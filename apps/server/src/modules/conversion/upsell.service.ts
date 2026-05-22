import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';

export interface UpsellItem {
  id: string;
  name: string;
  price: number;
  currency: string;
  description?: string | null;
  imageUrl?: string | null;
}

@Injectable()
export class UpsellService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  async getUpsellsForProduct(businessId: string, productId: string): Promise<UpsellItem[]> {
    const product = await this.prisma.client.product.findUnique({
      where: { id: productId, businessId },
      select: { executionMeta: true },
    });
    if (!product?.executionMeta) return [];

    const meta = product.executionMeta as Record<string, any>;
    const upsellIds = meta.upsellProductIds as string[] | undefined;
    if (!upsellIds?.length) return [];

    const upsells = await this.prisma.client.product.findMany({
      where: { id: { in: upsellIds }, businessId, isActive: true, deletedAt: null },
      select: { id: true, name: true, price: true, currency: true, description: true, imageUrl: true },
    });

    return upsells;
  }

  async getOrderBumpForCart(businessId: string, productIds: string[]): Promise<UpsellItem | null> {
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: productIds }, businessId },
      select: { id: true, executionMeta: true, price: true },
      orderBy: { price: 'desc' },
      take: 1,
    });
    if (!products.length) return null;

    const upsells = await this.getUpsellsForProduct(businessId, products[0].id);
    return upsells[0] ?? null;
  }

  async setUpsellProducts(businessId: string, productId: string, upsellIds: string[]) {
    const product = await this.prisma.client.product.findUnique({
      where: { id: productId, businessId },
      select: { executionMeta: true },
    });
    if (!product) throw new Error('Product not found');

    const meta = (product.executionMeta as Record<string, any>) ?? {};
    await this.catalog.updateProduct({
      businessId,
      productId,
      executionMeta: { ...meta, upsellProductIds: upsellIds },
    });
  }
}
