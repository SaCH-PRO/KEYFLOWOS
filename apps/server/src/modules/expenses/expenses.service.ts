import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ExpenseCreatedPayload } from '../../core/event-bus/events.types';
import { ExpensePostingService } from '../finance/expense-posting.service';
import { TimelineService } from '../timeline/timeline.service';

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(ExpensePostingService) private readonly posting: ExpensePostingService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
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
      status?: string;
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
    if (filters?.status) {
      where.status = filters.status;
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
    /** PAID (default) or BILL — BILL credits AP instead of cash. */
    status?: 'PAID' | 'BILL';
    dueDate?: string | Date;
    paidAt?: string | Date;
    recurringExpenseId?: string;
    items?: Array<{ amount: number; categoryId?: string | null; description?: string; taxRateId?: string | null }> | null;
  }) {
    let validProjectId: string | null = null;
    let validContactId: string | null = null;
    let validServiceId: string | null = null;

    if (input.projectId) {
      const proj = await this.prisma.client.project.findFirst({ where: { id: input.projectId, businessId: input.businessId } });
      if (!proj) throw new BadRequestException(`Project not found or does not belong to this business`);
      validProjectId = input.projectId;
    }
    if (input.contactId) {
      const ct = await this.prisma.client.contact.findFirst({ where: { id: input.contactId, businessId: input.businessId } });
      if (!ct) throw new BadRequestException(`Contact not found or does not belong to this business`);
      validContactId = input.contactId;
    }
    if (input.serviceId) {
      const svc = await this.prisma.client.service.findFirst({ where: { id: input.serviceId, businessId: input.businessId } });
      if (!svc) throw new BadRequestException(`Service not found or does not belong to this business`);
      validServiceId = input.serviceId;
    }

    const status = input.status ?? 'PAID';
    if (status !== 'PAID' && status !== 'BILL') {
      throw new BadRequestException(`Invalid expense status: ${status}`);
    }
    const expenseDate = input.date ? new Date(input.date) : new Date();
    const paidAt = status === 'PAID' ? (input.paidAt ? new Date(input.paidAt) : expenseDate) : null;
    const dueDate = input.dueDate
      ? new Date(input.dueDate)
      : status === 'BILL'
      ? new Date(expenseDate.getTime() + 30 * 86400000)
      : null;

    // Create + post in a single transaction so a failed posting rolls
    // back the expense row (no orphan business writes vs. ledger).
    const expense = await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as import('@prisma/client').Prisma.TransactionClient;
      const created = await tx.expense.create({
        data: {
          businessId: input.businessId,
          description: input.description,
          amount: input.amount,
          currency: input.currency ?? 'TTD',
          date: expenseDate,
          vendor: input.vendor ?? null,
          receiptUrl: input.receiptUrl ?? null,
          notes: input.notes ?? null,
          paymentMethod: input.paymentMethod ?? null,
          tags: input.tags ?? [],
          isRecurring: input.isRecurring ?? false,
          recurringFrequency: input.recurringFrequency ?? null,
          categoryId: input.categoryId ?? null,
          projectId: validProjectId,
          contactId: validContactId,
          serviceId: validServiceId,
          recurringExpenseId: input.recurringExpenseId ?? null,
          status,
          dueDate,
          paidAt,
          items: input.items ? (input.items as Prisma.InputJsonValue) : undefined,
        },
        include: { category: true },
      });

      const postPayload = {
        id: created.id,
        businessId: created.businessId,
        amount: created.amount,
        currency: created.currency,
        date: created.date,
        categoryId: created.categoryId,
        paymentMethod: created.paymentMethod,
        description: created.description,
        contactId: created.contactId,
        vendor: created.vendor,
        items: input.items ?? null,
      };
      if (status === 'PAID') {
        await this.posting.onExpensePaid(postPayload, tx);
      } else {
        await this.posting.onBillCreated(postPayload, tx);
      }
      return created;
    });

    this.events.emit('expense.created', {
      expense: { id: expense.id, businessId: input.businessId, amount: expense.amount, description: expense.description, categoryId: expense.categoryId },
      businessId: input.businessId,
    } as ExpenseCreatedPayload);
    if (status === 'BILL') {
      this.events.emit('bill.created', {
        bill: expense,
        businessId: input.businessId,
      });
    }
    await this.timeline.recordEvent({
      businessId: input.businessId,
      module: 'EXPENSE',
      action: 'created',
      entityType: 'expense',
      entityId: expense.id,
      title: `${status === 'BILL' ? 'Bill' : 'Expense'} created: ${expense.description}`,
      detail: `${expense.currency} ${expense.amount}`,
      data: { amount: expense.amount, currency: expense.currency, status, vendor: expense.vendor },
      occurredAt: new Date(),
    });

    return expense;
  }

  /**
   * Mark an existing BILL as paid: posts Dr AP / Cr Cash and stamps
   * status=PAID + paidAt. Idempotent — calling twice on an already-paid
   * bill is a no-op (the posting service deduplicates by external_ref).
   */
  async markBillPaid(input: {
    businessId: string;
    expenseId: string;
    paymentMethod?: string;
    paidAt?: string | Date;
  }) {
    const existing = await this.prisma.client.expense.findFirst({
      where: { id: input.expenseId, businessId: input.businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Expense not found');
    if (existing.status === 'VOID') {
      throw new BadRequestException('Cannot mark a voided expense as paid');
    }
    if (existing.status === 'PAID' && existing.paidAt) {
      return existing; // idempotent
    }

    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    const paymentMethod = input.paymentMethod ?? existing.paymentMethod;

    const updated = await this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as import('@prisma/client').Prisma.TransactionClient;
      const u = await tx.expense.update({
        where: { id: input.expenseId },
        data: { status: 'PAID', paidAt, paymentMethod },
        include: { category: true },
      });
      await this.posting.onBillPaid(
        {
          id: u.id,
          businessId: u.businessId,
          amount: u.amount,
          currency: u.currency,
          paidAt,
          paymentMethod: paymentMethod ?? null,
          description: u.description,
          contactId: u.contactId,
          vendor: u.vendor,
        },
        tx,
      );
      this.events.emit('bill.paid', { bill: u, businessId: input.businessId });
      return u;
    });
    await this.timeline.recordEvent({
      businessId: input.businessId,
      module: 'EXPENSE',
      action: 'paid',
      entityType: 'expense',
      entityId: input.expenseId,
      title: 'Bill marked as paid',
      detail: existing.description,
      data: { amount: existing.amount, currency: existing.currency },
      occurredAt: new Date(),
    });
    return updated;
  }

  /**
   * Soft-void an expense by reversing its postings. Hard delete on a
   * posted Expense is forbidden — use this method instead.
   */
  async voidExpense(input: { businessId: string; expenseId: string; reason?: string }) {
    const existing = await this.prisma.client.expense.findFirst({
      where: { id: input.expenseId, businessId: input.businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Expense not found');
    if (existing.status === 'VOID') return existing;

    return this.prisma.client.$transaction(async (rawTx) => {
      const tx = rawTx as unknown as import('@prisma/client').Prisma.TransactionClient;
      // Reverse every posted financial transaction for this Expense.
      const txs = await tx.financialTransaction.findMany({
        where: { businessId: input.businessId, sourceType: 'Expense', sourceId: existing.id },
        include: { entries: true },
      });
      for (const ft of txs) {
        // Skip if already reversed.
        const already = await tx.financialTransaction.findFirst({
          where: { businessId: input.businessId, reversalOfId: ft.id },
          select: { id: true },
        });
        if (already) continue;
        const reversal = await tx.financialTransaction.create({
          data: {
            businessId: ft.businessId,
            type: 'REVERSAL',
            status: 'POSTED',
            date: new Date(),
            amount: ft.amount,
            currency: ft.currency,
            description: `VOID: ${ft.description ?? existing.description}`,
            contactId: ft.contactId,
            sourceType: ft.sourceType,
            sourceId: ft.sourceId,
            reversalOfId: ft.id,
            reference: ft.reference,
            notes: input.reason ?? `Voided expense ${existing.id}`,
            postedAt: new Date(),
          },
        });
        for (const e of ft.entries) {
          await tx.ledgerEntry.create({
            data: {
              businessId: e.businessId,
              transactionId: reversal.id,
              accountId: e.accountId,
              debit: e.credit,
              credit: e.debit,
              currency: e.currency,
              date: reversal.date,
            },
          });
        }
      }
      return tx.expense.update({
        where: { id: existing.id },
        data: { status: 'VOID', deletedAt: new Date() },
        include: { category: true },
      });
    });
  }

  /**
   * Payables aging: bucket all unpaid BILLs by days-past-due.
   * Buckets: current (not yet due), 1-30, 31-60, 61-90, >90.
   */
  async getPayablesAging(businessId: string) {
    const now = new Date();
    const bills = await this.prisma.client.expense.findMany({
      where: { businessId, status: 'BILL', deletedAt: null },
      orderBy: { dueDate: 'asc' },
    });
    const buckets = {
      current: { total: 0, count: 0 },
      d_1_30: { total: 0, count: 0 },
      d_31_60: { total: 0, count: 0 },
      d_61_90: { total: 0, count: 0 },
      d_over_90: { total: 0, count: 0 },
    };
    let total = 0;
    for (const b of bills) {
      total += b.amount;
      if (!b.dueDate || b.dueDate >= now) {
        buckets.current.total += b.amount;
        buckets.current.count += 1;
        continue;
      }
      const days = Math.floor((now.getTime() - b.dueDate.getTime()) / 86400000);
      if (days <= 30) {
        buckets.d_1_30.total += b.amount;
        buckets.d_1_30.count += 1;
      } else if (days <= 60) {
        buckets.d_31_60.total += b.amount;
        buckets.d_31_60.count += 1;
      } else if (days <= 90) {
        buckets.d_61_90.total += b.amount;
        buckets.d_61_90.count += 1;
      } else {
        buckets.d_over_90.total += b.amount;
        buckets.d_over_90.count += 1;
      }
    }
    return { total, count: bills.length, buckets, bills };
  }

  /**
   * Per-vendor outstanding balance — sum of unpaid BILL.amount grouped by
   * vendor (string column) and contact, sorted by largest balance first.
   */
  async getVendorBalances(businessId: string) {
    const bills = await this.prisma.client.expense.findMany({
      where: { businessId, status: 'BILL', deletedAt: null },
      select: { id: true, vendor: true, contactId: true, amount: true, currency: true, dueDate: true },
    });
    const map = new Map<string, { vendor: string | null; contactId: string | null; total: number; count: number; oldestDueDate: Date | null }>();
    for (const b of bills) {
      const key = b.contactId ?? b.vendor ?? 'unspecified';
      const cur = map.get(key) ?? { vendor: b.vendor, contactId: b.contactId, total: 0, count: 0, oldestDueDate: null };
      cur.total += b.amount;
      cur.count += 1;
      if (b.dueDate && (!cur.oldestDueDate || b.dueDate < cur.oldestDueDate)) {
        cur.oldestDueDate = b.dueDate;
      }
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  /**
   * Per-vendor balance breakdown for a single vendor.
   *
   * `vendorId` may be either a `Contact.id` (when the vendor is a linked
   * Contact) or a free-form vendor string (resolved against `Expense.vendor`).
   * Returns billed (lifetime BILL total), paid (lifetime PAID total for the
   * same vendor) and outstanding (sum of unpaid bills only) so the UI can
   * render full vendor history alongside what is currently owed.
   */
  async getVendorBalance(businessId: string, vendorId: string) {
    const byContactWhere = { businessId, contactId: vendorId, deletedAt: null };
    const byVendorWhere = { businessId, vendor: vendorId, contactId: null, deletedAt: null };
    // Try contact match first; fall back to vendor-name match if there are
    // no contact-linked rows. We never mix the two — vendor strings can
    // collide with contact ids in degenerate cases.
    const contactRows = await this.prisma.client.expense.findMany({
      where: byContactWhere,
      select: { id: true, status: true, amount: true, currency: true, dueDate: true, paidAt: true, vendor: true, contactId: true },
    });
    const rows = contactRows.length
      ? contactRows
      : await this.prisma.client.expense.findMany({
          where: byVendorWhere,
          select: { id: true, status: true, amount: true, currency: true, dueDate: true, paidAt: true, vendor: true, contactId: true },
        });

    // Build a durable "originated as a bill" marker so paid bills
    // (status flips BILL → PAID on payment) still contribute to the
    // lifetime billed total. We prefer the bill_created posting when
    // available; rows with a dueDate are also treated as bill-originated
    // since the bills controller always sets dueDate at creation.
    // PostingService writes externalRef = `${sourceType}:${sourceId}:${kind}`,
    // so we filter on the deterministic suffix to find bill_created rows.
    const billCreated = rows.length
      ? await this.prisma.client.financialTransaction.findMany({
          where: {
            businessId,
            sourceType: 'Expense',
            sourceId: { in: rows.map((r) => r.id) },
            externalRef: { endsWith: ':bill_created' },
          },
          select: { sourceId: true },
        })
      : [];
    const wasBilled = new Set(billCreated.map((r) => r.sourceId).filter((s): s is string => !!s));

    let billed = 0;
    let paid = 0;
    let outstanding = 0;
    let oldestDueDate: Date | null = null;
    const openBills: typeof rows = [];
    for (const r of rows) {
      if (r.status === 'VOID') continue;
      const originatedAsBill = wasBilled.has(r.id) || r.dueDate != null;
      if (r.status === 'BILL') {
        billed += r.amount;
        outstanding += r.amount;
        openBills.push(r);
        if (r.dueDate && (!oldestDueDate || r.dueDate < oldestDueDate)) {
          oldestDueDate = r.dueDate;
        }
      } else if (r.status === 'PAID') {
        // Lifetime billed includes paid bills (now PAID but originated
        // as BILL); pure paid expenses contribute only to `paid`.
        if (originatedAsBill) billed += r.amount;
        paid += r.amount;
      }
    }
    const currency = rows[0]?.currency ?? 'TTD';
    const matchedBy = contactRows.length ? 'contactId' : 'vendor';
    return {
      vendorId,
      matchedBy,
      currency,
      billed,
      paid,
      outstanding,
      openBillCount: openBills.length,
      oldestDueDate,
      openBills,
    };
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
    items?: Array<{ amount: number; categoryId?: string | null; description?: string; taxRateId?: string | null }> | null;
  }) {
    const updateData: Record<string, unknown> = {};
    if (input.description !== undefined) updateData.description = input.description;
    if (input.amount !== undefined) updateData.amount = input.amount;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.date !== undefined) updateData.date = new Date(input.date);
    if (input.vendor !== undefined) updateData.vendor = input.vendor;
    if (input.receiptUrl !== undefined) updateData.receiptUrl = input.receiptUrl;
    if (input.notes !== undefined) updateData.notes = input.notes;
    if (input.paymentMethod !== undefined) updateData.paymentMethod = input.paymentMethod;
    if (input.tags !== undefined) updateData.tags = input.tags;
    if (input.isRecurring !== undefined) updateData.isRecurring = input.isRecurring;
    if (input.recurringFrequency !== undefined) updateData.recurringFrequency = input.recurringFrequency;
    if (input.categoryId !== undefined) updateData.categoryId = input.categoryId;
    if (input.items !== undefined) updateData.items = input.items as Prisma.InputJsonValue;

    if (input.projectId !== undefined) {
      if (input.projectId === null) {
        updateData.projectId = null;
      } else {
        const proj = await this.prisma.client.project.findFirst({ where: { id: input.projectId, businessId: input.businessId } });
        if (!proj) throw new BadRequestException(`Project not found or does not belong to this business`);
        updateData.projectId = input.projectId;
      }
    }
    if (input.contactId !== undefined) {
      if (input.contactId === null) {
        updateData.contactId = null;
      } else {
        const ct = await this.prisma.client.contact.findFirst({ where: { id: input.contactId, businessId: input.businessId } });
        if (!ct) throw new BadRequestException(`Contact not found or does not belong to this business`);
        updateData.contactId = input.contactId;
      }
    }
    if (input.serviceId !== undefined) {
      if (input.serviceId === null) {
        updateData.serviceId = null;
      } else {
        const svc = await this.prisma.client.service.findFirst({ where: { id: input.serviceId, businessId: input.businessId } });
        if (!svc) throw new BadRequestException(`Service not found or does not belong to this business`);
        updateData.serviceId = input.serviceId;
      }
    }

    return this.prisma.client.expense.update({
      where: { id: input.expenseId, businessId: input.businessId },
      data: updateData,
      include: { category: true },
    });
  }

  async deleteExpense(businessId: string, expenseId: string) {
    // FIN3 — once an expense has been posted to the ledger we MUST NOT
    // hard/soft-delete it: deletion would leave a balanced ledger entry
    // referencing a row that no longer exists. Force callers to use
    // `voidExpense` instead, which posts an explicit reversal.
    const posted = await this.prisma.client.financialTransaction.findFirst({
      where: { businessId, sourceType: 'Expense', sourceId: expenseId },
      select: { id: true },
    });
    if (posted) {
      throw new BadRequestException(
        'Cannot delete a posted expense — call POST /finance/businesses/:businessId/bills/:expenseId/void to reverse the ledger entries instead.',
      );
    }
    const deleted = await this.prisma.client.expense.update({
      where: { id: expenseId, businessId },
      data: { deletedAt: new Date() },
    });
    await this.timeline.recordEvent({
      businessId,
      module: 'EXPENSE',
      action: 'deleted',
      entityType: 'expense',
      entityId: expenseId,
      title: 'Expense deleted',
      detail: deleted.description,
      data: { amount: deleted.amount, currency: deleted.currency },
      occurredAt: new Date(),
    });
    return deleted;
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
        where: { id: { in: projectIds }, businessId },
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

    const byProject: Record<string, { expenses: number; count: number; revenue: number; clientIds: Set<string> }> = {};
    for (const e of expenses) {
      if (e.projectId) {
        if (!byProject[e.projectId]) byProject[e.projectId] = { expenses: 0, count: 0, revenue: 0, clientIds: new Set() };
        byProject[e.projectId].expenses += e.amount;
        byProject[e.projectId].count += 1;
        if (e.contactId) byProject[e.projectId].clientIds.add(e.contactId);
      }
    }

    const invoiceByContact: Record<string, number> = {};
    for (const i of invoices) {
      if (i.contactId) {
        const amt = typeof i.total === 'number' ? i.total : parseFloat(String(i.total)) || 0;
        invoiceByContact[i.contactId] = (invoiceByContact[i.contactId] || 0) + amt;
      }
    }

    const clientProjectCount: Record<string, number> = {};
    for (const [, projData] of Object.entries(byProject)) {
      for (const cid of projData.clientIds) {
        clientProjectCount[cid] = (clientProjectCount[cid] || 0) + 1;
      }
    }
    for (const [, projData] of Object.entries(byProject)) {
      for (const cid of projData.clientIds) {
        const share = clientProjectCount[cid] > 0 ? 1 / clientProjectCount[cid] : 0;
        projData.revenue += (invoiceByContact[cid] || 0) * share;
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

    const byService: Record<string, { expenses: number; count: number; revenue: number }> = {};
    for (const e of expenses) {
      if (e.serviceId) {
        if (!byService[e.serviceId]) byService[e.serviceId] = { expenses: 0, count: 0, revenue: 0 };
        byService[e.serviceId].expenses += e.amount;
        byService[e.serviceId].count += 1;
      }
    }

    const serviceIds = [...new Set(expenses.filter(e => e.serviceId).map(e => e.serviceId!))];
    if (serviceIds.length > 0) {
      // Service.sourceProductId is the inverse link to Product, so build a productId -> serviceId map
      const linkedServices = await this.prisma.client.service.findMany({
        where: { id: { in: serviceIds }, businessId, sourceProductId: { not: null } },
        select: { id: true, sourceProductId: true },
      });
      const productIdToServiceId = new Map<string, string>();
      for (const s of linkedServices) {
        if (s.sourceProductId) productIdToServiceId.set(s.sourceProductId, s.id);
      }
      const productIds = Array.from(productIdToServiceId.keys());
      if (productIds.length > 0) {
        const svcInvoiceItems = await this.prisma.client.invoiceItem.findMany({
          where: {
            invoice: { businessId, issueDate: { gte: startDate, lte: endDate }, status: { in: ['PAID', 'SENT', 'OVERDUE'] } },
            productId: { in: productIds },
          },
          select: { total: true, productId: true },
        });
        for (const item of svcInvoiceItems) {
          const sid = item.productId ? productIdToServiceId.get(item.productId) : undefined;
          if (sid && byService[sid]) {
            byService[sid].revenue += item.total;
          }
        }
      }
    }

    const clientIds = Object.keys(byClient);
    const clientNames: Record<string, string> = {};
    if (clientIds.length > 0) {
      const contacts = await this.prisma.client.contact.findMany({
        where: { id: { in: clientIds }, businessId },
        select: { id: true, firstName: true, lastName: true, displayName: true },
      });
      for (const c of contacts) {
        clientNames[c.id] = c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
      }
    }

    const projectIds = Object.keys(byProject);
    const projectNames: Record<string, string> = {};
    if (projectIds.length > 0) {
      const projects = await this.prisma.client.project.findMany({
        where: { id: { in: projectIds }, businessId },
        select: { id: true, name: true },
      });
      for (const p of projects) {
        projectNames[p.id] = p.name;
      }
    }

    const svcNameIds = Object.keys(byService);
    const serviceNames: Record<string, string> = {};
    if (svcNameIds.length > 0) {
      const services = await this.prisma.client.service.findMany({
        where: { id: { in: svcNameIds }, businessId },
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
        expenses: data.expenses,
        count: data.count,
        revenue: data.revenue,
        profit: data.revenue - data.expenses,
        margin: data.revenue > 0 ? Math.round(((data.revenue - data.expenses) / data.revenue) * 1000) / 10 : 0,
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
        expenses: data.expenses,
        count: data.count,
        revenue: data.revenue,
        profit: data.revenue - data.expenses,
        margin: data.revenue > 0 ? Math.round(((data.revenue - data.expenses) / data.revenue) * 1000) / 10 : 0,
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

  async getExpensesByEntity(businessId: string, field: 'projectId' | 'serviceId' | 'contactId', entityId: string) {
    const expenses = await this.prisma.client.expense.findMany({
      where: { businessId, deletedAt: null, [field]: entityId },
      include: { category: true },
      orderBy: { date: 'desc' },
      take: 200,
    });
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    return { expenses, total, count: expenses.length };
  }

  async detectRecurringCandidates(businessId: string) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const expenses = await this.prisma.client.expense.findMany({
      where: { businessId, deletedAt: null, isRecurring: false, date: { gte: sixMonthsAgo } },
      select: { id: true, vendor: true, amount: true, date: true, description: true },
      orderBy: { date: 'asc' },
    });

    const byVendorAmount: Record<string, { dates: Date[]; amount: number; vendor: string; description: string; ids: string[] }> = {};
    for (const e of expenses) {
      if (!e.vendor) continue;
      const key = `${e.vendor}__${Math.round(e.amount * 100)}`;
      if (!byVendorAmount[key]) {
        byVendorAmount[key] = { dates: [], amount: e.amount, vendor: e.vendor, description: e.description, ids: [] };
      }
      byVendorAmount[key].dates.push(e.date);
      byVendorAmount[key].ids.push(e.id);
    }

    const candidates: { vendor: string; amount: number; description: string; occurrences: number; avgDaysBetween: number; frequency: string; expenseIds: string[] }[] = [];

    for (const [, group] of Object.entries(byVendorAmount)) {
      if (group.dates.length < 2) continue;

      const sorted = group.dates.sort((a, b) => a.getTime() - b.getTime());
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        gaps.push((sorted[i].getTime() - sorted[i - 1].getTime()) / (1000 * 60 * 60 * 24));
      }
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const variance = gaps.reduce((s, g) => s + Math.pow(g - avgGap, 2), 0) / gaps.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev > avgGap * 0.5) continue;

      let frequency = 'IRREGULAR';
      if (avgGap >= 25 && avgGap <= 35) frequency = 'MONTHLY';
      else if (avgGap >= 12 && avgGap <= 16) frequency = 'BIWEEKLY';
      else if (avgGap >= 6 && avgGap <= 8) frequency = 'WEEKLY';
      else if (avgGap >= 85 && avgGap <= 95) frequency = 'QUARTERLY';
      else if (avgGap >= 350 && avgGap <= 380) frequency = 'YEARLY';

      if (frequency === 'IRREGULAR') continue;

      candidates.push({
        vendor: group.vendor,
        amount: group.amount,
        description: group.description,
        occurrences: group.dates.length,
        avgDaysBetween: Math.round(avgGap),
        frequency,
        expenseIds: group.ids,
      });
    }

    return { candidates: candidates.sort((a, b) => b.occurrences - a.occurrences) };
  }
}
