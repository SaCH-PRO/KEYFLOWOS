import { Inject, Injectable, NotFoundException, BadRequestException, ConflictException, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { InvoiceWorkflowService } from '../commerce/invoice-workflow.service';
import { PostingService, buildExternalRef, type PostingInput } from './posting.service';

export interface CreateCreditNoteInput {
  invoiceId: string;
  creditNoteNumber: string;
  amount: number;
  reason?: string;
  items?: Array<{ description: string; quantity?: number; unitPrice?: number; amount: number }>;
}

export interface UpdateCreditNoteInput {
  amount?: number;
  reason?: string;
  items?: Array<{ description: string; quantity?: number; unitPrice?: number; amount: number }>;
}

const D = Prisma.Decimal;

/** The posting an applied note makes (PostingInput.kind): its externalRef is 'CREDIT_NOTE:<id>:credit_note_applied'. */
const APPLIED_KIND = 'credit_note_applied';

/**
 * Credit notes against an invoice (CF-42, V1-44-DM-CREDIT-NOTE, owner ruling
 * D-28). Applying a note posts a REVERSAL of kind credit_note_applied through
 * the ledger door (Dr revenue, pro rata over the invoice's recognition, / Cr
 * the receivable it was recognised on) and voiding an APPLIED note reverses
 * that posting (PostingService.reverse); a DRAFT note posts nothing. The
 * invoice's credited states are the workflow's: this service writes no
 * Invoice.status, it asks InvoiceWorkflowService.reconcileFromCredits to move
 * the invoice inside the same transaction as the note and its posting, under
 * the invoice row lock.
 */
@Injectable()
export class CreditNoteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(forwardRef(() => InvoiceWorkflowService)) private readonly workflow: InvoiceWorkflowService,
  ) {}

  async list(businessId: string) {
    return this.prisma.client.creditNote.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { invoice: { select: { invoiceNumber: true, contactId: true, total: true, status: true } } },
    });
  }

  async get(businessId: string, id: string) {
    const cn = await this.prisma.client.creditNote.findFirst({
      where: { id, businessId },
      include: { invoice: { select: { invoiceNumber: true, contactId: true, total: true, status: true } } },
    });
    if (!cn) throw new NotFoundException('Credit note not found');
    return cn;
  }

  async create(businessId: string, input: CreateCreditNoteInput) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId },
      select: { id: true, status: true, total: true },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');
    if (invoice.status === 'DRAFT') throw new BadRequestException('Cannot credit a draft invoice');

    const amount = new D(String(input.amount));
    const invoiceTotal = new D(String(invoice.total));
    if (amount.greaterThan(invoiceTotal)) {
      throw new BadRequestException(`Credit note amount (${amount.toString()}) exceeds invoice total (${invoiceTotal.toString()})`);
    }

    const existingCns = await this.prisma.client.creditNote.aggregate({
      where: { businessId, invoiceId: input.invoiceId, status: { not: 'VOID' } },
      _sum: { amount: true },
    });
    const alreadyCredited = new D(String(existingCns._sum.amount ?? 0));
    if (alreadyCredited.add(amount).greaterThan(invoiceTotal)) {
      throw new BadRequestException(`Total credits (${alreadyCredited.add(amount).toString()}) would exceed invoice total (${invoiceTotal.toString()})`);
    }

    const existing = await this.prisma.client.creditNote.findFirst({
      where: { businessId, creditNoteNumber: input.creditNoteNumber },
    });
    if (existing) throw new BadRequestException('Credit note number already exists');

    return this.prisma.client.creditNote.create({
      data: {
        businessId,
        invoiceId: input.invoiceId,
        creditNoteNumber: input.creditNoteNumber,
        amount,
        reason: input.reason ?? null,
        items: (input.items as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
      include: { invoice: { select: { invoiceNumber: true } } },
    });
  }

  async update(businessId: string, id: string, input: UpdateCreditNoteInput) {
    const cn = await this.get(businessId, id);
    if (cn.status !== 'DRAFT') throw new BadRequestException('Can only update draft credit notes');

    // V1-44: compare-and-set on DRAFT, so a PATCH racing an apply cannot change
    // the amount of a note whose posting is already written.
    try {
      return await this.prisma.client.creditNote.update({
        where: { id, status: 'DRAFT' },
        data: {
          ...(input.amount !== undefined && { amount: new D(String(input.amount)) }),
          ...(input.reason !== undefined && { reason: input.reason }),
          ...(input.items !== undefined && { items: input.items as unknown as Prisma.InputJsonValue }),
        },
        include: { invoice: { select: { invoiceNumber: true } } },
      });
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2025') throw new BadRequestException('Can only update draft credit notes');
      throw err;
    }
  }

  /**
   * Apply a DRAFT note (V1-44, CF-42). In one transaction, under the invoice
   * row lock: claim the note DRAFT -> APPLIED (compare-and-set, so of two
   * applies exactly one posts), refuse credits beyond the invoice total, let
   * the workflow move the invoice (reconcileFromCredits: 409 on a DRAFT or VOID
   * invoice), then post the REVERSAL of kind credit_note_applied against the
   * invoice's recognition (its 'Invoice:<id>:invoice_finalized' posting: what
   * onInvoiceFinalized writes, sourceType 'Invoice'; the base searched
   * 'INVOICE' and never found it). Any refusal rolls all of it back. An invoice
   * with no recognition (cash basis, or never issued) is refused 400, as
   * before.
   */
  async apply(businessId: string, id: string, opts: { userId?: string | null } = {}) {
    const cn = await this.get(businessId, id);
    if (cn.status !== 'DRAFT') throw new BadRequestException('Credit note already applied or voided');

    return this.prisma.client.$transaction(async (t) => {
      const tx = t as unknown as Prisma.TransactionClient;
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${cn.invoiceId} FOR NO KEY UPDATE`;

      const appliedAt = new Date();
      const claimed = await tx.creditNote.updateMany({
        where: { id: cn.id, businessId, status: 'DRAFT' },
        data: { status: 'APPLIED', appliedAt },
      });
      if (claimed.count !== 1) throw new ConflictException('Credit note already applied or voided');
      // The amount as claimed: a PATCH committed since `get` is in it, a later one is refused.
      const note = await tx.creditNote.findFirst({ where: { id: cn.id, businessId }, select: { amount: true } });
      const amount = new D(String(note?.amount ?? cn.amount));

      const invoice = await tx.invoice.findFirst({ where: { id: cn.invoiceId, businessId }, select: { total: true } });
      if (!invoice) throw new BadRequestException('Invoice not found');
      const creditedAgg = await tx.creditNote.aggregate({
        where: { businessId, invoiceId: cn.invoiceId, status: 'APPLIED' },
        _sum: { amount: true },
      });
      const totalCredited = new D(String(creditedAgg._sum.amount ?? 0));
      const invoiceTotal = new D(String(invoice.total));
      if (totalCredited.greaterThan(invoiceTotal)) {
        throw new BadRequestException(`Total credits (${totalCredited.toString()}) would exceed invoice total (${invoiceTotal.toString()})`);
      }

      // The workflow moves the invoice first: a DRAFT or VOID one is refused
      // 409 before anything is looked up or posted (everything rolls back).
      await this.workflow.reconcileFromCredits(cn.invoiceId, { tx });

      // The invoice's recognition, as RevenuePostingService.onInvoiceFinalized wrote it.
      const recognitionRef = buildExternalRef('Invoice', cn.invoiceId, 'invoice_finalized');
      const recognition = recognitionRef
        ? await tx.financialTransaction.findUnique({
            where: { businessId_externalRef: { businessId, externalRef: recognitionRef } },
            include: { entries: true },
          })
        : null;
      const live = recognition && recognition.status === 'POSTED' ? recognition.entries : [];
      // ALL its revenue credits (multi-line support) and its receivable debit.
      const revEntries = live.filter((e) => new D(String(e.credit)).greaterThan(0)).sort((a, b) => new D(String(b.credit)).comparedTo(new D(String(a.credit))));
      const arEntry = live.filter((e) => new D(String(e.debit)).greaterThan(0)).sort((a, b) => new D(String(b.debit)).comparedTo(new D(String(a.debit))))[0];
      if (!recognition || revEntries.length === 0 || !arEntry) {
        throw new BadRequestException('Could not find original invoice ledger entries to reverse');
      }

      const totalRevenue = revEntries.reduce((sum, e) => sum.add(new D(String(e.credit))), new D(0));

      // Pro-rate credit note amount across revenue accounts
      const postingEntries: PostingInput['entries'] = [];
      let allocated = new D(0);
      for (let i = 0; i < revEntries.length; i++) {
        const entry = revEntries[i];
        const share = i === revEntries.length - 1
          ? amount.sub(allocated) // last entry gets remainder to avoid rounding drift
          : amount.mul(new D(String(entry.credit))).div(totalRevenue).toDecimalPlaces(2); // whole cents (D-13), so the stored entries balance
        allocated = allocated.add(share);
        postingEntries.push({
          accountId: entry.accountId,
          debit: share,
          memo: `Reversal for CN ${cn.creditNoteNumber}`,
        });
      }

      postingEntries.push({
        accountId: arEntry.accountId,
        credit: amount,
        memo: `AR reduction for CN ${cn.creditNoteNumber}`,
      });

      const posting: PostingInput = {
        businessId,
        type: 'REVERSAL',
        date: appliedAt,
        amount,
        // The invoice's currency, as its recognition carries it (a TTD business's USD invoice).
        currency: recognition.currency,
        description: `Credit Note ${cn.creditNoteNumber} — ${cn.reason ?? 'Adjustment'}`,
        sourceType: 'CREDIT_NOTE',
        sourceId: cn.id,
        kind: APPLIED_KIND,
        reference: cn.creditNoteNumber,
        createdById: opts.userId ?? null,
        entries: postingEntries,
      };
      const postingResult = await this.posting.post(posting, tx);

      const creditNote = await tx.creditNote.update({
        where: { id: cn.id },
        data: { reversalTransactionId: postingResult.transactionId },
      });
      return { creditNote, transactionId: postingResult.transactionId };
    });
  }

  /**
   * Void a note (V1-44, CF-42). A DRAFT (or ISSUED) note posted nothing, so it
   * is only marked VOID. An APPLIED note is marked VOID, its credit_note_applied
   * posting is reversed through the ledger door (PostingService.reverse: an
   * offsetting transaction, the original REVERSED), and the workflow moves the
   * invoice back (reconcileFromCredits): to PARTIALLY_CREDITED while other
   * notes stay applied, else to the status its payments give it. An APPLIED
   * note with no posting (the rows the base's unreachable apply left, or a
   * seeded one) has nothing to reverse, and the invoice still converges. All of
   * it in one transaction under the invoice row lock, the note compare-and-set
   * on the status read.
   */
  async void(businessId: string, id: string, opts: { userId?: string | null } = {}) {
    const cn = await this.get(businessId, id);
    if (cn.status === 'VOID') throw new BadRequestException('Already voided');

    return this.prisma.client.$transaction(async (t) => {
      const tx = t as unknown as Prisma.TransactionClient;
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${cn.invoiceId} FOR NO KEY UPDATE`;

      const voided = await tx.creditNote.updateMany({
        where: { id: cn.id, businessId, status: cn.status },
        data: { status: 'VOID', voidedAt: new Date() },
      });
      if (voided.count !== 1) throw new ConflictException('Credit note changed while it was being voided; reload it and try again');

      if (cn.status === 'APPLIED') {
        const appliedRef = buildExternalRef('CREDIT_NOTE', cn.id, APPLIED_KIND);
        const applied = cn.reversalTransactionId
          ? await tx.financialTransaction.findFirst({ where: { id: cn.reversalTransactionId, businessId }, select: { id: true, status: true } })
          : appliedRef
            ? await tx.financialTransaction.findUnique({
                where: { businessId_externalRef: { businessId, externalRef: appliedRef } },
                select: { id: true, status: true },
              })
            : null;
        if (applied && applied.status !== 'REVERSED') {
          await this.posting.reverse(
            businessId,
            applied.id,
            { reason: `Credit note ${cn.creditNoteNumber} voided`, createdById: opts.userId ?? null },
            tx,
          );
        }
        await this.workflow.reconcileFromCredits(cn.invoiceId, { tx });
      }

      return tx.creditNote.findFirst({ where: { id: cn.id, businessId } });
    });
  }

  async remove(businessId: string, id: string) {
    const cn = await this.get(businessId, id);
    if (cn.status !== 'DRAFT') throw new BadRequestException('Can only delete draft credit notes');
    return this.prisma.client.creditNote.delete({ where: { id } });
  }
}
