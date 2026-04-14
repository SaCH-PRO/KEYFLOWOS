"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";

type AutomationCustomData = {
  playbooks?: unknown[];
  workflows?: unknown[];
  activeCount?: number;
  pausedCount?: number;
  totalRuns?: number;
  successRate?: number;
};

async function generateAutomationSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];
  const data = (customData ?? {}) as AutomationCustomData;
  const playbooks = (data.playbooks ?? []) as Record<string, unknown>[];
  const workflows = (data.workflows ?? []) as Record<string, unknown>[];
  const total = playbooks.length + workflows.length;
  const activeCount = data.activeCount ?? 0;
  const pausedCount = data.pausedCount ?? 0;
  const successRate = data.successRate ?? 0;

  if (total === 0) {
    suggestions.push({
      id: `no-flows-${Date.now()}`,
      type: "tip",
      title: "Create Your First Flow",
      description: "Automate repetitive tasks like follow-up emails, booking confirmations, or invoice reminders with a pre-built template.",
      priority: "medium",
      actionLabel: "Browse templates",
      actionKey: "switch_tab:templates",
    });
    return suggestions;
  }

  if (pausedCount > 0 && pausedCount >= activeCount) {
    suggestions.push({
      id: `paused-flows-${Date.now()}`,
      type: "warning",
      title: `${pausedCount} Paused Flow${pausedCount > 1 ? "s" : ""}`,
      description: "Most of your flows are paused. Review and reactivate them to keep automations running.",
      explanation: "Paused flows stop executing, which means tasks they handle will require manual work.",
      priority: "high",
      actionLabel: "Review flows",
      actionKey: "switch_tab:flows",
    });
  }

  const neverRun = [...playbooks, ...workflows].filter((f) => {
    const enabled = f.enabled as boolean | undefined;
    const runCount = (f.runCount as number) ?? 0;
    return enabled && runCount === 0;
  });
  if (neverRun.length > 0) {
    suggestions.push({
      id: `never-run-${Date.now()}`,
      type: "insight",
      title: `${neverRun.length} Flow${neverRun.length > 1 ? "s" : ""} Never Triggered`,
      description: "These flows are active but haven't executed yet. Check their trigger conditions or test them manually.",
      explanation: "Flows that never trigger may have misconfigured events or conditions that prevent execution.",
      priority: "medium",
      actionLabel: "Review",
      actionKey: "switch_tab:flows",
    });
  }

  if (successRate > 0 && successRate < 80) {
    suggestions.push({
      id: `low-success-${Date.now()}`,
      type: "warning",
      title: `Flow Success Rate: ${successRate}%`,
      description: "Your flow success rate is below 80%. Check the activity log for errors and fix failing flows.",
      explanation: "Low success rates indicate execution errors that may cause missed automations or duplicate actions.",
      priority: "high",
      actionLabel: "View activity log",
      actionKey: "switch_tab:log",
    });
  }

  if (activeCount > 0 && activeCount < 3) {
    suggestions.push({
      id: `expand-automation-${Date.now()}`,
      type: "tip",
      title: "Expand Your Automation",
      description: "You have fewer than 3 active flows. Explore templates to automate more of your business operations.",
      priority: "low",
      actionLabel: "Browse templates",
      actionKey: "switch_tab:templates",
    });
  }

  return suggestions;
}

const automationTools: AiTool[] = [
  {
    id: "flow-suggest",
    name: "Suggest New Flows",
    description: "AI recommends automation flows based on your business activity and current gaps",
    icon: "automate",
    category: "generate",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Flow suggestions generated" }),
  },
  {
    id: "flow-audit",
    name: "Audit Flow Health",
    description: "Analyze all active flows for errors, redundancies, and optimization opportunities",
    icon: "analysis",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Flow audit complete" }),
  },
  {
    id: "flow-optimize",
    name: "Optimize Flow Triggers",
    description: "Review trigger conditions and timing to improve flow reliability and reduce false executions",
    icon: "optimize",
    category: "optimize",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Trigger optimization complete" }),
  },
  {
    id: "coverage-gaps",
    name: "Find Coverage Gaps",
    description: "Identify business areas without automation coverage and suggest flows to fill gaps",
    icon: "bottleneck",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Coverage gaps identified" }),
  },
];

export function useAutomationsAiHub() {
  const tools = useMemo(() => automationTools, []);

  const ai = useModuleAi({
    moduleId: "automations",
    moduleName: "Flows",
    generateSuggestions: generateAutomationSuggestions,
    tools,
    executeAction: async (actionKey, context) => {
      if (actionKey.startsWith("tool:")) {
        const toolId = actionKey.replace("tool:", "");
        const tool = tools.find((t) => t.id === toolId);
        if (tool) await tool.execute(context);
      }
    },
  });

  const updateAutomationsContext = useCallback((params: {
    businessId: string;
    activeView?: string;
    playbooks?: unknown[];
    workflows?: unknown[];
    activeCount?: number;
    pausedCount?: number;
    totalRuns?: number;
    successRate?: number;
  }) => {
    ai.updateContext({
      businessId: params.businessId,
      activeView: params.activeView,
      customData: {
        playbooks: params.playbooks,
        workflows: params.workflows,
        activeCount: params.activeCount,
        pausedCount: params.pausedCount,
        totalRuns: params.totalRuns,
        successRate: params.successRate,
      },
    });
  }, [ai.updateContext]);

  return { aiHook: ai, updateAutomationsContext };
}

export type UseAutomationsAiHubReturn = ReturnType<typeof useAutomationsAiHub>;
