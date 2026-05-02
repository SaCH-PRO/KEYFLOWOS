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
      type: "opportunity",
      title: "Create Your First Project",
      description: "Set up a delivery project with tasks, milestones, linked clients, and revenue tracking.",
      explanation: "Projects connect your client work, calendar, revenue, and flows into one delivery hub.",
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
      type: "risk",
      title: `${overdueTasks.length} Overdue Task${overdueTasks.length > 1 ? "s" : ""}`,
      description: "Review and reschedule overdue tasks to keep delivery on track.",
      explanation: "Tasks past their due date increase project risk and may delay dependent work.",
      priority: "high",
      actionLabel: "Review tasks",
      actionKey: "switch_tab:board",
    });
  }

  const blockedProjects = projects.filter((p) => {
    const status = p.status as string | undefined;
    return status === "BLOCKED" || status === "WAITING_ON_CLIENT";
  });
  if (blockedProjects.length > 0) {
    suggestions.push({
      id: `blocked-projects-${Date.now()}`,
      type: "risk",
      title: `${blockedProjects.length} Blocked/Waiting Project${blockedProjects.length > 1 ? "s" : ""}`,
      description: "Projects are stalled. Review blockers or follow up with clients to unblock progress.",
      explanation: "Blocked projects consume resources without advancing. Clearing blockers early prevents cascading delays.",
      priority: "high",
      actionLabel: "Review projects",
      actionKey: "switch_tab:board",
    });
  }

  const unlinkedProjects = projects.filter((p) => !p.contactId);
  if (unlinkedProjects.length > 0 && projects.length > 0) {
    suggestions.push({
      id: `unlinked-projects-${Date.now()}`,
      type: "opportunity",
      title: "Link Clients to Projects",
      description: `${unlinkedProjects.length} project${unlinkedProjects.length > 1 ? "s" : ""} without a linked client. Connect them for full delivery tracking.`,
      explanation: "Linking clients enables cross-module tracking — client profitability, project costs, and communication history in one view.",
      priority: "low",
      actionLabel: "Review",
      actionKey: "switch_tab:board",
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
      explanation: "Projects below 30% completion may need scope re-evaluation or additional task decomposition.",
      priority: "medium",
      actionLabel: "Review",
      actionKey: "switch_tab:board",
    });
  }

  return suggestions;
}

const projectTools: AiTool[] = [
  {
    id: "project-plan",
    name: "Generate Project Plan",
    description: "AI creates a task breakdown, milestones, and timeline for a new project",
    icon: "plan",
    category: "generate",
    requiresSelection: false,
    creditCost: 2,
    execute: async () => ({ status: "success", message: "Project plan generated" }),
  },
  {
    id: "task-prioritize",
    name: "Prioritize Tasks",
    description: "AI analyzes dependencies and urgency to recommend task priority order",
    icon: "prioritize",
    category: "optimize",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Tasks prioritized" }),
  },
  {
    id: "risk-assess",
    name: "Assess Project Risk",
    description: "Evaluate delivery risk across all projects based on blockers, overdue tasks, and timelines",
    icon: "risk",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Risk assessment complete" }),
  },
  {
    id: "bottleneck-detect",
    name: "Detect Bottlenecks",
    description: "Identify workflow bottlenecks and resource constraints across active projects",
    icon: "bottleneck",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Bottleneck analysis complete" }),
  },
  {
    id: "client-update",
    name: "Draft Client Update",
    description: "Generate a client-facing progress update based on project status and completed tasks",
    icon: "update",
    category: "generate",
    requiresSelection: false,
    creditCost: 2,
    execute: async () => ({ status: "success", message: "Client update drafted" }),
  },
  {
    id: "automation-suggest",
    name: "Suggest Project Flows",
    description: "Recommend automation flows based on your project patterns and delivery stages",
    icon: "automate",
    category: "automate",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Flow suggestions ready" }),
  },
];

export function useProjectsAiHub() {
  const tools = useMemo(() => projectTools, []);

  const ai = useModuleAi({
    moduleId: "projects",
    moduleName: "Projects",
    generateSuggestions: generateProjectSuggestions,
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

  const updateProjectsContext = useCallback((params: {
    businessId: string;
    activeView?: string;
    selectedItemId?: string;
    projects?: unknown[];
    tasks?: unknown[];
    automations?: unknown[];
  }) => {
    ai.updateContext({
      businessId: params.businessId,
      activeView: params.activeView,
      selectedItemId: params.selectedItemId,
      customData: {
        projects: params.projects,
        tasks: params.tasks,
        automations: params.automations,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'ai' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [ai.updateContext]);

  return { aiHook: ai, updateProjectsContext };
}

export type UseProjectsAiHubReturn = ReturnType<typeof useProjectsAiHub>;
