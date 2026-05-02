"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";

type StoreCustomData = {
  products?: unknown[];
  services?: unknown[];
  testimonials?: unknown[];
  storeEnabled?: boolean;
  hasHeroImage?: boolean;
  hasHeroHeadline?: boolean;
  hasHeroCta?: boolean;
  hasLogo?: boolean;
  hoursConfigured?: boolean;
  storeName?: string;
  businessDescription?: string;
  businessTagline?: string;
  industryHint?: string;
  primaryColor?: string;
  hasMetaTitle?: boolean;
  hasMetaDescription?: boolean;
  hasPolicies?: boolean;
  hasFaq?: boolean;
  activeDeliveryCount?: number;
  readinessScores?: { overall: number; launch: number; conversion: number; merchandising: number; promotion: number };
  readinessItems?: { id: string; category: string; severity: string; title: string; detail: string; actionLabel: string; actionTab: string; resolved: boolean }[];
  revenueSnapshot?: { totalRevenue30d: number; totalOrders30d: number; avgOrderValue: number; conversionRate: number | null };
  graphStats?: { liveCount: number; draftCount: number; driftCount: number; totalProducts: number };
};

async function generateStoreSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, activeView, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];
  const data = (customData ?? {}) as StoreCustomData;

  const products = (data.products ?? []) as Record<string, unknown>[];
  const services = (data.services ?? []) as Record<string, unknown>[];
  const testimonials = (data.testimonials ?? []) as unknown[];
  const storeEnabled = data.storeEnabled ?? false;
  const hasHeroImage = data.hasHeroImage ?? false;
  const hasHeroHeadline = data.hasHeroHeadline ?? false;
  const hasHeroCta = data.hasHeroCta ?? false;
  const hasLogo = data.hasLogo ?? false;
  const hoursConfigured = data.hoursConfigured ?? false;
  const hasMetaTitle = data.hasMetaTitle ?? false;
  const hasMetaDescription = data.hasMetaDescription ?? false;
  const hasPolicies = data.hasPolicies ?? false;
  const _hasFaq = data.hasFaq ?? false;
  const activeDeliveryCount = data.activeDeliveryCount ?? 0;
  const readinessScores = data.readinessScores;
  const readinessItems = data.readinessItems;
  const revenueSnapshot = data.revenueSnapshot;
  const graphStats = data.graphStats;

  if (readinessItems && readinessItems.length > 0) {
    const unresolvedByView = readinessItems.filter((i) => !i.resolved);
    const viewItems = activeView
      ? unresolvedByView.filter((i) => i.actionTab === activeView)
      : [];
    const globalItems = unresolvedByView.filter((i) => i.severity === "blocker");

    const itemsToShow = viewItems.length > 0 ? viewItems : globalItems;

    for (const item of itemsToShow.slice(0, 3)) {
      suggestions.push({
        id: `readiness-${item.id}-${Date.now()}`,
        type: item.severity === "blocker" ? "risk" : item.severity === "warning" ? "action" : "insight",
        title: item.title,
        description: item.detail,
        explanation: `Store readiness: ${readinessScores?.overall ?? 0}%. This ${item.category} issue affects your store's ability to convert visitors.`,
        priority: item.severity === "blocker" ? "high" : "medium",
        actionLabel: item.actionLabel,
        actionKey: `switch_tab:${item.actionTab}`,
      });
    }

    if (revenueSnapshot && revenueSnapshot.totalOrders30d > 0 && activeView === "overview") {
      suggestions.push({
        id: `revenue-insight-${Date.now()}`,
        type: "insight",
        title: `${revenueSnapshot.totalOrders30d} Orders · $${revenueSnapshot.totalRevenue30d.toFixed(0)} Revenue (30d)`,
        description: `Average order value is $${revenueSnapshot.avgOrderValue.toFixed(2)}.${revenueSnapshot.conversionRate != null ? ` Conversion rate: ${revenueSnapshot.conversionRate.toFixed(1)}%.` : ""} Use the Pricing Advisor tool for optimization.`,
        explanation: "Revenue data from your store graph. Use conversion audit and pricing tools to optimize.",
        priority: "low",
        actionLabel: "Run Pricing Advisor",
        actionKey: "tool:pricing-advisor",
      });
    }

    if (graphStats && graphStats.driftCount > 0) {
      suggestions.push({
        id: `drift-alert-${Date.now()}`,
        type: "risk",
        title: `${graphStats.driftCount} Price/Duration Drift${graphStats.driftCount !== 1 ? "s" : ""} Detected`,
        description: "Some store items have different prices or durations than their Commerce products. Sync them to maintain consistency.",
        explanation: "Price drift confuses customers and can lead to billing disputes. The graph detected mismatches between your Commerce catalog and store services.",
        priority: "high",
        actionLabel: "Review Drift",
        actionKey: "switch_tab:catalog",
      });
    }

    if (readinessScores && readinessScores.overall >= 80 && suggestions.length === 0) {
      suggestions.push({
        id: `healthy-store-${Date.now()}`,
        type: "opportunity",
        title: "Store Health: Strong",
        description: `Overall readiness ${readinessScores.overall}%. Your store is well-configured. Focus on marketing and conversion optimization.`,
        explanation: "Your store has passed most readiness checks. Shift focus to growth strategies.",
        priority: "low",
      });
    }

    return suggestions;
  }

  if (!storeEnabled) {
    suggestions.push({
      id: `store-offline-${Date.now()}`,
      type: "risk",
      title: "Store is Offline",
      description: "Your storefront is in draft mode. Customers cannot find or access it. Go to Launch to publish.",
      explanation: "An offline store generates zero revenue — publishing is the most impactful action you can take.",
      priority: "high",
      actionLabel: "Go to Launch",
      actionKey: "switch_tab:launch",
    });
  }

  if (products.length === 0 && services.length === 0) {
    suggestions.push({
      id: `no-catalog-${Date.now()}`,
      type: "risk",
      title: "Empty Catalog",
      description: "Your store has no products or services. Add items so visitors have something to browse and purchase.",
      explanation: "An empty catalog means visitors have nothing to buy — this is your store's core content.",
      priority: "high",
      actionLabel: "Add items",
      actionKey: "switch_tab:catalog",
    });
  }

  if (!hasHeroHeadline || !hasHeroCta) {
    suggestions.push({
      id: `weak-hero-${Date.now()}`,
      type: "risk",
      title: "Weak Hero Section",
      description: "Missing headline or CTA in your hero. AI can generate compelling copy for you in the Design tab.",
      explanation: "The hero section is the first thing visitors see — strong copy increases time on site and conversions.",
      priority: "high",
      actionLabel: "Generate hero copy",
      actionKey: "tool:hero-copy-generator",
    });
  }

  if (!hasHeroImage) {
    suggestions.push({
      id: `no-hero-${Date.now()}`,
      type: "insight",
      title: "Missing Hero Image",
      description: "Stores with a hero banner see up to 40% higher engagement. Upload one in the Design tab.",
      explanation: "Visual hero banners create immediate emotional impact and set brand expectations.",
      priority: "medium",
      actionLabel: "Customize design",
      actionKey: "switch_tab:design",
    });
  }

  if (!hasLogo) {
    suggestions.push({
      id: `no-logo-${Date.now()}`,
      type: "insight",
      title: "No Logo Uploaded",
      description: "A branded logo builds trust and recognition. Add one in the Design tab.",
      explanation: "Logos are a key trust signal — visitors are more likely to purchase from branded stores.",
      priority: "medium",
      actionLabel: "Go to design",
      actionKey: "switch_tab:design",
    });
  }

  if (testimonials.length < 3) {
    suggestions.push({
      id: `low-testimonials-${Date.now()}`,
      type: "insight",
      title: "Low Social Proof",
      description: `Only ${testimonials.length} testimonial${testimonials.length !== 1 ? "s" : ""}. Aim for 3+ to boost conversions by up to 30%.`,
      explanation: "Social proof is one of the strongest conversion drivers in e-commerce.",
      priority: "medium",
      actionLabel: "Add testimonials",
      actionKey: "switch_tab:merchandising",
    });
  }

  if (!hoursConfigured) {
    suggestions.push({
      id: `no-hours-${Date.now()}`,
      type: "insight",
      title: "Business Hours Not Set",
      description: "Setting your hours helps customers know when you're available and improves local SEO.",
      explanation: "Business hours improve Google My Business ranking and reduce customer frustration.",
      priority: "medium",
      actionLabel: "Set hours",
      actionKey: "switch_tab:operations",
    });
  }

  if (!hasPolicies) {
    suggestions.push({
      id: `no-policies-${Date.now()}`,
      type: "insight",
      title: "No Store Policies",
      description: "Refund and privacy policies are top trust signals. AI can draft them for you.",
      explanation: "Clear policies reduce purchase hesitation and protect your business legally.",
      priority: "medium",
      actionLabel: "Generate policies",
      actionKey: "tool:policy-generator",
    });
  }

  if (!hasMetaTitle || !hasMetaDescription) {
    suggestions.push({
      id: `no-seo-${Date.now()}`,
      type: "insight",
      title: "SEO Not Configured",
      description: "Missing meta title or description hurts search visibility. AI can generate optimized copy.",
      explanation: "SEO metadata determines how your store appears in Google search results.",
      priority: "low",
      actionLabel: "Generate SEO",
      actionKey: "tool:seo-generator",
    });
  }

  if (activeDeliveryCount === 0 && (products.length + services.length) > 0) {
    suggestions.push({
      id: `no-delivery-${Date.now()}`,
      type: "risk",
      title: "No Delivery Method Configured",
      description: "Customers can't complete purchases without knowing how orders are fulfilled.",
      explanation: "Missing delivery options block checkout completion and cause cart abandonment.",
      priority: "high",
      actionLabel: "Configure delivery",
      actionKey: "switch_tab:operations",
    });
  }

  if (activeView === "design") {
    suggestions.push({
      id: `ai-hero-${Date.now()}`,
      type: "opportunity",
      title: "AI Hero Copy",
      description: "Let AI write your headline, subheadline, offer ribbon, and CTA based on your business.",
      explanation: "AI-generated hero copy is tailored to your business type and optimized for conversions.",
      priority: "low",
      actionLabel: "Generate hero copy",
      actionKey: "tool:hero-copy-generator",
    });
    suggestions.push({
      id: `storefront-model-${Date.now()}`,
      type: "opportunity",
      title: "Storefront Model Advisor",
      description: "Get a personalized recommendation for the best storefront theme and layout for your business type.",
      explanation: "The right theme and layout can significantly improve user experience and conversion rates.",
      priority: "low",
      actionLabel: "Get recommendation",
      actionKey: "tool:storefront-model-advisor",
    });
  }

  if (activeView === "merchandising") {
    suggestions.push({
      id: `faq-gen-${Date.now()}`,
      type: "opportunity",
      title: "Generate FAQ Content",
      description: "AI can generate relevant FAQ entries based on your products, services, and business type.",
      explanation: "FAQ content reduces support inquiries and improves SEO with long-tail keyword coverage.",
      priority: "low",
      actionLabel: "Generate FAQ",
      actionKey: "tool:faq-generator",
    });
    suggestions.push({
      id: `seo-gen-${Date.now()}`,
      type: "opportunity",
      title: "Generate SEO Metadata",
      description: "AI will craft an optimized meta title, description, and keyword strategy for your store.",
      explanation: "Optimized metadata improves click-through rates from search engine results pages.",
      priority: "low",
      actionLabel: "Generate SEO",
      actionKey: "tool:seo-generator",
    });
    suggestions.push({
      id: `featured-gen-${Date.now()}`,
      type: "opportunity",
      title: "Featured Products Advisor",
      description: "AI will recommend which products to feature based on demand signals and launch goals.",
      explanation: "Strategic featuring drives attention to high-margin or high-demand items.",
      priority: "low",
      actionLabel: "Get recommendations",
      actionKey: "tool:featured-products-advisor",
    });
  }

  if (activeView === "catalog") {
    if (products.length > 0) {
      suggestions.push({
        id: `catalog-reorder-${Date.now()}`,
        type: "opportunity",
        title: "Optimize Display Order",
        description: "Drag items to reorder. Place your best-selling or highest-margin items first for maximum visibility.",
        explanation: "Items displayed first get disproportionately more clicks and purchases.",
        priority: "low",
        actionLabel: "Reorder catalog",
        actionKey: "switch_tab:catalog",
      });
    }
    if (products.length >= 5) {
      suggestions.push({
        id: `catalog-emphasis-${Date.now()}`,
        type: "opportunity",
        title: "Category Emphasis",
        description: "Set emphasis levels per category to control which types of items get more visual prominence in your storefront.",
        explanation: "Category emphasis directs visitor attention to your most profitable or strategic categories.",
        priority: "low",
        actionLabel: "Adjust emphasis",
        actionKey: "switch_tab:catalog",
      });
    }
    const productsWithoutImages = products.filter((p) => !p.imageUrl).length;
    if (productsWithoutImages > 0) {
      suggestions.push({
        id: `catalog-images-${Date.now()}`,
        type: "insight",
        title: `${productsWithoutImages} Items Missing Images`,
        description: "Products with images convert 2× better. Add images to improve click-through and conversions.",
        explanation: "Visual products significantly outperform text-only listings in both clicks and sales.",
        priority: "medium",
        actionLabel: "Add images",
        actionKey: "switch_tab:catalog",
      });
    }
  }

  if (activeView === "operations") {
    if (activeDeliveryCount === 0) {
      suggestions.push({
        id: `ops-delivery-${Date.now()}`,
        type: "risk",
        title: "No Delivery Methods Active",
        description: "Customers cannot complete orders without a fulfillment method. Add shipping, pickup, or digital delivery.",
        explanation: "No delivery method means 100% cart abandonment at checkout.",
        priority: "high",
        actionLabel: "Configure delivery",
        actionKey: "switch_tab:operations",
      });
    }
    if (!hoursConfigured) {
      suggestions.push({
        id: `ops-hours-${Date.now()}`,
        type: "insight",
        title: "Set Business Hours",
        description: "Business hours help customers plan visits and improve local search ranking.",
        explanation: "Visible hours build trust and are a key factor in local search engine rankings.",
        priority: "medium",
        actionLabel: "Configure hours",
        actionKey: "switch_tab:operations",
      });
    }
    suggestions.push({
      id: `ops-zones-${Date.now()}`,
      type: "opportunity",
      title: "Shipping Zones",
      description: "Configure delivery zones with different rates for local, regional, and international customers.",
      explanation: "Zone-based shipping provides accurate costs and prevents under or overcharging customers.",
      priority: "low",
      actionLabel: "Manage zones",
      actionKey: "switch_tab:operations",
    });
  }

  if (activeView === "launch") {
    suggestions.push({
      id: `launch-campaign-${Date.now()}`,
      type: "opportunity",
      title: "Launch Campaign Generator",
      description: "Generate social posts, WhatsApp messages, and email copy to announce your store launch.",
      explanation: "A coordinated multi-channel launch drives initial traffic and builds early momentum.",
      priority: "low",
      actionLabel: "Generate campaign",
      actionKey: "tool:launch-campaign-generator",
    });
    if (storeEnabled) {
      suggestions.push({
        id: `launch-share-${Date.now()}`,
        type: "opportunity",
        title: "Share Your Store",
        description: "Your store is live! Share the URL on social media, WhatsApp groups, and email newsletters.",
        explanation: "Word-of-mouth sharing is the most cost-effective way to drive early store traffic.",
        priority: "low",
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: `healthy-${Date.now()}`,
      type: "opportunity",
      title: "Store Health",
      description: `${products.length + services.length} catalog items, ${testimonials.length} testimonials. Your store is looking good!`,
      explanation: "Your store has a solid foundation — continue optimizing for conversion and traffic growth.",
      priority: "low",
    });
  }

  return suggestions;
}

function buildStoreTools(): AiTool[] {
  return [
    {
      id: "hero-copy-generator",
      name: "Hero Copy Generator",
      description: "Generate a compelling hero headline, subheadline, offer ribbon text, and CTA for your storefront.",
      icon: "analysis",
      category: "generate",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const storeName = d.storeName || "Your Store";
        const products = (d.products ?? []) as Record<string, unknown>[];
        const services = (d.services ?? []) as Record<string, unknown>[];
        const tagline = d.businessTagline || "";
        const description = d.businessDescription || "";
        const totalItems = products.length + services.length;

        const categories = [...new Set([
          ...products.map((p) => p.category as string).filter(Boolean),
          ...services.map((s) => (s.category as string) || "Service").filter(Boolean),
        ])].slice(0, 3);

        const categoryStr = categories.length > 0 ? categories.join(", ") : "products and services";

        const headlines = [
          `${storeName} — ${tagline || "Where Quality Meets Convenience"}`,
          `Discover ${categoryStr} from ${storeName}`,
          `Your go-to for ${categoryStr}`,
        ];
        const subheadlines = [
          description || `Browse ${totalItems} curated ${categoryStr}. Book or buy online in seconds.`,
          `${totalItems > 0 ? `${totalItems} items` : "Everything you need"} — available online, anytime.`,
          `Premium ${categoryStr} delivered to you. No fuss, just results.`,
        ];
        const offerRibbons = [
          "🎉 Now Open Online — Shop Today",
          "✨ New Arrivals Just Added",
          "🔥 Limited Time: Free Consultation on First Order",
        ];
        const ctas = [
          "Shop Now",
          "Book Today",
          "Explore Collection",
          "Get Started",
        ];

        return {
          summary: `Generated ${headlines.length} headline options, ${subheadlines.length} subheadlines, ${offerRibbons.length} ribbon options, and ${ctas.length} CTAs for ${storeName}.`,
          headlines,
          subheadlines,
          offerRibbons,
          ctas,
          recommendation: {
            headline: headlines[0],
            subheadline: subheadlines[0],
            offerRibbon: offerRibbons[0],
            cta: ctas[0],
          },
          tip: "Use the recommended combination for maximum impact, or mix and match from the options above. Update these in Design → Appearance → Hero section.",
        };
      },
    },
    {
      id: "storefront-model-advisor",
      name: "Storefront Model Advisor",
      description: "Get a personalized theme, layout, and storefront model recommendation based on your business type and catalog.",
      icon: "detect",
      category: "analyze",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const products = (d.products ?? []) as Record<string, unknown>[];
        const services = (d.services ?? []) as Record<string, unknown>[];
        const storeName = d.storeName || "Your Store";

        const serviceCount = services.length;
        const productCount = products.length;
        const totalItems = serviceCount + productCount;

        const isServiceHeavy = serviceCount > productCount;
        const hasMultipleCategories = new Set([
          ...products.map((p) => p.category as string).filter(Boolean),
          ...services.map((s) => (s.category as string)).filter(Boolean),
        ]).size > 2;

        let modelType = "hybrid";
        let modelDescription = "";
        let themeRecommendation = "default";
        let themeReason = "";
        let layoutTips: string[] = [];

        if (totalItems === 0) {
          modelType = "not-configured";
          modelDescription = "Add products or services first to get a storefront model recommendation.";
        } else if (isServiceHeavy && serviceCount >= 3) {
          modelType = "service-booking";
          modelDescription = `With ${serviceCount} services, your store is best positioned as a service booking platform. Customers browse services and book directly.`;
          themeRecommendation = "elegant";
          themeReason = "The Elegant theme conveys professionalism and trust — ideal for service businesses.";
          layoutTips = [
            "Place your top 3 services in the Featured section",
            "Add testimonials prominently — service buyers rely heavily on social proof",
            "Ensure your business hours are visible — customers want to know availability",
            "Include a clear CTA like 'Book a Consultation' or 'Schedule Now'",
          ];
        } else if (productCount >= 5 && hasMultipleCategories) {
          modelType = "retail-catalog";
          modelDescription = `With ${productCount} products across multiple categories, your store is a full retail catalog. Category navigation is critical.`;
          themeRecommendation = "bold";
          themeReason = "The Bold theme uses strong visual hierarchy perfect for product-first retail stores.";
          layoutTips = [
            "Enable the Categories section for easy navigation",
            "Feature your bestsellers or new arrivals prominently",
            "Add a promotional banner to highlight limited-time offers",
            "Ensure product images are high quality — visual products need great imagery",
          ];
        } else if (productCount > 0 && serviceCount > 0) {
          modelType = "hybrid";
          modelDescription = "Your store mixes products and services — a hybrid model that requires clear section organization.";
          themeRecommendation = "fresh";
          themeReason = "The Fresh theme's clean, modern aesthetic works well for hybrid service/product stores.";
          layoutTips = [
            "Separate services and products clearly in your catalog",
            "Consider featuring one of each type in your hero section",
            "Use a ribbon to announce what's new or what's popular",
            "FAQ section can address common questions about both product orders and service bookings",
          ];
        } else {
          modelType = "boutique";
          modelDescription = "A small, curated catalog suggests a boutique approach — focus on quality over quantity.";
          themeRecommendation = "minimal";
          themeReason = "The Minimal theme's clean aesthetic positions small catalogs as premium and curated.";
          layoutTips = [
            "Focus on storytelling in your hero section — quality items need context",
            "Add detailed descriptions to each item",
            "Gather and display testimonials — social proof matters more for boutique stores",
          ];
        }

        return {
          summary: `Storefront model recommendation for "${storeName}": ${modelType.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())}.`,
          modelType,
          modelDescription,
          themeRecommendation,
          themeReason,
          layoutTips,
          catalogStats: { serviceCount, productCount, totalItems },
        };
      },
    },
    {
      id: "featured-products-advisor",
      name: "Featured Products Advisor",
      description: "Recommend which products or services to feature based on demand, variety, and launch goals.",
      icon: "score",
      category: "analyze",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const products = (d.products ?? []) as Record<string, unknown>[];
        const services = (d.services ?? []) as Record<string, unknown>[];

        type CatalogItem = Record<string, unknown> & { _type: string };
        const allItems: CatalogItem[] = [
          ...products.map((p) => ({ ...p, _type: "product" } as CatalogItem)),
          ...services.map((s) => ({ ...s, _type: "service" } as CatalogItem)),
        ];

        if (allItems.length === 0) {
          return {
            summary: "No items found. Add products or services first to get featured item recommendations.",
            recommendations: [],
          };
        }

        const pricedItems = allItems.filter((i) => i["price"] && (i["price"] as number) > 0);
        const prices = pricedItems.map((i) => i["price"] as number);
        const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

        const recommendations: { id: string; name: string; reason: string; priority: string; badge?: string }[] = [];

        const highValue = pricedItems.filter((i) => (i["price"] as number) >= avgPrice * 1.2).slice(0, 2);
        for (const item of highValue) {
          recommendations.push({
            id: item["id"] as string,
            name: item["name"] as string,
            reason: `Premium pricing ($${(item["price"] as number).toFixed(2)}) — feature it as your anchor product to anchor the price perception of cheaper items.`,
            priority: "high",
            badge: "Premium",
          });
        }

        const withImages = allItems.filter((i) => i["imageUrl"]).slice(0, 2);
        for (const item of withImages) {
          if (!recommendations.find((r) => r.id === (item["id"] as string))) {
            recommendations.push({
              id: item["id"] as string,
              name: item["name"] as string,
              reason: "Has a product image — visual items perform significantly better in Featured sections.",
              priority: "medium",
              badge: "Visual",
            });
          }
        }

        const withDesc = allItems.filter((i) => i["description"] && (i["description"] as string).length > 50).slice(0, 2);
        for (const item of withDesc) {
          if (!recommendations.find((r) => r.id === (item["id"] as string))) {
            recommendations.push({
              id: item["id"] as string,
              name: item["name"] as string,
              reason: "Has a detailed description — well-described items convert better when featured.",
              priority: "low",
              badge: "Well Described",
            });
          }
        }

        if (recommendations.length === 0 && allItems.length > 0) {
          const first = allItems.slice(0, 3);
          for (const item of first) {
            recommendations.push({
              id: item["id"] as string,
              name: item["name"] as string,
              reason: "Consider adding images and descriptions to maximize featured item impact.",
              priority: "low",
            });
          }
        }

        return {
          summary: `Analyzed ${allItems.length} catalog items. ${recommendations.length} featured item recommendation${recommendations.length !== 1 ? "s" : ""} generated.`,
          recommendations: recommendations.slice(0, 4),
          tip: "Featured items appear prominently at the top of your storefront. Choose items that represent your brand best and have the strongest visual appeal.",
          totalItems: allItems.length,
        };
      },
    },
    {
      id: "faq-generator",
      name: "FAQ Generator",
      description: "Generate relevant FAQ entries based on your products, services, policies, and business type.",
      icon: "analysis",
      category: "generate",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const products = (d.products ?? []) as Record<string, unknown>[];
        const services = (d.services ?? []) as Record<string, unknown>[];
        const storeName = d.storeName || "Your Store";
        const activeDelivery = d.activeDeliveryCount ?? 0;

        const faqs: { question: string; answer: string; category: string }[] = [];

        if (services.length > 0) {
          faqs.push({
            question: "How do I book a service?",
            answer: `Booking is easy — browse our services on the storefront, select the one you want, and click "Book Now". You'll be guided through selecting your preferred time and completing the booking.`,
            category: "Bookings",
          });
          faqs.push({
            question: "Can I reschedule or cancel my booking?",
            answer: "Yes, you can reschedule or cancel your booking up to 24 hours before your appointment. Please contact us directly for last-minute changes.",
            category: "Bookings",
          });
        }

        if (products.length > 0) {
          faqs.push({
            question: "What payment methods do you accept?",
            answer: "We accept all major credit and debit cards, as well as online payment methods. Payment is processed securely at checkout.",
            category: "Payments",
          });
        }

        if (activeDelivery > 0) {
          faqs.push({
            question: "How long does delivery take?",
            answer: "Delivery times vary by location and method. Standard delivery typically takes 3-5 business days. Express options may be available at checkout.",
            category: "Delivery",
          });
          faqs.push({
            question: "Do you offer local pickup?",
            answer: "Yes, local pickup is available. Select this option at checkout and we'll let you know when your order is ready.",
            category: "Delivery",
          });
        }

        faqs.push({
          question: `What makes ${storeName} different?`,
          answer: `We pride ourselves on quality and customer satisfaction. Every item in our catalog is carefully selected and we're committed to providing an excellent experience from browsing to delivery.`,
          category: "About",
        });

        faqs.push({
          question: "How can I contact you?",
          answer: "You can reach us through the contact section on our storefront, or message us directly via the contact details listed on our page. We typically respond within 1 business day.",
          category: "Support",
        });

        faqs.push({
          question: "What is your refund policy?",
          answer: "We offer refunds within 7 days of purchase for items in their original condition. Services can be cancelled up to 24 hours before the scheduled time. Please contact us to initiate a refund.",
          category: "Refunds",
        });

        return {
          summary: `Generated ${faqs.length} FAQ entries for "${storeName}" covering bookings, payments, delivery, and support.`,
          faqs,
          instruction: "Copy these FAQs into your FAQ Manager in the Merchandising tab. You can edit and customize each answer to match your specific policies.",
        };
      },
    },
    {
      id: "seo-generator",
      name: "SEO Metadata Generator",
      description: "Generate an optimized meta title, meta description, and keyword strategy for your storefront.",
      icon: "detect",
      category: "generate",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const products = (d.products ?? []) as Record<string, unknown>[];
        const services = (d.services ?? []) as Record<string, unknown>[];
        const storeName = d.storeName || "Your Store";
        const tagline = d.businessTagline || "";

        const categories = [...new Set([
          ...products.map((p) => p.category as string).filter(Boolean),
          ...services.map((s) => (s.category as string)).filter(Boolean),
        ])].slice(0, 3);

        const primaryCategory = categories[0] || "Products & Services";
        const totalItems = products.length + services.length;

        const metaTitleOptions = [
          `${storeName} — ${primaryCategory} Online`,
          `${storeName} | Shop ${primaryCategory}`,
          tagline ? `${storeName} — ${tagline}` : `${storeName} | ${totalItems > 0 ? `${totalItems} Items` : primaryCategory}`,
        ].map((t) => t.slice(0, 60));

        const metaDescOptions = [
          `Browse ${totalItems > 0 ? totalItems : ""} ${primaryCategory} at ${storeName}. Book online, buy instantly, delivered to you.`.slice(0, 160),
          `${storeName} offers ${categories.join(", ") || primaryCategory}. Discover our catalog and order online today.`.slice(0, 160),
          `Shop ${primaryCategory} from ${storeName}. ${tagline || "Quality products and services available online."}`.slice(0, 160),
        ];

        const keywords = [
          storeName.toLowerCase(),
          ...categories.map((c) => c.toLowerCase()),
          "buy online",
          "book online",
          "local business",
        ];

        const issues: { field: string; issue: string; suggestion: string }[] = [];
        if (products.some((p) => !p.description)) {
          issues.push({ field: "Product Descriptions", issue: "Some products lack descriptions", suggestion: "Add at least 2 sentences per product for better indexing." });
        }
        if (!d.hasHeroImage) {
          issues.push({ field: "Hero Image", issue: "No OG image set for social sharing", suggestion: "Upload a 1200×630px image to improve social share previews." });
        }

        return {
          summary: `Generated SEO metadata for "${storeName}" targeting "${primaryCategory}".`,
          metaTitleOptions,
          metaDescOptions,
          recommendation: {
            metaTitle: metaTitleOptions[0],
            metaDescription: metaDescOptions[0],
          },
          keywords,
          issues,
          instruction: "Apply the recommended meta title and description in Merchandising → SEO section. Choose options that best describe your business.",
        };
      },
    },
    {
      id: "trust-copy-generator",
      name: "Trust Copy Generator",
      description: "Generate trust badges, guarantee copy, and social proof language to add to your storefront.",
      icon: "analysis",
      category: "generate",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const storeName = d.storeName || "Your Store";
        const testimonials = (d.testimonials ?? []) as unknown[];

        const guarantees = [
          "✅ 100% Satisfaction Guarantee",
          "🔒 Secure, Encrypted Checkout",
          "⚡ Fast, Reliable Service",
          "💬 Real Human Support",
        ];

        const trustBadges = [
          "Verified Business",
          "5-Star Rated",
          `${testimonials.length > 0 ? `${testimonials.length}+ Happy Customers` : "Trusted by Customers"}`,
          "Secure Payments",
        ];

        const socialProofCopy = [
          testimonials.length > 0
            ? `Join ${testimonials.length}+ satisfied customers who trust ${storeName}.`
            : `Join our growing community of satisfied customers.`,
          `Trusted by customers across the region. See what they're saying below.`,
          `Real results, real reviews — see why customers keep coming back.`,
        ];

        const aboutCopy = `${storeName} is committed to delivering quality ${d.businessDescription ? "— " + d.businessDescription : "products and services"}. Every order is backed by our satisfaction guarantee.`;

        return {
          summary: `Generated trust copy, guarantee statements, and social proof language for "${storeName}".`,
          guarantees,
          trustBadges,
          socialProofCopy,
          aboutCopy,
          instruction: "Add guarantee copy to your hero ribbon, trust badges in your description, and social proof copy near your testimonials section.",
        };
      },
    },
    {
      id: "launch-campaign-generator",
      name: "Launch Campaign Generator",
      description: "Generate social media posts, WhatsApp messages, and email copy to announce your store launch.",
      icon: "analysis",
      category: "generate",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const storeName = d.storeName || "Your Store";
        const products = (d.products ?? []) as Record<string, unknown>[];
        const services = (d.services ?? []) as Record<string, unknown>[];
        const totalItems = products.length + services.length;

        const socialPosts = [
          `🚀 We're officially live! ${storeName} is now open online. Browse our ${totalItems > 0 ? `${totalItems}+ items` : "products and services"} and place your first order today. Link in bio! ✨`,
          `Big news! 🎉 ${storeName} just launched online. Shop, book, and explore — all in one place. Drop a comment if you want the link! 👇`,
          `We've been working hard behind the scenes, and it's finally here. ${storeName} is now live online. Come shop with us! 🛍️`,
        ];

        const whatsappMessages = [
          `Hi! Just wanted to let you know that ${storeName} is now live online! 🎉 You can browse and shop directly at ${d.storeName ? "[your store link]" : "our store"}. Would love to see you there! 😊`,
          `Big news — ${storeName} is now online! 🚀 Easy ordering, fast response. Check it out and let me know what you think!`,
        ];

        const emailSubjectLines = [
          `We're Live! ${storeName} Is Now Online`,
          `Big News from ${storeName} — Shop Us Online`,
          `${storeName} Just Launched — Come Check It Out`,
        ];

        const emailBody = `Hi [First Name],

We're thrilled to announce that ${storeName} is now live online!

You can now browse our full catalog, book services, and place orders directly from our store — anytime, anywhere.

${totalItems > 0 ? `We have ${totalItems} items available, with more coming soon.` : "We're just getting started and have exciting things coming."}

[Your Store Link]

As always, thank you for your support. We couldn't do this without amazing customers like you.

Warmly,
${storeName}`;

        return {
          summary: `Generated launch campaign materials for "${storeName}": ${socialPosts.length} social posts, ${whatsappMessages.length} WhatsApp messages, and a launch email.`,
          socialPosts,
          whatsappMessages,
          emailSubjectLines,
          emailBody,
          tip: "Use these across your channels in the 24-48 hours around your launch for maximum impact. Personalize with your actual store link before sending.",
        };
      },
    },
    {
      id: "store-optimizer",
      name: "Store Optimizer",
      description: "Analyze your catalog, configuration, and appearance for improvement suggestions to maximize conversions.",
      icon: "analysis",
      category: "optimize",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const products = (d.products ?? []) as Record<string, unknown>[];
        const services = (d.services ?? []) as Record<string, unknown>[];
        const testimonials = (d.testimonials ?? []) as unknown[];
        const storeEnabled = d.storeEnabled ?? false;
        const hasHeroImage = d.hasHeroImage ?? false;
        const hasHeroHeadline = d.hasHeroHeadline ?? false;
        const hasHeroCta = d.hasHeroCta ?? false;
        const hasPolicies = d.hasPolicies ?? false;
        const hasMetaTitle = d.hasMetaTitle ?? false;

        const totalItems = products.length + services.length;
        const score = Math.min(100,
          (storeEnabled ? 15 : 0) +
          Math.min(20, totalItems * 4) +
          (hasHeroImage ? 12 : 0) +
          (hasHeroHeadline ? 8 : 0) +
          (hasHeroCta ? 5 : 0) +
          Math.min(18, testimonials.length * 6) +
          (hasPolicies ? 8 : 0) +
          (hasMetaTitle ? 7 : 0) +
          7
        );

        const recommendations: { title: string; description: string; priority: string; expectedImpact?: string }[] = [];
        if (!storeEnabled) recommendations.push({ title: "Enable Your Store", description: "Your store is offline. Toggle it live to start receiving visitors.", priority: "high", expectedImpact: "Critical — no traffic while offline" });
        if (totalItems === 0) recommendations.push({ title: "Add Catalog Items", description: "Add at least 3-5 products or services to give visitors a reason to stay.", priority: "high", expectedImpact: "High — empty stores have near-zero conversions" });
        if (!hasHeroHeadline || !hasHeroCta) recommendations.push({ title: "Complete Hero Section", description: "Add a headline and CTA to your hero. Use the AI Hero Copy Generator for instant results.", priority: "high", expectedImpact: "Up to 90% higher CTA click-through" });
        if (!hasHeroImage) recommendations.push({ title: "Add a Hero Image", description: "A visually appealing banner grabs attention and communicates your brand instantly.", priority: "medium", expectedImpact: "Up to 40% more engagement" });
        if (testimonials.length < 3) recommendations.push({ title: "Gather More Reviews", description: "Social proof is the #1 trust signal. Ask your best customers for testimonials.", priority: "medium", expectedImpact: "Up to 30% conversion lift" });
        if (!hasPolicies) recommendations.push({ title: "Add Store Policies", description: "Refund and privacy policies reduce purchase anxiety for first-time buyers.", priority: "medium", expectedImpact: "Lower cart abandonment" });
        if (!hasMetaTitle) recommendations.push({ title: "Configure SEO", description: "Set your meta title and description to improve search visibility.", priority: "low", expectedImpact: "Better search ranking and click-through" });

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
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const products = (d.products ?? []) as Record<string, unknown>[];
        const storeName = d.storeName || "Your Store";

        const tips: string[] = [
          "Include your primary service keyword in the store title and description.",
          "Add alt text to all product images for better image search ranking.",
          "Keep product descriptions between 100-300 words with natural keyword usage.",
          "Use structured business hours data — search engines reward consistency.",
          "Add a clear call-to-action on your storefront hero section.",
        ];

        const issues: { field: string; issue: string; suggestion: string; impact: string }[] = [];
        if (products.some((p) => !p.description || (p.description as string).length < 20)) {
          issues.push({ field: "Product Descriptions", issue: "Some products have missing or very short descriptions.", suggestion: "Write at least 2-3 sentences describing each product's benefits.", impact: "high" });
        }
        if (products.some((p) => !p.imageUrl)) {
          issues.push({ field: "Product Images", issue: "Some products are missing images.", suggestion: "Add high-quality images to every product for better engagement and SEO.", impact: "high" });
        }
        if (!d.hasMetaTitle) {
          issues.push({ field: "Meta Title", issue: "No meta title configured.", suggestion: "Use the SEO Generator tool to create an optimized title.", impact: "high" });
        }
        if (!d.hasMetaDescription) {
          issues.push({ field: "Meta Description", issue: "No meta description set.", suggestion: "A compelling description improves click-through from search results.", impact: "medium" });
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
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const products = (d.products ?? []) as Record<string, unknown>[];
        const pricedProducts = products.filter((p) => p.price && (p.price as number) > 0);

        if (pricedProducts.length === 0) {
          return {
            summary: "No priced products found. Add products with prices to get pricing insights.",
            recommendations: [{ title: "Add Product Pricing", description: "Set prices for your products to enable competitive analysis.", priority: "high" }],
          };
        }

        const prices = pricedProducts.map((p) => p.price as number);
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);

        const recommendations: { title: string; description: string; priority: string; expectedImpact?: string }[] = [];
        if (maxPrice / minPrice > 10) {
          recommendations.push({ title: "Wide Price Range", description: `Your prices span from $${minPrice.toFixed(2)} to $${maxPrice.toFixed(2)}. Consider creating distinct tiers or bundles.`, priority: "medium", expectedImpact: "Clearer value positioning" });
        }
        const freeItems = products.filter((p) => !p.price || (p.price as number) === 0);
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
        const d = (ctx.customData ?? {}) as StoreCustomData;
        const products = (d.products ?? []) as Record<string, unknown>[];
        const services = (d.services ?? []) as Record<string, unknown>[];
        const testimonials = (d.testimonials ?? []) as unknown[];
        const storeEnabled = d.storeEnabled ?? false;
        const hasHeroImage = d.hasHeroImage ?? false;
        const hasHeroHeadline = d.hasHeroHeadline ?? false;
        const hasHeroCta = d.hasHeroCta ?? false;
        const hoursConfigured = d.hoursConfigured ?? false;
        const hasPolicies = d.hasPolicies ?? false;

        const checks = [
          { label: "Store is live", passed: storeEnabled },
          { label: "Hero image set", passed: hasHeroImage },
          { label: "Hero copy complete", passed: hasHeroHeadline && hasHeroCta },
          { label: "Has catalog items", passed: products.length + services.length > 0 },
          { label: "Social proof (3+ testimonials)", passed: testimonials.length >= 3 },
          { label: "Business hours configured", passed: hoursConfigured },
          { label: "Store policies published", passed: hasPolicies },
          { label: "Multiple product categories", passed: new Set(products.map((p) => p.category as string).filter(Boolean)).size > 1 },
        ];

        const passedCount = checks.filter((c) => c.passed).length;
        const conversionScore = Math.round((passedCount / checks.length) * 100);

        const frictionPoints: { area: string; issue: string; suggestion: string; impact: string }[] = [];
        checks.filter((c) => !c.passed).forEach((c) => {
          frictionPoints.push({ area: c.label, issue: `Not configured: ${c.label}`, suggestion: "Complete this step to improve your conversion score.", impact: "medium" });
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
    useGlobalCopilot: true,
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
    hasHeroHeadline?: boolean;
    hasHeroCta?: boolean;
    hasLogo?: boolean;
    hoursConfigured?: boolean;
    storeName?: string;
    businessDescription?: string;
    businessTagline?: string;
    hasMetaTitle?: boolean;
    hasMetaDescription?: boolean;
    hasPolicies?: boolean;
    hasFaq?: boolean;
    activeDeliveryCount?: number;
    readinessScores?: StoreCustomData["readinessScores"];
    readinessItems?: StoreCustomData["readinessItems"];
    revenueSnapshot?: StoreCustomData["revenueSnapshot"];
    graphStats?: StoreCustomData["graphStats"];
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
        hasHeroHeadline: params.hasHeroHeadline,
        hasHeroCta: params.hasHeroCta,
        hasLogo: params.hasLogo,
        hoursConfigured: params.hoursConfigured,
        storeName: params.storeName,
        businessDescription: params.businessDescription,
        businessTagline: params.businessTagline,
        hasMetaTitle: params.hasMetaTitle,
        hasMetaDescription: params.hasMetaDescription,
        hasPolicies: params.hasPolicies,
        hasFaq: params.hasFaq,
        activeDeliveryCount: params.activeDeliveryCount,
        readinessScores: params.readinessScores,
        readinessItems: params.readinessItems,
        revenueSnapshot: params.revenueSnapshot,
        graphStats: params.graphStats,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'ai' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [ai.updateContext]);

  return {
    ...ai,
    aiHook: ai,
    updateStoreContext,
  };
}

export type UseStoreAiHubReturn = ReturnType<typeof useStoreAiHub>;
