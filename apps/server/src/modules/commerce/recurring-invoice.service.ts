import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoiceWorkflowService } from './invoice-workflow.service';

/** lastError of a schedule whose contact belongs to another business (V1-12 review ST-12-3). */
const CONTACT_OUTSIDE_BUSINESS = "the schedule's contact does not belong to its business; not billed";

/**
 * The schedule as an event hands it to listeners. A contact of another
 * business is never handed on: listeners write that contact's timeline and
 * notify the customer from it (V1-12 review ST-12-3).
 */
function scheduleForEvent<T extends { businessId: string; contact?: { businessId: string } | null }>(schedule: T) {
  return schedule.contact && schedule.contact.businessId === schedule.businessId
    ? schedule
    : { ...schedule, contactId: null, contact: null };
}

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
    const contactId = await this.assertContactInBusiness(input.contactId, input.businessId);
    const recurringInvoice = await this.prisma.client.recurringInvoice.create({
      data: {
        businessId: input.businessId,
        contactId,
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

  /**
   * Resolve a contact id inside the caller's tenant before a schedule binds it.
   * A schedule is the third way a contact reaches an Invoice (after invoice
   * create and quote convert), and the row is returned with
   * `include: { contact: true }`, so a foreign id would both bind another
   * tenant's contact to every invoice the schedule issues and disclose its row.
   * Same rule and answers as CommerceService.assertContactInBusiness (private
   * there): a foreign, soft-deleted or unknown id is the same 404 and nothing
   * is written. V1-12 review ST-12-3 (ST-27-1).
   */
  private async assertContactInBusiness(contactId: unknown, businessId: string): Promise<string> {
    if (typeof contactId !== 'string' || contactId.length === 0) {
      throw new BadRequestException('contactId must be a non-empty string');
    }
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, businessId },
      select: { id: true },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contactId;
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

  /**
   * Invoices this schedule has actually produced.
   *
   * The recurring panel has offered a "history" view since it was written and
   * called an endpoint that did not exist, so the drawer opened empty every
   * time. `getRecurringInvoice` already reads the same relation but caps at 10
   * and is only used for the detail view; history needs the full run.
   *
   * Ownership is checked on the SCHEDULE before the invoices are read. Filtering
   * the invoices by businessId alone would return an empty list for someone
   * else's schedule id rather than saying it is not theirs, which reads to the
   * caller as "this schedule has never run".
   */
  async listGenerationHistory(businessId: string, id: string) {
    const schedule = await this.prisma.client.recurringInvoice.findFirst({
      where: { id, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!schedule) throw new NotFoundException('Recurring invoice not found');

    const invoices = await this.prisma.client.invoice.findMany({
      where: { businessId, recurringInvoiceId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
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
    return invoices;
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

  /**
   * Bill every due schedule once for its current period.
   *
   * V1-12 (#174 REL-03 / PRS-M15): the overlap flag is released in `finally`.
   * It used to be reset only on the last line, so one rejected scan (a
   * transient DB error) left it set and every later run of this process
   * returned [] without reading a schedule.
   */
  async processRecurringInvoices() {
    if (this.running) return [];
    this.running = true;
    try {
      return await this.runDueSchedules();
    } finally {
      this.running = false;
    }
  }

  private async runDueSchedules() {
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

        // V1-12 review ST-12-3: a schedule bound to another business's contact
        // (a row written before create checked the tenant) is never billed,
        // and that contact is never handed to a listener: the `due` trigger
        // sends the customer the invoice. Recorded as a failure on the schedule.
        if (recurring.contact.businessId !== recurring.businessId) {
          throw new Error(CONTACT_OUTSIDE_BUSINESS);
        }

        this.events.emit('recurring_invoice.due', {
          recurringInvoice: recurring,
          businessId: recurring.businessId,
          nextRunDate: recurring.nextRunDate,
        });

        const nextRunDate = this.calculateNextRunDate(recurring.nextRunDate, recurring.frequency);

        // V1-12 (#174 REL-04 / PRS-M16): one transaction for the period. The
        // schedule advance, the invoice create and the SENT transition (with
        // its ACCRUAL posting) commit together or not at all, so a failure
        // anywhere leaves the period due and nothing billed, and the retry
        // bills it once. They used to run separately with the advance last:
        // a failure after SENT left a posted invoice behind a schedule still
        // due, and the next run billed the customer again.
        //
        // The advance runs first and is a compare-and-set on the nextRunDate
        // this run read: a second runner (another instance) that read the
        // same period waits on the row lock, then matches no row and skips.
        // Invoice events are buffered and emitted only after the commit.
        //
        // V1-12 review (ST-12-1 / ST-12-2): the claim re-applies the scan's
        // whole due predicate (status, deletedAt, endDate) and binds the
        // frequency the advance was computed from, so a schedule paused,
        // cancelled, deleted, ended or re-scheduled after the scan matches no
        // row and is not billed this run. The invoice is built from the row
        // read back after the claim (whose lock is held until commit), not
        // from the scan snapshot: an amount changed after the scan bills at
        // the amount the schedule holds. The contact's tenant is checked again
        // on that row.
        const pendingEvents: Array<{ name: string; payload: unknown }> = [];
        const billed = await this.prisma.client.$transaction(async (tx) => {
          const claimed = await tx.recurringInvoice.updateMany({
            where: {
              id: recurring.id,
              nextRunDate: recurring.nextRunDate,
              frequency: recurring.frequency,
              status: 'ACTIVE',
              deletedAt: null,
              OR: [{ endDate: null }, { endDate: { gte: now } }],
            },
            data: {
              lastGeneratedAt: now,
              nextRunDate,
              generatedCount: { increment: 1 },
              failureCount: 0,
              lastError: null,
              lastFailureAt: null,
            },
          });
          if (claimed.count === 0) return null;

          const schedule = await tx.recurringInvoice.findUnique({
            where: { id: recurring.id },
            include: { contact: true },
          });
          if (!schedule || schedule.contact.businessId !== schedule.businessId) {
            throw new Error(CONTACT_OUTSIDE_BUSINESS);
          }

          const invoice = await tx.invoice.create({
            data: {
              businessId: schedule.businessId,
              contactId: schedule.contactId,
              invoiceNumber: `INV-${Date.now()}`,
              status: 'DRAFT',
              issueDate: new Date(),
              subtotal: schedule.amount,
              taxRate: 0,
              taxAmount: 0,
              discountType: null,
              discountValue: null,
              discountAmount: 0,
              total: schedule.amount,
              currency: schedule.currency,
              notes: schedule.description,
              recurringInvoiceId: schedule.id,
              items: {
                create: [
                  {
                    description: schedule.description || schedule.name,
                    quantity: 1,
                    unitPrice: schedule.amount,
                    total: schedule.amount,
                  },
                ],
              },
            },
          });

          const sent = await this.invoiceWorkflow.transition(invoice.id, 'SENT', {
            sentAt: new Date(),
            tx: tx as unknown as Prisma.TransactionClient,
            eventBuffer: pendingEvents,
          });
          return { schedule, invoice: sent };
        });

        if (!billed) {
          this.logger.log(
            `Recurring invoice ${recurring.id}: no longer due when claimed (billed by another run, or paused, cancelled, deleted, ended or re-scheduled since the scan); skipped`,
          );
          continue;
        }
        const { schedule, invoice: sentInvoice } = billed;

        for (const event of pendingEvents) this.events.emit(event.name, event.payload);
        this.events.emit('recurring_invoice.generated', {
          recurringInvoice: schedule,
          invoice: sentInvoice,
          businessId: schedule.businessId,
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
          recurringInvoice: scheduleForEvent(recurring),
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
