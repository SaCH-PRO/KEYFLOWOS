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

  async createRecurringInvoice(input: {
    businessId: string;
    contactId: string;
    name: string;
    description?: string | null;
    frequency: string;
    amount: number;
    currency?: string;
    startDate: Date | string;
    endDate?: Date | string | null;
    nextRunDate: Date | string;
    metadata?: Record<string, unknown> | null;
  }) {
    const recurringInvoice = await this.prisma.client.recurringInvoice.create({
      data: {
        businessId: input.businessId,
        contactId: input.contactId,
        name: input.name,
        description: input.description ?? null,
        frequency: input.frequency,
        amount: input.amount,
        currency: input.currency ?? 'TTD',
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        nextRunDate: new Date(input.nextRunDate),
        status: 'ACTIVE',
        metadata: input.metadata ? (input.metadata as any) : null,
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
    description?: string | null;
    frequency?: string;
    amount?: number;
    currency?: string;
    startDate?: Date | string;
    endDate?: Date | string | null;
    nextRunDate?: Date | string;
    status?: string;
    metadata?: Record<string, unknown> | null;
  }) {
    const existing = await this.prisma.client.recurringInvoice.findFirst({
      where: { id: input.id, businessId: input.businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Recurring invoice not found');

    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.frequency !== undefined) data.frequency = input.frequency;
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.startDate !== undefined) data.startDate = new Date(input.startDate);
    if (input.endDate !== undefined) data.endDate = input.endDate ? new Date(input.endDate) : null;
    if (input.nextRunDate !== undefined) data.nextRunDate = new Date(input.nextRunDate);
    if (input.status !== undefined) data.status = input.status;
    if (input.metadata !== undefined) data.metadata = input.metadata ? (input.metadata as any) : null;

    const recurringInvoice = await this.prisma.client.recurringInvoice.update({
      where: { id: input.id },
      data,
      include: { contact: true },
    });
    this.events.emit('recurring_invoice.updated', {
      recurringInvoice,
      businessId: input.businessId,
    });
    return recurringInvoice;
  }

  async pauseRecurringInvoice(businessId: string, id: string) {
    const existing = await this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Recurring invoice not found');
    if (existing.status !== 'ACTIVE') {
      throw new Error('Only active recurring invoices can be paused');
    }
    const recurringInvoice = await this.prisma.client.recurringInvoice.update({
      where: { id },
      data: { status: 'PAUSED' },
      include: { contact: true },
    });
    this.events.emit('recurring_invoice.paused', { recurringInvoice, businessId });
    return recurringInvoice;
  }

  async resumeRecurringInvoice(businessId: string, id: string) {
    const existing = await this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Recurring invoice not found');
    if (existing.status !== 'PAUSED') {
      throw new Error('Only paused recurring invoices can be resumed');
    }
    const recurringInvoice = await this.prisma.client.recurringInvoice.update({
      where: { id },
      data: { status: 'ACTIVE' },
      include: { contact: true },
    });
    this.events.emit('recurring_invoice.resumed', { recurringInvoice, businessId });
    return recurringInvoice;
  }

  async cancelRecurringInvoice(businessId: string, id: string) {
    const existing = await this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Recurring invoice not found');
    const recurringInvoice = await this.prisma.client.recurringInvoice.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { contact: true },
    });
    this.events.emit('recurring_invoice.cancelled', { recurringInvoice, businessId });
    return recurringInvoice;
  }

  listRecurringInvoices(businessId: string) {
    return this.prisma.client.recurringInvoice.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { contact: true },
    });
  }

  async getRecurringInvoice(businessId: string, id: string) {
    return this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId, deletedAt: null },
      include: { contact: true, generatedInvoices: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
  }

  async processRecurringInvoices() {
    if (this.running) return [];
    this.running = true;

    const now = new Date();
    const dueInvoices = await this.prisma.client.recurringInvoice.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        nextRunDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      include: { contact: true },
    });

    this.logger.log(`Processing ${dueInvoices.length} recurring invoices`);
    const results: Array<{ recurringId: string; invoiceId: string; invoiceNumber: string }> = [];

    for (const recurring of dueInvoices) {
      try {
        // Skip custom frequency — user must update nextRunDate manually
        if (recurring.frequency === 'CUSTOM') {
          this.logger.warn(`Skipping CUSTOM frequency recurring invoice ${recurring.id}`);
          continue;
        }

        const invoice = await this.prisma.client.invoice.create({
          data: {
            businessId: recurring.businessId,
            contactId: recurring.contactId,
            invoiceNumber: `INV-${Date.now()}`,
            status: 'DRAFT',
            issueDate: new Date(),
            subtotal: recurring.amount,
            taxRate: 0,
            taxAmount: 0,
            discountType: null,
            discountValue: null,
            discountAmount: 0,
            total: recurring.amount,
            currency: recurring.currency,
            notes: recurring.description,
            recurringInvoiceId: recurring.id,
            items: {
              create: [
                {
                  description: recurring.description || recurring.name,
                  quantity: 1,
                  unitPrice: recurring.amount,
                  total: recurring.amount,
                },
              ],
            },
          },
          include: { items: true, contact: true },
        });

        const sentInvoice = await this.invoiceWorkflow.transition(invoice.id, 'SENT', {
          sentAt: new Date(),
        });

        const nextRunDate = this.calculateNextRunDate(recurring.nextRunDate, recurring.frequency);

        await this.prisma.client.recurringInvoice.update({
          where: { id: recurring.id },
          data: {
            lastGeneratedAt: now,
            nextRunDate,
            generatedCount: { increment: 1 },
            failureCount: 0,
            lastError: null,
            lastFailureAt: null,
          },
        });

        this.events.emit('recurring_invoice.generated', {
          recurringInvoice: { ...recurring, lastGeneratedAt: now, nextRunDate, generatedCount: recurring.generatedCount + 1 },
          invoice: sentInvoice,
          businessId: recurring.businessId,
        });
        this.events.emit('invoice.created', {
          invoice: sentInvoice,
          businessId: recurring.businessId,
        });

        this.logger.log(
          `Generated invoice ${sentInvoice.invoiceNumber} from recurring "${recurring.name}"`,
        );
        results.push({
          recurringId: recurring.id,
          invoiceId: sentInvoice.id,
          invoiceNumber: sentInvoice.invoiceNumber,
        });
      } catch (error: any) {
        this.logger.error(
          `Failed to process recurring invoice ${recurring.id}: ${error?.message}`,
          error?.stack,
        );
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
          this.logger.error(
            `Failed to record failure for recurring ${recurring.id}`,
            writeErr as Error,
          );
        }
        this.events.emit('recurring_invoice.failed', {
          recurringInvoice: recurring,
          businessId: recurring.businessId,
          error: String(error?.message ?? error),
        });
      }
    }

    this.running = false;
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
      case 'ANNUALLY':
      case 'YEARLY':
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        next.setMonth(next.getMonth() + 1);
    }
    return next;
  }
}
