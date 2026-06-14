import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateStockCountInput {
  countNumber: string;
  countDate?: string;
  countedBy?: string;
  notes?: string;
  items: Array<{
    productId?: string;
    description: string;
    systemQty: number;
    countedQty: number;
  }>;
}

export interface UpdateStockCountInput {
  countDate?: string;
  countedBy?: string;
  notes?: string;
  items?: Array<{
    productId?: string;
    description: string;
    systemQty: number;
    countedQty: number;
  }>;
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'ADJUSTED';
}

/**
 * Continental Ops — Physical stock count with discrepancy audit.
 * Counts are compared against system inventory. Variances trigger adjustments.
 */
@Injectable()
export class StockCountService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(businessId: string) {
    return this.prisma.client.stockCount.findMany({
      where: { businessId },
      orderBy: { countDate: 'desc' },
    });
  }

  async get(businessId: string, id: string) {
    const sc = await this.prisma.client.stockCount.findFirst({ where: { id, businessId } });
    if (!sc) throw new NotFoundException('Stock count not found');
    return sc;
  }

  async create(businessId: string, input: CreateStockCountInput) {
    const existing = await this.prisma.client.stockCount.findFirst({
      where: { businessId, countNumber: input.countNumber },
    });
    if (existing) throw new BadRequestException('Count number already exists');

    const itemsWithVariance = input.items.map((i) => ({
      ...i,
      variance: (i.countedQty ?? 0) - (i.systemQty ?? 0),
    }));

    return this.prisma.client.stockCount.create({
      data: {
        businessId,
        countNumber: input.countNumber,
        countDate: input.countDate ? new Date(input.countDate) : new Date(),
        countedBy: input.countedBy ?? null,
        notes: input.notes ?? null,
        items: itemsWithVariance as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
  }

  async update(businessId: string, id: string, input: UpdateStockCountInput) {
    const sc = await this.get(businessId, id);
    if (sc.status === 'ADJUSTED') throw new BadRequestException('Cannot update an adjusted stock count');

    let items = input.items;
    if (items) {
      items = items.map((i) => ({
        ...i,
        variance: (i.countedQty ?? 0) - (i.systemQty ?? 0),
      }));
    }

    return this.prisma.client.stockCount.update({
      where: { id },
      data: {
        ...(input.countDate !== undefined && { countDate: new Date(input.countDate) }),
        ...(input.countedBy !== undefined && { countedBy: input.countedBy }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(items !== undefined && { items: items as unknown as import('@prisma/client').Prisma.InputJsonValue }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
  }

  async adjust(businessId: string, id: string) {
    const sc = await this.get(businessId, id);
    if (sc.status === 'ADJUSTED') throw new BadRequestException('Already adjusted');

    const items = sc.items as unknown as Array<{ productId?: string; countedQty: number; systemQty: number; variance: number }>;

    return this.prisma.client.$transaction(async (tx) => {
      for (const item of items) {
        if (!item.productId || item.variance === 0) continue;
        await tx.inventoryStock.updateMany({
          where: { productId: item.productId, businessId },
          data: { quantity: item.countedQty },
        });
      }

      return tx.stockCount.update({
        where: { id },
        data: { status: 'ADJUSTED' },
      });
    });
  }

  async remove(businessId: string, id: string) {
    await this.get(businessId, id);
    return this.prisma.client.stockCount.delete({ where: { id } });
  }
}
