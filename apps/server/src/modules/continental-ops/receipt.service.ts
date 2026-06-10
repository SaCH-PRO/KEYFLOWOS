import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateReceiptInput {
  receiptNumber: string;
  invoiceId: string;
  amount: number;
  currency?: string;
  paymentMethod: string;
  receivedFrom?: string;
  receivedBy?: string;
  receivedAt?: string;
  notes?: string;
}

export interface UpdateReceiptInput {
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  receivedFrom?: string;
  receivedBy?: string;
  receivedAt?: string;
  notes?: string;
}

/**
 * Continental Ops — Formal payment receipt document. Linked to invoice.
 * Cross-referenced: receipt number recorded on invoice, invoice number on receipt.
 */
@Injectable()
export class ReceiptService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.receipt.findMany({
      where: { businessId },
      orderBy: { receivedAt: 'desc' },
      include: { invoice: { select: { invoiceNumber: true, contactId: true, total: true } } },
    });
  }

  async get(businessId: string, id: string) {
    const r = await this.prisma.client.receipt.findFirst({
      where: { id, businessId },
      include: { invoice: { select: { invoiceNumber: true, contactId: true, total: true, status: true } } },
    });
    if (!r) throw new NotFoundException('Receipt not found');
    return r;
  }

  async create(businessId: string, input: CreateReceiptInput) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId },
      select: { id: true },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');

    const existing = await this.prisma.client.receipt.findFirst({
      where: { businessId, receiptNumber: input.receiptNumber },
    });
    if (existing) throw new BadRequestException('Receipt number already exists');

    return this.prisma.client.receipt.create({
      data: {
        businessId,
        receiptNumber: input.receiptNumber,
        invoiceId: input.invoiceId,
        amount: input.amount,
        currency: input.currency ?? 'TTD',
        paymentMethod: input.paymentMethod,
        receivedFrom: input.receivedFrom ?? null,
        receivedBy: input.receivedBy ?? null,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
        notes: input.notes ?? null,
      },
      include: { invoice: { select: { invoiceNumber: true } } },
    });
  }

  async update(businessId: string, id: string, input: UpdateReceiptInput) {
    await this.get(businessId, id);
    return this.prisma.client.receipt.update({
      where: { id },
      data: {
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.paymentMethod !== undefined && { paymentMethod: input.paymentMethod }),
        ...(input.receivedFrom !== undefined && { receivedFrom: input.receivedFrom }),
        ...(input.receivedBy !== undefined && { receivedBy: input.receivedBy }),
        ...(input.receivedAt !== undefined && { receivedAt: new Date(input.receivedAt) }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
      include: { invoice: { select: { invoiceNumber: true } } },
    });
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.receipt.delete({ where: { id } });
  }
}
