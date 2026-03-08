"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";
import {
  marketingAiSearch,
  marketingAiCampaignContent,
  marketingAiPerformance,
  marketingAiAudience,
  marketingAiSubjectLines,
  marketingAiFormOptimizer,
} from "@/lib/client";

async function generateMarketingSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, activeView, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];

  const campaigns = (customData?.campaigns as any[]) ?? [];
  const forms = (customData?.forms as any[]) ?? [];

  const draftCampaigns = campaigns.filter((c) => c.status === "DRAFT");
  const sentCampaigns = campaigns.filter((c) => c.status === "SENT");

  if (draftCampaigns.length > 3) {
    suggestions.push({
      id: `drafts-pile-${Date.now()}`,
      type: "warning",
      title: "Unsent Drafts",
      description: `You have ${draftCampaigns.length} draft campaigns. Review and send them to engage your audience.`,
      priority: "high",
      actionLabel: "View drafts",
      actionKey: "filter_status:DRAFT",
    });
  }

  if (sentCampaigns.length > 0) {
    const lowOpen = sentCampaigns.filter((c) => c.totalRecipients > 0 && (c.openCount / c.totalRecipients) < 0.15);
    if (lowOpen.length > 0) {
      suggestions.push({
        id: `low-open-${Date.now()}`,
        type: "insight",
        title: "Low Open Rates Detected",
        description: `${lowOpen.length} campaign${lowOpen.length > 1 ? "s have" : " has"} open rates below 15%. Use AI Subject Line Optimizer to improve engagement.`,
        priority: "medium",
        actionLabel: "Optimize subject lines",
        actionKey: "tool:subject-line-optimizer",
      });
    }
  }

  if (forms.length > 0) {
    const inactiveForms = forms.filter((f: any) => !f.isActive);
    if (inactiveForms.length > 0) {
      suggestions.push({
        id: `inactive-forms-${Date.now()}`,
        type: "insight",
        title: "Inactive Lead Forms",
        description: `${inactiveForms.length} form${inactiveForms.length > 1 ? "s are" : " is"} currently inactive. Activate or optimize them to capture more leads.`,
        priority: "medium",
        actionLabel: "View forms",
        actionKey: "switch_tab:forms",
      });
    }
  }

  if (activeView === "campaigns") {
    suggestions.push({
      id: `content-tip-${Date.now()}`,
      type: "tip",
      title: "AI Content Generator",
      description: "Use the AI Content Generator to create compelling email copy, subject lines, and CTAs for your next campaign.",
      priority: "low",
      actionLabel: "Generate content",
      actionKey: "tool:campaign-content-generator",
    });
  }

  if (activeView === "forms") {
    suggestions.push({
      id: `form-optimize-${Date.now()}`,
      type: "tip",
      title: "Optimize Your Forms",
      description: "AI can analyze your lead form fields and suggest improvements to boost conversion rates.",
      priority: "low",
      actionLabel: "Optimize forms",
      actionKey: "tool:lead-form-optimizer",
    });
  }

  if (activeView === "insights") {
    suggestions.push({
      id: `performance-tip-${Date.now()}`,
      type: "insight",
      title: "Campaign Performance Analysis",
      description: "Get AI-powered analysis of your campaign performance, engagement trends, and improvement recommendations.",
      priority: "medium",
      actionLabel: "Analyze performance",
      actionKey: "tool:campaign-performance",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: `healthy-${Date.now()}`,
      type: "tip",
      title: "Marketing Health",
      description: `${campaigns.length} campaigns, ${forms.length} lead forms. Keep growing your audience with targeted campaigns.`,
      priority: "low",
    });
  }

  return suggestions;
}

function buildMarketingTools(): AiTool[] {
  return [
    {
      id: "marketing-nl-search",
      name: "Natural Language Search",
      description: "Search campaigns and lead forms using natural language — e.g. 'show sent campaigns' or 'forms with most submissions'.",
      icon: "default",
      category: "analyze",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const query = (ctx.customData?.searchQuery as string) || "show all campaigns";
        const result = await marketingAiSearch(query, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "campaign-content-generator",
      name: "Campaign Content Generator",
      description: "Generate email subject lines, body content, and CTAs based on your business context and audience.",
      icon: "generate",
      category: "generate",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const query = (ctx.customData?.searchQuery as string) || "generate engaging email campaign content";
        const result = await marketingAiCampaignContent(query, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "campaign-performance",
      name: "Campaign Performance Analyzer",
      description: "Analyze open rates, click rates, send patterns, and get suggestions to improve engagement.",
      icon: "revenue",
      category: "analyze",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const query = (ctx.customData?.searchQuery as string) || "analyze campaign performance";
        const result = await marketingAiPerformance(query, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "audience-advisor",
      name: "Audience Segment Advisor",
      description: "Analyze CRM contacts to recommend optimal audience segments for your campaigns.",
      icon: "score",
      category: "analyze",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const query = (ctx.customData?.searchQuery as string) || "recommend audience segments";
        const result = await marketingAiAudience(query, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "subject-line-optimizer",
      name: "Subject Line Optimizer",
      description: "Generate and compare subject line variations with predicted performance scores.",
      icon: "analysis",
      category: "generate",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const query = (ctx.customData?.searchQuery as string) || "optimize subject line for better open rates";
        const result = await marketingAiSubjectLines(query, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "lead-form-optimizer",
      name: "Lead Form Optimizer",
      description: "Analyze form conversion rates, suggest field optimizations, and recommend improvements.",
      icon: "detect",
      category: "optimize",
      requiresSelection: false,
      creditCost: 2,
      execute: async (ctx) => {
        const query = (ctx.customData?.searchQuery as string) || "analyze lead form conversion";
        const result = await marketingAiFormOptimizer(query, ctx.businessId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
  ];
}

export function useMarketingAiHub() {
  const tools = useMemo(() => buildMarketingTools(), []);

  const ai = useModuleAi({
    moduleId: "marketing",
    moduleName: "Marketing",
    generateSuggestions: generateMarketingSuggestions,
    tools,
    executeAction: async (actionKey, context) => {
      if (actionKey.startsWith("tool:")) {
        const toolId = actionKey.replace("tool:", "");
        const tool = tools.find((t) => t.id === toolId);
        if (tool) await tool.execute(context);
      }
    },
  });

  const updateMarketingContext = useCallback((params: {
    businessId: string;
    activeView: string;
    selectedItemId?: string;
    itemCount?: number;
    campaigns?: unknown[];
    forms?: unknown[];
  }) => {
    ai.updateContext({
      businessId: params.businessId,
      activeView: params.activeView,
      selectedItemId: params.selectedItemId,
      itemCount: params.itemCount,
      customData: {
        campaigns: params.campaigns,
        forms: params.forms,
      },
    });
  }, [ai.updateContext]);

  return {
    ...ai,
    updateMarketingContext,
  };
}

export type UseMarketingAiHubReturn = ReturnType<typeof useMarketingAiHub>;
