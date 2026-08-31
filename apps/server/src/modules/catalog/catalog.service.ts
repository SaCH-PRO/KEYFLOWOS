import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { resolveInventoryMode } from '../../core/inventory/inventory-mode';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { db } from '@keyflow/db';

type TransactionClient = Parameters<Parameters<typeof db['$transaction']>[0]>[0];

import {
  ProductCreatedPayload,
  ProductUpdatedPayload,
  ProductDeactivatedPayload,
  CatalogProductCreatedPayload,
  CatalogProductUpdatedPayload,
  CatalogProductDeletedPayload,
  CatalogServiceCreatedPayload,
  CatalogServiceUpdatedPayload,
  CatalogServiceDeletedPayload,
} from '../../core/event-bus/events.types';

export interface CatalogProductInput {
  businessId: string;
  name: string;
  price: number;
  currency?: string;
  description?: string | null;
  category?: string;
  duration?: number | null;
  imageUrl?: string | null;
  sku?: string | null;
  isActive?: boolean;
  executionModel?: string | null;
  executionMeta?: any;
  fulfillmentModel?: string | null;
  inventoryMode?: string | null;
  outOfStockBehavior?: string | null;
  compareAtPrice?: number | null;
  // Digital resource (community/resource-marketplace) fields
  resourceType?: string | null;
  downloadUrl?: string | null;
  previewUrl?: string | null;
  licenseTerms?: string | null;
  isFree?: boolean | null;
  fileSize?: number | null;
}

export interface CatalogProductPatch {
  businessId: string;
  productId: string;
  name?: string;
  price?: number;
  currency?: string;
  description?: string | null;
  category?: string;
  duration?: number | null;
  imageUrl?: string | null;
  sku?: string | null;
  isActive?: boolean;
  executionModel?: string | null;
  executionMeta?: any;
  fulfillmentModel?: string | null;
  inventoryMode?: string | null;
  outOfStockBehavior?: string | null;
  compareAtPrice?: number | null;
}

export interface CatalogServiceInput {
  businessId: string;
  name: string;
  duration: number;
  price: number;
  description?: string | null;
  bufferMins?: number | null;
  leadTimeMins?: number | null;
  sourceProductId?: string | null;
}

export interface CatalogServicePatch {
  businessId: string;
  serviceId: string;
  name?: string;
  duration?: number;
  price?: number;
  description?: string | null;
  bufferMins?: number | null;
  leadTimeMins?: number | null;
  sourceProductId?: string | null;
}

/**
 * Canonical owner of Product + Service CRUD.
 *
 * Store, Commerce, and Bookings MUST go through this service for any
 * catalog write. Reads may continue to use Prisma directly, but writes
 * are funneled here so validation, normalization, and event emission
 * stay consistent across modules.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  // ---------- Products ----------

  async listProducts(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.client.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.product.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Public storefront listing. Augments each product row with live
   * inventory state derived from `InventoryStock` (sum across warehouses,
   * minus reservations) and computes:
   *   - availableQuantity: number | null (null when untracked/virtual)
   *   - stockStatus: 'available' | 'low' | 'out_of_stock' | 'backorder' | 'untracked'
   *   - purchasable: boolean — single source of truth for storefront UI
   * Tracked products at zero stock with outOfStockBehavior='hide' are
   * filtered out of the public list entirely.
   */
  async listPublicProducts(businessId: string) {
    const products = await this.prisma.client.product.findMany({
      where: { businessId, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    const stockByProduct = await this.aggregateStock(products.map((p) => p.id));
    const result: any[] = [];
    for (const p of products) {
      const projected = this.projectAvailability(p, stockByProduct.get(p.id));
      if (projected.hidden) continue;
      result.push({ ...p, ...projected.public });
    }
    return result;
  }

  async getProduct(businessId: string, productId: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) return null;
    const stockByProduct = await this.aggregateStock([product.id]);
    const projected = this.projectAvailability(product, stockByProduct.get(product.id));
    return { ...product, ...projected.public };
  }

  private async aggregateStock(productIds: string[]) {
    const map = new Map<string, { quantity: number; reserved: number }>();
    if (productIds.length === 0) return map;
    const rows = await this.prisma.client.inventoryStock.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds } },
      _sum: { quantity: true, reserved: true },
    });
    for (const r of rows) {
      map.set(r.productId, {
        quantity: r._sum.quantity ?? 0,
        reserved: r._sum.reserved ?? 0,
      });
    }
    return map;
  }

  private projectAvailability(
    product: { inventoryMode: string | null; outOfStockBehavior: string | null },
    stock: { quantity: number; reserved: number } | undefined,
  ): {
    hidden: boolean;
    public: {
      availableQuantity: number | null;
      stockStatus: 'available' | 'low' | 'out_of_stock' | 'backorder' | 'untracked';
      purchasable: boolean;
      outOfStockBehavior: string;
    };
  } {
    // See core/inventory/inventory-mode.ts. Resolving NULL to 'tracked'
    // here hid every product whose owner never opened inventory settings:
    // gated as out_of_stock, and with outOfStockBehavior defaulting to
    // 'hide', absent from the storefront altogether.
    const mode = resolveInventoryMode(product.inventoryMode, stock !== undefined);
    const behavior = product.outOfStockBehavior ?? 'hide';

    // Untracked / virtual: no inventory gating, always purchasable.
    if (mode !== 'tracked') {
      return {
        hidden: false,
        public: {
          availableQuantity: null,
          stockStatus: 'untracked',
          purchasable: true,
          outOfStockBehavior: behavior,
        },
      };
    }

    const qty = stock?.quantity ?? 0;
    const reserved = stock?.reserved ?? 0;
    const available = Math.max(0, qty - reserved);

    if (available <= 0) {
      if (behavior === 'allow_backorder') {
        return {
          hidden: false,
          public: {
            availableQuantity: 0,
            stockStatus: 'backorder',
            purchasable: true,
            outOfStockBehavior: behavior,
          },
        };
      }
      if (behavior === 'show_oos') {
        return {
          hidden: false,
          public: {
            availableQuantity: 0,
            stockStatus: 'out_of_stock',
            purchasable: false,
            outOfStockBehavior: behavior,
          },
        };
      }
      // default: hide
      return {
        hidden: true,
        public: {
          availableQuantity: 0,
          stockStatus: 'out_of_stock',
          purchasable: false,
          outOfStockBehavior: behavior,
        },
      };
    }

    return {
      hidden: false,
      public: {
        availableQuantity: available,
        stockStatus: available <= 3 ? 'low' : 'available',
        purchasable: true,
        outOfStockBehavior: behavior,
      },
    };
  }

  async createProduct(input: CatalogProductInput, tx?: TransactionClient) {
    if (!input.name?.trim()) throw new Error('Product name is required');
    if (typeof input.price !== 'number' || Number.isNaN(input.price)) {
      throw new Error('Product price must be a number');
    }
    const client = tx ?? this.prisma.client;
    const product = await client.product.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        price: input.price,
        currency: input.currency ?? 'TTD',
        description: input.description ?? null,
        category: input.category ?? 'SERVICE',
        duration: input.duration ?? null,
        imageUrl: input.imageUrl ?? null,
        sku: input.sku ?? null,
        isActive: input.isActive ?? true,
        ...(input.executionModel !== undefined && { executionModel: input.executionModel }),
        ...(input.executionMeta !== undefined && { executionMeta: input.executionMeta }),
        ...(input.fulfillmentModel !== undefined && { fulfillmentModel: input.fulfillmentModel }),
        ...(input.inventoryMode !== undefined && { inventoryMode: input.inventoryMode }),
        ...(input.outOfStockBehavior !== undefined && { outOfStockBehavior: input.outOfStockBehavior }),
        ...(input.compareAtPrice !== undefined && { compareAtPrice: input.compareAtPrice }),
        ...(input.resourceType !== undefined && { resourceType: input.resourceType }),
        ...(input.downloadUrl !== undefined && { downloadUrl: input.downloadUrl }),
        ...(input.previewUrl !== undefined && { previewUrl: input.previewUrl }),
        ...(input.licenseTerms !== undefined && { licenseTerms: input.licenseTerms }),
        ...(input.isFree !== undefined && input.isFree !== null && { isFree: input.isFree }),
        ...(input.fileSize !== undefined && { fileSize: input.fileSize }),
      },
    });
    // Canonical Catalog event + legacy product event for back-compat.
    this.events.emit('catalog.product.created', { product, businessId: input.businessId } as CatalogProductCreatedPayload);
    this.events.emit('product.created', { product, businessId: input.businessId } as ProductCreatedPayload);
    return product;
  }

  async updateProduct(input: CatalogProductPatch, tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    const data: Record<string, any> = {};
    const fields: (keyof CatalogProductPatch)[] = [
      'name', 'price', 'currency', 'description', 'category', 'duration',
      'imageUrl', 'sku', 'isActive', 'executionModel', 'executionMeta',
      'fulfillmentModel', 'inventoryMode', 'outOfStockBehavior', 'compareAtPrice',
    ];
    for (const k of fields) {
      if (input[k] !== undefined) data[k as string] = input[k];
    }
    const product = await client.product.update({
      where: { id: input.productId, businessId: input.businessId },
      data,
    });
    this.events.emit('catalog.product.updated', { product, businessId: input.businessId } as CatalogProductUpdatedPayload);
    this.events.emit('product.updated', { product, businessId: input.businessId } as ProductUpdatedPayload);
    return product;
  }

  async deleteProduct(businessId: string, productId: string, tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    const product = await client.product.update({
      where: { id: productId, businessId },
      data: { deletedAt: new Date() },
    });
    this.events.emit('catalog.product.deleted', { product, businessId } as CatalogProductDeletedPayload);
    this.events.emit('product.deactivated', { product, businessId } as ProductDeactivatedPayload);
    return product;
  }

  async deactivateProduct(businessId: string, productId: string, tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    const product = await client.product.update({
      where: { id: productId, businessId },
      data: { isActive: false },
    });
    this.events.emit('catalog.product.updated', { product, businessId } as CatalogProductUpdatedPayload);
    this.events.emit('product.updated', { product, businessId } as ProductUpdatedPayload);
    return product;
  }

  async bulkUpdateProducts(businessId: string, ids: string[], action: 'activate' | 'deactivate' | 'delete', tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    const where = { id: { in: ids }, businessId, deletedAt: null };
    let result: { count: number };
    switch (action) {
      case 'activate':
        result = await client.product.updateMany({ where, data: { isActive: true } });
        break;
      case 'deactivate':
        result = await client.product.updateMany({ where, data: { isActive: false } });
        break;
      case 'delete':
        result = await client.product.updateMany({ where, data: { deletedAt: new Date() } });
        break;
    }
    return { updated: result.count, action };
  }

  // ---------- Services ----------

  async listServices(businessId: string) {
    return this.prisma.client.service.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async getService(businessId: string, serviceId: string) {
    return this.prisma.client.service.findFirst({
      where: { id: serviceId, businessId, deletedAt: null },
    });
  }

  async createService(input: CatalogServiceInput, tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    if (!input.name?.trim()) throw new Error('Service name is required');
    if (typeof input.duration !== 'number' || input.duration <= 0) {
      throw new Error('Service duration must be a positive number');
    }
    if (typeof input.price !== 'number' || input.price < 0) {
      throw new Error('Service price must be a non-negative number');
    }
    const service = await client.service.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        duration: input.duration,
        price: input.price,
        description: input.description ?? null,
        bufferMins: input.bufferMins ?? null,
        leadTimeMins: input.leadTimeMins ?? null,
        sourceProductId: input.sourceProductId ?? null,
      },
    });
    this.events.emit('catalog.service.created', { service, businessId: input.businessId } as CatalogServiceCreatedPayload);
    return service;
  }

  async updateService(input: CatalogServicePatch, tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    const existing = await client.service.findFirst({
      where: { id: input.serviceId, businessId: input.businessId },
    });
    if (!existing) throw new NotFoundException('Service not found');
    const data: Record<string, any> = {};
    const fields: (keyof CatalogServicePatch)[] = [
      'name', 'duration', 'price', 'description', 'bufferMins', 'leadTimeMins', 'sourceProductId',
    ];
    for (const k of fields) {
      if (input[k] !== undefined) data[k as string] = input[k];
    }
    const service = await client.service.update({
      where: { id: input.serviceId },
      data,
    });
    this.events.emit('catalog.service.updated', { service, businessId: input.businessId } as CatalogServiceUpdatedPayload);
    return service;
  }

  async deleteService(businessId: string, serviceId: string, tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    const existing = await client.service.findFirst({
      where: { id: serviceId, businessId },
    });
    if (!existing) throw new NotFoundException('Service not found');
    const service = await client.service.update({
      where: { id: serviceId },
      data: { deletedAt: new Date() },
    });
    this.events.emit('catalog.service.deleted', { service, businessId } as CatalogServiceDeletedPayload);
    return { success: true, service };
  }

  async batchServices(
    businessId: string,
    body: {
      add?: Array<Omit<CatalogServiceInput, 'businessId'> & { businessId?: string }>;
      remove?: string[];
    },
    tx?: TransactionClient,
  ) {
    const client = tx ?? this.prisma.client;
    const results: { added: number; removed: number; errors: string[] } = { added: 0, removed: 0, errors: [] };

    if (body.remove?.length) {
      const removed = await client.service.updateMany({
        where: { id: { in: body.remove }, businessId },
        data: { deletedAt: new Date() },
      });
      results.removed = removed.count;
      // Emit per-id deletion events for downstream listeners
      for (const id of body.remove) {
        this.events.emit('catalog.service.deleted', { service: { id } as any, businessId } as CatalogServiceDeletedPayload);
      }
    }

    if (body.add?.length) {
      for (const item of body.add) {
        try {
          await this.createService({ ...item, businessId }, tx);
          results.added++;
        } catch (e) {
          results.errors.push(`Failed to add ${item.name}`);
        }
      }
    }

    return results;
  }

  /**
   * Internal: link a Service back to its source Product. Used by
   * Commerce store-readiness backfill.
   */
  async linkServiceToProduct(businessId: string, serviceId: string, productId: string, tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    const service = await client.service.update({
      where: { id: serviceId },
      data: { sourceProductId: productId },
    });
    this.events.emit('catalog.service.updated', { service, businessId } as CatalogServiceUpdatedPayload);
    return service;
  }
}
