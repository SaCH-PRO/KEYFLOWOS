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
import type { CrossModuleSignal } from "./use-marketing";

async function generateMarketingSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, activeView, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];

  const campaigns = (customData?.campaigns as any[]) ?? [];
  const forms = (customData?.forms as any[]) ?? [];
  const socialPosts = (customData?.socialPosts as any[]) ?? [];
  const signals = (customData?.crossModuleSignals as CrossModuleSignal[]) ?? [];

  const draftCampaigns = campaigns.filter((c) => c.status === "DRAFT");
  const sentCampaigns = campaigns.filter((c) => c.status === "SENT");
  const scheduledCampaigns = campaigns.filter((c) => c.status === "SCHEDULED");

  if (draftCampaigns.length > 3) {
    suggestions.push({
      id: `drafts-pile-${Date.now()}`,
      type: "warning",
      title: "Unsent Drafts Piling Up",
      description: `You have ${draftCampaigns.length} draft campaigns waiting. Review and send them to keep your audience engaged.`,
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

    const highPerformers = sentCampaigns.filter((c) => c.totalRecipients > 0 && (c.openCount / c.totalRecipients) > 0.3);
    if (highPerformers.length > 0) {
      suggestions.push({
        id: `high-open-${Date.now()}`,
        type: "tip",
        title: "Top Performing Campaigns",
        description: `${highPerformers.length} campaign${highPerformers.length > 1 ? "s have" : " has"} open rates above 30%. Analyze what works and replicate the pattern.`,
        priority: "low",
        actionLabel: "Analyze performance",
        actionKey: "tool:campaign-performance",
      });
    }
  }

  if (scheduledCampaigns.length > 0) {
    suggestions.push({
      id: `scheduled-${Date.now()}`,
      type: "tip",
      title: "Scheduled Campaigns",
      description: `${scheduledCampaigns.length} campaign${scheduledCampaigns.length > 1 ? "s are" : " is"} scheduled to send. Review timing for optimal engagement.`,
      priority: "low",
      actionLabel: "View campaigns",
      actionKey: "switch_tab:campaigns",
    });
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

  const draftPosts = socialPosts.filter((p: any) => p.status === "DRAFT" || p.status === "draft");
  if (draftPosts.length > 0) {
    suggestions.push({
      id: `draft-posts-${Date.now()}`,
      type: "insight",
      title: "Unpublished Social Posts",
      description: `${draftPosts.length} social post${draftPosts.length > 1 ? "s are" : " is"} still in draft. Publish or schedule them to maintain consistent content.`,
      priority: "medium",
      actionLabel: "View social",
      actionKey: "switch_tab:social",
    });
  }

  if (socialPosts.length > 0 && socialPosts.length < 5) {
    suggestions.push({
      id: `posting-freq-${Date.now()}`,
      type: "tip",
      title: "Increase Posting Frequency",
      description: "You have fewer than 5 social posts. Consistent posting helps build audience engagement and brand awareness.",
      priority: "low",
      actionLabel: "Create post",
      actionKey: "switch_tab:social",
    });
  }

  const recentSignals = signals.filter((s) => Date.now() - s.timestamp < 300_000);
  for (const signal of recentSignals.slice(0, 3)) {
    if (signal.type === "contacts_imported") {
      suggestions.push({
        id: `signal-imported-${signal.id}`,
        type: "insight",
        title: "New Contacts Imported",
        description: `${signal.data?.count ?? "Multiple"} contacts were just imported. Create a welcome campaign to engage them right away.`,
        priority: "high",
        actionLabel: "Create campaign",
        actionKey: "switch_tab:campaigns",
      });
    } else if (signal.type === "invoice_paid") {
      suggestions.push({
        id: `signal-paid-${signal.id}`,
        type: "tip",
        title: "Revenue Opportunity",
        description: "A client just paid an invoice. Consider sending a thank-you email or upsell campaign.",
        priority: "medium",
        actionLabel: "Generate content",
        actionKey: "tool:campaign-content-generator",
      });
    } else if (signal.type === "booking_created") {
      suggestions.push({
        id: `signal-booking-${signal.id}`,
        type: "tip",
        title: "New Booking Received",
        description: "A new booking was made. Send a confirmation or pre-service info campaign.",
        priority: "low",
        actionLabel: "Generate content",
        actionKey: "tool:campaign-content-generator",
      });
    }
  }

  if (activeView === "campaigns" && suggestions.filter((s) => s.actionKey?.includes("campaign")).length === 0) {
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

  if (activeView === "forms" && suggestions.filter((s) => s.actionKey?.includes("form")).length === 0) {
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

  if (activeView === "social") {
    suggestions.push({
      id: `social-advisor-${Date.now()}`,
      type: "tip",
      title: "Social Content Advisor",
      description: "Get AI recommendations for content types, posting times, and platform strategies.",
      priority: "low",
      actionLabel: "Get advice",
      actionKey: "tool:social-content-advisor",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: `healthy-${Date.now()}`,
      type: "tip",
      title: "Marketing Health",
      description: `${campaigns.length} campaigns, ${forms.length} lead forms, ${socialPosts.length} posts. Keep growing your audience with targeted campaigns.`,
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
    {
      id: "social-content-advisor",
      name: "Social Content Advisor",
      description: "Analyze posting patterns, platform coverage, and suggest optimal content strategies for social media.",
      icon: "generate",
      category: "analyze",
      requiresSelection: false,
      creditCost: 1,
      execute: async (ctx) => {
        const query = (ctx.customData?.searchQuery as string) || "analyze social media content strategy and suggest improvements";
        const result = await marketingAiCampaignContent(query, ctx.businessId);
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
    socialPosts?: unknown[];
    crossModuleSignals?: unknown[];
  }) => {
    ai.updateContext({
      businessId: params.businessId,
      activeView: params.activeView,
      selectedItemId: params.selectedItemId,
      itemCount: params.itemCount,
      customData: {
        campaigns: params.campaigns,
        forms: params.forms,
        socialPosts: params.socialPosts,
        crossModuleSignals: params.crossModuleSignals,
      },
    });
  }, [ai.updateContext]);

  return {
    ...ai,
    updateMarketingContext,
  };
}

export type UseMarketingAiHubReturn = ReturnType<typeof useMarketingAiHub>;
