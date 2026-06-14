import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PostingService, type PostingInput } from './posting.service';

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

@Injectable()
export class CreditNoteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PostingService) private readonly posting: PostingService,
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

    return this.prisma.client.creditNote.update({
      where: { id },
      data: {
        ...(input.amount !== undefined && { amount: new D(String(input.amount)) }),
        ...(input.reason !== undefined && { reason: input.reason }),
        ...(input.items !== undefined && { items: input.items as unknown as Prisma.InputJsonValue }),
      },
      include: { invoice: { select: { invoiceNumber: true } } },
    });
  }

  async apply(businessId: string, id: string, opts: { userId?: string | null } = {}) {
    const cn = await this.get(businessId, id);
    if (cn.status !== 'DRAFT') throw new BadRequestException('Credit note already applied or voided');

    // Find ALL revenue ledger entries for the invoice (multi-line support)
    const revEntries = await this.prisma.client.ledgerEntry.findMany({
      where: {
        businessId,
        transaction: {
          sourceType: 'INVOICE',
          sourceId: cn.invoiceId,
        },
        credit: { gt: 0 },
      },
      include: { account: true },
      orderBy: { credit: 'desc' },
    });

    const arEntry = await this.prisma.client.ledgerEntry.findFirst({
      where: {
        businessId,
        transaction: {
          sourceType: 'INVOICE',
          sourceId: cn.invoiceId,
        },
        debit: { gt: 0 },
      },
      include: { account: true },
      orderBy: { debit: 'desc' },
    });

    if (revEntries.length === 0 || !arEntry) {
      throw new BadRequestException('Could not find original invoice ledger entries to reverse');
    }

    const amount = new D(String(cn.amount));
    const totalRevenue = revEntries.reduce((sum, e) => sum.add(new D(String(e.credit))), new D(0));

    // Pro-rate credit note amount across revenue accounts
    const postingEntries: PostingInput['entries'] = [];
    let allocated = new D(0);
    for (let i = 0; i < revEntries.length; i++) {
      const entry = revEntries[i];
      const share = i === revEntries.length - 1
        ? amount.sub(allocated) // last entry gets remainder to avoid rounding drift
        : amount.mul(new D(String(entry.credit))).div(totalRevenue);
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
      date: new Date(),
      amount,
      description: `Credit Note ${cn.creditNoteNumber} — ${cn.reason ?? 'Adjustment'}`,
      sourceType: 'CREDIT_NOTE',
      sourceId: cn.id,
      kind: 'credit_note_applied',
      reference: cn.creditNoteNumber,
      createdById: opts.userId ?? null,
      entries: postingEntries,
    };

    const result = await this.prisma.client.$transaction(async (tx) => {
      const postingResult = await this.posting.post(posting, tx as unknown as Prisma.TransactionClient);

      await tx.creditNote.update({
        where: { id: cn.id },
        data: {
          status: 'APPLIED',
          appliedAt: new Date(),
          reversalTransactionId: postingResult.transactionId,
        },
      });

      // Update invoice status based on total credits
      const invoice = await tx.invoice.findFirst({
        where: { id: cn.invoiceId, businessId },
        select: { total: true },
      });
      if (invoice) {
        const creditedAgg = await tx.creditNote.aggregate({
          where: { businessId, invoiceId: cn.invoiceId, status: 'APPLIED' },
          _sum: { amount: true },
        });
        const totalCredited = new D(String(creditedAgg._sum.amount ?? 0));
        const invoiceTotal = new D(String(invoice.total));
        await tx.invoice.update({
          where: { id: cn.invoiceId },
          data: {
            status: totalCredited.greaterThanOrEqualTo(invoiceTotal) ? 'FULLY_CREDITED' : 'PARTIALLY_CREDITED',
          },
        });
      }

      return postingResult;
    });

    return { creditNote: cn, transactionId: result.transactionId };
  }

  async void(businessId: string, id: string) {
    const cn = await this.get(businessId, id);
    if (cn.status === 'VOID') throw new BadRequestException('Already voided');

    return this.prisma.client.creditNote.update({
      where: { id: cn.id },
      data: { status: 'VOID', voidedAt: new Date() },
    });
  }

  async remove(businessId: string, id: string) {
    const cn = await this.get(businessId, id);
    if (cn.status !== 'DRAFT') throw new BadRequestException('Can only delete draft credit notes');
    return this.prisma.client.creditNote.delete({ where: { id } });
  }
}
