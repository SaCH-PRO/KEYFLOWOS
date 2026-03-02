"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";
import {
  aiAnalyzeContacts,
  aiContactSummary,
  aiLeadScore,
  aiPrepBrief,
  aiSuggestTags,
  aiChurnDetection,
  aiDataQualityScan,
  aiFindDuplicates,
  aiReengagementSuggestions,
  aiRevenueOpportunities,
  aiFollowUpDraft,
} from "@/lib/client";

async function generateCrmSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, activeView, itemCount, selectedItemId, customData } = context;
  if (!businessId) return [];

  const prompt = buildContextualPrompt(activeView, itemCount, selectedItemId, customData);

  try {
    const result = await aiAnalyzeContacts(businessId, prompt);
    if (!result.data) return [];

    const suggestions: AiSuggestion[] = [];

    if (result.data.analysis) {
      suggestions.push({
        id: `insight-${Date.now()}`,
        type: "insight",
        title: "CRM Intelligence",
        description: result.data.analysis.slice(0, 300),
        priority: "medium",
      });
    }

    if (result.data.suggestedActions?.length) {
      result.data.suggestedActions.forEach((action: any, i: number) => {
        suggestions.push({
          id: `action-${Date.now()}-${i}`,
          type: "action",
          title: action.title || "Suggested Action",
          description: action.description || "",
          priority: action.priority === "urgent" || action.priority === "high" ? "high" : "medium",
          actionLabel: getActionLabel(action.type),
          actionKey: `${action.type}:${action.contactId || ""}`,
          icon: action.type,
        });
      });
    }

    if (result.data.guidelines?.length) {
      result.data.guidelines.slice(0, 2).forEach((g: string, i: number) => {
        suggestions.push({
          id: `tip-${Date.now()}-${i}`,
          type: "tip",
          title: "Best Practice",
          description: g,
          priority: "low",
        });
      });
    }

    return suggestions;
  } catch {
    return [{
      id: `error-${Date.now()}`,
      type: "warning",
      title: "Analysis Unavailable",
      description: "Could not complete AI analysis. Try again in a moment.",
      priority: "low",
    }];
  }
}

function buildContextualPrompt(
  activeView?: string,
  itemCount?: number,
  selectedItemId?: string,
  customData?: Record<string, unknown>,
): string {
  const parts: string[] = [];

  parts.push("Analyze my CRM data and provide 3-5 specific, actionable suggestions.");

  if (activeView === "pipeline") {
    parts.push("I'm viewing the Pipeline. Focus on: contacts needing follow-up, status changes that should be made, and high-priority actions.");
  } else if (activeView === "database") {
    parts.push("I'm in the Database view. Focus on: data quality issues, missing information, and contacts that need attention.");
  } else if (activeView === "insights") {
    parts.push("I'm viewing Insights. Focus on: trends, revenue opportunities, and strategic recommendations.");
  } else if (activeView === "engage") {
    parts.push("I'm in the Engage tab. Focus on: sequence optimization, engagement gaps, and re-engagement opportunities.");
  }

  if (itemCount !== undefined) {
    parts.push(`I currently have ${itemCount} contacts.`);
  }

  if (selectedItemId) {
    parts.push(`I have a specific contact selected (ID: ${selectedItemId}). Include suggestions specific to this contact.`);
  }

  const statusFilter = customData?.statusFilter as string | undefined;
  if (statusFilter) {
    parts.push(`I'm filtering by status: ${statusFilter}.`);
  }

  parts.push("For each suggestion, include: what to do, why it matters, and which contact(s) it applies to. Be specific with names.");

  return parts.join(" ");
}

function getActionLabel(type: string): string {
  switch (type) {
    case "follow_up": return "Open contact";
    case "call": return "View contact";
    case "email": return "Open contact";
    case "send_quote": return "Create quote";
    case "payment_reminder": return "View invoices";
    case "check_in": return "Open contact";
    case "upsell": return "View contact";
    case "re_engage": return "Open contact";
    default: return "Take action";
  }
}

function buildCrmTools(): AiTool[] {
  return [
    {
      id: "contact-summary",
      name: "Contact Briefing",
      description: "Generate an AI-powered summary with sentiment, relationship health, key insights, and recommended next steps.",
      icon: "summary",
      category: "analyze",
      requiresSelection: true,
      creditCost: 1,
      execute: async (ctx) => {
        if (!ctx.selectedItemId) throw new Error("Select a contact first");
        const result = await aiContactSummary(ctx.selectedItemId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "lead-score",
      name: "Smart Lead Scoring",
      description: "AI-analyzed lead score (0-100) with factor breakdown, reasoning, and temperature label.",
      icon: "score",
      category: "analyze",
      requiresSelection: true,
      creditCost: 1,
      execute: async (ctx) => {
        if (!ctx.selectedItemId) throw new Error("Select a contact first");
        const result = await aiLeadScore(ctx.selectedItemId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "prep-brief",
      name: "Conversation Prep",
      description: "Pre-interaction preparation: talking points, icebreakers, open items, relationship signals, and things to avoid.",
      icon: "prep",
      category: "generate",
      requiresSelection: true,
      creditCost: 2,
      execute: async (ctx) => {
        if (!ctx.selectedItemId) throw new Error("Select a contact first");
        const result = await aiPrepBrief(ctx.selectedItemId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "tag-suggestions",
      name: "Smart Auto-Tags",
      description: "AI-suggested tags based on contact data, interaction patterns, and notes analysis with confidence scores.",
      icon: "tags",
      category: "generate",
      requiresSelection: true,
      creditCost: 1,
      execute: async (ctx) => {
        if (!ctx.selectedItemId) throw new Error("Select a contact first");
        const result = await aiSuggestTags(ctx.selectedItemId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "churn-detection",
      name: "Churn Risk Scan",
      description: "Business-wide churn risk analysis identifying at-risk contacts with probability scores and recommended interventions.",
      icon: "churn",
      category: "detect",
      requiresSelection: false,
      creditCost: 2,
      execute: async () => {
        const result = await aiChurnDetection();
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "crm-analysis",
      name: "Pipeline Analysis",
      description: "Contextual AI analysis of your entire pipeline with actionable insights, trends, and strategic recommendations.",
      icon: "analysis",
      category: "analyze",
      requiresSelection: false,
      creditCost: 3,
      execute: async (ctx) => {
        const result = await aiAnalyzeContacts(ctx.businessId, "Provide a comprehensive analysis of my CRM pipeline. Include: pipeline health, conversion rates, bottlenecks, top opportunities, and 5 specific action items I should take this week. Be specific with contact names and amounts.");
        if (!result.data) throw new Error("Analysis failed");
        return result.data;
      },
    },
    {
      id: "data-quality",
      name: "Data Quality Scan",
      description: "Scan your entire contact database for missing fields, invalid emails, formatting issues, and data completeness scores.",
      icon: "quality",
      category: "detect",
      requiresSelection: false,
      creditCost: 1,
      execute: async () => {
        const result = await aiDataQualityScan();
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "duplicate-finder",
      name: "Duplicate Finder",
      description: "AI-powered duplicate detection across your contact database. Finds exact and fuzzy matches by name, email, and phone.",
      icon: "duplicates",
      category: "detect",
      requiresSelection: false,
      creditCost: 1,
      execute: async () => {
        const result = await aiFindDuplicates();
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "reengagement",
      name: "Re-engagement Planner",
      description: "Identify stale contacts and get AI-crafted re-engagement strategies with personalized message suggestions.",
      icon: "reengage",
      category: "generate",
      requiresSelection: false,
      creditCost: 2,
      execute: async () => {
        const result = await aiReengagementSuggestions();
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "revenue-opportunities",
      name: "Revenue Opportunities",
      description: "AI scan of your pipeline to uncover upsell, cross-sell, and conversion opportunities with estimated revenue impact.",
      icon: "revenue",
      category: "analyze",
      requiresSelection: false,
      creditCost: 2,
      execute: async () => {
        const result = await aiRevenueOpportunities();
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
    {
      id: "follow-up-drafter",
      name: "Follow-up Drafter",
      description: "Generate a personalized follow-up message for the selected contact based on their history, notes, and relationship context.",
      icon: "followup",
      category: "generate",
      requiresSelection: true,
      creditCost: 1,
      execute: async (ctx) => {
        if (!ctx.selectedItemId) throw new Error("Select a contact first");
        const result = await aiFollowUpDraft(ctx.selectedItemId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    },
  ];
}

export function useCrmAiHub() {
  const tools = useMemo(() => buildCrmTools(), []);

  const ai = useModuleAi({
    moduleId: "crm",
    moduleName: "CRM",
    generateSuggestions: generateCrmSuggestions,
    tools,
  });

  const updateCrmContext = useCallback((params: {
    businessId: string;
    activeView: string;
    contactCount: number;
    selectedContactId?: string;
    statusFilter?: string;
  }) => {
    ai.updateContext({
      businessId: params.businessId,
      activeView: params.activeView,
      itemCount: params.contactCount,
      selectedItemId: params.selectedContactId,
      customData: {
        statusFilter: params.statusFilter,
      },
    });
  }, [ai.updateContext]);

  const parseActionKey = useCallback((actionKey: string) => {
    const [type, contactId] = actionKey.split(":");
    return { type, contactId: contactId || null };
  }, []);

  return {
    ...ai,
    updateCrmContext,
    parseActionKey,
  };
}

export type UseCrmAiHubReturn = ReturnType<typeof useCrmAiHub>;
