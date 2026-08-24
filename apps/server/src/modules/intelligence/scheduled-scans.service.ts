import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RulesService, SYSTEM_RULES } from './rules.service';
import { SignalsService } from './signals.service';
import { CommandBridgeService } from './command-bridge.service';
import { HealthScoreService } from './health-score.service';
import { runGuarded } from '../../core/scheduling/safe-interval';

@Injectable()
export class ScheduledScansService implements OnModuleInit {
  private readonly logger = new Logger(ScheduledScansService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RulesService) private readonly rules: RulesService,
    @Inject(SignalsService) private readonly signals: SignalsService,
    @Inject(CommandBridgeService) private readonly bridge: CommandBridgeService,
    @Inject(HealthScoreService) private readonly health: HealthScoreService,
  ) {}

  async onModuleInit() {
    this.logger.log('ScheduledScansService initialized');
  }

  @Interval(1000 * 60 * 30)
  // Nest's SchedulerOrchestrator mounts @Interval with a raw
  // `setInterval(target, ms)` — no wrapper — so an async handler that rejects
  // becomes an unhandled rejection, and main.ts exits(1) on those. (@Cron is
  // NOT affected: the cron library catches both paths itself. Verified
  // empirically, not assumed.) The work stays in runAllScans() so callers and
  // tests are unchanged; only the scheduled entry point is guarded.
  runAllScansTick(): void {
    runGuarded('ScheduledScansService', () => this.runAllScans(), this.logger);
  }

  async runAllScans() {
    this.logger.log('Running scheduled business scans...');
    const businesses = await this.prisma.client.business.findMany({
      select: { id: true },
      take: 100,
    });

    for (const b of businesses) {
      try {
        await this.scanBusiness(b.id);
      } catch (err: any) {
        this.logger.error(`Scan failed for business ${b.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`Completed scans for ${businesses.length} businesses`);
  }

  async scanBusiness(businessId: string) {
    // Ensure system rules are seeded
    await this.rules.seedSystemRules(businessId);

    // Run deterministic rule evaluations
    await this.evaluateRules(businessId);

    // Calculate and store health scores
    const healthResults = await this.health.calculateAll(businessId);
    for (const result of healthResults) {
      await this.health.saveSnapshot(businessId, result);
    }

    // Generate commands from low health scores
    for (const result of healthResults) {
      if (result.score < 60) {
        await this.bridge.bridge({
          businessId,
          sourceModule: 'intelligence',
          sourceType: 'health',
          title: `${result.area} health is ${result.status.toLowerCase()}`,
          description: result.reasons.join('\n'),
          category: this.areaToCategory(result.area),
          actionType: 'REVIEW_HEALTH',
          priority: result.score < 40 ? 80 : 60,
          urgency: result.score < 40 ? 80 : 50,
          riskTier: result.score < 40 ? 3 : 2,
        });
      }
    }
  }

  private async evaluateRules(businessId: string) {
    const now = new Date();

    for (const rule of SYSTEM_RULES) {
      try {
        switch (rule.key) {
          case 'invoice_overdue': {
            const invoices = await this.prisma.client.invoice.findMany({
              where: { businessId, status: 'SENT', deletedAt: null, dueDate: { lt: now } },
              select: { id: true, contactId: true, total: true, dueDate: true },
            });
            for (const inv of invoices) {
              const paymentSum = await this.prisma.client.payment.aggregate({ where: { invoiceId: inv.id }, _sum: { amount: true } });
              const remaining = Number(inv.total ?? 0) - Number(paymentSum._sum.amount ?? 0);
              if (remaining <= 0) continue;
              await this.signals.upsertSignal(
                businessId,
                { module: 'commerce', type: 'OVERDUE_INVOICE', entityType: 'invoice', entityId: inv.id },
                {
                  module: 'commerce',
                  type: 'OVERDUE_INVOICE',
                  severity: 'WARN',
                  title: `Overdue invoice: ${remaining.toFixed(2)}`,
                  description: `Invoice ${inv.id.slice(0, 8)} is overdue by ${Math.ceil((now.getTime() - new Date(inv.dueDate!).getTime()) / 86400000)} days`,
                  entityType: 'invoice',
                  entityId: inv.id,
                  contactId: inv.contactId ?? undefined,
                  value: remaining,
                },
              );
              await this.bridge.bridge({
                businessId,
                sourceModule: 'commerce',
                sourceType: 'invoice',
                sourceId: inv.id,
                contactId: inv.contactId ?? undefined,
                title: `Collect overdue invoice (${remaining.toFixed(2)})`,
                description: `Invoice is overdue. Remaining balance: ${remaining.toFixed(2)}`,
                category: 'MONEY',
                actionType: 'COLLECT_PAYMENT',
                priority: 80,
                urgency: 80,
                riskTier: 2,
                expectedValue: remaining,
              });
            }
            break;
          }
          case 'stale_lead': {
            const staleDate = new Date(now.getTime() - 14 * 86400000);
            const leads = await this.prisma.client.contact.findMany({
              where: { businessId, deletedAt: null, status: 'LEAD', updatedAt: { lt: staleDate } },
              select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
            });
            for (const lead of leads) {
              const leadName = lead.displayName ?? `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() ?? lead.email ?? 'Unknown';
              await this.signals.upsertSignal(
                businessId,
                { module: 'crm', type: 'STALE_LEAD', entityType: 'contact', entityId: lead.id },
                {
                  module: 'crm',
                  type: 'STALE_LEAD',
                  severity: 'INFO',
                  title: `Stale lead: ${leadName}`,
                  description: 'No activity in 14+ days',
                  entityType: 'contact',
                  entityId: lead.id,
                },
              );
              await this.bridge.bridge({
                businessId,
                sourceModule: 'crm',
                sourceType: 'contact',
                sourceId: lead.id,
                title: `Follow up stale lead: ${leadName}`,
                category: 'PEOPLE',
                actionType: 'FOLLOW_UP',
                priority: 60,
                urgency: 50,
                riskTier: 1,
              });
            }
            break;
          }
          case 'quote_pending_followup': {
            const followupDate = new Date(now.getTime() - 3 * 86400000);
            const quotes = await this.prisma.client.quote.findMany({
              where: { businessId, status: 'SENT', updatedAt: { lt: followupDate } },
              select: { id: true, contactId: true, total: true },
            });
            for (const q of quotes) {
              await this.bridge.bridge({
                businessId,
                sourceModule: 'commerce',
                sourceType: 'quote',
                sourceId: q.id,
                contactId: q.contactId ?? undefined,
                title: `Follow up on quote (${q.total?.toFixed(2) ?? '0.00'})`,
                category: 'MONEY',
                actionType: 'FOLLOW_UP_QUOTE',
                priority: 60,
                urgency: 50,
                riskTier: 1,
                expectedValue: Number(q.total ?? 0),
              });
            }
            break;
          }
          case 'uncategorized_expense': {
            const expenses = await this.prisma.client.expense.findMany({
              where: { businessId, categoryId: null, deletedAt: null },
              select: { id: true, amount: true },
            });
            for (const ex of expenses) {
              await this.bridge.bridge({
                businessId,
                sourceModule: 'finance',
                sourceType: 'expense',
                sourceId: ex.id,
                title: `Categorize expense (${ex.amount?.toFixed(2) ?? '0.00'})`,
                category: 'MONEY',
                actionType: 'CATEGORIZE_EXPENSE',
                priority: 40,
                urgency: 30,
                riskTier: 1,
              });
            }
            break;
          }
          case 'booking_unconfirmed': {
            const bookings = await this.prisma.client.booking.findMany({
              where: { businessId, status: 'PENDING' },
              select: { id: true, contactId: true, startTime: true },
            });
            for (const bk of bookings) {
              await this.bridge.bridge({
                businessId,
                sourceModule: 'bookings',
                sourceType: 'booking',
                sourceId: bk.id,
                contactId: bk.contactId ?? undefined,
                title: 'Confirm pending booking',
                category: 'TIME',
                actionType: 'CONFIRM_BOOKING',
                priority: 70,
                urgency: 70,
                riskTier: 1,
                dueAt: bk.startTime ?? undefined,
              });
            }
            break;
          }
          case 'overdue_task': {
            const overdueContactTasks = await this.prisma.client.contactTask.findMany({
              where: { businessId, status: { not: 'COMPLETED' }, dueDate: { lt: now } },
              select: { id: true, contactId: true, title: true },
            });
            for (const t of overdueContactTasks) {
              await this.bridge.bridge({
                businessId,
                sourceModule: 'crm',
                sourceType: 'contact_task',
                sourceId: t.id,
                contactId: t.contactId ?? undefined,
                title: `Overdue task: ${t.title ?? 'Untitled'}`,
                category: 'WORK',
                actionType: 'COMPLETE_TASK',
                priority: 70,
                urgency: 70,
                riskTier: 2,
              });
            }
            const overdueProjectTasks = await this.prisma.client.projectTask.findMany({
              where: { businessId, status: { notIn: ['DONE'] }, dueDate: { lt: now } },
              select: { id: true, projectId: true, title: true },
            });
            for (const t of overdueProjectTasks) {
              await this.bridge.bridge({
                businessId,
                sourceModule: 'projects',
                sourceType: 'project_task',
                sourceId: t.id,
                title: `Overdue project task: ${t.title ?? 'Untitled'}`,
                category: 'WORK',
                actionType: 'COMPLETE_TASK',
                priority: 70,
                urgency: 70,
                riskTier: 2,
              });
            }
            break;
          }
          case 'storefront_no_products': {
            const count = await this.prisma.client.product.count({ where: { businessId, isActive: true } });
            if (count === 0) {
              await this.signals.upsertSignal(
                businessId,
                { module: 'storefront', type: 'NO_PRODUCTS' },
                {
                  module: 'storefront',
                  type: 'NO_PRODUCTS',
                  severity: 'WARN',
                  title: 'Storefront has no active products',
                  description: 'Add products or services to enable storefront sales',
                },
              );
              await this.bridge.bridge({
                businessId,
                sourceModule: 'storefront',
                title: 'Add products to storefront',
                category: 'SALES',
                actionType: 'ADD_PRODUCT',
                priority: 60,
                urgency: 40,
                riskTier: 1,
              });
            }
            break;
          }
          case 'blueprint_incomplete': {
            const bp = await this.prisma.client.business.findUnique({
              where: { id: businessId },
              select: { profileCompleteness: true },
            });
            if ((bp?.profileCompleteness ?? 0) < 80) {
              await this.bridge.bridge({
                businessId,
                sourceModule: 'system',
                title: 'Complete your business blueprint',
                description: `Blueprint is ${bp?.profileCompleteness ?? 0}% complete. Fill in missing details so KEYFLOWOS can guide you better.`,
                category: 'SYSTEM',
                actionType: 'COMPLETE_SETUP',
                priority: 50,
                urgency: 30,
                riskTier: 1,
              });
            }
            break;
          }
          case 'tax_period_due_soon': {
            const taxDue = new Date(now.getTime() + 14 * 86400000);
            const liabilities = await this.prisma.client.taxLiability.findMany({
              where: { businessId, status: 'OPEN', dueDate: { lte: taxDue, gte: now } },
              select: { id: true, amountDue: true, dueDate: true },
            });
            for (const tl of liabilities) {
              const daysUntil = Math.ceil((new Date(tl.dueDate!).getTime() - now.getTime()) / 86400000);
              await this.bridge.bridge({
                businessId,
                sourceModule: 'finance',
                sourceType: 'tax_liability',
                sourceId: tl.id,
                title: `File tax return (due in ${daysUntil} days)`,
                description: `Tax liability of ${Number(tl.amountDue ?? 0).toFixed(2)} is due soon`,
                category: 'MONEY',
                actionType: 'FILE_TAX',
                priority: 80,
                urgency: 80,
                riskTier: 3,
                dueAt: tl.dueDate ?? undefined,
              });
            }
            break;
          }
          default:
            break;
        }
      } catch (err: any) {
        this.logger.error(`Rule ${rule.key} failed for business ${businessId}: ${(err as Error).message}`);
      }
    }
  }

  private areaToCategory(area: string): string {
    const map: Record<string, string> = {
      money: 'MONEY',
      time: 'TIME',
      people: 'PEOPLE',
      sales: 'SALES',
      storefront: 'SALES',
      operations: 'WORK',
      risk: 'GOVERNANCE',
    };
    return map[area] ?? 'SYSTEM';
  }
}
