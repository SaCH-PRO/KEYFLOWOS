import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommandService } from '../command/command.service';

export interface HealthScore {
  score: number;
  label: string;
  trend: 'up' | 'down' | 'flat';
}

export interface BusinessCommandCenterDto {
  business: {
    id: string;
    name: string;
    currency: string;
  };
  generatedAt: string;
  health: {
    overallScore: number;
    money: HealthScore;
    time: HealthScore;
    people: HealthScore;
    sales: HealthScore;
    operations: HealthScore;
    governance: HealthScore;
  };
  today: {
    priorityCommands: number;
    pendingApprovals: number;
    dueTasks: number;
    meetingsOrBookings: number;
    moneyToCollect: number;
    urgentRisks: number;
  };
  flows: {
    financial: {
      cashBalance: number;
      outstandingInvoices: number;
      overdueInvoices: number;
      billsDue: number;
      taxReserved: number;
    };
    temporal: {
      pendingBookings: number;
      confirmedToday: number;
      overdueTasks: number;
    };
    people: {
      totalContacts: number;
      staleLeads: number;
      highValueCustomers: number;
    };
    sales: {
      openDeals: number;
      pendingQuotes: number;
      pipelineValue: number;
    };
    operations: {
      activeProjects: number;
      blockedTasks: number;
    };
  };
  key: {
    canAutoExecuteCount: number;
    needsApprovalCount: number;
    briefing: string;
  };
}

@Injectable()
export class OsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommandService) private readonly commandService: CommandService,
  ) {}

  async getCommandCenter(businessId: string): Promise<BusinessCommandCenterDto> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, currency: true },
    });

    const currency = business?.currency ?? 'TTD';
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const [
      commandSummary,
      cashAccounts,
      outstandingAgg,
      overdueAgg,
      billsDueAgg,
      taxPayableAccount,
      pendingBookings,
      confirmedToday,
      overdueTasks,
      totalContacts,
      staleLeads,
      highValueCustomers,
      openDeals,
      pendingQuotes,
      activeProjects,
      blockedTasks,
      pendingApprovals,
    ] = await Promise.all([
      this.commandService.summary(businessId),
      this.prisma.client.financialAccount.findMany({
        where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
        select: { currentBalance: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } },
        _sum: { total: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'OVERDUE' },
        _sum: { total: true },
      }),
      this.prisma.client.expense.aggregate({
        where: { businessId, status: 'BILL', dueDate: { gte: todayStart, lt: todayEnd } },
        _sum: { amount: true },
      }),
      this.prisma.client.chartOfAccount.findFirst({
        where: { businessId, systemKey: 'TAX_PAYABLE' },
        select: { id: true },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, status: 'PENDING' },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, status: 'CONFIRMED', startTime: { gte: todayStart, lt: todayEnd } },
      }),
      this.prisma.client.projectTask.count({
        where: { businessId, deletedAt: null, isCompleted: false, dueDate: { lt: now } },
      }),
      this.prisma.client.contact.count({
        where: { businessId, deletedAt: null },
      }),
      this.prisma.client.contact.count({
        where: {
          businessId,
          deletedAt: null,
          status: 'LEAD',
          nextActionAt: { lt: now },
        },
      }),
      this.prisma.client.contact.count({
        where: {
          businessId,
          deletedAt: null,
          status: 'CLIENT',
          lifetimeValue: { gte: 5000 },
        },
      }),
      this.prisma.client.deal.count({
        where: { businessId, status: 'OPEN' },
      }),
      this.prisma.client.quote.count({
        where: { businessId, status: 'SENT' },
      }),
      this.prisma.client.project.count({
        where: { businessId, deletedAt: null, status: { in: ['ACTIVE', 'IN_PROGRESS'] } },
      }),
      this.prisma.client.projectTask.count({
        where: { businessId, deletedAt: null, status: 'BLOCKED' },
      }),
      this.prisma.client.aiApprovalItem.count({
        where: { businessId, status: 'pending' },
      }),
    ]);

    let taxReserved = 0;
    if (taxPayableAccount) {
      const agg = await this.prisma.client.ledgerEntry.aggregate({
        where: { accountId: taxPayableAccount.id },
        _sum: { debit: true, credit: true },
      });
      taxReserved = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }

    const cashBalance = cashAccounts.reduce((sum, a) => sum + Number(a.currentBalance ?? 0), 0);
    const outstandingInvoices = Number(outstandingAgg._sum.total ?? 0);
    const overdueInvoices = Number(overdueAgg._sum.total ?? 0);
    const billsDue = Number(billsDueAgg._sum.amount ?? 0);
    const pipelineValueAgg = await this.prisma.client.deal.aggregate({
      where: { businessId, status: 'OPEN' },
      _sum: { value: true },
    });
    const pipelineValue = Number(pipelineValueAgg._sum.value ?? 0);

    const moneyHealth = this.computeHealthScore(cashBalance, overdueInvoices, billsDue);
    const timeHealth = this.computeHealthScore(100 - overdueTasks * 10, pendingBookings * 5, 0);
    const peopleHealth = this.computeHealthScore(totalContacts > 0 ? 70 : 40, staleLeads * -5, highValueCustomers * 5);
    const salesHealth = this.computeHealthScore(openDeals > 0 ? 60 : 30, pendingQuotes * 5, 0);
    const opsHealth = this.computeHealthScore(activeProjects > 0 ? 70 : 50, -blockedTasks * 10, 0);
    const govHealth = this.computeHealthScore(100 - pendingApprovals * 15, 0, 0);

    const overallScore = Math.round(
      (moneyHealth.score + timeHealth.score + peopleHealth.score + salesHealth.score + opsHealth.score + govHealth.score) / 6,
    );

    return {
      business: {
        id: businessId,
        name: business?.name ?? 'Your Business',
        currency,
      },
      generatedAt: now.toISOString(),
      health: {
        overallScore,
        money: moneyHealth,
        time: timeHealth,
        people: peopleHealth,
        sales: salesHealth,
        operations: opsHealth,
        governance: govHealth,
      },
      today: {
        priorityCommands: commandSummary.open + commandSummary.waitingApproval,
        pendingApprovals,
        dueTasks: overdueTasks,
        meetingsOrBookings: confirmedToday,
        moneyToCollect: overdueInvoices,
        urgentRisks: commandSummary.byCategory.find((c) => c.category === 'MONEY')?.count ?? 0,
      },
      flows: {
        financial: {
          cashBalance,
          outstandingInvoices,
          overdueInvoices,
          billsDue,
          taxReserved,
        },
        temporal: {
          pendingBookings,
          confirmedToday,
          overdueTasks,
        },
        people: {
          totalContacts,
          staleLeads,
          highValueCustomers,
        },
        sales: {
          openDeals,
          pendingQuotes,
          pipelineValue,
        },
        operations: {
          activeProjects,
          blockedTasks,
        },
      },
      key: {
        canAutoExecuteCount: commandSummary.executableByKey,
        needsApprovalCount: commandSummary.waitingApproval,
        briefing: `You have ${commandSummary.open} priority actions today.`,
      },
    };
  }

  private computeHealthScore(base: number, penalty: number, bonus: number): HealthScore {
    const raw = base + penalty + bonus;
    const score = Math.max(0, Math.min(100, Math.round(raw)));
    let label = 'Healthy';
    if (score < 40) label = 'Critical';
    else if (score < 60) label = 'At Risk';
    else if (score < 80) label = 'Fair';
    const trend: 'up' | 'down' | 'flat' = penalty > bonus ? 'down' : bonus > penalty ? 'up' : 'flat';
    return { score, label, trend };
  }
}
