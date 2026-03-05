"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";
import {
  bookingsAiSearch,
  bookingsAiScheduleOptimizer,
  bookingsAiNoShowPredictor,
  bookingsAiRevenueInsights,
  fetchBookingStats,
} from "@/lib/client";

async function generateBookingsSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, activeView } = context;
  if (!businessId) return [];

  try {
    const result = await fetchBookingStats(businessId);
    if (!result.data) return [];

    const stats = result.data;
    const suggestions: AiSuggestion[] = [];

    if ((stats.pendingCount ?? 0) > 5) {
      suggestions.push({
        id: `pending-high-${Date.now()}`,
        type: "warning",
        title: "Many Pending Bookings",
        description: `You have ${stats.pendingCount} pending bookings that need confirmation. Review and confirm to reduce no-shows.`,
        priority: "high",
        actionLabel: "View pending",
        actionKey: "filter_status:PENDING",
      });
    }

    if ((stats.cancelledCount ?? 0) > 3) {
      suggestions.push({
        id: `cancellations-${Date.now()}`,
        type: "insight",
        title: "Recent Cancellations",
        description: `${stats.cancelledCount} cancellations detected. Use AI No-Show Predictor to identify at-risk bookings.`,
        priority: "medium",
        actionLabel: "Predict no-shows",
        actionKey: "tool:no-show-predictor",
      });
    }

    if (activeView === "calendar") {
      suggestions.push({
        id: `optimize-schedule-${Date.now()}`,
        type: "tip",
        title: "Optimize Your Schedule",
        description: "AI can analyze your booking patterns and suggest ways to maximize utilization and revenue.",
        priority: "low",
        actionLabel: "Optimize",
        actionKey: "tool:schedule-optimizer",
      });
    }

    if (activeView === "insights") {
      suggestions.push({
        id: `revenue-analysis-${Date.now()}`,
        type: "insight",
        title: "Revenue Trends",
        description: "Get AI-powered analysis of your booking revenue, top services, and growth opportunities.",
        priority: "medium",
        actionLabel: "Analyze revenue",
        actionKey: "tool:revenue-insights",
      });
    }

    if (activeView === "services") {
      suggestions.push({
        id: `pricing-review-${Date.now()}`,
        type: "tip",
        title: "Service Pricing Review",
        description: "AI can help you optimize service pricing based on demand patterns and market analysis.",
        priority: "low",
        actionLabel: "Get insights",
        actionKey: "tool:revenue-insights",
      });
    }

    return suggestions;
  } catch {
    return [];
  }
}

function buildBookingsTools(): AiTool[] {
  return [
    {
      id: "schedule-optimizer",
      name: "Schedule Optimizer",
      description: "Analyze booking patterns and get recommendations to maximize utilization",
      icon: "calendar",
      category: "optimize",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const result = await bookingsAiScheduleOptimizer(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "no-show-predictor",
      name: "No-Show Predictor",
      description: "Predict which upcoming bookings are at risk of cancellation",
      icon: "alert-triangle",
      category: "detect",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const result = await bookingsAiNoShowPredictor(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "revenue-insights",
      name: "Revenue Insights",
      description: "AI-powered analysis of booking revenue, top services, and growth trends",
      icon: "trending-up",
      category: "analyze",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const result = await bookingsAiRevenueInsights(ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "bookings-nl-search",
      name: "Natural Language Search",
      description: "Search bookings using natural language — \"show me this week's confirmed bookings\"",
      icon: "search",
      category: "analyze",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const query = ctx.customData?.query as string;
        if (!query) throw new Error("No search query provided");
        const result = await bookingsAiSearch(query, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
  ];
}

export function useBookingsAiHub() {
  const tools = useMemo(() => buildBookingsTools(), []);

  const ai = useModuleAi({
    moduleId: "bookings",
    moduleName: "Bookings",
    generateSuggestions: generateBookingsSuggestions,
    tools,
    executeAction: async (actionKey, context) => {
      if (actionKey.startsWith("tool:")) {
        const toolId = actionKey.replace("tool:", "");
        const tool = tools.find((t) => t.id === toolId);
        if (tool) await tool.execute(context);
      }
    },
  });

  return ai;
}
