import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateDeliveryNoteInput {
  dnNumber: string;
  invoiceId: string;
  items: Array<{ productId?: string; description: string; quantity: number; unitPrice?: number }>;
  notes?: string;
}

export interface UpdateDeliveryNoteInput {
  items?: Array<{ productId?: string; description: string; quantity: number; unitPrice?: number }>;
  notes?: string;
  status?: 'DRAFT' | 'ISSUED' | 'DELIVERED' | 'CANCELLED';
  deliveredAt?: string;
  delivererName?: string;
  delivererSignature?: string;
  receiverName?: string;
  receiverSignature?: string;
}

/**
 * Continental Ops — Delivery Note authorizes release of goods from inventory.
 * Workflow: Invoice created → Delivery Note issued → Goods dispatched → Signed.
 */
@Injectable()
export class DeliveryNoteService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.deliveryNote.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { invoice: { select: { invoiceNumber: true, contactId: true, total: true, status: true } } },
    });
  }

  async get(businessId: string, id: string) {
    const dn = await this.prisma.client.deliveryNote.findFirst({
      where: { id, businessId },
      include: { invoice: { select: { invoiceNumber: true, contactId: true, total: true, status: true } } },
    });
    if (!dn) throw new NotFoundException('Delivery note not found');
    return dn;
  }

  async create(businessId: string, input: CreateDeliveryNoteInput) {
    const invoice = await this.prisma.client.invoice.findFirst({
      where: { id: input.invoiceId, businessId },
      select: { id: true },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');

    const existing = await this.prisma.client.deliveryNote.findFirst({
      where: { businessId, dnNumber: input.dnNumber },
    });
    if (existing) throw new BadRequestException('Delivery note number already exists');

    return this.prisma.client.deliveryNote.create({
      data: {
        businessId,
        dnNumber: input.dnNumber,
        invoiceId: input.invoiceId,
        items: input.items as unknown as import('@prisma/client').Prisma.InputJsonValue,
        notes: input.notes ?? null,
      },
      include: { invoice: { select: { invoiceNumber: true } } },
    });
  }

  async update(businessId: string, id: string, input: UpdateDeliveryNoteInput) {
    const dn = await this.get(businessId, id);
    if (dn.status === 'CANCELLED') throw new BadRequestException('Cannot update a cancelled delivery note');

    return this.prisma.client.deliveryNote.update({
      where: { id },
      data: {
        ...(input.items !== undefined && { items: input.items as unknown as import('@prisma/client').Prisma.InputJsonValue }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.deliveredAt !== undefined && { deliveredAt: new Date(input.deliveredAt) }),
        ...(input.delivererName !== undefined && { delivererName: input.delivererName }),
        ...(input.delivererSignature !== undefined && { delivererSignature: input.delivererSignature }),
        ...(input.receiverName !== undefined && { receiverName: input.receiverName }),
        ...(input.receiverSignature !== undefined && { receiverSignature: input.receiverSignature }),
      },
      include: { invoice: { select: { invoiceNumber: true } } },
    });
  }

  async fulfill(businessId: string, id: string, input: {
    delivererName?: string;
    delivererSignature?: string;
    receiverName?: string;
    receiverSignature?: string;
  }) {
    const dn = await this.get(businessId, id);
    if (dn.status === 'DELIVERED') throw new BadRequestException('Already delivered');
    if (dn.status === 'CANCELLED') throw new BadRequestException('Cannot fulfill a cancelled delivery note');

    const items = dn.items as unknown as Array<{ productId?: string; quantity: number }>;

    return this.prisma.client.$transaction(async (tx) => {
      // Decrement inventory stock for each item and record stock movement
      for (const item of items) {
        if (!item.productId || item.quantity <= 0) continue;
        await tx.inventoryStock.updateMany({
          where: { productId: item.productId, businessId },
          data: { quantity: { decrement: item.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            businessId,
            productId: item.productId,
            quantityChange: -item.quantity,
            reasonCode: 'SALE',
            referenceId: dn.id,
            note: `Delivery note ${dn.dnNumber} fulfilled`,
          },
        });
      }

      return tx.deliveryNote.update({
        where: { id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          delivererName: input.delivererName ?? null,
          delivererSignature: input.delivererSignature ?? null,
          receiverName: input.receiverName ?? null,
          receiverSignature: input.receiverSignature ?? null,
        },
        include: { invoice: { select: { invoiceNumber: true } } },
      });
    });
  }

  async cancel(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.deliveryNote.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.deliveryNote.delete({ where: { id } });
  }
}
