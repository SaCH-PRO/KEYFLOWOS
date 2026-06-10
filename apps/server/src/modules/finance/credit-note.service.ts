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
      select: { id: true, status: true },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');
    if (invoice.status === 'DRAFT') throw new BadRequestException('Cannot credit a draft invoice');

    const existing = await this.prisma.client.creditNote.findFirst({
      where: { businessId, creditNoteNumber: input.creditNoteNumber },
    });
    if (existing) throw new BadRequestException('Credit note number already exists');

    return this.prisma.client.creditNote.create({
      data: {
        businessId,
        invoiceId: input.invoiceId,
        creditNoteNumber: input.creditNoteNumber,
        amount: new D(String(input.amount)),
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

    // Find the revenue account from the invoice's ledger entries
    const revEntry = await this.prisma.client.ledgerEntry.findFirst({
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

    const revenueAccountId = revEntry?.accountId;
    const arAccountId = arEntry?.accountId;

    if (!revenueAccountId || !arAccountId) {
      throw new BadRequestException('Could not find original invoice ledger entries to reverse');
    }

    const amount = new D(String(cn.amount));

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
      entries: [
        { accountId: revenueAccountId, debit: amount, memo: `Reversal for CN ${cn.creditNoteNumber}` },
        { accountId: arAccountId, credit: amount, memo: `AR reduction for CN ${cn.creditNoteNumber}` },
      ],
    };

    const result = await this.posting.post(posting);

    await this.prisma.client.creditNote.update({
      where: { id: cn.id },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
        reversalTransactionId: result.transactionId,
      },
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
