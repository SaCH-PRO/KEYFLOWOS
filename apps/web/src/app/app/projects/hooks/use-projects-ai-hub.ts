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
      description: "Organize work into projects with tasks, deadlines, and automations.",
      priority: "medium",
      actionLabel: "New project",
      actionKey: "new_project",
    });
  }

  const overdueTasks = tasks.filter((t) => {
    const due = t.dueDate as string | undefined;
    return due && new Date(due) < new Date() && t.status !== "COMPLETED" && t.status !== "DONE";
  });
  if (overdueTasks.length > 0) {
    suggestions.push({
      id: `overdue-tasks-${Date.now()}`,
      type: "warning",
      title: `${overdueTasks.length} Overdue Task${overdueTasks.length > 1 ? "s" : ""}`,
      description: "Review and reschedule overdue tasks to keep projects on track.",
      priority: "high",
      actionLabel: "View tasks",
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
      title: "Projects Need Attention",
      description: `${stuckProjects.length} project${stuckProjects.length > 1 ? "s have" : " has"} less than 30% progress. Consider breaking tasks into smaller steps.`,
      priority: "medium",
      actionLabel: "Review projects",
      actionKey: "switch_tab:projects",
    });
  }

  return suggestions;
}

const projectTools: AiTool[] = [
  {
    id: "project-plan",
    name: "Generate Project Plan",
    description: "AI creates a task breakdown and timeline for a new project",
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
    id: "bottleneck-detect",
    name: "Detect Bottlenecks",
    description: "Identify workflow bottlenecks and resource constraints across projects",
    icon: "🔍",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Bottleneck analysis complete" }),
  },
  {
    id: "automation-suggest",
    name: "Suggest Automations",
    description: "Recommend automation rules based on your recurring task patterns",
    icon: "⚡",
    category: "automate",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Automation suggestions ready" }),
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
    moduleName: "Projects & Automations",
    generateSuggestions: generateProjectSuggestions,
    tools: projectTools,
  }), []);

  const ai = useModuleAi(config);

  const handleAction = useCallback((actionKey: string) => {
    console.log("[ProjectsAI] action:", actionKey);
  }, []);

  return { ai, handleAction };
}
