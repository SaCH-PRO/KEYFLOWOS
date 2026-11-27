import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import type { Prisma, Service } from '@prisma/client';
import { ownStockRows, resolveInventoryMode } from '../../core/inventory/inventory-mode';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { db } from '@keyflow/db';

type TransactionClient = Parameters<Parameters<typeof db['$transaction']>[0]>[0];

/** Advisory lock namespace for atomic (businessId, sourceProductId) store listing writes (P204 / V1-91). */
const STORE_LISTING_LOCK_NAMESPACE = 'store_listing_service';
const UNIFORM_PRODUCT_NOT_FOUND_MSG = 'Product not found or does not belong to this business';
const DUPLICATE_LISTING_CONFLICT_MSG = 'Product is already listed on the store by another service';
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

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

/*
 * What an anonymous visitor may read of a catalog row (M36, V1-23). Every
 * public read selects one of these instead of the whole row: a new column is
 * private until it is added here. Left out on purpose: downloadUrl (the paid
 * file), licenseTerms, sku, fulfillmentModel, inventoryMode, executionMeta;
 * a service's invoice timing, deposit terms, buffers and sourceProductId; a
 * staff member's hourlyRate and maxHoursPerWeek; every businessId and
 * timestamp.
 */
export const PUBLIC_PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  price: true,
  currency: true,
  category: true,
  duration: true,
  imageUrl: true,
  isActive: true,
  compareAtPrice: true,
} as const satisfies Prisma.ProductSelect;

export const PUBLIC_SERVICE_SELECT = {
  id: true,
  name: true,
  description: true,
  duration: true,
  price: true,
} as const satisfies Prisma.ServiceSelect;

export const PUBLIC_STAFF_SELECT = { id: true, name: true } as const satisfies Prisma.StaffMemberSelect;

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
  depositRequired?: boolean;
  depositType?: string | null;
  depositValue?: number | null;
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
  depositRequired?: boolean;
  depositType?: string | null;
  depositValue?: number | null;
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
   *
   * Each row is PUBLIC_PRODUCT_SELECT plus that availability, never the
   * whole Product. A business whose storefront is off, or that does not
   * exist, is a 404 (assertPublicStore), for this route and the Commerce
   * pass-through alike.
   */
  async listPublicProducts(businessId: string) {
    // SWP-STORE-LISTING-SERVER (BUG-055, ruling storelisting): only products
    // with a live listing Service (sourceProductId, deletedAt: null) for THIS
    // business appear on the public store. Closed stores still return 404 via
    // assertPublicStore before returning an empty list.
    const listings = await this.prisma.client.service.findMany({
      where: { businessId, deletedAt: null, sourceProductId: { not: null } },
      select: { sourceProductId: true },
      distinct: ['sourceProductId'],
    });
    const listedProductIds = listings
      .map((l) => l.sourceProductId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (listedProductIds.length === 0) {
      await this.assertPublicStore(businessId);
      return [];
    }

    const products = await this.prisma.client.product.findMany({
      where: {
        businessId,
        deletedAt: null,
        isActive: true,
        id: { in: listedProductIds },
        business: { deletedAt: null, storeEnabled: true },
      },
      orderBy: { createdAt: 'desc' },
      select: { ...PUBLIC_PRODUCT_SELECT, inventoryMode: true, outOfStockBehavior: true },
    });
    if (products.length === 0) {
      // The store filter rides on the query, so an empty list means either
      // "no open store" (404) or "an open store with nothing listed" ([]).
      await this.assertPublicStore(businessId);
      return [];
    }
    const stockByProduct = await this.aggregateStock(businessId, products.map((p) => p.id));
    const result: any[] = [];
    for (const { inventoryMode, outOfStockBehavior, ...publicFields } of products) {
      const projected = this.projectAvailability({ inventoryMode, outOfStockBehavior }, stockByProduct.get(publicFields.id));
      if (projected.hidden) continue;
      result.push({ ...publicFields, ...projected.public });
    }
    return result;
  }

  /**
   * 404 unless the business exists and its storefront is on (storeEnabled).
   * A closed store and an unknown id get the same answer, the one
   * getPublicStorefront gives (CF-56), so the public reads disclose nothing
   * about a store that is not open.
   */
  async assertPublicStore(businessId: string): Promise<void> {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null, storeEnabled: true },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Storefront not found');
  }

  async getProduct(businessId: string, productId: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) return null;
    const stockByProduct = await this.aggregateStock(businessId, [product.id]);
    const projected = this.projectAvailability(product, stockByProduct.get(product.id));
    return { ...product, ...projected.public };
  }

  /**
   * W11-CHECKOUT-PAIR-SCOPE review (CPS-SEC-2; D-137): the business's own stock
   * rows only (ownStockRows). A planted row of another business on this
   * business's product was summed in, so the anonymous list published that
   * business's quantity as this one's and, through resolveInventoryMode, made a
   * product with no inventoryMode tracked and purchasable from it, while the
   * paid door counts the business's own rows.
   */
  private async aggregateStock(businessId: string, productIds: string[]) {
    const map = new Map<string, { quantity: number; reserved: number }>();
    if (productIds.length === 0) return map;
    const rows = await this.prisma.client.inventoryStock.groupBy({
      by: ['productId'],
      where: { ...ownStockRows(businessId), productId: { in: productIds } },
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

  async createProduct(
    input: CatalogProductInput,
    tx?: TransactionClient,
    eventBuffer?: Array<{ name: string; payload: unknown }>,
  ) {
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
    // SEC-P78-1: callers running inside a Prisma $transaction pass eventBuffer
    // and flush after commit so listeners never act on rolled-back rows.
    const catalogProductPayload: CatalogProductCreatedPayload = { product, businessId: input.businessId };
    const productPayload: ProductCreatedPayload = { product, businessId: input.businessId };
    if (eventBuffer) {
      eventBuffer.push(
        { name: 'catalog.product.created', payload: catalogProductPayload },
        { name: 'product.created', payload: productPayload },
      );
    } else {
      this.events.emit('catalog.product.created', catalogProductPayload);
      this.events.emit('product.created', productPayload);
    }
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

  /**
   * Restore this business's trashed product (the trash's restore, D-95): clears
   * deletedAt and emits the update events, inside the Catalog module (the
   * catalog boundary keeps Product/Service writes here).
   */
  async restoreProduct(businessId: string, productId: string, tx?: TransactionClient) {
    const client = tx ?? this.prisma.client;
    const product = await client.product.update({
      where: { id: productId, businessId },
      data: { deletedAt: null },
    });
    this.events.emit('catalog.product.updated', { product, businessId } as CatalogProductUpdatedPayload);
    this.events.emit('product.updated', { product, businessId } as ProductUpdatedPayload);
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

  /**
   * V1-64 (SWP-SERVICE-DEPOSIT, BUG-048, COR-P69-1, COR-P69-2): validate raw
   * deposit input types (matching CatalogServiceDto even on /bookings
   * passthrough) and reject non-null depositType/depositValue when
   * depositRequired is omitted and effectively false so callers never get a
   * silent discard.
   */
  private validateDepositInputShape(
    input: { depositRequired?: boolean; depositType?: string | null; depositValue?: number | null },
    effectiveRequired: boolean,
  ): void {
    if (input.depositRequired !== undefined && typeof input.depositRequired !== 'boolean') {
      throw new BadRequestException('depositRequired must be a boolean');
    }
    if (
      input.depositType !== undefined &&
      input.depositType !== null &&
      input.depositType !== 'PERCENT' &&
      input.depositType !== 'FIXED'
    ) {
      throw new BadRequestException('depositType must be PERCENT or FIXED');
    }
    if (
      input.depositValue !== undefined &&
      input.depositValue !== null &&
      (typeof input.depositValue !== 'number' || !Number.isFinite(input.depositValue))
    ) {
      throw new BadRequestException('depositValue must be a finite number');
    }
    if (
      input.depositRequired === undefined &&
      !effectiveRequired &&
      (input.depositType != null || input.depositValue != null)
    ) {
      throw new BadRequestException('depositRequired must be true when setting depositType or depositValue');
    }
  }

  /**
   * V1-64 (SWP-SERVICE-DEPOSIT, BUG-048): validate and normalize service
   * deposit terms against the effective service price.
   *   - depositRequired=false -> clears depositType & depositValue to null.
   *   - depositRequired=true  -> requires depositType 'PERCENT' (1..100) or
   *     'FIXED' (> 0 and <= price), else 400 BadRequestException.
   */
  private normalizeServiceDeposit(
    price: number,
    next: { depositRequired: boolean; depositType: string | null; depositValue: number | null },
  ): { depositRequired: boolean; depositType: 'PERCENT' | 'FIXED' | null; depositValue: number | null } {
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      throw new BadRequestException('Service price must be a non-negative number');
    }
    if (!next.depositRequired) {
      return { depositRequired: false, depositType: null, depositValue: null };
    }
    if (next.depositType !== 'PERCENT' && next.depositType !== 'FIXED') {
      throw new BadRequestException('depositType must be PERCENT or FIXED when depositRequired is true');
    }
    if (typeof next.depositValue !== 'number' || !Number.isFinite(next.depositValue)) {
      throw new BadRequestException('depositValue must be a finite number when depositRequired is true');
    }
    if (next.depositType === 'PERCENT') {
      if (next.depositValue < 1 || next.depositValue > 100) {
        throw new BadRequestException('PERCENT depositValue must be between 1 and 100');
      }
      return { depositRequired: true, depositType: 'PERCENT', depositValue: next.depositValue };
    }
    if (next.depositValue <= 0 || next.depositValue > price) {
      throw new BadRequestException('FIXED depositValue must be greater than 0 and at most the service price');
    }
    return { depositRequired: true, depositType: 'FIXED', depositValue: next.depositValue };
  }

  /**
   * P204 / V1-91 (`FU-STORE-ADD-IDEMPOTENT`): normalize optional `sourceProductId`.
   * Blank/whitespace strings normalize to `null` (regular bookable service); non-string
   * or unstorable UTF-16/NUL payloads fail fast with 400.
   */
  private normalizeSourceProductId(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'string') {
      throw new BadRequestException('sourceProductId must be a string');
    }
    if (raw.includes('\u0000') || UNPAIRED_SURROGATE.test(raw)) {
      throw new BadRequestException('sourceProductId contains a character that cannot be stored');
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async lockStoreListing(
    txClient: TransactionClient,
    businessId: string,
    sourceProductId: string,
  ): Promise<void> {
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${STORE_LISTING_LOCK_NAMESPACE}), hashtext(${`${businessId}:${sourceProductId}`}))`;
  }

  private async assertLiveBusinessProduct(
    txClient: TransactionClient,
    businessId: string,
    productId: string,
  ): Promise<void> {
    const product = await txClient.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new BadRequestException(UNIFORM_PRODUCT_NOT_FOUND_MSG);
    }
  }

  async createService(
    input: CatalogServiceInput,
    tx?: TransactionClient,
    eventBuffer?: Array<{ name: string; payload: unknown }>,
  ) {
    if (!input.name?.trim()) throw new BadRequestException('Service name is required');
    if (typeof input.duration !== 'number' || !Number.isFinite(input.duration) || input.duration <= 0) {
      throw new BadRequestException('Service duration must be a positive number');
    }
    if (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price < 0) {
      throw new BadRequestException('Service price must be a non-negative number');
    }
    const effectiveRequired = input.depositRequired === true;
    this.validateDepositInputShape(input, effectiveRequired);
    const deposit = this.normalizeServiceDeposit(input.price, {
      depositRequired: effectiveRequired,
      depositType: input.depositType ?? null,
      depositValue: input.depositValue ?? null,
    });
    const sourceProductId = this.normalizeSourceProductId(input.sourceProductId);

    const emitCreated = (service: Service) => {
      const servicePayload: CatalogServiceCreatedPayload = { service, businessId: input.businessId };
      if (eventBuffer) {
        eventBuffer.push({ name: 'catalog.service.created', payload: servicePayload });
      } else {
        this.events.emit('catalog.service.created', servicePayload);
      }
    };

    if (!sourceProductId) {
      const client = tx ?? this.prisma.client;
      const service = await client.service.create({
        data: {
          businessId: input.businessId,
          name: input.name,
          duration: input.duration,
          price: input.price,
          description: input.description ?? null,
          bufferMins: input.bufferMins ?? null,
          leadTimeMins: input.leadTimeMins ?? null,
          sourceProductId: null,
          depositRequired: deposit.depositRequired,
          depositType: deposit.depositType,
          depositValue: deposit.depositValue,
        },
      });
      emitCreated(service);
      return service;
    }

    // P204 / V1-91 (`FU-STORE-ADD-IDEMPOTENT`): serialize store listing creation
    // per (businessId, sourceProductId) with pg_advisory_xact_lock, verify the
    // product is live and owned by this business, and return any existing live
    // listing idempotently without creating duplicates or re-emitting events.
    const runCreate = async (txClient: TransactionClient) => {
      await this.lockStoreListing(txClient, input.businessId, sourceProductId);
      await this.assertLiveBusinessProduct(txClient, input.businessId, sourceProductId);

      const existingListing = await txClient.service.findFirst({
        where: {
          businessId: input.businessId,
          sourceProductId,
          deletedAt: null,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (existingListing) {
        return { service: existingListing, created: false };
      }

      const createdService = await txClient.service.create({
        data: {
          businessId: input.businessId,
          name: input.name,
          duration: input.duration,
          price: input.price,
          description: input.description ?? null,
          bufferMins: input.bufferMins ?? null,
          leadTimeMins: input.leadTimeMins ?? null,
          sourceProductId,
          depositRequired: deposit.depositRequired,
          depositType: deposit.depositType,
          depositValue: deposit.depositValue,
        },
      });
      return { service: createdService, created: true };
    };

    const { service, created } = tx
      ? await runCreate(tx)
      : await this.prisma.client.$transaction((innerTx) => runCreate(innerTx));

    if (created) {
      emitCreated(service);
    }
    return service;
  }

  async updateService(input: CatalogServicePatch, tx?: TransactionClient) {
    if (input.duration !== undefined && (typeof input.duration !== 'number' || !Number.isFinite(input.duration) || input.duration <= 0)) {
      throw new BadRequestException('Service duration must be a positive number');
    }
    if (input.price !== undefined && (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price < 0)) {
      throw new BadRequestException('Service price must be a non-negative number');
    }
    const hasSourceProductPatch = input.sourceProductId !== undefined;
    const normalizedSourceProductId = hasSourceProductPatch
      ? this.normalizeSourceProductId(input.sourceProductId)
      : undefined;

    const runUpdate = async (txClient: TransactionClient) => {
      if (normalizedSourceProductId) {
        await this.lockStoreListing(txClient, input.businessId, normalizedSourceProductId);
      }

      const existing = await txClient.service.findFirst({
        where: { id: input.serviceId, businessId: input.businessId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Service not found');

      if (normalizedSourceProductId) {
        await this.assertLiveBusinessProduct(txClient, input.businessId, normalizedSourceProductId);
        const conflict = await txClient.service.findFirst({
          where: {
            businessId: input.businessId,
            sourceProductId: normalizedSourceProductId,
            deletedAt: null,
            id: { not: input.serviceId },
          },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictException(DUPLICATE_LISTING_CONFLICT_MSG);
        }
      }

      const effectiveRequired =
        input.depositRequired !== undefined ? input.depositRequired : existing.depositRequired;
      this.validateDepositInputShape(input, effectiveRequired);
      const data: Record<string, any> = {};
      const fields: (keyof CatalogServicePatch)[] = [
        'name', 'duration', 'price', 'description', 'bufferMins', 'leadTimeMins',
      ];
      for (const k of fields) {
        if (input[k] !== undefined) data[k as string] = input[k];
      }
      if (hasSourceProductPatch) {
        data.sourceProductId = normalizedSourceProductId ?? null;
      }
      const depositTouched =
        input.depositRequired !== undefined ||
        input.depositType !== undefined ||
        input.depositValue !== undefined;
      if (depositTouched || (input.price !== undefined && existing.depositRequired)) {
        const effectivePrice = input.price !== undefined ? input.price : existing.price;
        const deposit = this.normalizeServiceDeposit(effectivePrice, {
          depositRequired: effectiveRequired,
          depositType:
            effectiveRequired
              ? (input.depositType !== undefined ? input.depositType : existing.depositType)
              : null,
          depositValue:
            effectiveRequired
              ? (input.depositValue !== undefined ? input.depositValue : existing.depositValue)
              : null,
        });
        if (depositTouched) {
          data.depositRequired = deposit.depositRequired;
          data.depositType = deposit.depositType;
          data.depositValue = deposit.depositValue;
        }
      }
      return txClient.service.update({
        where: { id: input.serviceId, businessId: input.businessId },
        data,
      });
    };

    const service = normalizedSourceProductId && !tx
      ? await this.prisma.client.$transaction((innerTx) => runUpdate(innerTx))
      : await runUpdate(tx ?? this.prisma.client);
    this.events.emit('catalog.service.updated', { service, businessId: input.businessId } as CatalogServiceUpdatedPayload);
    return service;
  }

  /** Restore this business's trashed service (the trash's restore, D-95); see restoreProduct. */
  async restoreService(businessId: string, serviceId: string, tx?: TransactionClient) {
    const runRestore = async (txClient: TransactionClient) => {
      const rows = await txClient.$queryRaw<
        Array<{ source_product_id: string | null; deleted_at: Date | null }>
      >`
        SELECT source_product_id, deleted_at
        FROM services
        WHERE id = ${serviceId} AND business_id = ${businessId}
        LIMIT 1
      `;
      if (rows.length === 0 || rows[0].deleted_at === null) {
        throw new NotFoundException('Service not found');
      }
      const sourceProductId = this.normalizeSourceProductId(rows[0].source_product_id);
      if (sourceProductId) {
        await this.lockStoreListing(txClient, businessId, sourceProductId);
        await this.assertLiveBusinessProduct(txClient, businessId, sourceProductId);
        const conflict = await txClient.service.findFirst({
          where: {
            businessId,
            sourceProductId,
            deletedAt: null,
            id: { not: serviceId },
          },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictException(DUPLICATE_LISTING_CONFLICT_MSG);
        }
      }
      return txClient.service.update({
        where: { id: serviceId, businessId },
        data: { deletedAt: null },
      });
    };

    const service = tx
      ? await runRestore(tx)
      : await this.prisma.client.$transaction((innerTx) => runRestore(innerTx));
    this.events.emit('catalog.service.updated', { service, businessId } as CatalogServiceUpdatedPayload);
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
   * Commerce store-readiness backfill. Enforces tenant isolation and the
   * single-live-listing invariant under the store listing advisory lock.
   */
  async linkServiceToProduct(businessId: string, serviceId: string, productId: string, tx?: TransactionClient) {
    const normalizedProductId = this.normalizeSourceProductId(productId);
    if (!normalizedProductId) {
      throw new BadRequestException(UNIFORM_PRODUCT_NOT_FOUND_MSG);
    }

    const runLink = async (txClient: TransactionClient) => {
      await this.lockStoreListing(txClient, businessId, normalizedProductId);
      await this.assertLiveBusinessProduct(txClient, businessId, normalizedProductId);

      const existing = await txClient.service.findFirst({
        where: { id: serviceId, businessId, deletedAt: null },
      });
      if (!existing) {
        throw new NotFoundException('Service not found');
      }

      const conflict = await txClient.service.findFirst({
        where: {
          businessId,
          sourceProductId: normalizedProductId,
          deletedAt: null,
          id: { not: serviceId },
        },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictException(DUPLICATE_LISTING_CONFLICT_MSG);
      }

      if (existing.sourceProductId === normalizedProductId) {
        return { service: existing, updated: false };
      }

      const updatedService = await txClient.service.update({
        where: { id: serviceId, businessId },
        data: { sourceProductId: normalizedProductId },
      });
      return { service: updatedService, updated: true };
    };

    const { service, updated } = tx
      ? await runLink(tx)
      : await this.prisma.client.$transaction((innerTx) => runLink(innerTx));
    if (updated) {
      this.events.emit('catalog.service.updated', { service, businessId } as CatalogServiceUpdatedPayload);
    }
    return service;
  }
}
