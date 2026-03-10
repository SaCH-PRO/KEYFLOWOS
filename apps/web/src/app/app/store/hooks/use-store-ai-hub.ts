"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";

async function generateStoreSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, activeView, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];

  const products = (customData?.products as any[]) ?? [];
  const services = (customData?.services as any[]) ?? [];
  const testimonials = (customData?.testimonials as any[]) ?? [];
  const storeEnabled = (customData?.storeEnabled as boolean) ?? false;
  const hasHeroImage = (customData?.hasHeroImage as boolean) ?? false;
  const hasLogo = (customData?.hasLogo as boolean) ?? false;
  const hoursConfigured = (customData?.hoursConfigured as boolean) ?? false;

  if (!storeEnabled) {
    suggestions.push({
      id: `store-offline-${Date.now()}`,
      type: "warning",
      title: "Store is Offline",
      description: "Your storefront is currently in draft mode. Toggle it live so customers can find you.",
      priority: "high",
      actionLabel: "Go to Overview",
      actionKey: "switch_tab:overview",
    });
  }

  if (products.length === 0 && services.length === 0) {
    suggestions.push({
      id: `no-catalog-${Date.now()}`,
      type: "warning",
      title: "Empty Catalog",
      description: "Your store has no products or services listed. Add items so visitors have something to browse.",
      priority: "high",
      actionLabel: "Add products",
      actionKey: "switch_tab:products",
    });
  }

  if (!hasHeroImage) {
    suggestions.push({
      id: `no-hero-${Date.now()}`,
      type: "insight",
      title: "Missing Hero Image",
      description: "Stores with a hero banner image see up to 40% higher engagement. Upload one in Customize.",
      priority: "medium",
      actionLabel: "Customize store",
      actionKey: "switch_tab:customize",
    });
  }

  if (!hasLogo) {
    suggestions.push({
      id: `no-logo-${Date.now()}`,
      type: "insight",
      title: "No Logo Uploaded",
      description: "A branded logo builds trust and recognition. Add one in your store settings.",
      priority: "medium",
      actionLabel: "Go to settings",
      actionKey: "switch_tab:settings",
    });
  }

  if (testimonials.length < 3) {
    suggestions.push({
      id: `low-testimonials-${Date.now()}`,
      type: "insight",
      title: "Low Social Proof",
      description: `You only have ${testimonials.length} testimonial${testimonials.length !== 1 ? "s" : ""}. Adding more social proof can boost conversions by up to 30%.`,
      priority: "medium",
      actionLabel: "Manage testimonials",
      actionKey: "switch_tab:customize",
    });
  }

  if (!hoursConfigured) {
    suggestions.push({
      id: `no-hours-${Date.now()}`,
      type: "insight",
      title: "Business Hours Not Set",
      description: "Setting your hours helps customers know when you're available and improves local SEO.",
      priority: "medium",
      actionLabel: "Set hours",
      actionKey: "switch_tab:hours",
    });
  }

  if (activeView === "overview") {
    suggestions.push({
      id: `optimizer-tip-${Date.now()}`,
      type: "tip",
      title: "Store Optimizer",
      description: "Run the AI Store Optimizer to get a comprehensive audit of your storefront with actionable improvement steps.",
      priority: "low",
      actionLabel: "Run optimizer",
      actionKey: "tool:store-optimizer",
    });
  }

  if (activeView === "customize") {
    suggestions.push({
      id: `seo-tip-${Date.now()}`,
      type: "tip",
      title: "SEO Advisor",
      description: "Get AI-powered SEO recommendations to improve your storefront's discoverability.",
      priority: "low",
      actionLabel: "Get SEO advice",
      actionKey: "tool:seo-advisor",
    });
  }

  if (activeView === "products") {
    suggestions.push({
      id: `pricing-tip-${Date.now()}`,
      type: "tip",
      title: "Pricing Advisor",
      description: "AI can analyze your product pricing and suggest competitive adjustments.",
      priority: "low",
      actionLabel: "Analyze pricing",
      actionKey: "tool:pricing-advisor",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: `healthy-${Date.now()}`,
      type: "tip",
      title: "Store Health",
      description: `${products.length + services.length} catalog items, ${testimonials.length} testimonials. Your store is looking good!`,
      priority: "low",
    });
  }

  return suggestions;
}

function buildStoreTools(): AiTool[] {
  return [
    {
      id: "store-optimizer",
      name: "Store Optimizer",
      description: "Analyze your catalog, configuration, and appearance for improvement suggestions to maximize conversions.",
      icon: "analysis",
      category: "optimize",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const products = (ctx.customData?.products as any[]) ?? [];
        const services = (ctx.customData?.services as any[]) ?? [];
        const testimonials = (ctx.customData?.testimonials as any[]) ?? [];
        const storeEnabled = (ctx.customData?.storeEnabled as boolean) ?? false;
        const hasHeroImage = (ctx.customData?.hasHeroImage as boolean) ?? false;

        const totalItems = products.length + services.length;
        const score = Math.min(100, (storeEnabled ? 20 : 0) + Math.min(30, totalItems * 5) + (hasHeroImage ? 15 : 0) + Math.min(20, testimonials.length * 7) + 15);

        const recommendations: any[] = [];
        if (!storeEnabled) recommendations.push({ title: "Enable Your Store", description: "Your store is offline. Toggle it live to start receiving visitors.", priority: "high", expectedImpact: "Critical — no traffic while offline" });
        if (totalItems === 0) recommendations.push({ title: "Add Catalog Items", description: "Add at least 3-5 products or services to give visitors a reason to stay.", priority: "high", expectedImpact: "High — empty stores have near-zero conversions" });
        if (totalItems > 0 && totalItems < 3) recommendations.push({ title: "Expand Your Catalog", description: `You have ${totalItems} item${totalItems > 1 ? "s" : ""}. Aim for at least 5 to look established.`, priority: "medium", expectedImpact: "Medium — more options increase average order value" });
        if (!hasHeroImage) recommendations.push({ title: "Add a Hero Image", description: "A visually appealing banner image grabs attention and communicates your brand instantly.", priority: "medium", expectedImpact: "Up to 40% more engagement" });
        if (testimonials.length < 3) recommendations.push({ title: "Gather More Reviews", description: "Social proof is the #1 trust signal. Ask your best customers for testimonials.", priority: "medium", expectedImpact: "Up to 30% conversion lift" });

        return {
          summary: `Your store health score is ${score}/100. ${recommendations.length} improvement${recommendations.length !== 1 ? "s" : ""} recommended.`,
          score,
          totalItems,
          testimonialCount: testimonials.length,
          recommendations,
        };
      },
    },
    {
      id: "seo-advisor",
      name: "SEO Advisor",
      description: "Get storefront SEO suggestions to improve search visibility, meta tags, and content structure.",
      icon: "detect",
      category: "analyze",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const products = (ctx.customData?.products as any[]) ?? [];
        const storeName = (ctx.customData?.storeName as string) || "Your Store";

        const tips: string[] = [
          "Include your primary service keyword in the store title and description.",
          "Add alt text to all product images for better image search ranking.",
          "Keep product descriptions between 100-300 words with natural keyword usage.",
          "Use structured business hours data — search engines reward consistency.",
          "Add a clear call-to-action on your storefront hero section.",
        ];

        const issues: any[] = [];
        if (products.some((p: any) => !p.description || p.description.length < 20)) {
          issues.push({ field: "Product Descriptions", issue: "Some products have missing or very short descriptions.", suggestion: "Write at least 2-3 sentences describing each product's benefits.", impact: "high" });
        }
        if (products.some((p: any) => !p.imageUrl)) {
          issues.push({ field: "Product Images", issue: "Some products are missing images.", suggestion: "Add high-quality images to every product for better engagement and SEO.", impact: "high" });
        }
        issues.push({ field: "Store Title", issue: `Ensure "${storeName}" includes a relevant keyword.`, suggestion: "Example: 'KeyFlow Studio — Premium Design Services'", impact: "medium" });

        return {
          summary: `SEO analysis for "${storeName}" — ${issues.length} issue${issues.length !== 1 ? "s" : ""} found with ${tips.length} general tips.`,
          issues,
          tips,
        };
      },
    },
    {
      id: "pricing-advisor",
      name: "Pricing Advisor",
      description: "Analyze your product pricing and get competitive insights to optimize revenue.",
      icon: "score",
      category: "analyze",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const products = (ctx.customData?.products as any[]) ?? [];
        const pricedProducts = products.filter((p: any) => p.price && p.price > 0);

        if (pricedProducts.length === 0) {
          return {
            summary: "No priced products found. Add products with prices to get pricing insights.",
            recommendations: [{ title: "Add Product Pricing", description: "Set prices for your products to enable competitive analysis.", priority: "high" }],
          };
        }

        const prices = pricedProducts.map((p: any) => p.price);
        const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);

        const recommendations: any[] = [];
        if (maxPrice / minPrice > 10) {
          recommendations.push({ title: "Wide Price Range", description: `Your prices span from $${minPrice.toFixed(2)} to $${maxPrice.toFixed(2)}. Consider creating distinct tiers or bundles.`, priority: "medium", expectedImpact: "Clearer value positioning" });
        }
        const freeItems = products.filter((p: any) => !p.price || p.price === 0);
        if (freeItems.length > 0) {
          recommendations.push({ title: "Free Items Detected", description: `${freeItems.length} item${freeItems.length > 1 ? "s have" : " has"} no price. Consider adding a price or marking as 'Contact for pricing'.`, priority: "medium", expectedImpact: "Potential lost revenue" });
        }
        recommendations.push({ title: "Anchor Pricing Strategy", description: "Place your premium offering first to make mid-tier options feel like great value.", priority: "low", expectedImpact: "Up to 15% higher AOV" });

        return {
          summary: `Analyzed ${pricedProducts.length} priced product${pricedProducts.length !== 1 ? "s" : ""}. Average price: $${avgPrice.toFixed(2)}.`,
          avgPrice,
          minPrice,
          maxPrice,
          totalProducts: products.length,
          pricedCount: pricedProducts.length,
          recommendations,
        };
      },
    },
    {
      id: "storefront-analyzer",
      name: "Storefront Analyzer",
      description: "Conversion optimization analysis — identify friction points and get actionable fixes.",
      icon: "default",
      category: "optimize",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const products = (ctx.customData?.products as any[]) ?? [];
        const services = (ctx.customData?.services as any[]) ?? [];
        const testimonials = (ctx.customData?.testimonials as any[]) ?? [];
        const storeEnabled = (ctx.customData?.storeEnabled as boolean) ?? false;
        const hasHeroImage = (ctx.customData?.hasHeroImage as boolean) ?? false;
        const hoursConfigured = (ctx.customData?.hoursConfigured as boolean) ?? false;

        const checks = [
          { label: "Store is live", passed: storeEnabled },
          { label: "Hero image set", passed: hasHeroImage },
          { label: "Has catalog items", passed: products.length + services.length > 0 },
          { label: "Social proof (3+ testimonials)", passed: testimonials.length >= 3 },
          { label: "Business hours configured", passed: hoursConfigured },
          { label: "Multiple product categories", passed: new Set(products.map((p: any) => p.category).filter(Boolean)).size > 1 },
        ];

        const passedCount = checks.filter((c) => c.passed).length;
        const conversionScore = Math.round((passedCount / checks.length) * 100);

        const frictionPoints: any[] = [];
        checks.filter((c) => !c.passed).forEach((c) => {
          frictionPoints.push({ area: c.label, issue: `Not configured: ${c.label}`, suggestion: `Complete this step to improve your conversion score.`, impact: "medium" });
        });

        return {
          summary: `Conversion readiness: ${conversionScore}%. ${passedCount}/${checks.length} checks passed.`,
          conversionScore,
          checks,
          frictionPoints,
          recommendations: frictionPoints.length === 0
            ? [{ title: "Looking Great!", description: "All conversion checks passed. Keep monitoring your analytics for ongoing optimization.", priority: "low" }]
            : [{ title: "Focus on Quick Wins", description: `Complete the ${frictionPoints.length} remaining check${frictionPoints.length > 1 ? "s" : ""} to maximize conversions.`, priority: "high", expectedImpact: "Significant conversion improvement" }],
        };
      },
    },
  ];
}

export function useStoreAiHub() {
  const tools = useMemo(() => buildStoreTools(), []);

  const ai = useModuleAi({
    moduleId: "store",
    moduleName: "Store",
    generateSuggestions: generateStoreSuggestions,
    tools,
    executeAction: async (actionKey, context) => {
      if (actionKey.startsWith("tool:")) {
        const toolId = actionKey.replace("tool:", "");
        const tool = tools.find((t) => t.id === toolId);
        if (tool) await tool.execute(context);
      }
    },
  });

  const updateStoreContext = useCallback((params: {
    businessId: string;
    activeView: string;
    selectedItemId?: string;
    itemCount?: number;
    products?: unknown[];
    services?: unknown[];
    testimonials?: unknown[];
    storeEnabled?: boolean;
    hasHeroImage?: boolean;
    hasLogo?: boolean;
    hoursConfigured?: boolean;
    storeName?: string;
  }) => {
    ai.updateContext({
      businessId: params.businessId,
      activeView: params.activeView,
      selectedItemId: params.selectedItemId,
      itemCount: params.itemCount,
      customData: {
        products: params.products,
        services: params.services,
        testimonials: params.testimonials,
        storeEnabled: params.storeEnabled,
        hasHeroImage: params.hasHeroImage,
        hasLogo: params.hasLogo,
        hoursConfigured: params.hoursConfigured,
        storeName: params.storeName,
      },
    });
  }, [ai.updateContext]);

  return {
    ...ai,
    updateStoreContext,
  };
}

export type UseStoreAiHubReturn = ReturnType<typeof useStoreAiHub>;
