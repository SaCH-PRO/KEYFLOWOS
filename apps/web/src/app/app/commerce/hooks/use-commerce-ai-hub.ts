"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";
import {
  commerceAiAnalyze,
  commerceAiCashFlow,
  commerceAiInvoiceReminder,
  commerceAiPricing,
  commerceAiSearch,
  commerceAiProductHealth,
  commerceAiClientIntelligence,
  commerceAiQuoteAnalysis,
  fetchCommerceStats,
} from "@/lib/client";

async function generateCommerceSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, activeView, customData } = context;
  if (!businessId) return [];

  try {
    const result = await fetchCommerceStats(businessId);
    if (!result.data) return [];

    const stats = result.data;
    const suggestions: AiSuggestion[] = [];

    if (stats.overdueAmount > 0) {
      suggestions.push({
        id: `overdue-${Date.now()}`,
        type: "warning",
        title: "Overdue Payments",
        description: `You have $${stats.overdueAmount.toLocaleString()} in overdue invoices. Consider sending payment reminders.`,
        priority: "high",
        actionLabel: "View overdue",
        actionKey: "filter_status:overdue",
      });
    }

    if (stats.quoteConversionRate < 30) {
      suggestions.push({
        id: `conversion-${Date.now()}`,
        type: "insight",
        title: "Low Quote Conversion",
        description: `Your quote-to-invoice conversion rate is ${stats.quoteConversionRate}%. Consider following up on pending quotes.`,
        priority: "medium",
        actionLabel: "View quotes",
        actionKey: "switch_tab:quotes",
      });
    }

    if (stats.outstandingAmount > stats.totalRevenue * 0.5) {
      suggestions.push({
        id: `outstanding-${Date.now()}`,
        type: "warning",
        title: "High Outstanding Balance",
        description: `Outstanding amount ($${stats.outstandingAmount.toLocaleString()}) is over 50% of total revenue. Focus on collections.`,
        priority: "high",
      });
    }

    if (stats.topProducts?.length > 0) {
      const top = stats.topProducts[0];
      suggestions.push({
        id: `top-product-${Date.now()}`,
        type: "tip",
        title: "Top Performer",
        description: `"${top.name}" is your best seller with $${top.revenue.toLocaleString()} revenue from ${top.count} sales.`,
        priority: "low",
      });
    }

    if (activeView === "products") {
      if (stats.productCount > 0 && stats.topProducts?.length > 0) {
        const lowPerformers = stats.topProducts.filter((p: any) => p.count === 0);
        if (lowPerformers.length > 0) {
          suggestions.push({
            id: `no-sales-products-${Date.now()}`,
            type: "insight",
            title: "Products With No Sales",
            description: `${lowPerformers.length} product${lowPerformers.length > 1 ? "s have" : " has"} no sales yet. Run an AI health scan to find optimization opportunities.`,
            priority: "medium",
            actionLabel: "Run Health Scan",
            actionKey: "tool:product-health-scan",
          });
        }
      }

      if (stats.productCount > 5) {
        suggestions.push({
          id: `pricing-review-${Date.now()}`,
          type: "tip",
          title: "Pricing Review",
          description: `With ${stats.productCount} products, periodic pricing reviews can optimize revenue. Use AI Pricing Advisor on individual products.`,
          priority: "low",
        });
      }
    }

    if (activeView === "billing" || activeView === "invoices") {
      if (stats.invoiceStatusBreakdown?.SENT) {
        const sent = stats.invoiceStatusBreakdown.SENT;
        suggestions.push({
          id: `sent-invoices-${Date.now()}`,
          type: "action",
          title: "Pending Invoices",
          description: `${sent.count} invoices totaling $${sent.total.toLocaleString()} are awaiting payment.`,
          priority: "medium",
          actionLabel: "Send reminders",
          actionKey: "send_reminders:sent",
        });
      }

      if (stats.overdueAmount > 0) {
        suggestions.push({
          id: `recovery-plan-${Date.now()}`,
          type: "action",
          title: "AI Recovery Plan",
          description: `Generate an AI-powered recovery strategy for $${stats.overdueAmount.toLocaleString()} in overdue payments.`,
          priority: "high",
          actionLabel: "Generate plan",
          actionKey: "tool:overdue-recovery",
        });
      }

      if (stats.averageInvoiceValue > 0) {
        suggestions.push({
          id: `avg-invoice-${Date.now()}`,
          type: "tip",
          title: "Invoice Insights",
          description: `Average invoice value: $${stats.averageInvoiceValue.toLocaleString()}. Run Client Intelligence on key accounts to optimize billing.`,
          priority: "low",
        });
      }
    }

    if (activeView === "quotes") {
      if (stats.quoteCount > 0) {
        suggestions.push({
          id: `quote-analysis-${Date.now()}`,
          type: "insight",
          title: "Quote Win Analysis",
          description: `Analyze ${stats.quoteCount} quotes to discover conversion patterns and improvement opportunities.`,
          priority: "medium",
          actionLabel: "Analyze quotes",
          actionKey: "tool:quote-win-analysis",
        });
      }
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: `healthy-${Date.now()}`,
        type: "tip",
        title: "Commerce Health",
        description: `${stats.invoiceCount} invoices, ${stats.productCount} products. Revenue: $${stats.totalRevenue.toLocaleString()}.`,
        priority: "low",
      });
    }

    return suggestions;
  } catch {
    return [{
      id: `error-${Date.now()}`,
      type: "warning",
      title: "Analysis Unavailable",
      description: "Could not complete commerce analysis. Try again in a moment.",
      priority: "low",
    }];
  }
}

function buildCommerceTools(): AiTool[] {
  return [
    {
      id: "revenue-analysis",
      name: "Revenue Analysis",
      description: "AI-powered revenue insights including trends, top clients, growth recommendations, and a health score.",
      icon: "revenue",
      category: "analyze",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const result = await commerceAiAnalyze(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "cashflow-forecast",
      name: "Cash Flow Forecast",
      description: "Predict cash flow for the next 30, 60, and 90 days with risk analysis and collection priorities.",
      icon: "cashflow",
      category: "analyze",
      requiresSelection: false,
      creditCost: 3,
      execute: async (ctx) => {
        const result = await commerceAiCashFlow(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "product-health-scan",
      name: "Product Health Scan",
      description: "Audit all products for data quality issues — missing descriptions, no sales, stale pricing, and optimization opportunities.",
      icon: "analysis",
      category: "detect",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const result = await commerceAiProductHealth(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "client-intelligence",
      name: "Client Payment Intelligence",
      description: "Analyze a contact's payment patterns, reliability score, lifetime value, and risk assessment.",
      icon: "score",
      category: "analyze",
      requiresSelection: true,
      creditCost: 2,
      execute: async (ctx) => {
        if (!ctx.selectedItemId) throw new Error("Select a contact first");
        const result = await commerceAiClientIntelligence(ctx.selectedItemId, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "quote-win-analysis",
      name: "Quote Win Analysis",
      description: "Analyze quote conversion patterns, identify what wins deals, and get suggestions to improve close rates.",
      icon: "pipeline",
      category: "analyze",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const result = await commerceAiQuoteAnalysis(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "commerce-nl-search",
      name: "Natural Language Search",
      description: "Search products, invoices, and quotes using natural language — e.g. 'invoices over $5000' or 'products with no sales'.",
      icon: "default",
      category: "analyze",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const query = ctx.customData?.searchQuery as string || "show all recent activity";
        const result = await commerceAiSearch(query, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "invoice-reminder",
      name: "Invoice Reminder Drafter",
      description: "Generate an AI-crafted payment reminder message for a specific invoice with multiple tone options.",
      icon: "reminder",
      category: "generate",
      requiresSelection: true,
      creditCost: 1,
      execute: async (ctx) => {
        if (!ctx.selectedItemId) throw new Error("Select an invoice first");
        const result = await commerceAiInvoiceReminder(ctx.selectedItemId, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "pricing-advisor",
      name: "Pricing Advisor",
      description: "AI pricing recommendations for a product based on market positioning, history, and competitive analysis.",
      icon: "pricing",
      category: "analyze",
      requiresSelection: true,
      creditCost: 2,
      execute: async (ctx) => {
        if (!ctx.selectedItemId) throw new Error("Select a product first");
        const result = await commerceAiPricing(ctx.selectedItemId, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "pipeline-analysis",
      name: "Pipeline Analysis",
      description: "Analyze quote-to-invoice conversion rates, identify bottlenecks, and get recommendations to improve your sales pipeline.",
      icon: "pipeline",
      category: "analyze",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const stats = await fetchCommerceStats(ctx.businessId);
        if (stats.error) throw new Error(stats.error);
        if (!stats.data) throw new Error("No data available");
        const s = stats.data;
        return {
          quoteConversionRate: s.quoteConversionRate,
          quoteCount: s.quoteCount,
          invoiceCount: s.invoiceCount,
          averageInvoiceValue: s.averageInvoiceValue,
          quoteStatusBreakdown: s.quoteStatusBreakdown,
          invoiceStatusBreakdown: s.invoiceStatusBreakdown,
          topProducts: s.topProducts,
          revenueByMonth: s.revenueByMonth,
          totalRevenue: s.totalRevenue,
          outstandingAmount: s.outstandingAmount,
        };
      },
    },
    {
      id: "overdue-recovery",
      name: "Overdue Recovery",
      description: "Strategies and prioritized actions for collecting overdue payments, with estimated recovery amounts.",
      icon: "overdue",
      category: "detect",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const [statsResult, cashFlowResult] = await Promise.all([
          fetchCommerceStats(ctx.businessId),
          commerceAiCashFlow(ctx.businessId),
        ]);
        if (statsResult.error) throw new Error(statsResult.error);
        const s = statsResult.data;
        const cf = cashFlowResult.data;
        return {
          overdueAmount: s?.overdueAmount ?? 0,
          outstandingAmount: s?.outstandingAmount ?? 0,
          invoiceStatusBreakdown: s?.invoiceStatusBreakdown ?? {},
          collectionPriority: cf?.collectionPriority ?? [],
          risks: cf?.risks ?? [],
          opportunities: cf?.opportunities ?? [],
        };
      },
    },
  ];
}

export function useCommerceAiHub() {
  const tools = useMemo(() => buildCommerceTools(), []);

  const ai = useModuleAi({
    moduleId: "commerce",
    moduleName: "Commerce",
    generateSuggestions: generateCommerceSuggestions,
    tools,
  });

  const updateCommerceContext = useCallback((params: {
    businessId: string;
    activeView: string;
    selectedItemId?: string;
    itemCount?: number;
  }) => {
    ai.updateContext({
      businessId: params.businessId,
      activeView: params.activeView,
      selectedItemId: params.selectedItemId,
      itemCount: params.itemCount,
    });
  }, [ai.updateContext]);

  return {
    ...ai,
    updateCommerceContext,
  };
}

export type UseCommerceAiHubReturn = ReturnType<typeof useCommerceAiHub>;
