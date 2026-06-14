import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateGoodsReceiptInput {
  grNumber: string;
  purchaseOrderId?: string;
  supplierName?: string;
  receivedBy?: string;
  notes?: string;
  items: Array<{
    productId?: string;
    description: string;
    qtyOrdered: number;
    qtyReceived: number;
    qtyAccepted: number;
    qtyRejected: number;
    reason?: string;
  }>;
}

export interface UpdateGoodsReceiptInput {
  supplierName?: string;
  receivedBy?: string;
  notes?: string;
  items?: Array<{
    productId?: string;
    description: string;
    qtyOrdered: number;
    qtyReceived: number;
    qtyAccepted: number;
    qtyRejected: number;
    reason?: string;
  }>;
  status?: 'PENDING' | 'CHECKED' | 'POSTED' | 'DISCREPANCY';
}

/**
 * Continental Ops — Goods Receipt records physical receipt of inventory.
 * Qty received is checked against qty ordered. Discrepancies logged.
 */
@Injectable()
export class GoodsReceiptService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.goodsReceipt.findMany({
      where: { businessId },
      orderBy: { receivedAt: 'desc' },
      include: { purchaseOrder: { select: { poNumber: true, supplierName: true } } },
    });
  }

  async get(businessId: string, id: string) {
    const gr = await this.prisma.client.goodsReceipt.findFirst({
      where: { id, businessId },
      include: { purchaseOrder: { select: { poNumber: true, supplierName: true, items: true } } },
    });
    if (!gr) throw new NotFoundException('Goods receipt not found');
    return gr;
  }

  async create(businessId: string, input: CreateGoodsReceiptInput) {
    if (input.purchaseOrderId) {
      const po = await this.prisma.client.purchaseOrder.findFirst({
        where: { id: input.purchaseOrderId, businessId },
      });
      if (!po) throw new BadRequestException('Purchase order not found');
    }

    const existing = await this.prisma.client.goodsReceipt.findFirst({
      where: { businessId, grNumber: input.grNumber },
    });
    if (existing) throw new BadRequestException('GR number already exists');

    // Auto-detect discrepancies
    const hasDiscrepancy = input.items.some(
      (i) => (i.qtyAccepted + i.qtyRejected) !== i.qtyReceived || i.qtyReceived !== i.qtyOrdered,
    );

    return this.prisma.client.goodsReceipt.create({
      data: {
        businessId,
        grNumber: input.grNumber,
        purchaseOrderId: input.purchaseOrderId ?? null,
        supplierName: input.supplierName ?? null,
        receivedBy: input.receivedBy ?? null,
        notes: input.notes ?? null,
        items: input.items as unknown as import('@prisma/client').Prisma.InputJsonValue,
        status: hasDiscrepancy ? 'DISCREPANCY' : 'PENDING',
      },
      include: { purchaseOrder: { select: { poNumber: true } } },
    });
  }

  async update(businessId: string, id: string, input: UpdateGoodsReceiptInput) {
    const gr = await this.get(businessId, id);
    if (gr.status === 'POSTED') throw new BadRequestException('Cannot update a posted goods receipt');

    const items = input.items ?? (gr.items as unknown as CreateGoodsReceiptInput['items']);
    const hasDiscrepancy = items.some(
      (i: any) => (i.qtyAccepted + i.qtyRejected) !== i.qtyReceived || i.qtyReceived !== i.qtyOrdered,
    );

    return this.prisma.client.goodsReceipt.update({
      where: { id },
      data: {
        ...(input.supplierName !== undefined && { supplierName: input.supplierName }),
        ...(input.receivedBy !== undefined && { receivedBy: input.receivedBy }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.items !== undefined && { items: input.items as unknown as import('@prisma/client').Prisma.InputJsonValue }),
        ...(input.status !== undefined && { status: input.status }),
        ...(hasDiscrepancy && { status: 'DISCREPANCY' }),
      },
      include: { purchaseOrder: { select: { poNumber: true } } },
    });
  }

  async post(businessId: string, id: string) {
    const gr = await this.get(businessId, id);
    if (gr.status === 'POSTED') throw new BadRequestException('Already posted');

    // Update inventory stock levels for accepted quantities
    const items = gr.items as unknown as Array<{ productId?: string; qtyAccepted: number }>;

    return this.prisma.client.$transaction(async (tx) => {
      for (const item of items) {
        if (!item.productId || item.qtyAccepted <= 0) continue;
        await tx.inventoryStock.updateMany({
          where: { productId: item.productId, businessId },
          data: { quantity: { increment: item.qtyAccepted } },
        });
      }

      return tx.goodsReceipt.update({
        where: { id },
        data: { status: 'POSTED' },
      });
    });
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.goodsReceipt.delete({ where: { id } });
  }
}
