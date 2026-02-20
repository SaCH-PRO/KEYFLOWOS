import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async listExpenses(
    businessId: string,
    filters?: {
      startDate?: string;
      endDate?: string;
      categoryId?: string;
      vendor?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const where: any = { businessId, deletedAt: null };

    if (filters?.startDate || filters?.endDate) {
      where.date = {};
      if (filters.startDate) where.date.gte = new Date(filters.startDate);
      if (filters.endDate) where.date.lte = new Date(filters.endDate);
    }
    if (filters?.categoryId) {
      where.categoryId = filters.categoryId;
    }
    if (filters?.vendor) {
      where.vendor = { contains: filters.vendor, mode: 'insensitive' };
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
    isRecurring?: boolean;
    recurringFrequency?: string;
    categoryId?: string;
  }) {
    return this.prisma.client.expense.create({
      data: {
        businessId: input.businessId,
        description: input.description,
        amount: input.amount,
        currency: input.currency ?? 'TTD',
        date: input.date ? new Date(input.date) : new Date(),
        vendor: input.vendor ?? null,
        receiptUrl: input.receiptUrl ?? null,
        notes: input.notes ?? null,
        isRecurring: input.isRecurring ?? false,
        recurringFrequency: input.recurringFrequency ?? null,
        categoryId: input.categoryId ?? null,
      },
      include: { category: true },
    });
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
    isRecurring?: boolean;
    recurringFrequency?: string;
    categoryId?: string | null;
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
        ...(input.isRecurring !== undefined && { isRecurring: input.isRecurring }),
        ...(input.recurringFrequency !== undefined && { recurringFrequency: input.recurringFrequency }),
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
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

  async getExpenseSummary(businessId: string, period?: string) {
    let startDate: Date;
    const now = new Date();

    switch (period) {
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '12m':
        startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        break;
      case '30d':
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    const where = {
      businessId,
      deletedAt: null as Date | null,
      date: { gte: startDate },
    };

    const [expenses, categories] = await Promise.all([
      this.prisma.client.expense.findMany({
        where,
        include: { category: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.client.expenseCategory.findMany({
        where: { businessId },
      }),
    ]);

    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const expenseCount = expenses.length;

    const byCategory: Record<string, { name: string; total: number; count: number }> = {};
    for (const expense of expenses) {
      const catName = expense.category?.name ?? 'Uncategorized';
      const catId = expense.categoryId ?? 'uncategorized';
      if (!byCategory[catId]) {
        byCategory[catId] = { name: catName, total: 0, count: 0 };
      }
      byCategory[catId].total += expense.amount;
      byCategory[catId].count += 1;
    }

    const monthlyTrend: Record<string, number> = {};
    for (const expense of expenses) {
      const key = `${expense.date.getFullYear()}-${String(expense.date.getMonth() + 1).padStart(2, '0')}`;
      monthlyTrend[key] = (monthlyTrend[key] ?? 0) + expense.amount;
    }

    return {
      period: period ?? '30d',
      startDate,
      endDate: now,
      totalExpenses,
      expenseCount,
      byCategory: Object.entries(byCategory).map(([id, data]) => ({
        categoryId: id,
        ...data,
      })),
      monthlyTrend: Object.entries(monthlyTrend).map(([month, total]) => ({
        month,
        total,
      })),
    };
  }
}
