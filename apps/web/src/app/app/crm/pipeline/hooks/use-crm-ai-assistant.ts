"use client";

import { useCallback } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion } from "@/hooks/use-module-ai";
import { aiAnalyzeContacts } from "@/lib/client";

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

export function useCrmAiAssistant() {
  const ai = useModuleAi({
    moduleId: "crm",
    moduleName: "Contacts",
    generateSuggestions: generateCrmSuggestions,
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

export type UseCrmAiAssistantReturn = ReturnType<typeof useCrmAiAssistant>;
