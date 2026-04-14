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
import type { EmailCampaign, LeadForm, SocialPost } from "@/lib/client";
import type { CrossModuleSignal } from "./use-marketing";

async function generateMarketingSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, activeView, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];

  const campaigns = (customData?.campaigns as EmailCampaign[]) ?? [];
  const forms = (customData?.forms as LeadForm[]) ?? [];
  const socialPosts = (customData?.socialPosts as SocialPost[]) ?? [];
  const signals = (customData?.crossModuleSignals as CrossModuleSignal[]) ?? [];

  const draftCampaigns = campaigns.filter((c) => c.status === "DRAFT");
  const sentCampaigns = campaigns.filter((c) => c.status === "SENT");
  const scheduledCampaigns = campaigns.filter((c) => c.status === "SCHEDULED");

  if (draftCampaigns.length > 3) {
    suggestions.push({
      id: `drafts-pile-${Date.now()}`,
      type: "risk",
      title: "Unsent Drafts Piling Up",
      description: `You have ${draftCampaigns.length} draft campaigns waiting. Review and send them to keep your audience engaged.`,
      explanation: "Stale drafts represent missed engagement opportunities and indicate workflow bottlenecks.",
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
        explanation: "Open rates below 15% suggest subject lines or send times need optimization.",
        priority: "medium",
        actionLabel: "Optimize subject lines",
        actionKey: "tool:subject-line-optimizer",
      });
    }

    const highPerformers = sentCampaigns.filter((c) => c.totalRecipients > 0 && (c.openCount / c.totalRecipients) > 0.3);
    if (highPerformers.length > 0) {
      suggestions.push({
        id: `high-open-${Date.now()}`,
        type: "opportunity",
        title: "Top Performing Campaigns",
        description: `${highPerformers.length} campaign${highPerformers.length > 1 ? "s have" : " has"} open rates above 30%. Analyze what works and replicate the pattern.`,
        explanation: "High-performing campaigns reveal winning patterns you can replicate across future sends.",
        priority: "low",
        actionLabel: "Analyze performance",
        actionKey: "tool:campaign-performance",
      });
    }
  }

  if (scheduledCampaigns.length > 0) {
    suggestions.push({
      id: `scheduled-${Date.now()}`,
      type: "opportunity",
      title: "Scheduled Campaigns",
      description: `${scheduledCampaigns.length} campaign${scheduledCampaigns.length > 1 ? "s are" : " is"} scheduled to send. Review timing for optimal engagement.`,
      explanation: "Reviewing scheduled sends ensures they align with audience time zones and avoid conflicts.",
      priority: "low",
      actionLabel: "View calendar",
      actionKey: "switch_tab:calendar",
    });
  }

  if (forms.length > 0) {
    const inactiveForms = forms.filter((f) => !f.isActive);
    if (inactiveForms.length > 0) {
      suggestions.push({
        id: `inactive-forms-${Date.now()}`,
        type: "insight",
        title: "Inactive Lead Forms",
        description: `${inactiveForms.length} form${inactiveForms.length > 1 ? "s are" : " is"} currently inactive. Activate or optimize them to capture more leads.`,
        explanation: "Inactive forms mean lost lead capture opportunities on your website and landing pages.",
        priority: "medium",
        actionLabel: "View forms",
        actionKey: "switch_tab:audience",
      });
    }
  }

  const draftPosts = socialPosts.filter((p) => p.status === "DRAFT" || p.status === "draft");
  if (draftPosts.length > 0) {
    suggestions.push({
      id: `draft-posts-${Date.now()}`,
      type: "insight",
      title: "Unpublished Social Posts",
      description: `${draftPosts.length} social post${draftPosts.length > 1 ? "s are" : " is"} still in draft. Publish or schedule them to maintain consistent content.`,
      explanation: "Consistent posting maintains audience engagement and strengthens brand visibility.",
      priority: "medium",
      actionLabel: "View posts",
      actionKey: "switch_tab:create",
    });
  }

  if (socialPosts.length > 0 && socialPosts.length < 5) {
    suggestions.push({
      id: `posting-freq-${Date.now()}`,
      type: "opportunity",
      title: "Increase Posting Frequency",
      description: "You have fewer than 5 social posts. Consistent posting helps build audience engagement and brand awareness.",
      explanation: "Regular posting cadence trains algorithms to favor your content and keeps your brand top-of-mind.",
      priority: "low",
      actionLabel: "Create post",
      actionKey: "switch_tab:create",
    });
  }

  const pulse = customData?.businessPulse as { pipeline?: { contactsGoingCold?: number; newThisWeek?: number; leads?: number; totalContacts?: number }; financial?: { revenueGrowthPct?: number; topServices?: { name: string }[]; revenueAtRisk?: number; totalCollected?: number; avgClientValue?: number }; contactCount?: number } | undefined;

  if (pulse?.pipeline) {
    const { contactsGoingCold, newThisWeek, leads, totalContacts } = pulse.pipeline;
    if (contactsGoingCold && contactsGoingCold > 0) {
      suggestions.push({
        id: `cold-contacts-${Date.now()}`,
        type: "risk",
        title: "Contacts Going Cold",
        description: `${contactsGoingCold} contact${contactsGoingCold > 1 ? "s are" : " is"} going cold. Create a re-engagement email campaign to win them back before they're lost.`,
        explanation: "Re-engaging cold contacts is 5–25× cheaper than acquiring new ones.",
        priority: "high",
        actionLabel: "Create win-back campaign",
        actionKey: "tool:campaign-content-generator",
      });
    }
    if (newThisWeek && newThisWeek > 2) {
      suggestions.push({
        id: `new-contacts-week-${Date.now()}`,
        type: "insight",
        title: "Growing Audience",
        description: `${newThisWeek} new contacts this week. Welcome them with an introductory campaign or social post showcasing your best work.`,
        explanation: "First impressions drive long-term engagement — welcome sequences boost retention.",
        priority: "medium",
        actionLabel: "Create welcome content",
        actionKey: "tool:campaign-content-generator",
      });
    }
    if (leads && totalContacts && totalContacts > 0 && (leads / totalContacts) > 0.4) {
      suggestions.push({
        id: `lead-nurture-${Date.now()}`,
        type: "insight",
        title: "Lead Nurture Opportunity",
        description: `${Math.round((leads / totalContacts) * 100)}% of your contacts are still leads. Create a nurture sequence to convert them into paying clients.`,
        explanation: "A high lead-to-contact ratio means untapped revenue potential in your existing pipeline.",
        priority: "medium",
        actionLabel: "Build nurture campaign",
        actionKey: "tool:campaign-content-generator",
      });
    }
  }

  if (pulse?.financial) {
    const { topServices, revenueAtRisk, revenueGrowthPct } = pulse.financial;
    if (topServices && topServices.length > 0) {
      suggestions.push({
        id: `promote-service-${Date.now()}`,
        type: "opportunity",
        title: `Promote "${topServices[0].name}"`,
        description: `Your top-earning service deserves spotlight content. Create a social post or campaign highlighting what makes it special.`,
        explanation: "Promoting proven services amplifies what already works and attracts similar high-value clients.",
        priority: "low",
        actionLabel: "Create content",
        actionKey: "tool:campaign-content-generator",
      });
    }
    if (revenueAtRisk && revenueAtRisk > 0) {
      suggestions.push({
        id: `revenue-risk-${Date.now()}`,
        type: "risk",
        title: "Revenue at Risk",
        description: `You have revenue at risk from overdue payments. Send a friendly payment reminder campaign to recover outstanding amounts.`,
        explanation: "Combining marketing reach with payment recovery increases collection rates significantly.",
        priority: "high",
        actionLabel: "Create reminder",
        actionKey: "tool:campaign-content-generator",
      });
    }
    if (revenueGrowthPct !== undefined && revenueGrowthPct > 10) {
      suggestions.push({
        id: `growth-story-${Date.now()}`,
        type: "opportunity",
        title: "Share Your Growth Story",
        description: `Revenue is up ${Math.round(revenueGrowthPct)}%. Share a milestone post to build trust and attract new clients.`,
        explanation: "Sharing success milestones builds social proof and attracts clients who value growth.",
        priority: "low",
        actionLabel: "Create post",
        actionKey: "switch_tab:create",
      });
    }
  }

  const recentSignals = signals.filter((s) => Date.now() - s.timestamp < 300_000);
  for (const signal of recentSignals.slice(0, 3)) {
    if (signal.type === "contacts_imported") {
      suggestions.push({
        id: `signal-imported-${signal.id}`,
        type: "insight",
        title: "New Contacts Imported",
        description: `${signal.data?.count ?? "Multiple"} contacts were just imported. Create a welcome campaign to engage them right away.`,
        explanation: "Immediate welcome emails have the highest open rates of any email type.",
        priority: "high",
        actionLabel: "Create campaign",
        actionKey: "switch_tab:create",
      });
    } else if (signal.type === "invoice_paid") {
      suggestions.push({
        id: `signal-paid-${signal.id}`,
        type: "opportunity",
        title: "Revenue Opportunity",
        description: "A client just paid an invoice. Consider sending a thank-you email or upsell campaign.",
        explanation: "Post-purchase follow-up increases repeat business and lifetime value.",
        priority: "medium",
        actionLabel: "Generate content",
        actionKey: "tool:campaign-content-generator",
      });
    } else if (signal.type === "booking_created") {
      suggestions.push({
        id: `signal-booking-${signal.id}`,
        type: "opportunity",
        title: "New Booking Received",
        description: "A new booking was made. Send a confirmation or pre-service info campaign.",
        explanation: "Pre-service communication reduces no-shows and improves client satisfaction.",
        priority: "low",
        actionLabel: "Generate content",
        actionKey: "tool:campaign-content-generator",
      });
    }
  }

  if ((activeView === "campaigns" || activeView === "create") && suggestions.filter((s) => s.actionKey?.includes("campaign")).length === 0) {
    suggestions.push({
      id: `content-tip-${Date.now()}`,
      type: "opportunity",
      title: "AI Content Generator",
      description: "Use the AI Content Generator to create compelling email copy, subject lines, and CTAs for your next campaign.",
      explanation: "AI-generated content saves hours of writing and optimizes for engagement metrics.",
      priority: "low",
      actionLabel: "Generate content",
      actionKey: "tool:campaign-content-generator",
    });
  }

  if ((activeView === "forms" || activeView === "audiences" || activeView === "audience") && suggestions.filter((s) => s.actionKey?.includes("form")).length === 0) {
    suggestions.push({
      id: `form-optimize-${Date.now()}`,
      type: "opportunity",
      title: "Optimize Your Forms",
      description: "AI can analyze your lead form fields and suggest improvements to boost conversion rates.",
      explanation: "Form field optimization can increase conversion rates by 20–50% with minimal effort.",
      priority: "low",
      actionLabel: "Optimize forms",
      actionKey: "tool:lead-form-optimizer",
    });
  }

  if (activeView === "insights" || activeView === "performance") {
    suggestions.push({
      id: `performance-tip-${Date.now()}`,
      type: "insight",
      title: "Campaign Performance Analysis",
      description: "Get AI-powered analysis of your campaign performance, engagement trends, and improvement recommendations.",
      explanation: "Performance analysis identifies which content types, times, and audiences drive the best results.",
      priority: "medium",
      actionLabel: "Analyze performance",
      actionKey: "tool:campaign-performance",
    });
  }

  if (activeView === "social" || activeView === "create") {
    suggestions.push({
      id: `social-advisor-${Date.now()}`,
      type: "opportunity",
      title: "Social Content Advisor",
      description: "Get AI recommendations for content types, posting times, and platform strategies.",
      explanation: "Strategic content advice based on your data ensures every post maximizes reach and engagement.",
      priority: "low",
      actionLabel: "Get advice",
      actionKey: "tool:social-content-advisor",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      id: `healthy-${Date.now()}`,
      type: "opportunity",
      title: "Marketing Health",
      description: `${campaigns.length} campaigns, ${forms.length} lead forms, ${socialPosts.length} posts. Keep growing your audience with targeted campaigns.`,
      explanation: "Your marketing foundation is solid — focus on consistency and data-driven optimization.",
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
    businessPulse?: unknown;
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
        businessPulse: params.businessPulse,
      },
    });
  }, [ai.updateContext]);

  return {
    ...ai,
    aiHook: ai,
    updateMarketingContext,
  };
}

export type UseMarketingAiHubReturn = ReturnType<typeof useMarketingAiHub>;
