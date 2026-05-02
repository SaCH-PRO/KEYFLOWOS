"use client";

import { useCallback, useMemo, useState } from "react";
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
  commerceAiCollectionsScore,
  commerceAiChurnRisk,
  commerceAiRevenueJourney,
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
        type: "risk",
        title: "Overdue Payments",
        description: `You have $${stats.overdueAmount.toLocaleString()} in overdue invoices. Consider sending payment reminders.`,
        explanation: "Overdue invoices reduce cash flow predictability and may indicate client payment risk.",
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
        explanation: "Low conversion rates mean potential revenue is being lost at the proposal stage.",
        priority: "medium",
        actionLabel: "View quotes",
        actionKey: "switch_tab:quotes",
      });
    }

    if (stats.outstandingAmount > stats.totalRevenue * 0.5) {
      suggestions.push({
        id: `outstanding-${Date.now()}`,
        type: "risk",
        title: "High Outstanding Balance",
        description: `Outstanding amount ($${stats.outstandingAmount.toLocaleString()}) is over 50% of total revenue. Focus on collections.`,
        explanation: "A high outstanding-to-revenue ratio signals cash flow pressure that could limit operations.",
        priority: "high",
      });
    }

    if (stats.topProducts?.length > 0) {
      const top = stats.topProducts[0];
      suggestions.push({
        id: `top-product-${Date.now()}`,
        type: "opportunity",
        title: "Top Performer",
        description: `"${top.name}" is your best seller with $${top.revenue.toLocaleString()} revenue from ${top.count} sales.`,
        explanation: "Top performers deserve increased visibility, promotional focus, and potential upsell pairing.",
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
            explanation: "Zero-sale products may need better descriptions, images, pricing, or promotion.",
            priority: "medium",
            actionLabel: "Run Health Scan",
            actionKey: "tool:product-health-scan",
          });
        }
      }

      if (stats.productCount > 5) {
        suggestions.push({
          id: `pricing-review-${Date.now()}`,
          type: "opportunity",
          title: "Pricing Review",
          description: `With ${stats.productCount} products, periodic pricing reviews can optimize revenue. Use AI Pricing Advisor on individual products.`,
          explanation: "Regular pricing analysis ensures your margins stay healthy as costs and demand change.",
          priority: "low",
        });
      }
    }

    if (activeView === "invoices" || activeView === "payments") {
      if (stats.invoiceStatusBreakdown?.SENT) {
        const sent = stats.invoiceStatusBreakdown.SENT;
        suggestions.push({
          id: `sent-invoices-${Date.now()}`,
          type: "action",
          title: "Pending Invoices",
          description: `${sent.count} invoices totaling $${sent.total.toLocaleString()} are awaiting payment.`,
          explanation: "Timely reminders significantly improve collection rates and reduce days-sales-outstanding.",
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
          explanation: "Structured recovery plans prioritize high-value invoices and optimize follow-up timing.",
          priority: "high",
          actionLabel: "Generate plan",
          actionKey: "tool:overdue-recovery",
        });
      }

      if (stats.averageInvoiceValue > 0) {
        suggestions.push({
          id: `avg-invoice-${Date.now()}`,
          type: "opportunity",
          title: "Invoice Insights",
          description: `Average invoice value: $${stats.averageInvoiceValue.toLocaleString()}. Run Client Intelligence on key accounts to optimize billing.`,
          explanation: "Understanding invoice value distribution helps identify upsell and bundling opportunities.",
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
          explanation: "Quote analysis reveals which pricing, timing, and scope patterns win deals most often.",
          priority: "medium",
          actionLabel: "Analyze quotes",
          actionKey: "tool:quote-win-analysis",
        });
      }
    }

    if (activeView === "schedules" || activeView === "recurring") {
      suggestions.push({
        id: `churn-risk-${Date.now()}`,
        type: "risk",
        title: "Churn Risk Scanner",
        description: "Detect declining payment patterns in recurring customers before you lose revenue.",
        explanation: "Early churn detection allows proactive retention efforts before revenue is permanently lost.",
        priority: "medium",
        actionLabel: "Scan for risk",
        actionKey: "tool:churn-risk",
      });
    }

    if (activeView === "payments") {
      suggestions.push({
        id: `revenue-journey-${Date.now()}`,
        type: "insight",
        title: "Revenue Journey Analysis",
        description: "Map your Contact → Quote → Invoice → Payment funnel and find conversion drop-off points.",
        explanation: "Funnel analysis pinpoints where leads or revenue stall, enabling targeted process improvements.",
        priority: "medium",
        actionLabel: "View funnel",
        actionKey: "tool:revenue-journey",
      });
    }

    if (stats.overdueAmount > 0 && (activeView === "invoices" || activeView === "payments")) {
      suggestions.push({
        id: `collections-scoring-${Date.now()}`,
        type: "action",
        title: "Predictive Collections",
        description: `Score ${stats.invoiceStatusBreakdown?.OVERDUE?.count ?? 0} overdue invoices for recovery likelihood with AI-recommended follow-up timing.`,
        explanation: "Predictive scoring focuses your collection efforts on invoices most likely to be recovered.",
        priority: "high",
        actionLabel: "Score invoices",
        actionKey: "tool:collections-scoring",
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: `healthy-${Date.now()}`,
        type: "opportunity",
        title: "Commerce Health",
        description: `${stats.invoiceCount} invoices, ${stats.productCount} products. Revenue: $${stats.totalRevenue.toLocaleString()}.`,
        explanation: "Your commerce metrics are healthy — keep monitoring for trends and optimization opportunities.",
        priority: "low",
      });
    }

    return suggestions;
  } catch {
    return [{
      id: `error-${Date.now()}`,
      type: "risk",
      title: "Analysis Unavailable",
      description: "Could not complete commerce analysis. Try again in a moment.",
      explanation: "A temporary issue prevented data retrieval. Your data is safe — just retry.",
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
    {
      id: "collections-scoring",
      name: "Predictive Collections",
      description: "AI-scored recovery likelihood for each overdue invoice with optimal follow-up timing and channel recommendations.",
      icon: "score",
      category: "detect",
      requiresSelection: false,
      creditCost: 3,
      execute: async (ctx) => {
        const result = await commerceAiCollectionsScore(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "churn-risk",
      name: "Churn Risk Alerts",
      description: "Detect declining payment patterns and risk signals in recurring customers to prevent revenue loss.",
      icon: "overdue",
      category: "detect",
      requiresSelection: false,
      creditCost: 3,
      execute: async (ctx) => {
        const result = await commerceAiChurnRisk(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "revenue-journey",
      name: "Revenue Journey",
      description: "Analyze the full Contact → Quote → Invoice → Payment funnel to find drop-off points and optimize conversions.",
      icon: "pipeline",
      category: "analyze",
      requiresSelection: false,
      creditCost: 3,
      execute: async (ctx) => {
        const result = await commerceAiRevenueJourney(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
  ];
}

export type CopilotMode = "command" | "recommend" | "assist";

const COPILOT_MODE_CONFIG: Record<CopilotMode, { label: string; description: string; icon: string }> = {
  command: {
    label: "Command",
    description: "Execute specific commerce tools and actions directly",
    icon: "terminal",
  },
  recommend: {
    label: "Recommend",
    description: "Get proactive AI suggestions based on your data",
    icon: "lightbulb",
  },
  assist: {
    label: "Contextual Assist",
    description: "Context-aware help based on your current view",
    icon: "sparkles",
  },
};

export function useCommerceAiHub() {
  const tools = useMemo(() => buildCommerceTools(), []);

  const ai = useModuleAi({
    moduleId: "commerce",
    moduleName: "Commerce",
    generateSuggestions: generateCommerceSuggestions,
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

  const [copilotMode, setCopilotMode] = useState<CopilotMode>("command");
  const [activeView, setActiveView] = useState("");

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
    setActiveView(params.activeView);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'ai' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [ai.updateContext]);

  const contextualTools = useMemo(() => {
    if (copilotMode === "recommend") {
      return tools.filter((t) => !t.requiresSelection);
    }

    if (copilotMode === "assist") {
      if (activeView === "invoices" || activeView === "payments") {
        return tools.filter((t) => ["revenue-analysis", "cashflow-forecast", "invoice-reminder", "overdue-recovery", "client-intelligence"].includes(t.id));
      }
      if (activeView === "quotes") {
        return tools.filter((t) => ["quote-win-analysis", "pipeline-analysis", "client-intelligence"].includes(t.id));
      }
      if (activeView === "recurring") {
        return tools.filter((t) => ["cashflow-forecast", "revenue-analysis", "pricing-advisor"].includes(t.id));
      }
      return tools.slice(0, 4);
    }

    return tools;
  }, [copilotMode, tools, activeView]);

  return {
    ...ai,
    aiHook: ai,
    tools: contextualTools,
    updateCommerceContext,
    copilotMode,
    setCopilotMode,
    copilotModeConfig: COPILOT_MODE_CONFIG,
    contextualTools,
  };
}

export type UseCommerceAiHubReturn = ReturnType<typeof useCommerceAiHub>;
