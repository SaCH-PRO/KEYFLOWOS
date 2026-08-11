import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/** The default tier every contact has unless assigned otherwise. RETAIL price
 *  lives on `Product.price`; other tiers store overrides in ProductTierPrice. */
export const DEFAULT_PRICING_TIER = 'RETAIL';

export interface PricedLineInput {
  description: string;
  quantity: number;
  /** Explicit unit price. When omitted, it is resolved from the product + tier. */
  unitPrice?: number;
  productId?: string;
  total?: number;
}

export interface PricedLine {
  description: string;
  quantity: number;
  unitPrice: number;
  productId?: string;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * PricingService — resolves the correct unit price for a line item given the
 * customer's pricing tier (e.g. wholesale/distributor vs retail).
 *
 * The business rule this implements: a distributor is quoted/invoiced at the
 * wholesale price, a retail customer at the retail price, without a human
 * re-keying the discount on every document. An explicit unit price on a line is
 * always honoured as a manual override.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The pricing tier for a contact (defaults to RETAIL; RETAIL for anonymous). */
  async getContactTier(businessId: string, contactId?: string | null): Promise<string> {
    if (!contactId) return DEFAULT_PRICING_TIER;
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, businessId },
      select: { pricingTier: true },
    });
    return contact?.pricingTier || DEFAULT_PRICING_TIER;
  }

  /**
   * Resolve the unit price for a product at a given tier.
   * RETAIL — or any tier with no override — falls back to `Product.price`.
   */
  async resolveUnitPrice(
    businessId: string,
    productId: string,
    tier: string = DEFAULT_PRICING_TIER,
  ): Promise<number> {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId, businessId },
      select: { price: true },
    });
    if (!product) {
      throw new Error(`Product ${productId} not found for business ${businessId}`);
    }
    if (!tier || tier === DEFAULT_PRICING_TIER) return product.price;

    const override = await this.prisma.client.productTierPrice.findUnique({
      where: { productId_tier: { productId, tier } },
      select: { price: true },
    });
    return override?.price ?? product.price;
  }

  /**
   * Fill in unit price / total for any line that omits an explicit price, using
   * the contact's tier. Lines that already carry a unitPrice are passed through
   * unchanged (manual override wins). A line with neither a price nor a product
   * to price from is a caller error.
   */
  async resolveLineItems(
    businessId: string,
    contactId: string | null | undefined,
    items: PricedLineInput[],
  ): Promise<PricedLine[]> {
    const tier = await this.getContactTier(businessId, contactId);
    const resolved: PricedLine[] = [];
    for (const item of items) {
      let unitPrice = item.unitPrice;
      if (unitPrice == null) {
        if (!item.productId) {
          throw new Error(
            `Line "${item.description}" has neither a unitPrice nor a productId to price from`,
          );
        }
        unitPrice = await this.resolveUnitPrice(businessId, item.productId, tier);
      }
      resolved.push({
        description: item.description,
        quantity: item.quantity,
        unitPrice,
        productId: item.productId,
        total: item.total ?? round2(item.quantity * unitPrice),
      });
    }
    return resolved;
  }

  /** Set (or update) a product's price for a non-retail tier. */
  async setTierPrice(businessId: string, productId: string, tier: string, price: number) {
    if (tier === DEFAULT_PRICING_TIER) {
      throw new Error('RETAIL price lives on the product — set Product.price, not a tier override');
    }
    return this.prisma.client.productTierPrice.upsert({
      where: { productId_tier: { productId, tier } },
      create: { businessId, productId, tier, price },
      update: { price },
    });
  }

  /** List a product's tier price overrides. */
  async listTierPrices(businessId: string, productId: string) {
    return this.prisma.client.productTierPrice.findMany({
      where: { businessId, productId },
      orderBy: { tier: 'asc' },
    });
  }

  /** Assign a contact to a pricing tier (e.g. mark a distributor WHOLESALE). */
  async setContactTier(businessId: string, contactId: string, tier: string) {
    return this.prisma.client.contact.update({
      where: { id: contactId },
      data: { pricingTier: tier },
    });
  }
}
