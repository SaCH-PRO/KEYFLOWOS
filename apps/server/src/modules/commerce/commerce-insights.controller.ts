import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { CrmRateLimitGuard, CrmRateLimit } from '../crm/guards/rate-limit.guard';
import { FeatureFlagGuard, RequireFeature } from '../crm/guards/feature-flag.guard';
import { checkAiRateLimit } from '../crm/ai-rate-limit.util';
import { LandedCostEngine } from './landed-cost-engine.service';
import { MarginAnalysisService } from './margin-analysis.service';
import { SourceRiskService } from './source-risk.service';
import { InventoryRiskService } from './inventory-risk.service';
import { CommerceIntelligenceService } from './commerce-intelligence.service';
import { MarginSnapshotSchedulerService } from './margin-snapshot-scheduler.service';

@Controller('commerce')
@UseGuards(CrmRateLimitGuard)
export class CommerceInsightsController {
  constructor(
    @Inject(LandedCostEngine) private readonly landedCostEngine: LandedCostEngine,
    @Inject(MarginAnalysisService) private readonly marginAnalysis: MarginAnalysisService,
    @Inject(SourceRiskService) private readonly sourceRisk: SourceRiskService,
    @Inject(InventoryRiskService) private readonly inventoryRisk: InventoryRiskService,
    @Inject(CommerceIntelligenceService) private readonly intelligence: CommerceIntelligenceService,
    @Inject(MarginSnapshotSchedulerService) private readonly snapshotScheduler: MarginSnapshotSchedulerService,
  ) {}

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/insights/landed-costs')
  getLandedCosts(@Param('businessId') businessId: string) {
    return this.landedCostEngine.calculateForBusiness(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/products/:productId/insights/landed-cost')
  getProductLandedCost(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.landedCostEngine.calculateForProduct(productId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/insights/margins')
  getMarginAnalysis(@Param('businessId') businessId: string) {
    return this.marginAnalysis.analyzeAllProducts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/products/:productId/insights/margin')
  getProductMargin(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.marginAnalysis.analyzeProduct(productId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/insights/source-risk')
  getSourceRisk(@Param('businessId') businessId: string) {
    return this.sourceRisk.evaluateAllProducts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/products/:productId/insights/source-risk')
  getProductSourceRisk(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.sourceRisk.evaluateProduct(productId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/insights/inventory-risk')
  getInventoryRisk(@Param('businessId') businessId: string) {
    return this.inventoryRisk.evaluateAllProducts(businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/products/:productId/insights/inventory-risk')
  getProductInventoryRisk(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    return this.inventoryRisk.evaluateProduct(productId, businessId);
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(60, 60_000)
  @Get('businesses/:businessId/insights/overview')
  async getInsightsOverview(@Param('businessId') businessId: string) {
    const [marginSummary, sourceRiskReport, inventoryRiskReport] = await Promise.all([
      this.marginAnalysis.analyzeAllProducts(businessId),
      this.sourceRisk.evaluateAllProducts(businessId),
      this.inventoryRisk.evaluateAllProducts(businessId),
    ]);

    const marginCards = marginSummary.products.slice(0, 20).map(p => ({
      productId: p.productId,
      productName: p.productName,
      grossMarginPct: p.grossMarginPct,
      marginBand: p.marginBand,
      sellingPrice: p.sellingPrice,
      landedCost: p.landedCost,
      recommendedRetailPrice: p.recommendedRetailPrice,
    }));

    return {
      margin: {
        summary: {
          totalProducts: marginSummary.totalProducts,
          productsWithCostData: marginSummary.productsWithCostData,
          avgGrossMarginPct: marginSummary.avgGrossMarginPct,
          distribution: marginSummary.marginDistribution,
        },
        cards: marginCards,
      },
      sourceRisk: {
        totalProducts: sourceRiskReport.totalProducts,
        productsAtRisk: sourceRiskReport.productsAtRisk,
        riskDistribution: sourceRiskReport.riskDistribution,
        highRiskProducts: sourceRiskReport.products
          .filter(p => p.riskLevel === 'critical' || p.riskLevel === 'high')
          .slice(0, 10),
      },
      inventoryRisk: {
        totalProducts: inventoryRiskReport.totalProducts,
        outOfStockCount: inventoryRiskReport.outOfStockCount,
        lowStockCount: inventoryRiskReport.lowStockCount,
        unverifiedCount: inventoryRiskReport.unverifiedCount,
        atRiskProducts: inventoryRiskReport.products.slice(0, 10),
      },
    };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(30, 60_000)
  @Get('businesses/:businessId/products/:productId/insights/margin-history')
  async getMarginHistory(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    const snapshots = await this.marginAnalysis.getMarginHistory(productId, businessId);
    return { productId, snapshots };
  }

  @UseGuards(AuthGuard, BusinessGuard)
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/products/:productId/insights/snapshot')
  async captureMarginSnapshot(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
    @Body() body: { reason?: string },
  ) {
    await this.snapshotScheduler.captureSnapshotForProduct(productId, body?.reason ?? 'manual');
    return { success: true, message: 'Margin snapshot captured' };
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/products/:productId/ai-copy')
  async rewriteProductCopy(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.intelligence.rewriteProductCopy(businessId, productId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/products/:productId/ai-pricing-recommendation')
  async recommendPricing(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.intelligence.recommendPricing(businessId, productId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/products/:productId/ai-fulfillment-strategy')
  async recommendFulfillmentStrategy(
    @Param('businessId') businessId: string,
    @Param('productId') productId: string,
  ) {
    checkAiRateLimit(businessId);
    return this.intelligence.recommendFulfillmentStrategy(businessId, productId);
  }

  @UseGuards(AuthGuard, BusinessGuard, FeatureFlagGuard)
  @RequireFeature('ai_tools')
  @CrmRateLimit(10, 60_000)
  @Post('businesses/:businessId/ai-product-opportunities')
  async identifyOpportunities(@Param('businessId') businessId: string) {
    checkAiRateLimit(businessId);
    return this.intelligence.identifyProductOpportunities(businessId);
  }
}
