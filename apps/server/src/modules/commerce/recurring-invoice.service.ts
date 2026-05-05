import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';

@Injectable()
export class RecurringInvoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringInvoiceService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(forwardRef(() => InvoiceWorkflowService))
    private readonly invoiceWorkflow: InvoiceWorkflowService,
  ) {}

  onModuleInit() {
    this.intervalRef = setInterval(() => {
      this.processRecurringInvoices().catch((err) => {
        this.logger.error('Error processing recurring invoices', err);
      });
    }, 60 * 60 * 1000);
    this.logger.log('Recurring invoice scheduler started (hourly interval)');
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  listRecurringInvoices(businessId: string) {
    return this.prisma.client.recurringInvoice.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { contact: true },
    });
  }

  getRecurringInvoice(businessId: string, id: string) {
    return this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { contact: true },
    });
  }

  /** Generation history: invoices created by a recurring schedule. */
  async getGenerationHistory(businessId: string, recurringId: string) {
    const recurring = await this.prisma.client.recurringInvoice.findFirst({
      where: { id: recurringId, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!recurring) throw new NotFoundException('Recurring schedule not found');
    return this.prisma.client.invoice.findMany({
      where: { businessId, recurringInvoiceId: recurringId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        total: true,
        currency: true,
        issueDate: true,
        dueDate: true,
        paidAt: true,
        createdAt: true,
      },
    });
  }

  /** Cancel a schedule (soft-stop, kept for audit). */
  async cancelRecurringInvoice(businessId: string, id: string) {
    const existing = await this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Recurring invoice not found');
    return this.prisma.client.recurringInvoice.update({
      where: { id },
      data: { isActive: false, cancelledAt: new Date() },
      include: { contact: true },
    });
  }

  async createRecurringInvoice(input: {
    businessId: string;
    name: string;
    frequency: string;
    nextRunDate: Date | string;
    endDate?: Date | string | null;
    contactId: string;
    lineItems: { description: string; quantity: number; unitPrice: number; total: number; productId?: string }[];
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    currency?: string;
    notes?: string;
  }) {
    const subtotal = input.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const taxRate = input.taxRate ?? 0;
    const taxAmount = (subtotal * taxRate) / 100;
    let discountAmount = 0;
    if (input.discountType === 'PERCENT' && input.discountValue) {
      discountAmount = (subtotal * input.discountValue) / 100;
    } else if (input.discountType === 'FIXED' && input.discountValue) {
      discountAmount = input.discountValue;
    }
    const total = subtotal + taxAmount - discountAmount;

    const recurringInvoice = await this.prisma.client.recurringInvoice.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        frequency: input.frequency,
        nextRunDate: new Date(input.nextRunDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        contactId: input.contactId,
        lineItems: input.lineItems,
        subtotal,
        taxRate,
        discountType: input.discountType ?? null,
        discountValue: input.discountValue ?? null,
        total,
        currency: input.currency ?? 'TTD',
        notes: input.notes ?? null,
      },
      include: { contact: true },
    });
    this.events.emit('recurring_invoice.created', {
      recurringInvoice,
      businessId: input.businessId,
    });
    return recurringInvoice;
  }

  async updateRecurringInvoice(input: {
    id: string;
    businessId: string;
    name?: string;
    frequency?: string;
    nextRunDate?: Date | string;
    endDate?: Date | string | null;
    contactId?: string;
    lineItems?: { description: string; quantity: number; unitPrice: number; total: number; productId?: string }[];
    taxRate?: number;
    discountType?: 'PERCENT' | 'FIXED' | null;
    discountValue?: number | null;
    currency?: string;
    notes?: string | null;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.client.recurringInvoice.findFirst({
      where: { id: input.id, businessId: input.businessId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Recurring invoice not found');
    }

    const updateData: any = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.frequency !== undefined) updateData.frequency = input.frequency;
    if (input.nextRunDate !== undefined) updateData.nextRunDate = new Date(input.nextRunDate);
    if (input.endDate !== undefined) updateData.endDate = input.endDate ? new Date(input.endDate) : null;
    if (input.contactId !== undefined) updateData.contactId = input.contactId;
    if (input.currency !== undefined) updateData.currency = input.currency;
    if (input.notes !== undefined) updateData.notes = input.notes;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    if (input.lineItems) {
      const subtotal = input.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const taxRate = input.taxRate ?? existing.taxRate ?? 0;
      const taxAmount = (subtotal * taxRate) / 100;
      const discountType = input.discountType !== undefined ? input.discountType : existing.discountType;
      const discountValue = input.discountValue !== undefined ? input.discountValue : existing.discountValue;
      let discountAmount = 0;
      if (discountType === 'PERCENT' && discountValue) {
        discountAmount = (subtotal * discountValue) / 100;
      } else if (discountType === 'FIXED' && discountValue) {
        discountAmount = discountValue;
      }
      const total = subtotal + taxAmount - discountAmount;

      updateData.lineItems = input.lineItems;
      updateData.subtotal = subtotal;
      updateData.taxRate = taxRate;
      updateData.discountType = discountType;
      updateData.discountValue = discountValue;
      updateData.total = total;
    } else if (input.taxRate !== undefined || input.discountType !== undefined || input.discountValue !== undefined) {
      const subtotal = existing.subtotal;
      const taxRate = input.taxRate ?? existing.taxRate ?? 0;
      const taxAmount = (subtotal * taxRate) / 100;
      const discountType = input.discountType !== undefined ? input.discountType : existing.discountType;
      const discountValue = input.discountValue !== undefined ? input.discountValue : existing.discountValue;
      let discountAmount = 0;
      if (discountType === 'PERCENT' && discountValue) {
        discountAmount = (subtotal * discountValue) / 100;
      } else if (discountType === 'FIXED' && discountValue) {
        discountAmount = discountValue;
      }
      const total = subtotal + taxAmount - discountAmount;

      updateData.taxRate = taxRate;
      updateData.discountType = discountType;
      updateData.discountValue = discountValue;
      updateData.total = total;
    }

    const recurringInvoice = await this.prisma.client.recurringInvoice.update({
      where: { id: input.id },
      data: updateData,
      include: { contact: true },
    });
    this.events.emit('recurring_invoice.updated', {
      recurringInvoice,
      businessId: input.businessId,
    });
    return recurringInvoice;
  }

  async deleteRecurringInvoice(businessId: string, id: string) {
    const existing = await this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId },
      select: { contactId: true },
    });
    const result = await this.prisma.client.recurringInvoice.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.events.emit('recurring_invoice.deleted', {
      businessId,
      recurringInvoiceId: id,
      contactId: existing?.contactId ?? null,
    });
    return result;
  }

  async toggleActive(businessId: string, id: string) {
    const existing = await this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Recurring invoice not found');
    }
    const recurringInvoice = await this.prisma.client.recurringInvoice.update({
      where: { id },
      data: { isActive: !existing.isActive },
      include: { contact: true },
    });
    this.events.emit('recurring_invoice.updated', { recurringInvoice, businessId });
    return recurringInvoice;
  }

  async processRecurringInvoices() {
    const now = new Date();
    const dueInvoices = await this.prisma.client.recurringInvoice.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        nextRunDate: { lte: now },
        OR: [
          { endDate: null },
          { endDate: { gte: now } },
        ],
      },
      include: { contact: true },
    });

    this.logger.log(`Processing ${dueInvoices.length} recurring invoices`);
    const results: any[] = [];

    for (const recurring of dueInvoices) {
      try {
        const lineItems = recurring.lineItems as any[];
        const subtotal = lineItems.reduce((sum: number, item: any) => sum + item.quantity * item.unitPrice, 0);
        const taxRate = recurring.taxRate ?? 0;
        const taxAmount = (subtotal * taxRate) / 100;
        let discountAmount = 0;
        if (recurring.discountType === 'PERCENT' && recurring.discountValue) {
          discountAmount = (subtotal * recurring.discountValue) / 100;
        } else if (recurring.discountType === 'FIXED' && recurring.discountValue) {
          discountAmount = recurring.discountValue;
        }
        const total = subtotal + taxAmount - discountAmount;

        const draft = await this.prisma.client.invoice.create({
          data: {
            businessId: recurring.businessId,
            contactId: recurring.contactId,
            invoiceNumber: `INV-${Date.now()}`,
            status: 'DRAFT',
            issueDate: new Date(),
            subtotal,
            taxRate,
            taxAmount,
            discountType: recurring.discountType ?? null,
            discountValue: recurring.discountValue ?? null,
            discountAmount,
            total,
            currency: recurring.currency,
            notes: recurring.notes,
            recurringInvoiceId: recurring.id,
            items: {
              create: lineItems.map((item: any) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.quantity * item.unitPrice,
                productId: item.productId ?? null,
              })),
            },
          },
          include: { items: true, contact: true },
        });

        // FIN2 — finalize the generated invoice through the workflow so it
        // posts to the ledger (accrual: Dr AR/Cr Revenue) under the same
        // tx that the status update commits with. Cash-basis businesses
        // no-op inside the posting service.
        const invoice = await this.invoiceWorkflow.transition(draft.id, 'SENT', {
          sentAt: new Date(),
        });

        const nextRunDate = this.calculateNextRunDate(recurring.nextRunDate, recurring.frequency);

        const updatedRecurring = await this.prisma.client.recurringInvoice.update({
          where: { id: recurring.id },
          data: {
            lastRunDate: now,
            nextRunDate,
            runCount: { increment: 1 },
            failureCount: 0,
            lastError: null,
            lastFailureAt: null,
          },
          include: { contact: true },
        });

        this.events.emit('recurring_invoice.generated', {
          recurringInvoice: updatedRecurring,
          invoice,
          businessId: recurring.businessId,
        });
        this.events.emit('invoice.created', {
          invoice,
          businessId: recurring.businessId,
        });

        this.logger.log(`Generated invoice ${invoice.invoiceNumber} from recurring "${recurring.name}"`);
        results.push({ recurringId: recurring.id, invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber });
      } catch (error: any) {
        this.logger.error(`Failed to process recurring invoice ${recurring.id}: ${error?.message}`, error?.stack);
        try {
          await this.prisma.client.recurringInvoice.update({
            where: { id: recurring.id },
            data: {
              failureCount: { increment: 1 },
              lastFailureAt: now,
              lastError: String(error?.message ?? error).slice(0, 500),
            },
          });
        } catch (writeErr) {
          this.logger.error(`Failed to record failure for recurring ${recurring.id}`, writeErr as Error);
        }
        this.events.emit('recurring_invoice.failed', {
          recurringInvoice: recurring,
          businessId: recurring.businessId,
          error: String(error?.message ?? error),
        });
      }
    }

    return results;
  }

  private calculateNextRunDate(currentDate: Date, frequency: string): Date {
    const next = new Date(currentDate);
    switch (frequency) {
      case 'WEEKLY':
        next.setDate(next.getDate() + 7);
        break;
      case 'BIWEEKLY':
        next.setDate(next.getDate() + 14);
        break;
      case 'MONTHLY':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'QUARTERLY':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'YEARLY':
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        next.setMonth(next.getMonth() + 1);
    }
    return next;
  }
}
