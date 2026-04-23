import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Prisma } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ProductNormalizationService } from './product-normalization.service';
import { encryptCredentials, decryptCredentials } from './credentials.util';

@Injectable()
export class SupplierService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProductNormalizationService) private readonly normalizationService: ProductNormalizationService,
  ) {}

  // ---- SupplierConnection CRUD ----

  async createSupplierConnection(businessId: string, data: {
    providerType: string;
    displayName: string;
    credentials?: Record<string, unknown>;
    accountMeta?: Record<string, unknown>;
    syncCapabilities?: string[];
  }) {
    const encryptedCredentials = data.credentials
      ? encryptCredentials(data.credentials)
      : null;

    return this.prisma.client.supplierConnection.create({
      data: {
        businessId,
        providerType: data.providerType,
        displayName: data.displayName,
        credentials: encryptedCredentials as unknown as Prisma.InputJsonValue,
        accountMeta: (data.accountMeta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        syncCapabilities: data.syncCapabilities ?? [],
        connectionHealth: 'unknown',
      },
    });
  }

  async getSupplierConnections(businessId: string, page = 1, pageSize = 50) {
    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = { businessId, isActive: true };

    const [data, total] = await Promise.all([
      this.prisma.client.supplierConnection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { supplierProducts: true } } },
      }),
      this.prisma.client.supplierConnection.count({ where }),
    ]);

    return { data: data.map(c => ({ ...c, credentials: undefined })), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getSupplierConnection(businessId: string, connectionId: string) {
    const connection = await this.prisma.client.supplierConnection.findFirst({
      where: { id: connectionId, businessId },
      include: { _count: { select: { supplierProducts: true } } },
    });
    if (!connection) throw new NotFoundException('Supplier connection not found');
    return { ...connection, credentials: undefined };
  }

  async updateSupplierConnection(businessId: string, connectionId: string, data: {
    displayName?: string;
    credentials?: Record<string, unknown>;
    accountMeta?: Record<string, unknown>;
    syncCapabilities?: string[];
    connectionHealth?: string;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.client.supplierConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!existing) throw new NotFoundException('Supplier connection not found');

    const updateData: Prisma.SupplierConnectionUpdateInput = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.credentials !== undefined) {
      updateData.credentials = encryptCredentials(data.credentials) as unknown as Prisma.InputJsonValue;
    }
    if (data.accountMeta !== undefined) {
      updateData.accountMeta = data.accountMeta as Prisma.InputJsonValue;
    }
    if (data.syncCapabilities !== undefined) updateData.syncCapabilities = data.syncCapabilities;
    if (data.connectionHealth !== undefined) updateData.connectionHealth = data.connectionHealth;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const updated = await this.prisma.client.supplierConnection.update({
      where: { id: connectionId },
      data: updateData,
    });
    return { ...updated, credentials: undefined };
  }

  async deleteSupplierConnection(businessId: string, connectionId: string) {
    const connection = await this.prisma.client.supplierConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!connection) throw new NotFoundException('Supplier connection not found');

    await this.prisma.client.supplierConnection.update({
      where: { id: connectionId },
      data: { isActive: false },
    });
    return { success: true };
  }

  // ---- SupplierProduct CRUD ----

  async createSupplierProduct(businessId: string, data: {
    supplierConnectionId: string;
    externalId: string;
    rawData: Record<string, unknown>;
    normalizedTitle?: string;
    normalizedDescription?: string;
    normalizedPrice?: number;
    normalizedImages?: string[];
    availability?: string;
    leadTimeDays?: number;
    currency?: string;
  }) {
    const connection = await this.prisma.client.supplierConnection.findFirst({
      where: { id: data.supplierConnectionId, businessId },
    });
    if (!connection) throw new NotFoundException('Supplier connection not found');

    return this.prisma.client.supplierProduct.create({
      data: {
        supplierConnectionId: data.supplierConnectionId,
        externalId: data.externalId,
        rawData: data.rawData as Prisma.InputJsonValue,
        normalizedTitle: data.normalizedTitle,
        normalizedDescription: data.normalizedDescription,
        normalizedPrice: data.normalizedPrice,
        normalizedImages: data.normalizedImages ?? [],
        availability: data.availability ?? 'unknown',
        leadTimeDays: data.leadTimeDays,
        currency: data.currency ?? 'TTD',
      },
    });
  }

  async getSupplierProducts(
    businessId: string,
    supplierConnectionId: string,
    page = 1,
    pageSize = 50,
    filters?: { availability?: string },
  ) {
    const connection = await this.prisma.client.supplierConnection.findFirst({
      where: { id: supplierConnectionId, businessId },
    });
    if (!connection) throw new NotFoundException('Supplier connection not found');

    page = Math.max(page, 1);
    pageSize = Math.min(Math.max(pageSize, 1), 100);

    const where: Prisma.SupplierProductWhereInput = { supplierConnectionId };
    if (filters?.availability) where.availability = filters.availability;

    const [data, total] = await Promise.all([
      this.prisma.client.supplierProduct.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { variants: true, sourceLinks: true } } },
      }),
      this.prisma.client.supplierProduct.count({ where }),
    ]);

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getSupplierProduct(businessId: string, supplierProductId: string) {
    const supplierProduct = await this.prisma.client.supplierProduct.findUnique({
      where: { id: supplierProductId },
      include: {
        supplierConnection: true,
        variants: true,
        sourceLinks: { include: { product: true } },
      },
    });
    if (!supplierProduct || supplierProduct.supplierConnection.businessId !== businessId) {
      throw new NotFoundException('Supplier product not found');
    }
    return supplierProduct;
  }

  async updateSupplierProduct(businessId: string, supplierProductId: string, data: {
    normalizedTitle?: string;
    normalizedDescription?: string;
    normalizedPrice?: number;
    normalizedImages?: string[];
    availability?: string;
    leadTimeDays?: number;
    currency?: string;
  }) {
    const existing = await this.prisma.client.supplierProduct.findUnique({
      where: { id: supplierProductId },
      include: { supplierConnection: { select: { businessId: true } } },
    });
    if (!existing || existing.supplierConnection.businessId !== businessId) {
      throw new NotFoundException('Supplier product not found');
    }

    const updateData: Prisma.SupplierProductUpdateInput = {};
    if (data.normalizedTitle !== undefined) updateData.normalizedTitle = data.normalizedTitle;
    if (data.normalizedDescription !== undefined) updateData.normalizedDescription = data.normalizedDescription;
    if (data.normalizedPrice !== undefined) updateData.normalizedPrice = data.normalizedPrice;
    if (data.normalizedImages !== undefined) updateData.normalizedImages = data.normalizedImages;
    if (data.availability !== undefined) updateData.availability = data.availability;
    if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays;
    if (data.currency !== undefined) updateData.currency = data.currency;

    return this.prisma.client.supplierProduct.update({
      where: { id: supplierProductId },
      data: updateData,
    });
  }

  async deleteSupplierProduct(businessId: string, supplierProductId: string) {
    const existing = await this.prisma.client.supplierProduct.findUnique({
      where: { id: supplierProductId },
      include: { supplierConnection: { select: { businessId: true } } },
    });
    if (!existing || existing.supplierConnection.businessId !== businessId) {
      throw new NotFoundException('Supplier product not found');
    }

    await this.prisma.client.supplierProduct.delete({
      where: { id: supplierProductId },
    });
    return { success: true };
  }

  // ---- ProductVariant CRUD ----

  async createProductVariant(businessId: string, data: {
    productId: string;
    attributes: Record<string, string>;
    sku?: string;
    priceOverride?: number;
    imageUrl?: string;
    trackStock?: boolean;
    stockQty?: number;
  }) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: data.productId, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.client.productVariant.create({
      data: {
        productId: data.productId,
        attributes: data.attributes as Prisma.InputJsonValue,
        sku: data.sku,
        priceOverride: data.priceOverride,
        imageUrl: data.imageUrl,
        trackStock: data.trackStock ?? false,
        stockQty: data.stockQty ?? 0,
      },
    });
  }

  async getProductVariants(businessId: string, productId: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.client.productVariant.findMany({
      where: { productId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateProductVariant(businessId: string, variantId: string, data: {
    attributes?: Record<string, string>;
    sku?: string;
    priceOverride?: number;
    imageUrl?: string;
    trackStock?: boolean;
    stockQty?: number;
    isActive?: boolean;
  }) {
    const variant = await this.prisma.client.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant) throw new NotFoundException('Variant not found');

    const product = await this.prisma.client.product.findFirst({
      where: { id: variant.productId, businessId },
    });
    if (!product) throw new NotFoundException('Variant not found');

    const updateData: Prisma.ProductVariantUpdateInput = {};
    if (data.attributes !== undefined) updateData.attributes = data.attributes as Prisma.InputJsonValue;
    if (data.sku !== undefined) updateData.sku = data.sku;
    if (data.priceOverride !== undefined) updateData.priceOverride = data.priceOverride;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.trackStock !== undefined) updateData.trackStock = data.trackStock;
    if (data.stockQty !== undefined) updateData.stockQty = data.stockQty;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return this.prisma.client.productVariant.update({
      where: { id: variantId },
      data: updateData,
    });
  }

  async deleteProductVariant(businessId: string, variantId: string) {
    const variant = await this.prisma.client.productVariant.findUnique({
      where: { id: variantId },
    });
    if (!variant) throw new NotFoundException('Variant not found');

    const product = await this.prisma.client.product.findFirst({
      where: { id: variant.productId, businessId },
    });
    if (!product) throw new NotFoundException('Variant not found');

    await this.prisma.client.productVariant.update({
      where: { id: variantId },
      data: { isActive: false },
    });
    return { success: true };
  }

  // ---- ProductSourceLink CRUD ----

  async createProductSourceLink(businessId: string, data: {
    productId: string;
    supplierProductId: string;
    sourceCost?: number;
    leadTimeDays?: number;
    moq?: number;
    shippingAssumptions?: Record<string, unknown>;
    availabilityState?: string;
    priority?: number;
  }) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: data.productId, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    const supplierProduct = await this.prisma.client.supplierProduct.findUnique({
      where: { id: data.supplierProductId },
      include: { supplierConnection: { select: { businessId: true } } },
    });
    if (!supplierProduct || supplierProduct.supplierConnection.businessId !== businessId) {
      throw new NotFoundException('Supplier product not found');
    }

    return this.prisma.client.productSourceLink.create({
      data: {
        productId: data.productId,
        supplierProductId: data.supplierProductId,
        sourceCost: data.sourceCost,
        leadTimeDays: data.leadTimeDays,
        moq: data.moq ?? 1,
        shippingAssumptions: (data.shippingAssumptions ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        availabilityState: data.availabilityState ?? 'available',
        priority: data.priority ?? 1,
      },
      include: { product: true, supplierProduct: true },
    });
  }

  async getProductSourceLinks(businessId: string, productId: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.client.productSourceLink.findMany({
      where: { productId, isActive: true },
      include: { supplierProduct: { include: { supplierConnection: true } } },
      orderBy: { priority: 'asc' },
    });
  }

  async updateProductSourceLink(businessId: string, linkId: string, data: {
    sourceCost?: number;
    leadTimeDays?: number;
    moq?: number;
    shippingAssumptions?: Record<string, unknown>;
    availabilityState?: string;
    priority?: number;
    isActive?: boolean;
  }) {
    const link = await this.prisma.client.productSourceLink.findUnique({
      where: { id: linkId },
    });
    if (!link) throw new NotFoundException('Source link not found');

    const product = await this.prisma.client.product.findFirst({
      where: { id: link.productId, businessId },
    });
    if (!product) throw new NotFoundException('Source link not found');

    const updateData: Prisma.ProductSourceLinkUpdateInput = {};
    if (data.sourceCost !== undefined) updateData.sourceCost = data.sourceCost;
    if (data.leadTimeDays !== undefined) updateData.leadTimeDays = data.leadTimeDays;
    if (data.moq !== undefined) updateData.moq = data.moq;
    if (data.shippingAssumptions !== undefined) updateData.shippingAssumptions = data.shippingAssumptions as Prisma.InputJsonValue;
    if (data.availabilityState !== undefined) updateData.availabilityState = data.availabilityState;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return this.prisma.client.productSourceLink.update({
      where: { id: linkId },
      data: updateData,
    });
  }

  async deleteProductSourceLink(businessId: string, linkId: string) {
    const link = await this.prisma.client.productSourceLink.findUnique({
      where: { id: linkId },
    });
    if (!link) throw new NotFoundException('Source link not found');

    const product = await this.prisma.client.product.findFirst({
      where: { id: link.productId, businessId },
    });
    if (!product) throw new NotFoundException('Source link not found');

    await this.prisma.client.productSourceLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });
    return { success: true };
  }

  // ---- ProductCostProfile CRUD ----

  async upsertProductCostProfile(businessId: string, data: {
    productId: string;
    sourceCost?: number;
    shippingEstimate?: number;
    dutiesEstimate?: number;
    packagingCost?: number;
    transactionCost?: number;
    currency?: string;
  }) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: data.productId, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    const sourceCost = data.sourceCost ?? 0;
    const shippingEstimate = data.shippingEstimate ?? 0;
    const dutiesEstimate = data.dutiesEstimate ?? 0;
    const packagingCost = data.packagingCost ?? 0;
    const transactionCost = data.transactionCost ?? 0;
    const landedCostEstimate = sourceCost + shippingEstimate + dutiesEstimate + packagingCost + transactionCost;

    const grossMargin = product.price > 0
      ? ((product.price - landedCostEstimate) / product.price) * 100
      : null;

    let marginBand: string | null = null;
    if (grossMargin !== null) {
      if (grossMargin < 15) marginBand = 'low';
      else if (grossMargin < 35) marginBand = 'medium';
      else if (grossMargin < 60) marginBand = 'high';
      else marginBand = 'premium';
    }

    const currency = data.currency ?? product.currency ?? 'TTD';

    const profile = await this.prisma.client.productCostProfile.upsert({
      where: { productId: data.productId },
      create: {
        productId: data.productId,
        sourceCost,
        shippingEstimate,
        dutiesEstimate,
        packagingCost,
        transactionCost,
        landedCostEstimate,
        grossMargin,
        marginBand,
        currency,
      },
      update: {
        sourceCost,
        shippingEstimate,
        dutiesEstimate,
        packagingCost,
        transactionCost,
        landedCostEstimate,
        grossMargin,
        marginBand,
        currency,
      },
    });

    if (grossMargin !== null && marginBand) {
      await this.prisma.client.marginSnapshot.create({
        data: {
          productId: data.productId,
          sourceCost,
          sellingPrice: product.price,
          landedCostEstimate,
          grossMargin,
          marginBand,
          currency,
          snapshotReason: 'cost_update',
        },
      });
    }

    return profile;
  }

  async getProductCostProfile(businessId: string, productId: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.client.productCostProfile.findUnique({
      where: { productId },
    });
  }

  async getMarginSnapshots(businessId: string, productId: string, limit = 20) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.client.marginSnapshot.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  // ---- Normalization helper ----

  async importAndNormalizeProduct(
    businessId: string,
    supplierConnectionId: string,
    rawProductData: Record<string, unknown>,
    normalizer: (raw: Record<string, unknown>) => import('./supplier-adapter.interface').NormalizedProduct,
  ) {
    const connection = await this.prisma.client.supplierConnection.findFirst({
      where: { id: supplierConnectionId, businessId },
    });
    if (!connection) throw new NotFoundException('Supplier connection not found');

    const normalized = normalizer(rawProductData);
    return this.normalizationService.normalizeAndUpsertProduct(supplierConnectionId, normalized);
  }

  async createProductFromSupplier(
    businessId: string,
    supplierProductId: string,
    overrides?: { name?: string; price?: number; category?: string; fulfillmentModel?: string },
  ) {
    return this.normalizationService.createProductFromSupplierProduct(businessId, supplierProductId, overrides);
  }

  // ---- Credential retrieval for adapter use ----

  async getDecryptedCredentials(businessId: string, connectionId: string): Promise<Record<string, unknown>> {
    const connection = await this.prisma.client.supplierConnection.findFirst({
      where: { id: connectionId, businessId },
    });
    if (!connection) throw new NotFoundException('Supplier connection not found');

    if (!connection.credentials) return {};
    return decryptCredentials(connection.credentials as string);
  }
}
