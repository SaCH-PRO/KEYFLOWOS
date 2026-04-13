import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { LandedCostEngine } from './landed-cost-engine.service';
import { MarginAnalysisService } from './margin-analysis.service';

@Injectable()
export class CommerceIntelligenceService {
  private readonly logger = new Logger(CommerceIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiUsage: AiUsageService,
    private readonly landedCostEngine: LandedCostEngine,
    private readonly marginAnalysis: MarginAnalysisService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async rewriteProductCopy(businessId: string, productId: string): Promise<{
    originalTitle: string;
    originalDescription: string;
    suggestedTitle: string;
    suggestedDescription: string;
    seoKeywords: string[];
    improvements: string[];
  }> {
    const product = await this.db.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
    });
    if (!product) throw new NotFoundException('Product not found');

    const sourceLinks = await this.db.productSourceLink.findMany({
      where: { productId, isActive: true },
      include: {
        supplierProduct: {
          select: { normalizedTitle: true, normalizedDescription: true, rawData: true },
        },
      },
      take: 3,
    });

    const supplierContext = sourceLinks.length > 0
      ? sourceLinks.map(l => {
          const sp = l.supplierProduct;
          return `Supplier: ${sp.normalizedTitle ?? 'unknown'} — ${sp.normalizedDescription ?? 'no description'}`;
        }).join('\n')
      : 'No supplier data available';

    const prompt = `You are an expert ecommerce copywriter specializing in SEO and conversion optimization.
Given the product information and any available supplier data, rewrite the product title and description to:
1. Be clear, compelling, and benefit-focused
2. Include relevant SEO keywords naturally
3. Use Caribbean/Trinidad & Tobago market context where appropriate
4. Normalize messy supplier copy into professional product listings

Product Context:
Name: ${product.name}
Category: ${product.category}
Current Price: $${product.price} ${product.currency}
Current Description: ${product.description ?? 'None provided'}
SKU: ${product.sku ?? 'N/A'}

Supplier Data:
${supplierContext}

Respond in valid JSON:
{
  "suggestedTitle": "...",
  "suggestedDescription": "...",
  "seoKeywords": ["keyword1", "keyword2"],
  "improvements": ["What was improved and why"]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_product_copy',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Rewrite copy for: ${product.name}` },
      ],
      maxTokens: 1500,
      temperature: 0.5,
      outputCategory: 'messages',
      responseMode: 'structured_json',
    });

    try {
      const parsed = JSON.parse(result.content);
      return {
        originalTitle: product.name,
        originalDescription: product.description ?? '',
        suggestedTitle: parsed.suggestedTitle ?? product.name,
        suggestedDescription: parsed.suggestedDescription ?? '',
        seoKeywords: Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
      };
    } catch {
      return {
        originalTitle: product.name,
        originalDescription: product.description ?? '',
        suggestedTitle: product.name,
        suggestedDescription: result.content,
        seoKeywords: [],
        improvements: [],
      };
    }
  }

  async recommendPricing(businessId: string, productId: string): Promise<{
    currentPrice: number;
    landedCost: number;
    grossMarginPct: number;
    recommendedPrice: number;
    priceRange: { min: number; max: number };
    reasoning: string;
    marginImpact: string;
    strategies: Array<{ name: string; price: number; marginPct: number; rationale: string }>;
  }> {
    const product = await this.db.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      include: { costProfile: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const [marginData, salesHistory, similarProducts] = await Promise.all([
      this.marginAnalysis.analyzeProduct(productId, businessId),
      this.db.invoiceItem.findMany({
        where: { invoice: { businessId, deletedAt: null }, productId },
        select: { unitPrice: true, quantity: true },
        take: 30,
      }),
      this.db.product.findMany({
        where: { businessId, category: product.category, deletedAt: null, id: { not: productId } },
        select: { name: true, price: true },
        take: 10,
      }),
    ]);

    const landedCost = marginData?.landedCost ?? 0;
    const grossMarginPct = marginData?.grossMarginPct ?? 0;
    const recommendedBase = landedCost > 0 ? this.marginAnalysis.recommendRetailPrice(landedCost, 30) : product.price;

    const prompt = `You are a pricing strategist for a Caribbean commerce business (TTD currency).
Analyze the cost profile and market data to recommend optimal retail pricing with multiple strategies.

Product: ${product.name}
Category: ${product.category}
Current Price: $${product.price} ${product.currency}
Landed Cost (estimated): $${landedCost.toFixed(2)} ${product.currency}
Current Gross Margin: ${grossMarginPct.toFixed(1)}%
Margin Band: ${marginData?.marginBand ?? 'unknown'}
Base Recommended Price (30% margin target): $${recommendedBase.toFixed(2)}

Sales History (${salesHistory.length} transactions):
${salesHistory.slice(0, 10).map(s => `  - Sold at $${s.unitPrice} x${s.quantity}`).join('\n') || '  No sales history'}

Similar Products in Category:
${similarProducts.map(p => `  - ${p.name}: $${p.price}`).join('\n') || '  No similar products'}

Provide 3 pricing strategies: value (volume-focused), balanced (30% margin), and premium.

Respond in valid JSON:
{
  "recommendedPrice": 0.00,
  "priceRange": { "min": 0.00, "max": 0.00 },
  "reasoning": "...",
  "marginImpact": "...",
  "strategies": [
    { "name": "value", "price": 0.00, "marginPct": 0.0, "rationale": "..." },
    { "name": "balanced", "price": 0.00, "marginPct": 0.0, "rationale": "..." },
    { "name": "premium", "price": 0.00, "marginPct": 0.0, "rationale": "..." }
  ]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_ai_pricing',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Recommend optimal pricing for "${product.name}"` },
      ],
      maxTokens: 1500,
      temperature: 0.3,
      outputCategory: 'general',
      responseMode: 'structured_json',
    });

    try {
      const parsed = JSON.parse(result.content);
      return {
        currentPrice: Number(product.price),
        landedCost,
        grossMarginPct,
        recommendedPrice: parsed.recommendedPrice ?? recommendedBase,
        priceRange: parsed.priceRange ?? { min: recommendedBase * 0.9, max: recommendedBase * 1.3 },
        reasoning: parsed.reasoning ?? '',
        marginImpact: parsed.marginImpact ?? '',
        strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
      };
    } catch {
      return {
        currentPrice: Number(product.price),
        landedCost,
        grossMarginPct,
        recommendedPrice: recommendedBase,
        priceRange: { min: recommendedBase * 0.9, max: recommendedBase * 1.3 },
        reasoning: result.content,
        marginImpact: '',
        strategies: [],
      };
    }
  }

  async recommendFulfillmentStrategy(businessId: string, productId: string): Promise<{
    currentModel: string | null;
    recommendedModel: string;
    confidence: number;
    reasoning: string;
    tradeoffs: string[];
    actionSteps: string[];
  }> {
    const product = await this.db.product.findFirst({
      where: { id: productId, businessId, deletedAt: null },
      include: {
        costProfile: true,
        sourceLinks: {
          where: { isActive: true },
          include: {
            supplierProduct: { select: { leadTimeDays: true, availability: true } },
          },
        },
        inventoryStocks: { include: { warehouse: { select: { name: true } } } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const marginData = await this.marginAnalysis.analyzeProduct(productId, businessId);
    const salesHistory = await this.db.invoiceItem.findMany({
      where: { invoice: { businessId, deletedAt: null }, productId },
      select: { quantity: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const totalSold = salesHistory.reduce((s, i) => s + i.quantity, 0);
    const avgLeadTime = product.sourceLinks.length > 0
      ? Math.round(product.sourceLinks.reduce((s, l) => s + (l.leadTimeDays ?? l.supplierProduct?.leadTimeDays ?? 14), 0) / product.sourceLinks.length)
      : null;
    const totalStock = product.inventoryStocks.reduce((s, st) => s + st.quantity, 0);

    const prompt = `You are a fulfillment strategy advisor for a Caribbean commerce business.
Recommend the optimal fulfillment model for this product based on cost, demand, lead times, and margin.

Available models: local_stock, dropship, preorder, hybrid

Product: ${product.name}
Category: ${product.category}
Current Fulfillment Model: ${product.fulfillmentModel ?? 'not set'}
Current Selling Price: $${product.price} ${product.currency}
Landed Cost: $${marginData?.landedCost?.toFixed(2) ?? 'unknown'}
Gross Margin: ${marginData?.grossMarginPct?.toFixed(1) ?? 'unknown'}%
Margin Band: ${marginData?.marginBand ?? 'unknown'}

Inventory:
Total Stock on Hand: ${totalStock} units
Supplier Sources: ${product.sourceLinks.length}
Avg Supplier Lead Time: ${avgLeadTime !== null ? `${avgLeadTime} days` : 'unknown'}
Supplier Availability: ${product.sourceLinks.map(l => l.availabilityState).join(', ') || 'unknown'}

Demand Signals:
Units Sold (last 30 transactions): ${totalSold}
Sales Velocity: ${salesHistory.length > 0 ? (totalSold / Math.max(1, salesHistory.length)).toFixed(1) : 'unknown'} units/transaction

Respond in valid JSON:
{
  "recommendedModel": "local_stock|dropship|preorder|hybrid",
  "confidence": 0.85,
  "reasoning": "...",
  "tradeoffs": ["pro/con 1", "pro/con 2"],
  "actionSteps": ["step 1", "step 2"]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_fulfillment_strategy',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Recommend fulfillment strategy for "${product.name}"` },
      ],
      maxTokens: 1200,
      temperature: 0.3,
      outputCategory: 'general',
      responseMode: 'structured_json',
    });

    try {
      const parsed = JSON.parse(result.content);
      return {
        currentModel: product.fulfillmentModel,
        recommendedModel: parsed.recommendedModel ?? 'dropship',
        confidence: parsed.confidence ?? 0.5,
        reasoning: parsed.reasoning ?? '',
        tradeoffs: Array.isArray(parsed.tradeoffs) ? parsed.tradeoffs : [],
        actionSteps: Array.isArray(parsed.actionSteps) ? parsed.actionSteps : [],
      };
    } catch {
      return {
        currentModel: product.fulfillmentModel,
        recommendedModel: 'dropship',
        confidence: 0.5,
        reasoning: result.content,
        tradeoffs: [],
        actionSteps: [],
      };
    }
  }

  async identifyProductOpportunities(businessId: string): Promise<{
    underperformers: Array<{
      productId: string;
      productName: string;
      issue: string;
      recommendation: string;
    }>;
    bundleOpportunities: Array<{
      products: string[];
      bundleName: string;
      rationale: string;
      estimatedBundlePrice: number;
    }>;
    upsellOpportunities: Array<{
      triggerProduct: string;
      upsellProduct: string;
      rationale: string;
    }>;
    promotionCandidates: Array<{
      productId: string;
      productName: string;
      reason: string;
    }>;
    summary: string;
  }> {
    const products = await this.db.product.findMany({
      where: { businessId, deletedAt: null, isActive: true },
      include: { costProfile: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const invoiceItems = await this.db.invoiceItem.findMany({
      where: { invoice: { businessId, deletedAt: null }, productId: { not: null } },
      select: { productId: true, quantity: true, total: true, unitPrice: true },
    });

    const salesByProduct = new Map<string, { count: number; revenue: number; unitsSold: number }>();
    for (const item of invoiceItems) {
      if (!item.productId) continue;
      const existing = salesByProduct.get(item.productId) ?? { count: 0, revenue: 0, unitsSold: 0 };
      existing.count++;
      existing.revenue += Number(item.total);
      existing.unitsSold += item.quantity;
      salesByProduct.set(item.productId, existing);
    }

    const now = new Date();
    const productContext = products.map(p => {
      const sales = salesByProduct.get(p.id);
      const daysSinceCreated = Math.floor((now.getTime() - new Date(p.createdAt).getTime()) / 86400000);
      const grossMargin = p.costProfile?.grossMargin;
      const marginBand = p.costProfile?.marginBand;
      return `ID: ${p.id} | ${p.name} | ${p.category} | $${p.price} ${p.currency} | Margin: ${grossMargin !== null && grossMargin !== undefined ? `${grossMargin.toFixed(1)}% (${marginBand})` : 'unknown'} | Sales: ${sales ? `${sales.count} orders, ${sales.unitsSold} units, $${sales.revenue.toFixed(0)} revenue` : `no sales (${daysSinceCreated}d old)`}`;
    }).join('\n');

    const prompt = `You are a commerce growth advisor for a Caribbean small business.
Analyze the product catalog performance data and identify:
1. Underperforming products with actionable suggestions
2. Bundle opportunities (products commonly used together)
3. Upsell/cross-sell opportunities
4. Products to promote based on high margin and low visibility

Product Catalog (${products.length} products):
${productContext}

Respond in valid JSON:
{
  "underperformers": [
    { "productId": "...", "productName": "...", "issue": "...", "recommendation": "..." }
  ],
  "bundleOpportunities": [
    { "products": ["Product A", "Product B"], "bundleName": "...", "rationale": "...", "estimatedBundlePrice": 0.00 }
  ],
  "upsellOpportunities": [
    { "triggerProduct": "...", "upsellProduct": "...", "rationale": "..." }
  ],
  "promotionCandidates": [
    { "productId": "...", "productName": "...", "reason": "..." }
  ],
  "summary": "..."
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'commerce_product_opportunities',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Identify product opportunities and underperformers for my catalog.' },
      ],
      maxTokens: 2500,
      temperature: 0.4,
      outputCategory: 'reports',
      responseMode: 'structured_json',
    });

    try {
      const parsed = JSON.parse(result.content);
      return {
        underperformers: Array.isArray(parsed.underperformers) ? parsed.underperformers : [],
        bundleOpportunities: Array.isArray(parsed.bundleOpportunities) ? parsed.bundleOpportunities : [],
        upsellOpportunities: Array.isArray(parsed.upsellOpportunities) ? parsed.upsellOpportunities : [],
        promotionCandidates: Array.isArray(parsed.promotionCandidates) ? parsed.promotionCandidates : [],
        summary: parsed.summary ?? '',
      };
    } catch {
      return {
        underperformers: [],
        bundleOpportunities: [],
        upsellOpportunities: [],
        promotionCandidates: [],
        summary: result.content,
      };
    }
  }
}
