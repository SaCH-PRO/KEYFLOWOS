import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LandedCostEngine } from './landed-cost-engine.service';

export type MarginBand = 'healthy' | 'moderate' | 'low' | 'negative';

export interface MarginAnalysis {
  productId: string;
  productName: string;
  sellingPrice: number;
  landedCost: number;
  grossProfit: number;
  grossMarginPct: number;
  marginBand: MarginBand;
  recommendedRetailPrice: number;
  currency: string;
  costBreakdown: {
    sourceCost: number;
    shippingEstimate: number;
    dutiesEstimate: number;
    packagingCost: number;
    transactionCost: number;
  };
}

export interface MarginSummary {
  businessId: string;
  totalProducts: number;
  productsWithCostData: number;
  marginDistribution: Record<MarginBand, number>;
  avgGrossMarginPct: number;
  products: MarginAnalysis[];
}

@Injectable()
export class MarginAnalysisService {
  private readonly logger = new Logger(MarginAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly landedCostEngine: LandedCostEngine,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  classifyMarginBand(grossMarginPct: number): MarginBand {
    if (grossMarginPct >= 30) return 'healthy';
    if (grossMarginPct >= 15) return 'moderate';
    if (grossMarginPct >= 5) return 'low';
    return 'negative';
  }

  recommendRetailPrice(landedCost: number, targetMarginPct = 30): number {
    if (landedCost <= 0) return 0;
    const price = landedCost / (1 - targetMarginPct / 100);
    return Math.round(price * 100) / 100;
  }

  async analyzeProduct(productId: string, businessId: string): Promise<MarginAnalysis | null> {
    const product = await this.db.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      include: { costProfile: true },
    });
    if (!product) return null;

    const landedCostBreakdown = await this.landedCostEngine.calculateForProduct(productId, businessId);
    if (!landedCostBreakdown) return null;

    const sellingPrice = Number(product.price);
    const landedCost = landedCostBreakdown.landedCostEstimate;
    const grossProfit = sellingPrice - landedCost;
    const grossMarginPct = sellingPrice > 0
      ? Math.round(((sellingPrice - landedCost) / sellingPrice) * 100 * 10) / 10
      : 0;
    const marginBand = this.classifyMarginBand(grossMarginPct);
    const recommendedRetailPrice = this.recommendRetailPrice(landedCost);

    if (product.costProfile) {
      await this.db.productCostProfile.update({
        where: { id: product.costProfile.id },
        data: { grossMargin: grossMarginPct, marginBand },
      }).catch(err => this.logger.error(`Failed to update margin band: ${err.message}`));
    }

    return {
      productId: product.id,
      productName: product.name,
      sellingPrice,
      landedCost,
      grossProfit,
      grossMarginPct,
      marginBand,
      recommendedRetailPrice,
      currency: product.currency,
      costBreakdown: {
        sourceCost: landedCostBreakdown.sourceCost,
        shippingEstimate: landedCostBreakdown.shippingEstimate,
        dutiesEstimate: landedCostBreakdown.dutiesEstimate,
        packagingCost: landedCostBreakdown.packagingCost,
        transactionCost: landedCostBreakdown.transactionCost,
      },
    };
  }

  async getMarginHistory(productId: string, businessId: string, limit = 90) {
    return this.prisma.client.marginSnapshot.findMany({
      where: { productId, product: { businessId } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async analyzeAllProducts(businessId: string): Promise<MarginSummary> {
    const products = await this.db.product.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true },
    });

    const analyses: MarginAnalysis[] = [];
    for (const p of products) {
      const analysis = await this.analyzeProduct(p.id, businessId);
      if (analysis) analyses.push(analysis);
    }

    const productsWithCostData = analyses.filter(a => a.landedCost > 0).length;
    const marginDistribution: Record<MarginBand, number> = { healthy: 0, moderate: 0, low: 0, negative: 0 };
    let totalMarginPct = 0;
    let countWithMargin = 0;

    for (const a of analyses) {
      if (a.landedCost > 0) {
        marginDistribution[a.marginBand]++;
        totalMarginPct += a.grossMarginPct;
        countWithMargin++;
      }
    }

    return {
      businessId,
      totalProducts: products.length,
      productsWithCostData,
      marginDistribution,
      avgGrossMarginPct: countWithMargin > 0 ? Math.round((totalMarginPct / countWithMargin) * 10) / 10 : 0,
      products: analyses,
    };
  }
}
