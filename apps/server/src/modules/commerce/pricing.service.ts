import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@keyflow/db';
import { PrismaService } from '../../core/prisma/prisma.service';
import { isSystemActor } from '../../core/auth/system-actor';
import { resolveCrmAccess, visibilityClause } from '../crm/crm-permissions.helper';
import { MAX_DOCUMENT_AMOUNT } from './dto/document-line-item.dto';
import { roundMoney } from './money';

/**
 * Canonical pricing tiers supported across products and contacts
 * (TOF-TIER-PRICING-SCHEMA / P156).
 */
export const PRICING_TIERS = ['RETAIL', 'WHOLESALE', 'VIP', 'DISTRIBUTOR'] as const;
export type PricingTier = (typeof PRICING_TIERS)[number];
export const DEFAULT_PRICING_TIER: PricingTier = 'RETAIL';

const ALLOWED_TIER_SET: ReadonlySet<string> = new Set(PRICING_TIERS);
const MAX_PRICE_DECIMALS = 2;

export interface TierPriceInput {
  tier: string;
  price: number;
}

export interface ProductTierPriceRecord {
  id: string;
  businessId: string;
  productId: string;
  tier: string;
  price: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactPricingTierResult {
  id: string;
  pricingTier: PricingTier | null;
}

export interface ResolvedProductPrice {
  productId: string;
  basePrice: number;
  effectivePrice: number;
  /** Alias of `effectivePrice` for callers reading `.price`. */
  price: number;
  currency: string;
  contactId: string | null;
  contactTier: string | null;
  /** The ProductTierPrice tier applied, or null when falling back to basePrice. */
  appliedTier: string | null;
  source: 'TIER' | 'BASE';
}

/** Exact decimal-place count of a finite number from its shortest decimal form. */
function decimalPlacesOf(value: number): number {
  const [coeff, exp] = String(value).toLowerCase().split('e');
  const dot = coeff.indexOf('.');
  const frac = dot < 0 ? 0 : coeff.length - dot - 1;
  const shift = exp ? Number(exp) : 0;
  return Math.max(0, frac - shift);
}

/**
 * Normalize and validate a pricing tier code (trimmed, uppercased) against the
 * canonical PRICING_TIERS vocabulary.
 */
export function normalizePricingTier(raw: unknown): PricingTier {
  if (typeof raw !== 'string') {
    throw new BadRequestException(`pricingTier must be one of: ${PRICING_TIERS.join(', ')}`);
  }
  const normalized = raw.trim().toUpperCase();
  if (!ALLOWED_TIER_SET.has(normalized)) {
    const preview = raw.length > 64 ? `${raw.slice(0, 64)}...` : raw;
    throw new BadRequestException(
      `Invalid pricing tier "${preview}". Allowed tiers: ${PRICING_TIERS.join(', ')}`,
    );
  }
  return normalized as PricingTier;
}

/**
 * Validate a tier unit price: finite non-negative number up to MAX_DOCUMENT_AMOUNT
 * and at most 2 decimal places. Normalizes -0 to 0.
 */
export function assertValidTierPrice(price: unknown): number {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new BadRequestException('price must be a finite number');
  }
  if (price < 0) {
    throw new BadRequestException('price must be non-negative');
  }
  if (price > MAX_DOCUMENT_AMOUNT) {
    throw new BadRequestException(`price must not be greater than ${MAX_DOCUMENT_AMOUNT}`);
  }
  if (decimalPlacesOf(price) > MAX_PRICE_DECIMALS) {
    throw new BadRequestException(`price must have at most ${MAX_PRICE_DECIMALS} decimal places`);
  }
  return price === 0 ? 0 : roundMoney(price);
}

function assertBusinessId(businessId: unknown): string {
  if (typeof businessId !== 'string' || businessId.trim().length === 0) {
    throw new BadRequestException('businessId is required');
  }
  return businessId;
}

function assertNonEmptyId(id: unknown, notFoundMessage: string): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new NotFoundException(notFoundMessage);
  }
  return id;
}

/**
 * Tenant-bound tiered pricing service (TOF-TIER-PRICING-SCHEMA / P156).
 *
 * Every Product, ProductTierPrice, and Contact query explicitly filters by
 * `businessId` (and `deletedAt: null` on soft-deleted models Product and
 * Contact) so cross-tenant or soft-deleted ids always fail with 404
 * NotFoundException without disclosing existence or mutating foreign rows.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async memberContactClause(
    businessId: string,
    actorUserId?: string,
  ): Promise<Prisma.ContactWhereInput | undefined> {
    if (!actorUserId || isSystemActor(actorUserId)) return undefined;
    const access = await resolveCrmAccess(this.prisma, businessId, actorUserId);
    return (visibilityClause(access, actorUserId) as Prisma.ContactWhereInput | null) ?? undefined;
  }

  /**
   * List all ProductTierPrice rows for a live product owned by `businessId`.
   */
  async listProductTierPrices(
    businessId: string,
    productId: string,
  ): Promise<ProductTierPriceRecord[]> {
    const bizId = assertBusinessId(businessId);
    const prodId = assertNonEmptyId(productId, 'Product not found');

    const product = await this.prisma.client.product.findFirst({
      where: { id: prodId, businessId: bizId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.client.productTierPrice.findMany({
      where: { businessId: bizId, productId: prodId },
      orderBy: { tier: 'asc' },
    });
  }

  /**
   * Atomically replace the complete set of tier prices for a live product owned
   * by `businessId`. Duplicate tiers (after trim/uppercase normalization) or
   * invalid prices are rejected before opening a transaction.
   */
  async setProductTierPrices(
    businessId: string,
    productId: string,
    entries: ReadonlyArray<TierPriceInput>,
  ): Promise<ProductTierPriceRecord[]> {
    const bizId = assertBusinessId(businessId);
    const prodId = assertNonEmptyId(productId, 'Product not found');
    if (!Array.isArray(entries)) {
      throw new BadRequestException('tierPrices must be an array');
    }

    const normalized: Array<{ tier: PricingTier; price: number }> = [];
    const seen = new Set<PricingTier>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        throw new BadRequestException('Each tier price entry must be an object');
      }
      const tier = normalizePricingTier(entry.tier);
      if (seen.has(tier)) {
        throw new BadRequestException(`Duplicate pricing tier: ${tier}`);
      }
      seen.add(tier);
      const price = assertValidTierPrice(entry.price);
      normalized.push({ tier, price });
    }

    return this.prisma.client.$transaction(async (tx) => {
      if (typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pricing_service'), hashtext(${`${bizId}:${prodId}`}))`;
      }

      const product = await tx.product.findFirst({
        where: { id: prodId, businessId: bizId, deletedAt: null },
        select: { id: true },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      if (normalized.length === 0) {
        await tx.productTierPrice.deleteMany({
          where: { businessId: bizId, productId: prodId },
        });
        return [];
      }

      const tiers = normalized.map((item) => item.tier);
      await tx.productTierPrice.deleteMany({
        where: { businessId: bizId, productId: prodId, tier: { notIn: tiers } },
      });

      for (const item of normalized) {
        const existing = await tx.productTierPrice.findFirst({
          where: { businessId: bizId, productId: prodId, tier: item.tier },
          select: { id: true },
        });
        if (existing) {
          await tx.productTierPrice.updateMany({
            where: { id: existing.id, businessId: bizId, productId: prodId },
            data: { price: item.price },
          });
        } else {
          await tx.productTierPrice.create({
            data: {
              businessId: bizId,
              productId: prodId,
              tier: item.tier,
              price: item.price,
            },
          });
        }
      }

      return tx.productTierPrice.findMany({
        where: { businessId: bizId, productId: prodId },
        orderBy: { tier: 'asc' },
      });
    });
  }

  /**
   * Create or update a single tier price for a live product owned by `businessId`.
   */
  async upsertProductTierPrice(
    businessId: string,
    productId: string,
    tier: string,
    price: number,
  ): Promise<ProductTierPriceRecord> {
    const bizId = assertBusinessId(businessId);
    const prodId = assertNonEmptyId(productId, 'Product not found');
    const normalizedTier = normalizePricingTier(tier);
    const validPrice = assertValidTierPrice(price);

    return this.prisma.client.$transaction(async (tx) => {
      if (typeof (tx as { $executeRaw?: unknown }).$executeRaw === 'function') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pricing_service'), hashtext(${`${bizId}:${prodId}`}))`;
      }

      const product = await tx.product.findFirst({
        where: { id: prodId, businessId: bizId, deletedAt: null },
        select: { id: true },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      const existing = await tx.productTierPrice.findFirst({
        where: { businessId: bizId, productId: prodId, tier: normalizedTier },
        select: { id: true },
      });

      if (existing) {
        await tx.productTierPrice.updateMany({
          where: { id: existing.id, businessId: bizId, productId: prodId },
          data: { price: validPrice },
        });
        const updated = await tx.productTierPrice.findFirst({
          where: { id: existing.id, businessId: bizId, productId: prodId },
        });
        if (!updated) {
          throw new NotFoundException('Product tier price not found');
        }
        return updated;
      }

      return tx.productTierPrice.create({
        data: {
          businessId: bizId,
          productId: prodId,
          tier: normalizedTier,
          price: validPrice,
        },
      });
    });
  }

  /**
   * Delete a single tier price for a live product owned by `businessId`.
   */
  async deleteProductTierPrice(
    businessId: string,
    productId: string,
    tier: string,
  ): Promise<{ deleted: boolean }> {
    const bizId = assertBusinessId(businessId);
    const prodId = assertNonEmptyId(productId, 'Product not found');
    const normalizedTier = normalizePricingTier(tier);

    const runDelete = async (client: typeof this.prisma.client) => {
      if (typeof (client as { $executeRaw?: unknown }).$executeRaw === 'function') {
        await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pricing_service'), hashtext(${`${bizId}:${prodId}`}))`;
      }
      const product = await client.product.findFirst({
        where: { id: prodId, businessId: bizId, deletedAt: null },
        select: { id: true },
      });
      if (!product) {
        throw new NotFoundException('Product not found');
      }

      const result = await client.productTierPrice.deleteMany({
        where: { businessId: bizId, productId: prodId, tier: normalizedTier },
      });
      return { deleted: result.count > 0 };
    };

    if (typeof this.prisma.client.$transaction === 'function') {
      return this.prisma.client.$transaction(async (tx) =>
        runDelete(tx as unknown as typeof this.prisma.client),
      );
    }
    return runDelete(this.prisma.client);
  }

  /**
   * Set or clear (`null`) a live contact's `pricingTier` within `businessId`.
   * When `actorUserId` is provided, enforces D-133 contact visibility so a
   * hidden contact returns 404 NotFoundException without mutating anything.
   */
  async setContactPricingTier(
    businessId: string,
    contactId: string,
    tier: string | null,
    actorUserId?: string,
  ): Promise<ContactPricingTierResult> {
    const bizId = assertBusinessId(businessId);
    const ctId = assertNonEmptyId(contactId, 'Contact not found');
    const normalizedTier = tier === null ? null : normalizePricingTier(tier);

    const memberClause = await this.memberContactClause(bizId, actorUserId);
    const where: Prisma.ContactWhereInput = {
      id: ctId,
      businessId: bizId,
      deletedAt: null,
    };
    if (memberClause) where.AND = [memberClause];

    const updated = await this.prisma.client.contact.updateMany({
      where,
      data: { pricingTier: normalizedTier },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Contact not found');
    }
    return { id: ctId, pricingTier: normalizedTier };
  }

  /**
   * Resolve the effective unit price for a live product owned by `businessId`,
   * optionally applying the matching ProductTierPrice for a live, visible contact.
   */
  async resolveProductPrice(
    businessId: string,
    productId: string,
    contactId?: string | null,
    actorUserId?: string,
  ): Promise<ResolvedProductPrice> {
    const bizId = assertBusinessId(businessId);
    const prodId = assertNonEmptyId(productId, 'Product not found');

    const product = await this.prisma.client.product.findFirst({
      where: { id: prodId, businessId: bizId, deletedAt: null },
      select: { id: true, price: true, currency: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const basePrice = roundMoney(product.price, product.currency);

    if (
      contactId === undefined ||
      contactId === null ||
      (typeof contactId === 'string' && contactId.trim().length === 0)
    ) {
      return {
        productId: product.id,
        basePrice,
        effectivePrice: basePrice,
        price: basePrice,
        currency: product.currency,
        contactId: null,
        contactTier: null,
        appliedTier: null,
        source: 'BASE',
      };
    }

    if (typeof contactId !== 'string') {
      throw new BadRequestException('contactId must be a string');
    }

    const memberClause = await this.memberContactClause(bizId, actorUserId);
    const contactWhere: Prisma.ContactWhereInput = {
      id: contactId,
      businessId: bizId,
      deletedAt: null,
    };
    if (memberClause) contactWhere.AND = [memberClause];

    const contact = await this.prisma.client.contact.findFirst({
      where: contactWhere,
      select: { id: true, pricingTier: true },
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const rawTier = typeof contact.pricingTier === 'string' ? contact.pricingTier.trim().toUpperCase() : '';
    const contactTier = rawTier.length > 0 ? rawTier : null;

    if (contactTier) {
      const tierRow = await this.prisma.client.productTierPrice.findFirst({
        where: { businessId: bizId, productId: product.id, tier: contactTier },
        select: { tier: true, price: true },
      });
      if (tierRow) {
        const effectivePrice = roundMoney(tierRow.price, product.currency);
        return {
          productId: product.id,
          basePrice,
          effectivePrice,
          price: effectivePrice,
          currency: product.currency,
          contactId: contact.id,
          contactTier,
          appliedTier: tierRow.tier,
          source: 'TIER',
        };
      }
    }

    return {
      productId: product.id,
      basePrice,
      effectivePrice: basePrice,
      price: basePrice,
      currency: product.currency,
      contactId: contact.id,
      contactTier,
      appliedTier: null,
      source: 'BASE',
    };
  }
}
