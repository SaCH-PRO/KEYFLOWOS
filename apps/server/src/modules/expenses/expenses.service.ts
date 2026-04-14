import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ExpenseCreatedPayload } from '../../core/event-bus/events.types';

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async listExpenses(
    businessId: string,
    filters?: {
      startDate?: string;
      endDate?: string;
      period?: string;
      categoryId?: string;
      vendor?: string;
      search?: string;
      paymentMethod?: string;
      tag?: string;
      isRecurring?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const where: any = { businessId, deletedAt: null };

    if (filters?.startDate || filters?.endDate || filters?.period) {
      const range = this.getDateRange(filters?.period, filters?.startDate, filters?.endDate);
      where.date = { gte: range.start, lte: range.end };
    }
    if (filters?.categoryId) {
      where.categoryId = filters.categoryId;
    }
    if (filters?.vendor) {
      where.vendor = { contains: filters.vendor, mode: 'insensitive' };
    }
    if (filters?.search) {
      where.OR = [
        { description: { contains: filters.search, mode: 'insensitive' } },
        { vendor: { contains: filters.search, mode: 'insensitive' } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters?.paymentMethod) {
      where.paymentMethod = filters.paymentMethod;
    }
    if (filters?.tag) {
      where.tags = { has: filters.tag };
    }
    if (filters?.isRecurring !== undefined) {
      where.isRecurring = filters.isRecurring;
    }

    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 50;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.client.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        include: { category: true },
        skip,
        take: limit,
      }),
      this.prisma.client.expense.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getExpense(businessId: string, expenseId: string) {
    return this.prisma.client.expense.findFirst({
      where: { id: expenseId, businessId, deletedAt: null },
      include: { category: true },
    });
  }

  async createExpense(input: {
    businessId: string;
    description: string;
    amount: number;
    currency?: string;
    date?: string | Date;
    vendor?: string;
    receiptUrl?: string;
    notes?: string;
    paymentMethod?: string;
    tags?: string[];
    isRecurring?: boolean;
    recurringFrequency?: string;
    categoryId?: string;
    projectId?: string;
    contactId?: string;
    serviceId?: string;
  }) {
    const expense = await this.prisma.client.expense.create({
      data: {
        businessId: input.businessId,
        description: input.description,
        amount: input.amount,
        currency: input.currency ?? 'TTD',
        date: input.date ? new Date(input.date) : new Date(),
        vendor: input.vendor ?? null,
        receiptUrl: input.receiptUrl ?? null,
        notes: input.notes ?? null,
        paymentMethod: input.paymentMethod ?? null,
        tags: input.tags ?? [],
        isRecurring: input.isRecurring ?? false,
        recurringFrequency: input.recurringFrequency ?? null,
        categoryId: input.categoryId ?? null,
        projectId: input.projectId ?? null,
        contactId: input.contactId ?? null,
        serviceId: input.serviceId ?? null,
      },
      include: { category: true },
    });

    this.events.emit('expense.created', {
      expense: { id: expense.id, businessId: input.businessId, amount: expense.amount, description: expense.description, categoryId: expense.categoryId },
      businessId: input.businessId,
    } as ExpenseCreatedPayload);

    return expense;
  }

  async updateExpense(input: {
    businessId: string;
    expenseId: string;
    description?: string;
    amount?: number;
    currency?: string;
    date?: string | Date;
    vendor?: string;
    receiptUrl?: string;
    notes?: string;
    paymentMethod?: string;
    tags?: string[];
    isRecurring?: boolean;
    recurringFrequency?: string;
    categoryId?: string | null;
    projectId?: string | null;
    contactId?: string | null;
    serviceId?: string | null;
  }) {
    return this.prisma.client.expense.update({
      where: { id: input.expenseId, businessId: input.businessId },
      data: {
        ...(input.description !== undefined && { description: input.description }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.date !== undefined && { date: new Date(input.date) }),
        ...(input.vendor !== undefined && { vendor: input.vendor }),
        ...(input.receiptUrl !== undefined && { receiptUrl: input.receiptUrl }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.paymentMethod !== undefined && { paymentMethod: input.paymentMethod }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.isRecurring !== undefined && { isRecurring: input.isRecurring }),
        ...(input.recurringFrequency !== undefined && { recurringFrequency: input.recurringFrequency }),
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
        ...(input.projectId !== undefined && { projectId: input.projectId }),
        ...(input.contactId !== undefined && { contactId: input.contactId }),
        ...(input.serviceId !== undefined && { serviceId: input.serviceId }),
      },
      include: { category: true },
    });
  }

  async deleteExpense(businessId: string, expenseId: string) {
    return this.prisma.client.expense.update({
      where: { id: expenseId, businessId },
      data: { deletedAt: new Date() },
    });
  }

  async listCategories(businessId: string) {
    return this.prisma.client.expenseCategory.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { expenses: true } },
      },
    });
  }

  async createCategory(input: {
    businessId: string;
    name: string;
    icon?: string;
    color?: string;
  }) {
    return this.prisma.client.expenseCategory.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        icon: input.icon ?? null,
        color: input.color ?? null,
      },
    });
  }

  async deleteCategory(businessId: string, categoryId: string) {
    await this.prisma.client.expense.updateMany({
      where: { businessId, categoryId },
      data: { categoryId: null },
    });
    return this.prisma.client.expenseCategory.delete({
      where: { id: categoryId, businessId },
    });
  }

  private getDateRange(period?: string, startDate?: string, endDate?: string) {
    const now = new Date();
    if (startDate && endDate) {
      return { start: new Date(startDate), end: new Date(endDate) };
    }
    switch (period) {
      case '7d':
        return { start: new Date(now.getTime() - 7 * 86400000), end: now };
      case '90d':
        return { start: new Date(now.getTime() - 90 * 86400000), end: now };
      case '12m':
        return { start: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()), end: now };
      case 'ytd':
        return { start: new Date(now.getFullYear(), 0, 1), end: now };
      case '30d':
      default:
        return { start: new Date(now.getTime() - 30 * 86400000), end: now };
    }
  }

  async getExpenseSummary(businessId: string, period?: string, customStart?: string, customEnd?: string) {
    const { start: startDate, end: endDate } = this.getDateRange(period, customStart, customEnd);

    const prevDuration = endDate.getTime() - startDate.getTime();
    const prevStart = new Date(startDate.getTime() - prevDuration);
    const prevEnd = new Date(startDate.getTime());

    const where = {
      businessId,
      deletedAt: null as Date | null,
      date: { gte: startDate, lte: endDate },
    };

    const prevWhere = {
      businessId,
      deletedAt: null as Date | null,
      date: { gte: prevStart, lte: prevEnd },
    };

    const [expenses, prevExpenses, categories] = await Promise.all([
      this.prisma.client.expense.findMany({
        where,
        include: { category: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.client.expense.findMany({
        where: prevWhere,
        select: { amount: true, categoryId: true },
      }),
      this.prisma.client.expenseCategory.findMany({
        where: { businessId },
      }),
    ]);

    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const count = expenses.length;
    const prevTotal = prevExpenses.reduce((sum, e) => sum + e.amount, 0);
    const prevCount = prevExpenses.length;
    const changePercent = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
    const averageExpense = count > 0 ? total / count : 0;

    const largestExpense = expenses.length > 0
      ? expenses.reduce((max, e) => e.amount > max.amount ? e : max)
      : null;

    const byCategory: Record<string, { name: string; color: string | null; total: number; count: number; prevTotal: number }> = {};
    for (const expense of expenses) {
      const catName = expense.category?.name ?? 'Uncategorized';
      const catColor = expense.category?.color ?? null;
      const catId = expense.categoryId ?? 'uncategorized';
      if (!byCategory[catId]) {
        byCategory[catId] = { name: catName, color: catColor, total: 0, count: 0, prevTotal: 0 };
      }
      byCategory[catId].total += expense.amount;
      byCategory[catId].count += 1;
    }
    for (const pe of prevExpenses) {
      const catId = pe.categoryId ?? 'uncategorized';
      if (byCategory[catId]) {
        byCategory[catId].prevTotal += pe.amount;
      }
    }

    const byPaymentMethod: Record<string, { total: number; count: number }> = {};
    for (const expense of expenses) {
      const method = expense.paymentMethod ?? 'unspecified';
      if (!byPaymentMethod[method]) {
        byPaymentMethod[method] = { total: 0, count: 0 };
      }
      byPaymentMethod[method].total += expense.amount;
      byPaymentMethod[method].count += 1;
    }

    const monthlyTrend: Record<string, number> = {};
    for (const expense of expenses) {
      const key = `${expense.date.getFullYear()}-${String(expense.date.getMonth() + 1).padStart(2, '0')}`;
      monthlyTrend[key] = (monthlyTrend[key] ?? 0) + expense.amount;
    }

    const dailyTrend: Record<string, number> = {};
    for (const expense of expenses) {
      const key = expense.date.toISOString().split('T')[0];
      dailyTrend[key] = (dailyTrend[key] ?? 0) + expense.amount;
    }

    const allTags = new Set<string>();
    let uncategorizedCount = 0;
    let missingReceiptCount = 0;
    let recurringCount = 0;
    const byProject: Record<string, { name: string; total: number; count: number }> = {};
    const byContact: Record<string, { total: number; count: number }> = {};
    const byService: Record<string, { total: number; count: number }> = {};
    for (const expense of expenses) {
      if (expense.tags) {
        for (const tag of expense.tags) allTags.add(tag);
      }
      if (!expense.categoryId) uncategorizedCount++;
      if (!expense.receiptUrl) missingReceiptCount++;
      if (expense.isRecurring) recurringCount++;
      if (expense.projectId) {
        if (!byProject[expense.projectId]) byProject[expense.projectId] = { name: '', total: 0, count: 0 };
        byProject[expense.projectId].total += expense.amount;
        byProject[expense.projectId].count += 1;
      }
      if (expense.contactId) {
        if (!byContact[expense.contactId]) byContact[expense.contactId] = { total: 0, count: 0 };
        byContact[expense.contactId].total += expense.amount;
        byContact[expense.contactId].count += 1;
      }
      if (expense.serviceId) {
        if (!byService[expense.serviceId]) byService[expense.serviceId] = { total: 0, count: 0 };
        byService[expense.serviceId].total += expense.amount;
        byService[expense.serviceId].count += 1;
      }
    }

    const projectIds = Object.keys(byProject);
    if (projectIds.length > 0) {
      const projects = await this.prisma.client.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      });
      for (const p of projects) {
        if (byProject[p.id]) byProject[p.id].name = p.name;
      }
    }

    return {
      period: period ?? '30d',
      startDate,
      endDate,
      total,
      count,
      averageExpense,
      uncategorizedCount,
      missingReceiptCount,
      recurringCount,
      largestExpense: largestExpense ? { id: largestExpense.id, description: largestExpense.description, amount: largestExpense.amount, date: largestExpense.date, vendor: largestExpense.vendor } : null,
      comparison: {
        prevTotal,
        prevCount,
        changePercent: Math.round(changePercent * 10) / 10,
        direction: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
      },
      byCategory: Object.entries(byCategory).map(([id, data]) => ({
        categoryId: id,
        ...data,
        percent: total > 0 ? Math.round((data.total / total) * 1000) / 10 : 0,
      })).sort((a, b) => b.total - a.total),
      byPaymentMethod: Object.entries(byPaymentMethod).map(([method, data]) => ({
        method,
        ...data,
      })).sort((a, b) => b.total - a.total),
      monthlyTrend: Object.entries(monthlyTrend).map(([month, total]) => ({
        month,
        total,
      })),
      dailyTrend: Object.entries(dailyTrend).map(([date, total]) => ({
        date,
        total,
      })),
      tags: Array.from(allTags),
      byProject: Object.entries(byProject).map(([id, data]) => ({ projectId: id, ...data })),
      byContact: Object.entries(byContact).map(([id, data]) => ({ contactId: id, ...data })),
      byService: Object.entries(byService).map(([id, data]) => ({ serviceId: id, ...data })),
    };
  }

  async getVendorAnalytics(businessId: string, period?: string, customStart?: string, customEnd?: string) {
    const { start: startDate, end: endDate } = this.getDateRange(period, customStart, customEnd);
    const where = { businessId, deletedAt: null as Date | null, date: { gte: startDate, lte: endDate }, vendor: { not: null } };

    const expenses = await this.prisma.client.expense.findMany({
      where: where as any,
      select: { vendor: true, amount: true, date: true, categoryId: true },
      orderBy: { date: 'asc' },
    });

    const vendors: Record<string, { total: number; count: number; average: number; lastDate: Date; months: Set<string> }> = {};
    for (const e of expenses) {
      const v = e.vendor!;
      if (!vendors[v]) {
        vendors[v] = { total: 0, count: 0, average: 0, lastDate: e.date, months: new Set() };
      }
      vendors[v].total += e.amount;
      vendors[v].count += 1;
      if (e.date > vendors[v].lastDate) vendors[v].lastDate = e.date;
      vendors[v].months.add(`${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, '0')}`);
    }

    return Object.entries(vendors)
      .map(([name, data]) => ({
        name,
        total: data.total,
        count: data.count,
        average: Math.round((data.total / data.count) * 100) / 100,
        lastDate: data.lastDate,
        frequency: data.months.size,
      }))
      .sort((a, b) => b.total - a.total);
  }

  async getMarginAnalysis(businessId: string, period?: string, customStart?: string, customEnd?: string) {
    const { start: startDate, end: endDate } = this.getDateRange(period, customStart, customEnd);

    const [expenses, invoices] = await Promise.all([
      this.prisma.client.expense.findMany({
        where: { businessId, deletedAt: null, date: { gte: startDate, lte: endDate } },
        select: { amount: true, projectId: true, contactId: true, serviceId: true, isRecurring: true, categoryId: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, status: { in: ['PAID', 'SENT', 'OVERDUE'] }, issueDate: { gte: startDate, lte: endDate } },
        select: { total: true, status: true, contactId: true },
      }),
    ]);

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const totalRevenue = invoices.reduce((s, i) => s + (typeof i.total === 'number' ? i.total : parseFloat(String(i.total)) || 0), 0);
    const paidRevenue = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + (typeof i.total === 'number' ? i.total : parseFloat(String(i.total)) || 0), 0);
    const grossProfit = totalRevenue - totalExpenses;
    const grossMargin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : 0;
    const expenseToRevenueRatio = totalRevenue > 0 ? Math.round((totalExpenses / totalRevenue) * 1000) / 10 : 0;

    const byProject: Record<string, { expenses: number; count: number }> = {};
    for (const e of expenses) {
      if (e.projectId) {
        if (!byProject[e.projectId]) byProject[e.projectId] = { expenses: 0, count: 0 };
        byProject[e.projectId].expenses += e.amount;
        byProject[e.projectId].count += 1;
      }
    }

    const byClient: Record<string, { expenses: number; revenue: number }> = {};
    for (const e of expenses) {
      if (e.contactId) {
        if (!byClient[e.contactId]) byClient[e.contactId] = { expenses: 0, revenue: 0 };
        byClient[e.contactId].expenses += e.amount;
      }
    }
    for (const i of invoices) {
      if (i.contactId) {
        if (!byClient[i.contactId]) byClient[i.contactId] = { expenses: 0, revenue: 0 };
        byClient[i.contactId].revenue += typeof i.total === 'number' ? i.total : parseFloat(String(i.total)) || 0;
      }
    }

    const byService: Record<string, { expenses: number; count: number }> = {};
    for (const e of expenses) {
      if (e.serviceId) {
        if (!byService[e.serviceId]) byService[e.serviceId] = { expenses: 0, count: 0 };
        byService[e.serviceId].expenses += e.amount;
        byService[e.serviceId].count += 1;
      }
    }

    const clientIds = Object.keys(byClient);
    let clientNames: Record<string, string> = {};
    if (clientIds.length > 0) {
      const contacts = await this.prisma.client.contact.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, firstName: true, lastName: true, displayName: true },
      });
      for (const c of contacts) {
        clientNames[c.id] = c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
      }
    }

    const projectIds = Object.keys(byProject);
    let projectNames: Record<string, string> = {};
    if (projectIds.length > 0) {
      const projects = await this.prisma.client.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      });
      for (const p of projects) {
        projectNames[p.id] = p.name;
      }
    }

    const serviceIds = Object.keys(byService);
    let serviceNames: Record<string, string> = {};
    if (serviceIds.length > 0) {
      const services = await this.prisma.client.service.findMany({
        where: { id: { in: serviceIds } },
        select: { id: true, name: true },
      });
      for (const s of services) {
        serviceNames[s.id] = s.name;
      }
    }

    return {
      totalRevenue,
      paidRevenue,
      totalExpenses,
      grossProfit,
      grossMargin,
      expenseToRevenueRatio,
      byProject: Object.entries(byProject).map(([id, data]) => ({
        projectId: id,
        name: projectNames[id] || 'Unknown Project',
        ...data,
      })),
      byClient: Object.entries(byClient).map(([id, data]) => ({
        contactId: id,
        name: clientNames[id] || 'Unknown Client',
        ...data,
        profit: data.revenue - data.expenses,
        margin: data.revenue > 0 ? Math.round(((data.revenue - data.expenses) / data.revenue) * 1000) / 10 : 0,
      })),
      byService: Object.entries(byService).map(([id, data]) => ({
        serviceId: id,
        name: serviceNames[id] || 'Unknown Service',
        ...data,
      })),
    };
  }

  async exportExpensesCSV(businessId: string, filters?: { startDate?: string; endDate?: string; categoryId?: string }) {
    const where: any = { businessId, deletedAt: null };
    if (filters?.startDate || filters?.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }
    if (filters?.categoryId) where.categoryId = filters.categoryId;

    const expenses = await this.prisma.client.expense.findMany({
      where,
      include: { category: true },
      orderBy: { date: 'desc' },
    });

    const header = 'Date,Description,Amount,Currency,Vendor,Category,Payment Method,Tags,Recurring,Notes\n';
    const rows = expenses.map(e => {
      const esc = (s: string | null | undefined) => {
        if (!s) return '';
        return `"${s.replace(/"/g, '""')}"`;
      };
      return [
        e.date.toISOString().split('T')[0],
        esc(e.description),
        e.amount.toFixed(2),
        e.currency,
        esc(e.vendor),
        esc(e.category?.name),
        esc(e.paymentMethod),
        esc(e.tags?.join(', ')),
        e.isRecurring ? 'Yes' : 'No',
        esc(e.notes),
      ].join(',');
    }).join('\n');

    return header + rows;
  }

  async listBudgets(businessId: string, month?: number, year?: number) {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();

    const budgets = await this.prisma.client.expenseBudget.findMany({
      where: { businessId, month: m, year: y },
      include: { category: true },
    });

    const startOfMonth = new Date(y, m - 1, 1);
    const endOfMonth = new Date(y, m, 0, 23, 59, 59);

    const expenses = await this.prisma.client.expense.findMany({
      where: { businessId, deletedAt: null, date: { gte: startOfMonth, lte: endOfMonth } },
      select: { categoryId: true, amount: true },
    });

    const spentByCategory: Record<string, number> = {};
    let totalSpent = 0;
    for (const e of expenses) {
      const key = e.categoryId ?? 'uncategorized';
      spentByCategory[key] = (spentByCategory[key] ?? 0) + e.amount;
      totalSpent += e.amount;
    }

    return budgets.map(b => {
      const spent = b.categoryId ? (spentByCategory[b.categoryId] ?? 0) : totalSpent;
      return {
        ...b,
        spent,
        remaining: b.amount - spent,
        percentUsed: b.amount > 0 ? Math.round((spent / b.amount) * 1000) / 10 : 0,
        isOverBudget: spent > b.amount,
        isNearAlert: b.amount > 0 && (spent / b.amount) * 100 >= b.alertAt,
      };
    });
  }

  async upsertBudget(input: {
    businessId: string;
    categoryId?: string;
    amount: number;
    month: number;
    year: number;
    alertAt?: number;
    rollover?: boolean;
  }) {
    const catId = input.categoryId || null;
    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.expenseBudget.findFirst({
        where: {
          businessId: input.businessId,
          categoryId: catId,
          month: input.month,
          year: input.year,
        },
      });

      if (existing) {
        return tx.expenseBudget.update({
          where: { id: existing.id },
          data: {
            amount: input.amount,
            alertAt: input.alertAt ?? 80,
            rollover: input.rollover ?? false,
          },
          include: { category: true },
        });
      }

      return tx.expenseBudget.create({
        data: {
          businessId: input.businessId,
          categoryId: catId,
          amount: input.amount,
          month: input.month,
          year: input.year,
          alertAt: input.alertAt ?? 80,
          rollover: input.rollover ?? false,
        },
        include: { category: true },
      });
    });
  }

  async deleteBudget(businessId: string, budgetId: string) {
    return this.prisma.client.expenseBudget.delete({
      where: { id: budgetId, businessId },
    });
  }
}
