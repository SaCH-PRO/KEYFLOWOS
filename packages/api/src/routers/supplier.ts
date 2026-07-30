import { protectedProcedure, router } from '../trpc';
import type { AnyRouter } from '@trpc/server';
import { z } from 'zod';
import { assertBusinessAccess } from '../lib/access';
import type { Prisma } from '@prisma/client';

export const supplierRouter: AnyRouter = router({
  // ---- SupplierConnection ----

  listSupplierConnections: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(50),
    }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const skip = (input.page - 1) * input.pageSize;
      const where = { businessId: input.businessId, isActive: true };
      const [data, total] = await Promise.all([
        ctx.db.supplierConnection.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: input.pageSize,
          select: {
            id: true, businessId: true, providerType: true, displayName: true,
            accountMeta: true, connectionHealth: true, syncCapabilities: true,
            lastSyncAt: true, isActive: true, createdAt: true, updatedAt: true,
          },
        }),
        ctx.db.supplierConnection.count({ where }),
      ]);
      return { data, total, page: input.page, pageSize: input.pageSize, totalPages: Math.ceil(total / input.pageSize) };
    }),

  getSupplierConnection: protectedProcedure
    .input(z.object({ businessId: z.string(), connectionId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      return ctx.db.supplierConnection.findFirst({
        where: { id: input.connectionId, businessId: input.businessId },
        select: {
          id: true, businessId: true, providerType: true, displayName: true,
          accountMeta: true, connectionHealth: true, syncCapabilities: true,
          lastSyncAt: true, isActive: true, createdAt: true, updatedAt: true,
        },
      });
    }),

  createSupplierConnection: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      providerType: z.string().min(1),
      displayName: z.string().min(1),
      credentials: z.record(z.unknown()).optional(),
      accountMeta: z.record(z.unknown()).optional(),
      syncCapabilities: z.array(z.string()).optional().default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const { encryptCredentials } = await import('../lib/credentials');
      const encryptedCredentials = input.credentials ? encryptCredentials(input.credentials) : null;
      return ctx.db.supplierConnection.create({
        data: {
          businessId: input.businessId,
          providerType: input.providerType,
          displayName: input.displayName,
          credentials: encryptedCredentials as Prisma.InputJsonValue,
          accountMeta: input.accountMeta as Prisma.InputJsonValue,
          syncCapabilities: input.syncCapabilities ?? [],
          connectionHealth: 'unknown',
        },
        select: {
          id: true, businessId: true, providerType: true, displayName: true,
          accountMeta: true, connectionHealth: true, syncCapabilities: true,
          lastSyncAt: true, isActive: true, createdAt: true, updatedAt: true,
        },
      });
    }),

  updateSupplierConnection: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      connectionId: z.string(),
      displayName: z.string().optional(),
      credentials: z.record(z.unknown()).optional(),
      accountMeta: z.record(z.unknown()).optional(),
      syncCapabilities: z.array(z.string()).optional(),
      connectionHealth: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const existing = await ctx.db.supplierConnection.findFirst({
        where: { id: input.connectionId, businessId: input.businessId },
      });
      if (!existing) throw new Error('Supplier connection not found');

      const updateData: Record<string, unknown> = {};
      if (input.displayName !== undefined) updateData.displayName = input.displayName;
      if (input.credentials !== undefined) {
        const { encryptCredentials } = await import('../lib/credentials');
        updateData.credentials = encryptCredentials(input.credentials);
      }
      if (input.accountMeta !== undefined) updateData.accountMeta = input.accountMeta;
      if (input.syncCapabilities !== undefined) updateData.syncCapabilities = input.syncCapabilities;
      if (input.connectionHealth !== undefined) updateData.connectionHealth = input.connectionHealth;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      return ctx.db.supplierConnection.update({
        where: { id: input.connectionId },
        data: updateData,
        select: {
          id: true, businessId: true, providerType: true, displayName: true,
          accountMeta: true, connectionHealth: true, syncCapabilities: true,
          lastSyncAt: true, isActive: true, createdAt: true, updatedAt: true,
        },
      });
    }),

  // ---- SupplierProduct ----

  listSupplierProducts: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      supplierConnectionId: z.string(),
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(50),
      availability: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const connection = await ctx.db.supplierConnection.findFirst({
        where: { id: input.supplierConnectionId, businessId: input.businessId },
      });
      if (!connection) return { data: [], total: 0, page: input.page, pageSize: input.pageSize, totalPages: 0 };

      const where: { supplierConnectionId: string; availability?: string } = { supplierConnectionId: input.supplierConnectionId };
      if (input.availability) where.availability = input.availability;

      const skip = (input.page - 1) * input.pageSize;
      const [data, total] = await Promise.all([
        ctx.db.supplierProduct.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: input.pageSize,
        }),
        ctx.db.supplierProduct.count({ where }),
      ]);
      return { data, total, page: input.page, pageSize: input.pageSize, totalPages: Math.ceil(total / input.pageSize) };
    }),

  getSupplierProduct: protectedProcedure
    .input(z.object({ businessId: z.string(), supplierProductId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const product = await ctx.db.supplierProduct.findUnique({
        where: { id: input.supplierProductId },
        include: { supplierConnection: { select: { businessId: true } }, variants: true },
      });
      if (!product || product.supplierConnection.businessId !== input.businessId) {
        return null;
      }
      return product;
    }),

  createSupplierProduct: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      supplierConnectionId: z.string(),
      externalId: z.string(),
      rawData: z.record(z.unknown()),
      normalizedTitle: z.string().optional(),
      normalizedDescription: z.string().optional(),
      normalizedPrice: z.number().optional(),
      normalizedImages: z.array(z.string()).optional().default([]),
      availability: z.string().optional().default('unknown'),
      leadTimeDays: z.number().int().optional(),
      currency: z.string().optional().default('TTD'),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const connection = await ctx.db.supplierConnection.findFirst({
        where: { id: input.supplierConnectionId, businessId: input.businessId },
      });
      if (!connection) throw new Error('Supplier connection not found');

      return ctx.db.supplierProduct.create({
        data: {
          supplierConnectionId: input.supplierConnectionId,
          externalId: input.externalId,
          rawData: input.rawData as Prisma.InputJsonValue,
          normalizedTitle: input.normalizedTitle,
          normalizedDescription: input.normalizedDescription,
          normalizedPrice: input.normalizedPrice,
          normalizedImages: input.normalizedImages ?? [],
          availability: input.availability ?? 'unknown',
          leadTimeDays: input.leadTimeDays,
          currency: input.currency ?? 'TTD',
        },
      });
    }),

  updateSupplierProduct: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      supplierProductId: z.string(),
      normalizedTitle: z.string().optional(),
      normalizedDescription: z.string().optional(),
      normalizedPrice: z.number().optional(),
      normalizedImages: z.array(z.string()).optional(),
      availability: z.string().optional(),
      leadTimeDays: z.number().int().optional(),
      currency: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const existing = await ctx.db.supplierProduct.findUnique({
        where: { id: input.supplierProductId },
        include: { supplierConnection: { select: { businessId: true } } },
      });
      if (!existing || existing.supplierConnection.businessId !== input.businessId) {
        throw new Error('Supplier product not found');
      }

      const updateData: Record<string, unknown> = {};
      if (input.normalizedTitle !== undefined) updateData.normalizedTitle = input.normalizedTitle;
      if (input.normalizedDescription !== undefined) updateData.normalizedDescription = input.normalizedDescription;
      if (input.normalizedPrice !== undefined) updateData.normalizedPrice = input.normalizedPrice;
      if (input.normalizedImages !== undefined) updateData.normalizedImages = input.normalizedImages;
      if (input.availability !== undefined) updateData.availability = input.availability;
      if (input.leadTimeDays !== undefined) updateData.leadTimeDays = input.leadTimeDays;
      if (input.currency !== undefined) updateData.currency = input.currency;

      return ctx.db.supplierProduct.update({
        where: { id: input.supplierProductId },
        data: updateData,
      });
    }),

  deleteSupplierProduct: protectedProcedure
    .input(z.object({ businessId: z.string(), supplierProductId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const existing = await ctx.db.supplierProduct.findUnique({
        where: { id: input.supplierProductId },
        include: { supplierConnection: { select: { businessId: true } } },
      });
      if (!existing || existing.supplierConnection.businessId !== input.businessId) {
        throw new Error('Supplier product not found');
      }
      await ctx.db.supplierProduct.delete({ where: { id: input.supplierProductId } });
      return { success: true };
    }),

  // ---- ProductVariant ----

  listProductVariants: protectedProcedure
    .input(z.object({ businessId: z.string(), productId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const product = await ctx.db.product.findFirst({
        where: { id: input.productId, businessId: input.businessId, deletedAt: null },
      });
      if (!product) return [];
      return ctx.db.productVariant.findMany({
        where: { productId: input.productId, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
    }),

  createProductVariant: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      productId: z.string(),
      attributes: z.record(z.string()),
      sku: z.string().optional(),
      priceOverride: z.number().optional(),
      imageUrl: z.string().optional(),
      trackStock: z.boolean().optional().default(false),
      stockQty: z.number().int().optional().default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const product = await ctx.db.product.findFirst({
        where: { id: input.productId, businessId: input.businessId, deletedAt: null },
      });
      if (!product) throw new Error('Product not found');

      return ctx.db.productVariant.create({
        data: {
          productId: input.productId,
          attributes: input.attributes as Prisma.InputJsonValue,
          sku: input.sku,
          priceOverride: input.priceOverride,
          imageUrl: input.imageUrl,
          trackStock: input.trackStock ?? false,
          stockQty: input.stockQty ?? 0,
        },
      });
    }),

  updateProductVariant: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      variantId: z.string(),
      attributes: z.record(z.string()).optional(),
      sku: z.string().optional(),
      priceOverride: z.number().optional(),
      imageUrl: z.string().optional(),
      trackStock: z.boolean().optional(),
      stockQty: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const variant = await ctx.db.productVariant.findUnique({ where: { id: input.variantId } });
      if (!variant) throw new Error('Variant not found');
      const product = await ctx.db.product.findFirst({
        where: { id: variant.productId, businessId: input.businessId },
      });
      if (!product) throw new Error('Variant not found');

      const updateData: Record<string, unknown> = {};
      if (input.attributes !== undefined) updateData.attributes = input.attributes;
      if (input.sku !== undefined) updateData.sku = input.sku;
      if (input.priceOverride !== undefined) updateData.priceOverride = input.priceOverride;
      if (input.imageUrl !== undefined) updateData.imageUrl = input.imageUrl;
      if (input.trackStock !== undefined) updateData.trackStock = input.trackStock;
      if (input.stockQty !== undefined) updateData.stockQty = input.stockQty;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      return ctx.db.productVariant.update({ where: { id: input.variantId }, data: updateData });
    }),

  deleteProductVariant: protectedProcedure
    .input(z.object({ businessId: z.string(), variantId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const variant = await ctx.db.productVariant.findUnique({ where: { id: input.variantId } });
      if (!variant) throw new Error('Variant not found');
      const product = await ctx.db.product.findFirst({
        where: { id: variant.productId, businessId: input.businessId },
      });
      if (!product) throw new Error('Variant not found');
      await ctx.db.productVariant.update({ where: { id: input.variantId }, data: { isActive: false } });
      return { success: true };
    }),

  // ---- ProductSourceLink ----

  listProductSourceLinks: protectedProcedure
    .input(z.object({ businessId: z.string(), productId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const product = await ctx.db.product.findFirst({
        where: { id: input.productId, businessId: input.businessId, deletedAt: null },
      });
      if (!product) return [];
      return ctx.db.productSourceLink.findMany({
        where: { productId: input.productId, isActive: true },
        include: { supplierProduct: { include: { supplierConnection: true } } },
        orderBy: { priority: 'asc' },
      });
    }),

  createProductSourceLink: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      productId: z.string(),
      supplierProductId: z.string(),
      sourceCost: z.number().optional(),
      leadTimeDays: z.number().int().optional(),
      moq: z.number().int().optional().default(1),
      shippingAssumptions: z.record(z.unknown()).optional(),
      availabilityState: z.string().optional().default('available'),
      priority: z.number().int().optional().default(1),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const product = await ctx.db.product.findFirst({
        where: { id: input.productId, businessId: input.businessId, deletedAt: null },
      });
      if (!product) throw new Error('Product not found');

      const supplierProduct = await ctx.db.supplierProduct.findUnique({
        where: { id: input.supplierProductId },
        include: { supplierConnection: { select: { businessId: true } } },
      });
      if (!supplierProduct || supplierProduct.supplierConnection.businessId !== input.businessId) {
        throw new Error('Supplier product not found');
      }

      return ctx.db.productSourceLink.create({
        data: {
          productId: input.productId,
          supplierProductId: input.supplierProductId,
          sourceCost: input.sourceCost,
          leadTimeDays: input.leadTimeDays,
          moq: input.moq ?? 1,
          shippingAssumptions: input.shippingAssumptions as Prisma.InputJsonValue,
          availabilityState: input.availabilityState ?? 'available',
          priority: input.priority ?? 1,
        },
        include: { supplierProduct: true },
      });
    }),

  updateProductSourceLink: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      linkId: z.string(),
      sourceCost: z.number().optional(),
      leadTimeDays: z.number().int().optional(),
      moq: z.number().int().optional(),
      availabilityState: z.string().optional(),
      priority: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const link = await ctx.db.productSourceLink.findUnique({ where: { id: input.linkId } });
      if (!link) throw new Error('Source link not found');
      const product = await ctx.db.product.findFirst({
        where: { id: link.productId, businessId: input.businessId },
      });
      if (!product) throw new Error('Source link not found');

      const updateData: Record<string, unknown> = {};
      if (input.sourceCost !== undefined) updateData.sourceCost = input.sourceCost;
      if (input.leadTimeDays !== undefined) updateData.leadTimeDays = input.leadTimeDays;
      if (input.moq !== undefined) updateData.moq = input.moq;
      if (input.availabilityState !== undefined) updateData.availabilityState = input.availabilityState;
      if (input.priority !== undefined) updateData.priority = input.priority;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      return ctx.db.productSourceLink.update({ where: { id: input.linkId }, data: updateData });
    }),

  deleteProductSourceLink: protectedProcedure
    .input(z.object({ businessId: z.string(), linkId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const link = await ctx.db.productSourceLink.findUnique({ where: { id: input.linkId } });
      if (!link) throw new Error('Source link not found');
      const product = await ctx.db.product.findFirst({
        where: { id: link.productId, businessId: input.businessId },
      });
      if (!product) throw new Error('Source link not found');
      await ctx.db.productSourceLink.update({ where: { id: input.linkId }, data: { isActive: false } });
      return { success: true };
    }),

  // ---- ProductCostProfile ----

  getProductCostProfile: protectedProcedure
    .input(z.object({ businessId: z.string(), productId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const product = await ctx.db.product.findFirst({
        where: { id: input.productId, businessId: input.businessId },
      });
      if (!product) return null;
      return ctx.db.productCostProfile.findUnique({
        where: { productId: input.productId },
      });
    }),

  upsertProductCostProfile: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      productId: z.string(),
      sourceCost: z.number().optional().default(0),
      shippingEstimate: z.number().optional().default(0),
      dutiesEstimate: z.number().optional().default(0),
      packagingCost: z.number().optional().default(0),
      transactionCost: z.number().optional().default(0),
      currency: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const product = await ctx.db.product.findFirst({
        where: { id: input.productId, businessId: input.businessId },
      });
      if (!product) throw new Error('Product not found');

      const sourceCost = input.sourceCost ?? 0;
      const shippingEstimate = input.shippingEstimate ?? 0;
      const dutiesEstimate = input.dutiesEstimate ?? 0;
      const packagingCost = input.packagingCost ?? 0;
      const transactionCost = input.transactionCost ?? 0;
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
      const currency = input.currency ?? product.currency ?? 'TTD';

      return ctx.db.productCostProfile.upsert({
        where: { productId: input.productId },
        create: {
          productId: input.productId, sourceCost, shippingEstimate, dutiesEstimate, packagingCost,
          transactionCost, landedCostEstimate, grossMargin, marginBand, currency,
        },
        update: {
          sourceCost, shippingEstimate, dutiesEstimate, packagingCost,
          transactionCost, landedCostEstimate, grossMargin, marginBand, currency,
        },
      });
    }),

  listMarginSnapshots: protectedProcedure
    .input(z.object({
      businessId: z.string(),
      productId: z.string(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    }))
    .query(async ({ input, ctx }) => {
      await assertBusinessAccess(ctx, input.businessId);
      const product = await ctx.db.product.findFirst({
        where: { id: input.productId, businessId: input.businessId },
      });
      if (!product) return [];
      return ctx.db.marginSnapshot.findMany({
        where: { productId: input.productId },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
    }),
});
