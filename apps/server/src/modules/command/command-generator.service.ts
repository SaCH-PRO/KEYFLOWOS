import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

interface CommandSeed {
  sourceModule: string;
  sourceType?: string;
  sourceId?: string;
  actionType: string;
  title: string;
  description?: string;
  category: string;
  priority: number;
  urgency: number;
  impactScore: number;
  expectedValue?: number;
  currency?: string;
  riskTier: number;
  requiresApproval: boolean;
  executableByKey: boolean;
  executionTool?: string;
  recommendedBy: string;
  dueAt?: Date;
}

@Injectable()
export class CommandGeneratorService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async generateForBusiness(businessId: string) {
    const seeds: CommandSeed[] = [];

    await this.seedFromOverdueInvoices(businessId, seeds);
    await this.seedFromStaleQuotes(businessId, seeds);
    await this.seedFromUncategorizedExpenses(businessId, seeds);
    await this.seedFromPendingApprovals(businessId, seeds);
    await this.seedFromOverdueTasks(businessId, seeds);
    await this.seedFromUnconfirmedBookings(businessId, seeds);

    let created = 0;
    let skipped = 0;

    for (const seed of seeds) {
      try {
        await this.prisma.client.commandItem.create({
          data: {
            businessId,
            ...seed,
            expectedValue: seed.expectedValue ? String(seed.expectedValue) : null,
          },
        });
        created++;
      } catch (err: unknown) {
        // P2002 = unique constraint violation — item already exists
        if (typeof err === 'object' && err !== null && 'code' in err && (err as Record<string, unknown>).code === 'P2002') {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    return { created, skipped, total: seeds.length };
  }

  private async seedFromOverdueInvoices(businessId: string, seeds: CommandSeed[]) {
    const invoices = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, status: 'OVERDUE' },
      orderBy: [{ total: 'desc' }],
      take: 10,
      select: { id: true, total: true, invoiceNumber: true, dueDate: true, currency: true },
    });

    for (const inv of invoices) {
      seeds.push({
        sourceModule: 'finance',
        sourceType: 'invoice',
        sourceId: inv.id,
        actionType: 'COLLECT_RECEIVABLE',
        title: `Chase overdue invoice ${inv.invoiceNumber ?? ''}`.trim(),
        description: `Invoice is overdue. Collect ${inv.currency ?? 'TTD'} ${inv.total?.toString() ?? '0'} to improve cash position.`,
        category: 'MONEY',
        priority: 90,
        urgency: 90,
        impactScore: 85,
        expectedValue: inv.total ? Number(inv.total) : undefined,
        currency: inv.currency ?? undefined,
        riskTier: 2,
        requiresApproval: false,
        executableByKey: true,
        executionTool: 'finance.queueInvoiceReminders',
        recommendedBy: 'SYSTEM',
        dueAt: inv.dueDate ?? undefined,
      });
    }
  }

  private async seedFromStaleQuotes(businessId: string, seeds: CommandSeed[]) {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 7);

    const quotes = await this.prisma.client.quote.findMany({
      where: {
        businessId,
        status: 'SENT',
        sentAt: { lt: staleDate },
      },
      orderBy: [{ total: 'desc' }],
      take: 10,
      select: { id: true, total: true, quoteNumber: true, sentAt: true, currency: true },
    });

    for (const q of quotes) {
      seeds.push({
        sourceModule: 'commerce',
        sourceType: 'quote',
        sourceId: q.id,
        actionType: 'FOLLOW_UP_QUOTE',
        title: `Follow up quote ${q.quoteNumber ?? ''}`.trim(),
        description: `Quote sent ${q.sentAt?.toISOString().slice(0, 10)} has not been responded to. Value: ${q.currency ?? 'TTD'} ${q.total?.toString() ?? '0'}.`,
        category: 'SALES',
        priority: 75,
        urgency: 70,
        impactScore: 70,
        expectedValue: q.total ? Number(q.total) : undefined,
        currency: q.currency ?? undefined,
        riskTier: 2,
        requiresApproval: false,
        executableByKey: true,
        executionTool: 'sales.draftQuoteFollowUps',
        recommendedBy: 'SYSTEM',
      });
    }
  }

  private async seedFromUncategorizedExpenses(businessId: string, seeds: CommandSeed[]) {
    const expenses = await this.prisma.client.expense.findMany({
      where: { businessId, categoryId: null },
      orderBy: [{ amount: 'desc' }],
      take: 5,
      select: { id: true, amount: true, vendor: true, date: true, currency: true },
    });

    for (const e of expenses) {
      seeds.push({
        sourceModule: 'finance',
        sourceType: 'expense',
        sourceId: e.id,
        actionType: 'CATEGORIZE_EXPENSE',
        title: 'Categorise expense',
        description: `${e.vendor ?? 'Unknown vendor'} · ${e.date?.toISOString().slice(0, 10)}`,
        category: 'MONEY',
        priority: 40,
        urgency: 40,
        impactScore: 20,
        expectedValue: e.amount ? Number(e.amount) : undefined,
        currency: e.currency ?? undefined,
        riskTier: 1,
        requiresApproval: false,
        executableByKey: true,
        executionTool: 'finance.categorizeExpenseDraft',
        recommendedBy: 'SYSTEM',
      });
    }
  }

  private async seedFromPendingApprovals(businessId: string, seeds: CommandSeed[]) {
    const approvals = await this.prisma.client.aiApprovalItem.findMany({
      where: { businessId, status: 'pending' },
      orderBy: [{ createdAt: 'desc' }],
      take: 10,
      select: { id: true, title: true, description: true, riskTier: true, createdAt: true },
    });

    for (const a of approvals) {
      seeds.push({
        sourceModule: 'governance',
        sourceType: 'aiApproval',
        sourceId: a.id,
        actionType: 'REVIEW_APPROVAL',
        title: a.title,
        description: a.description ?? 'An AI action requires your approval.',
        category: 'GOVERNANCE',
        priority: 80,
        urgency: 80,
        impactScore: 60,
        riskTier: a.riskTier ?? 2,
        requiresApproval: true,
        executableByKey: false,
        recommendedBy: 'KEY',
      });
    }
  }

  private async seedFromOverdueTasks(businessId: string, seeds: CommandSeed[]) {
    const now = new Date();
    const tasks = await this.prisma.client.projectTask.findMany({
      where: {
        businessId,
        deletedAt: null,
        isCompleted: false,
        dueDate: { lt: now },
      },
      orderBy: [{ dueDate: 'asc' }],
      take: 10,
      select: { id: true, title: true, dueDate: true, projectId: true },
    });

    for (const t of tasks) {
      seeds.push({
        sourceModule: 'operations',
        sourceType: 'projectTask',
        sourceId: t.id,
        actionType: 'COMPLETE_OVERDUE_TASK',
        title: `Overdue task: ${t.title}`,
        description: `Task was due ${t.dueDate?.toISOString().slice(0, 10)}. Completing it will unblock project progress.`,
        category: 'WORK',
        priority: 70,
        urgency: 75,
        impactScore: 50,
        riskTier: 2,
        requiresApproval: false,
        executableByKey: false,
        recommendedBy: 'SYSTEM',
      });
    }
  }

  private async seedFromUnconfirmedBookings(businessId: string, seeds: CommandSeed[]) {
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'PENDING',
      },
      orderBy: [{ startTime: 'asc' }],
      take: 10,
      select: { id: true, startTime: true, endTime: true, contactId: true },
    });

    for (const b of bookings) {
      seeds.push({
        sourceModule: 'temporal',
        sourceType: 'booking',
        sourceId: b.id,
        actionType: 'CONFIRM_BOOKING',
        title: 'Confirm pending booking',
        description: `Booking starting ${b.startTime?.toISOString().slice(0, 10)} needs confirmation.`,
        category: 'TIME',
        priority: 65,
        urgency: 60,
        impactScore: 40,
        riskTier: 1,
        requiresApproval: false,
        executableByKey: false,
        recommendedBy: 'SYSTEM',
        dueAt: b.startTime ?? undefined,
      });
    }
  }
}
