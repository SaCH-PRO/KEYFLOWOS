import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface SlowPayerEntry {
  contactId: string;
  contactName: string;
  email: string | null;
  avgDaysToPay: number;
  paidInvoiceCount: number;
  outstandingTotal: number;
  threshold: number;
  severity: 'mild' | 'moderate' | 'severe';
}

export interface SlowPayerReport {
  businessId: string;
  generatedAt: string;
  businessMedianDays: number;
  threshold: number;
  totalContactsScanned: number;
  slowPayers: SlowPayerEntry[];
}

const SLOW_PAYER_TYPE = 'SLOW_PAYER';
const MIN_INVOICES_PER_CONTACT = 2;

@Injectable()
export class SlowPayerDetector {
  private readonly logger = new Logger(SlowPayerDetector.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async detect(businessId: string): Promise<SlowPayerReport> {
    const ninetyDaysAgo = new Date(Date.now() - 180 * 86400_000);

    const paid = await this.db.invoice.findMany({
      where: {
        businessId, deletedAt: null,
        status: 'PAID',
        paidAt: { gte: ninetyDaysAgo },
        contactId: { not: undefined },
      },
      select: {
        contactId: true,
        createdAt: true,
        paidAt: true,
        total: true,
      },
    });

    const perContact = new Map<string, number[]>();
    const allDays: number[] = [];
    for (const inv of paid) {
      if (!inv.paidAt) continue;
      const days = Math.max(0, (inv.paidAt.getTime() - inv.createdAt.getTime()) / 86400_000);
      allDays.push(days);
      const list = perContact.get(inv.contactId) ?? [];
      list.push(days);
      perContact.set(inv.contactId, list);
    }

    const businessMedian = this.median(allDays);
    const threshold = businessMedian * 1.5;

    const slow: SlowPayerEntry[] = [];
    if (allDays.length >= 5 && threshold > 0) {
      const contactIds = Array.from(perContact.keys()).filter(
        (id) => (perContact.get(id) ?? []).length >= MIN_INVOICES_PER_CONTACT,
      );
      if (contactIds.length > 0) {
        const [contacts, outstanding] = await Promise.all([
          this.db.contact.findMany({
            where: { id: { in: contactIds }, businessId },
            select: { id: true, firstName: true, lastName: true, email: true, displayName: true },
          }),
          this.db.invoice.groupBy({
            by: ['contactId'],
            where: {
              businessId, deletedAt: null,
              status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] },
              contactId: { in: contactIds },
            },
            _sum: { total: true },
          }),
        ]);
        const outstandingMap = new Map(
          outstanding.map((o) => [o.contactId as string, Number(o._sum.total ?? 0)]),
        );
        const contactMap = new Map(contacts.map((c) => [c.id, c]));

        for (const id of contactIds) {
          const days = perContact.get(id) ?? [];
          const avg = days.reduce((a, b) => a + b, 0) / days.length;
          if (avg < threshold) continue;
          const c = contactMap.get(id);
          if (!c) continue;
          const ratio = avg / Math.max(1, businessMedian);
          const severity: SlowPayerEntry['severity'] =
            ratio >= 3 ? 'severe' : ratio >= 2 ? 'moderate' : 'mild';
          slow.push({
            contactId: id,
            contactName: c.displayName || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.email || 'Unknown',
            email: c.email ?? null,
            avgDaysToPay: Math.round(avg * 10) / 10,
            paidInvoiceCount: days.length,
            outstandingTotal: Math.round((outstandingMap.get(id) ?? 0) * 100) / 100,
            threshold: Math.round(threshold * 10) / 10,
            severity,
          });
        }
      }
    }

    slow.sort((a, b) => b.avgDaysToPay - a.avgDaysToPay || b.outstandingTotal - a.outstandingTotal);

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      businessMedianDays: Math.round(businessMedian * 10) / 10,
      threshold: Math.round(threshold * 10) / 10,
      totalContactsScanned: perContact.size,
      slowPayers: slow,
    };
  }

  /**
   * Mark detected slow-payer contacts so the CRM relationship-health surface
   * (#428) can read it without re-running the detector. We piggy-back on the
   * existing `tags` array since `relationshipHealth` is owned by another
   * service and uses a different value space.
   */
  async syncContactTags(businessId: string, report: SlowPayerReport): Promise<number> {
    const slowIds = new Set(report.slowPayers.map((s) => s.contactId));
    if (slowIds.size === 0) return 0;
    let updated = 0;
    const contacts = await this.db.contact.findMany({
      where: { id: { in: Array.from(slowIds) }, businessId },
      select: { id: true, tags: true },
    });
    for (const c of contacts) {
      const tags = new Set(c.tags ?? []);
      if (tags.has('slow-payer')) continue;
      tags.add('slow-payer');
      await this.db.contact.update({
        where: { id: c.id },
        data: { tags: Array.from(tags) },
      }).then(() => { updated++; }).catch(() => {});
    }
    // Clear the tag from contacts no longer flagged.
    const allTagged = await this.db.contact.findMany({
      where: { businessId, tags: { has: 'slow-payer' } },
      select: { id: true, tags: true },
    });
    for (const c of allTagged) {
      if (slowIds.has(c.id)) continue;
      await this.db.contact.update({
        where: { id: c.id },
        data: { tags: (c.tags ?? []).filter((t) => t !== 'slow-payer') },
      }).catch(() => {});
    }
    return updated;
  }

  /**
   * Idempotent upsert of a single SLOW_PAYER RevenueAction per contact.
   * Returns the number of newly-created actions (excluding refreshes).
   */
  async syncRevenueActions(businessId: string, report: SlowPayerReport): Promise<number> {
    let created = 0;
    for (const s of report.slowPayers) {
      const existing = await this.db.revenueAction.findUnique({
        where: {
          businessId_type_relatedType_relatedId: {
            businessId,
            type: SLOW_PAYER_TYPE,
            relatedType: 'contact',
            relatedId: s.contactId,
          },
        },
        select: { id: true, status: true },
      });
      const data = {
        businessId,
        type: SLOW_PAYER_TYPE,
        title: `Slow payer: ${s.contactName} (avg ${s.avgDaysToPay}d)`,
        detail:
          `Pays ${s.avgDaysToPay} days on average — ${(s.avgDaysToPay / report.businessMedianDays).toFixed(1)}× ` +
          `your business median (${report.businessMedianDays}d). ` +
          (s.outstandingTotal > 0 ? `Currently owes ${s.outstandingTotal.toFixed(2)}.` : ''),
        priority: s.severity === 'severe' ? 1 : s.severity === 'moderate' ? 2 : 3,
        contactId: s.contactId,
        relatedType: 'contact',
        relatedId: s.contactId,
        amountAtRisk: s.outstandingTotal,
        recommendation: {
          explanation:
            `${s.contactName} consistently pays slowly. Tightening terms or asking for deposits ` +
            `up-front improves your cash conversion cycle.`,
          suggestedAction: 'Send a polite reminder + propose deposit-on-acceptance for the next quote.',
          source: 'template' as const,
        },
      };
      if (existing) {
        if (existing.status === 'COMPLETED' || existing.status === 'DISMISSED') continue;
        await this.db.revenueAction.update({
          where: { id: existing.id },
          data: {
            title: data.title, detail: data.detail, priority: data.priority,
            amountAtRisk: data.amountAtRisk, recommendation: data.recommendation,
          },
        });
      } else {
        await this.db.revenueAction.create({ data });
        created++;
      }
    }
    return created;
  }
}
