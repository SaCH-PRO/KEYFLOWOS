import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FinancialCopilotService } from './financial-copilot.service';
import { SystemEmailService } from '../notifications/system-email.service';

const CHECK_INTERVAL_MS = 60 * 1000;
const TARGET_HOUR = 7;
const TARGET_DAY = 1;

@Injectable()
export class FinancialBriefingSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinancialBriefingSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinancialCopilotService) private readonly financialCopilot: FinancialCopilotService,
    @Inject(SystemEmailService) private readonly email: SystemEmailService,
  ) {}

  private formatTTD(amount: number): string {
    return `TTD ${Number(amount).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

  /**
   * Compose the Monday email body. Includes the AI summary, last week's
   * performance, "This Week's Money" so far, and the open FIN8 finance
   * action queue so the owner sees what to chase, not just what happened.
   */
  private buildEmailHtml(args: {
    businessName: string;
    briefing: Awaited<ReturnType<FinancialCopilotService['generateWeeklyBriefing']>>;
    thisWeek: { revenue: number; expenses: number; invoiceCount: number };
    openActions: Array<{ kind: string; severity: string; title: string; amount: number | null }>;
  }): string {
    const { briefing, thisWeek, openActions, businessName } = args;
    const highlights = (briefing.highlights ?? []).map((h) => `<li>${this.escapeHtml(h)}</li>`).join('') || '<li><em>None this week</em></li>';
    const concerns = (briefing.concerns ?? []).map((c) => `<li>${this.escapeHtml(c)}</li>`).join('') || '<li><em>No concerns flagged</em></li>';
    const actionsHtml = openActions.length
      ? `<ol style="padding-left:20px;margin:8px 0;">${openActions
          .map(
            (a) =>
              `<li style="margin:4px 0;"><strong>[${this.escapeHtml(a.severity)}]</strong> ${this.escapeHtml(a.title)}${a.amount != null ? ` — <strong>${this.formatTTD(a.amount)}</strong>` : ''}</li>`,
          )
          .join('')}</ol>`
      : '<p style="color:#16A34A;margin:8px 0;">No open finance actions — your queue is clear.</p>';

    return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0F172A;">
  <h2 style="color:#F97316;margin:0 0 4px;">Weekly Financial Briefing</h2>
  <p style="color:#64748B;margin:0 0 24px;">${this.escapeHtml(businessName)} · Monday plan</p>

  <p style="font-size:15px;line-height:1.55;">${this.escapeHtml(briefing.summary)}</p>

  <h3 style="margin:24px 0 8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;">Last Week</h3>
  <ul style="padding-left:20px;margin:8px 0;">
    <li>Revenue: <strong>${this.formatTTD(briefing.lastWeekRevenue)}</strong></li>
    <li>Expenses: <strong>${this.formatTTD(briefing.lastWeekExpenses)}</strong></li>
    <li>Net: <strong>${this.formatTTD(briefing.lastWeekNet)}</strong></li>
    <li>Outstanding receivables: <strong>${this.formatTTD(briefing.outstandingReceivables)}</strong></li>
  </ul>

  <h3 style="margin:24px 0 8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;">This Week's Money (so far)</h3>
  <ul style="padding-left:20px;margin:8px 0;">
    <li>Revenue collected: <strong>${this.formatTTD(thisWeek.revenue)}</strong> from ${thisWeek.invoiceCount} paid invoice(s)</li>
    <li>Expenses booked: <strong>${this.formatTTD(thisWeek.expenses)}</strong></li>
  </ul>

  <h3 style="margin:24px 0 8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;">Open Finance Actions</h3>
  ${actionsHtml}

  <h3 style="margin:24px 0 8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;">Highlights</h3>
  <ul style="padding-left:20px;margin:8px 0;">${highlights}</ul>

  <h3 style="margin:24px 0 8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;">Concerns</h3>
  <ul style="padding-left:20px;margin:8px 0;">${concerns}</ul>

  <h3 style="margin:24px 0 8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;">Recommendation</h3>
  <p style="margin:8px 0;">${this.escapeHtml(briefing.recommendation)}</p>

  <h3 style="margin:24px 0 8px;border-bottom:1px solid #E2E8F0;padding-bottom:6px;">Outlook</h3>
  <p style="margin:8px 0;">${this.escapeHtml(briefing.outlook)}</p>

  <p style="margin-top:32px;color:#64748B;font-size:13px;">— Keyflow Financial Copilot</p>
</body></html>`;
  }

  onModuleInit() {
    this.logger.log('[FinancialBriefingScheduler] Starting — checking every 60s for Monday 7am briefings');
    this.intervalRef = setInterval(() => {
      void this.checkAndRunBriefings();
    }, CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
    this.logger.log('[FinancialBriefingScheduler] Stopped');
  }

  private getLocalTimeInfo(tz: string): { hour: number; dayOfWeek: number; dateKey: string } {
    try {
      const now = new Date();
      const hourFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      });
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
      });
      const dateFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      const dayStr = dayFormatter.format(now);
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

      return {
        hour: parseInt(hourFormatter.format(now), 10),
        dayOfWeek: dayMap[dayStr] ?? now.getDay(),
        dateKey: dateFormatter.format(now),
      };
    } catch {
      const now = new Date();
      return {
        hour: now.getHours(),
        dayOfWeek: now.getDay(),
        dateKey: now.toISOString().split('T')[0],
      };
    }
  }

  private async hasBriefingForDate(businessId: string, dateKey: string): Promise<boolean> {
    const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);

    const existing = await this.prisma.client.notification.findFirst({
      where: {
        businessId,
        type: 'financial.weekly_briefing',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });

    return !!existing;
  }

  private async checkAndRunBriefings() {
    try {
      const businesses = await this.prisma.client.business.findMany({
        select: { id: true, timezone: true, name: true, ownerId: true },
      });

      for (const business of businesses) {
        const tz = business.timezone || 'America/Port_of_Spain';
        const { hour, dayOfWeek, dateKey } = this.getLocalTimeInfo(tz);

        if (dayOfWeek !== TARGET_DAY || hour !== TARGET_HOUR) continue;

        const alreadySent = await this.hasBriefingForDate(business.id, dateKey);
        if (alreadySent) continue;

        try {
          this.logger.log(`[FinancialBriefingScheduler] Generating weekly briefing for ${business.name} (${business.id})`);
          const briefing = await this.financialCopilot.generateWeeklyBriefing(business.id);

          // Compute "This Week's Money (so far)" — Monday-to-now in the
          // business's local timezone — and pull the open FIN8 finance
          // action queue. Both ride along in the email and notification.
          // dateKey is the local Monday (Trinidad-style YYYY-MM-DD); we
          // floor to that day's UTC midnight which is close enough as a
          // lower bound for a Monday-7am-local sweep.
          const weekStart = new Date(`${dateKey}T00:00:00.000Z`);
          const [thisWeekPaid, thisWeekExp, openActions] = await Promise.all([
            this.prisma.client.invoice.aggregate({
              where: { businessId: business.id, deletedAt: null, status: 'PAID', paidAt: { gte: weekStart } },
              _sum: { total: true },
              _count: true,
            }),
            this.prisma.client.expense.aggregate({
              where: { businessId: business.id, deletedAt: null, date: { gte: weekStart } },
              _sum: { amount: true },
            }),
            this.prisma.client.financeActionItem.findMany({
              where: { businessId: business.id, status: 'OPEN' },
              orderBy: [{ severity: 'asc' }, { amount: 'desc' }],
              take: 5,
              select: { kind: true, severity: true, title: true, amount: true },
            }),
          ]);
          const thisWeek = {
            revenue: Number(thisWeekPaid._sum.total ?? 0),
            invoiceCount: thisWeekPaid._count ?? 0,
            expenses: Number(thisWeekExp._sum.amount ?? 0),
          };
          const openActionPlain = openActions.map((a) => ({
            kind: a.kind,
            severity: a.severity,
            title: a.title,
            amount: a.amount == null ? null : Number(a.amount),
          }));

          await this.prisma.client.notification.create({
            data: {
              businessId: business.id,
              type: 'financial.weekly_briefing',
              title: 'Weekly Financial Briefing',
              body: briefing.summary,
              data: {
                lastWeekRevenue: briefing.lastWeekRevenue,
                lastWeekExpenses: briefing.lastWeekExpenses,
                lastWeekNet: briefing.lastWeekNet,
                outstandingReceivables: briefing.outstandingReceivables,
                cashPosition: briefing.cashPosition,
                highlights: briefing.highlights,
                concerns: briefing.concerns,
                recommendation: briefing.recommendation,
                outlook: briefing.outlook,
                thisWeek,
                openActions: openActionPlain,
              },
            },
          });

          // Send the Monday email to the business owner via Resend.
          // SystemEmailService no-ops gracefully when RESEND_API_KEY is
          // unset; we only log a warning so the notification still lands.
          if (this.email.isConfigured()) {
            try {
              const owner = await this.prisma.client.user.findUnique({
                where: { id: business.ownerId },
                select: { email: true },
              });
              if (owner?.email) {
                const html = this.buildEmailHtml({
                  businessName: business.name,
                  briefing,
                  thisWeek,
                  openActions: openActionPlain,
                });
                await this.email.sendTransactional({
                  to: owner.email,
                  subject: `Weekly Financial Briefing — ${business.name}`,
                  html,
                });
                this.logger.log(`[FinancialBriefingScheduler] Email sent to ${owner.email} for ${business.name}`);
              } else {
                this.logger.warn(`[FinancialBriefingScheduler] No owner email for ${business.id} — email skipped`);
              }
            } catch (emailErr) {
              this.logger.error(
                `[FinancialBriefingScheduler] Email send failed for ${business.id}: ${(emailErr as Error).message}`,
              );
            }
          }

          this.logger.log(`[FinancialBriefingScheduler] Briefing saved for ${business.name}`);
        } catch (error: any) {
          this.logger.error(`[FinancialBriefingScheduler] Failed for ${business.id}: ${(error as Error).message}`);
        }
      }
    } catch (error: any) {
      this.logger.error(`[FinancialBriefingScheduler] Check failed: ${(error as Error).message}`);
    }
  }
}
