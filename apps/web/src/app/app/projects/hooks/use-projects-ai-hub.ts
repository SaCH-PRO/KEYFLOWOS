"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";

type ProjectCustomData = {
  projects?: unknown[];
  tasks?: unknown[];
  automations?: unknown[];
};

async function generateProjectSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];
  const data = (customData ?? {}) as ProjectCustomData;
  const projects = (data.projects ?? []) as Record<string, unknown>[];
  const tasks = (data.tasks ?? []) as Record<string, unknown>[];

  if (projects.length === 0) {
    suggestions.push({
      id: `no-projects-${Date.now()}`,
      type: "tip",
      title: "Create Your First Project",
      description: "Set up a delivery project with tasks, milestones, linked clients, and revenue tracking.",
      priority: "medium",
      actionLabel: "New project",
      actionKey: "new_project",
    });
  }

  const overdueTasks = tasks.filter((t) => {
    const due = t.dueDate as string | undefined;
    return due && new Date(due) < new Date() && !t.isCompleted;
  });
  if (overdueTasks.length > 0) {
    suggestions.push({
      id: `overdue-tasks-${Date.now()}`,
      type: "warning",
      title: `${overdueTasks.length} Overdue Task${overdueTasks.length > 1 ? "s" : ""}`,
      description: "Review and reschedule overdue tasks to keep delivery on track.",
      priority: "high",
      actionLabel: "Review tasks",
      actionKey: "switch_tab:projects",
    });
  }

  const blockedProjects = projects.filter((p) => {
    const status = p.status as string | undefined;
    return status === "BLOCKED" || status === "WAITING_ON_CLIENT";
  });
  if (blockedProjects.length > 0) {
    suggestions.push({
      id: `blocked-projects-${Date.now()}`,
      type: "warning",
      title: `${blockedProjects.length} Blocked/Waiting Project${blockedProjects.length > 1 ? "s" : ""}`,
      description: "Projects are stalled. Review blockers or follow up with clients to unblock progress.",
      priority: "high",
      actionLabel: "Review projects",
      actionKey: "switch_tab:projects",
    });
  }

  const unlinkedProjects = projects.filter((p) => !p.contactId);
  if (unlinkedProjects.length > 0 && projects.length > 0) {
    suggestions.push({
      id: `unlinked-projects-${Date.now()}`,
      type: "tip",
      title: "Link Clients to Projects",
      description: `${unlinkedProjects.length} project${unlinkedProjects.length > 1 ? "s" : ""} without a linked client. Connect them for full delivery tracking.`,
      priority: "low",
      actionLabel: "Review",
      actionKey: "switch_tab:projects",
    });
  }

  const stuckProjects = projects.filter((p) => {
    const progress = p.progress as number | undefined;
    return progress !== undefined && progress > 0 && progress < 30;
  });
  if (stuckProjects.length > 0) {
    suggestions.push({
      id: `stuck-projects-${Date.now()}`,
      type: "insight",
      title: "Low-Progress Projects Detected",
      description: `${stuckProjects.length} project${stuckProjects.length > 1 ? "s have" : " has"} less than 30% progress. Consider breaking work into smaller tasks or reassessing scope.`,
      priority: "medium",
      actionLabel: "Review",
      actionKey: "switch_tab:projects",
    });
  }

  return suggestions;
}

const projectTools: AiTool[] = [
  {
    id: "project-plan",
    name: "Generate Project Plan",
    description: "AI creates a task breakdown, milestones, and timeline for a new project",
    icon: "📋",
    category: "generate",
    requiresSelection: false,
    creditCost: 2,
    execute: async () => ({ status: "success", message: "Project plan generated" }),
  },
  {
    id: "task-prioritize",
    name: "Prioritize Tasks",
    description: "AI analyzes dependencies and urgency to recommend task priority order",
    icon: "🎯",
    category: "optimize",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Tasks prioritized" }),
  },
  {
    id: "risk-assess",
    name: "Assess Project Risk",
    description: "Evaluate delivery risk across all projects based on blockers, overdue tasks, and timelines",
    icon: "⚠️",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Risk assessment complete" }),
  },
  {
    id: "bottleneck-detect",
    name: "Detect Bottlenecks",
    description: "Identify workflow bottlenecks and resource constraints across active projects",
    icon: "🔍",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Bottleneck analysis complete" }),
  },
  {
    id: "client-update",
    name: "Draft Client Update",
    description: "Generate a client-facing progress update based on project status and completed tasks",
    icon: "📧",
    category: "generate",
    requiresSelection: false,
    creditCost: 2,
    execute: async () => ({ status: "success", message: "Client update drafted" }),
  },
  {
    id: "automation-suggest",
    name: "Suggest Project Flows",
    description: "Recommend automation flows based on your project patterns and delivery stages",
    icon: "⚡",
    category: "automate",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Flow suggestions ready" }),
  },
];

export function useProjectsAiHub(
  businessId: string | null,
  customData?: ProjectCustomData,
) {
  const context: ModuleContext = useMemo(() => ({
    businessId: businessId ?? "",
    customData: customData as Record<string, unknown>,
  }), [businessId, customData]);

  const config = useMemo(() => ({
    moduleId: "projects",
    moduleName: "Projects",
    generateSuggestions: generateProjectSuggestions,
    tools: projectTools,
  }), []);

  const ai = useModuleAi(config);

  const handleAction = useCallback((actionKey: string) => {
    console.log("[ProjectsAI] action:", actionKey);
  }, []);

  return { ai, handleAction };
}
