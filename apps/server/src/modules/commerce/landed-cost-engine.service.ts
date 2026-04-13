import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface LandedCostBreakdown {
  productId: string;
  productName: string;
  sourceCost: number;
  shippingEstimate: number;
  dutiesEstimate: number;
  packagingCost: number;
  transactionCost: number;
  landedCostEstimate: number;
  currency: string;
  hasSourceLinks: boolean;
  sourceCount: number;
  breakdown: {
    sourceCostPct: number;
    shippingPct: number;
    dutiesPct: number;
    packagingPct: number;
    transactionPct: number;
  };
}

@Injectable()
export class LandedCostEngine {
  private readonly logger = new Logger(LandedCostEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async calculateForProduct(productId: string, businessId: string): Promise<LandedCostBreakdown | null> {
    const product = await this.db.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      include: {
        costProfile: true,
        sourceLinks: {
          where: { isActive: true },
          include: {
            supplierProduct: {
              select: { leadTimeDays: true, normalizedPrice: true, availability: true },
            },
          },
          orderBy: { priority: 'asc' },
        },
      },
    });

    if (!product) return null;

    const sourceLinks = product.sourceLinks;
    const profile = product.costProfile;

    let sourceCost = 0;
    let shippingEstimate = 0;
    let dutiesEstimate = 0;
    let packagingCost = 0;
    let transactionCost = 0;

    if (profile) {
      sourceCost = profile.sourceCost;
      shippingEstimate = profile.shippingEstimate;
      dutiesEstimate = profile.dutiesEstimate;
      packagingCost = profile.packagingCost;
      transactionCost = profile.transactionCost;
    } else if (sourceLinks.length > 0) {
      const primaryLink = sourceLinks[0];
      sourceCost = primaryLink.sourceCost ?? primaryLink.supplierProduct?.normalizedPrice ?? 0;
      shippingEstimate = this.estimateShipping(sourceCost);
      dutiesEstimate = this.estimateDuties(sourceCost);
      packagingCost = this.estimatePackaging(sourceCost);
      transactionCost = this.estimateTransaction(sourceCost + shippingEstimate);
    } else {
      return {
        productId: product.id,
        productName: product.name,
        sourceCost: 0,
        shippingEstimate: 0,
        dutiesEstimate: 0,
        packagingCost: 0,
        transactionCost: 0,
        landedCostEstimate: 0,
        currency: product.currency,
        hasSourceLinks: false,
        sourceCount: 0,
        breakdown: { sourceCostPct: 0, shippingPct: 0, dutiesPct: 0, packagingPct: 0, transactionPct: 0 },
      };
    }

    const landedCostEstimate = sourceCost + shippingEstimate + dutiesEstimate + packagingCost + transactionCost;

    const breakdown = landedCostEstimate > 0 ? {
      sourceCostPct: Math.round((sourceCost / landedCostEstimate) * 100),
      shippingPct: Math.round((shippingEstimate / landedCostEstimate) * 100),
      dutiesPct: Math.round((dutiesEstimate / landedCostEstimate) * 100),
      packagingPct: Math.round((packagingCost / landedCostEstimate) * 100),
      transactionPct: Math.round((transactionCost / landedCostEstimate) * 100),
    } : { sourceCostPct: 0, shippingPct: 0, dutiesPct: 0, packagingPct: 0, transactionPct: 0 };

    if (!profile && (sourceCost > 0 || shippingEstimate > 0)) {
      const grossMargin = product.price > 0
        ? Math.round(((product.price - landedCostEstimate) / product.price) * 100 * 10) / 10
        : null;
      const marginBand = grossMargin !== null ? this.classifyMarginBand(grossMargin) : null;

      await this.db.productCostProfile.upsert({
        where: { productId: product.id },
        update: { sourceCost, shippingEstimate, dutiesEstimate, packagingCost, transactionCost, landedCostEstimate, grossMargin, marginBand },
        create: { productId: product.id, sourceCost, shippingEstimate, dutiesEstimate, packagingCost, transactionCost, landedCostEstimate, grossMargin, marginBand, currency: product.currency },
      }).catch(err => this.logger.error(`Failed to upsert cost profile: ${err.message}`));
    }

    return {
      productId: product.id,
      productName: product.name,
      sourceCost,
      shippingEstimate,
      dutiesEstimate,
      packagingCost,
      transactionCost,
      landedCostEstimate,
      currency: product.currency,
      hasSourceLinks: sourceLinks.length > 0,
      sourceCount: sourceLinks.length,
      breakdown,
    };
  }

  async calculateForBusiness(businessId: string): Promise<LandedCostBreakdown[]> {
    const products = await this.db.product.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true },
    });

    const results: LandedCostBreakdown[] = [];
    for (const p of products) {
      const result = await this.calculateForProduct(p.id, businessId);
      if (result) results.push(result);
    }
    return results;
  }

  classifyMarginBand(grossMarginPct: number): string {
    if (grossMarginPct >= 30) return 'healthy';
    if (grossMarginPct >= 15) return 'moderate';
    if (grossMarginPct >= 5) return 'low';
    return 'negative';
  }

  private estimateShipping(sourceCost: number): number {
    if (sourceCost <= 0) return 0;
    return Math.round(sourceCost * 0.12 * 100) / 100;
  }

  private estimateDuties(sourceCost: number): number {
    if (sourceCost <= 0) return 0;
    return Math.round(sourceCost * 0.15 * 100) / 100;
  }

  private estimatePackaging(sourceCost: number): number {
    if (sourceCost <= 0) return 0;
    return Math.round(sourceCost * 0.03 * 100) / 100;
  }

  private estimateTransaction(baseAmount: number): number {
    if (baseAmount <= 0) return 0;
    return Math.round(baseAmount * 0.025 * 100) / 100;
  }
}
