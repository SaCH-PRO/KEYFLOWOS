"use client";

import { useEffect } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type TowerCustomData = {
  momentumScore?: number;
  overdueInvoices?: number;
  staleLeads?: number;
  pendingApprovals?: number;
  activeProjects?: number;
  overdueTaskCount?: number;
  monthlyRevenue?: number;
  utilizationRate?: number;
};

async function generateTowerSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];
  const data = (context.customData ?? {}) as TowerCustomData;

  if ((data.overdueInvoices ?? 0) > 0) {
    suggestions.push({
      id: `overdue-invoices-${Date.now()}`,
      type: "warning",
      title: "Overdue Invoices Need Attention",
      description: `You have ${data.overdueInvoices} overdue invoices. Follow up today to protect cash flow.`,
      priority: "high",
      actionLabel: "View overdue",
      actionKey: "navigate:/app/commerce?tab=operations",
    });
  }

  if ((data.staleLeads ?? 0) > 5) {
    suggestions.push({
      id: `stale-leads-${Date.now()}`,
      type: "insight",
      title: "Re-engage Stale Leads",
      description: `${data.staleLeads} leads have gone cold. A simple check-in could re-activate them.`,
      priority: "medium",
      actionLabel: "View leads",
      actionKey: "navigate:/app/crm/pipeline",
    });
  }

  if ((data.pendingApprovals ?? 0) > 0) {
    suggestions.push({
      id: `pending-approvals-${Date.now()}`,
      type: "action",
      title: "AI Actions Awaiting Approval",
      description: `${data.pendingApprovals} AI-proposed actions need your decision.`,
      priority: "high",
      actionLabel: "Review actions",
      actionKey: "navigate:/app/control-tower",
    });
  }

  if ((data.momentumScore ?? 100) < 50) {
    suggestions.push({
      id: `low-momentum-${Date.now()}`,
      type: "tip",
      title: "Momentum Score is Low",
      description: "Your business momentum is below 50. Focus on clearing overdue items and engaging leads.",
      priority: "medium",
    });
  }

  if ((data.utilizationRate ?? 100) < 40) {
    suggestions.push({
      id: `low-utilization-${Date.now()}`,
      type: "insight",
      title: "Low Booking Utilization",
      description: `Only ${data.utilizationRate?.toFixed(0)}% of your calendar capacity is used. Consider promotions or outreach.`,
      priority: "medium",
      actionLabel: "View calendar",
      actionKey: "navigate:/app/bookings",
    });
  }

  return suggestions;
}

const towerTools: AiTool[] = [
  {
    id: "explain_metric",
    name: "Explain Metric",
    description: "AI explains what a Control Tower metric means and suggests actions to improve it",
    icon: "help-circle",
    category: "analyze",
    requiresSelection: false,
    creditCost: 1,
    execute: async (ctx) => {
      const data = (ctx.customData ?? {}) as TowerCustomData;
      const metrics = [
        { name: "Monthly Revenue", value: data.monthlyRevenue ?? 0, unit: "TTD" },
        { name: "Overdue Invoices", value: data.overdueInvoices ?? 0 },
        { name: "Stale Leads", value: data.staleLeads ?? 0 },
        { name: "Active Projects", value: data.activeProjects ?? 0 },
        { name: "Overdue Tasks", value: data.overdueTaskCount ?? 0 },
        { name: "Pending Approvals", value: data.pendingApprovals ?? 0 },
        { name: "Momentum Score", value: data.momentumScore ?? 0, unit: "/100" },
        { name: "Utilization Rate", value: data.utilizationRate ?? 0, unit: "%" },
      ];
      const flagged = metrics.filter((m) => {
        if (m.name === "Momentum Score") return m.value < 60;
        if (m.name === "Utilization Rate") return m.value < 50;
        if (m.name === "Monthly Revenue") return m.value === 0;
        if (["Overdue Invoices", "Stale Leads", "Overdue Tasks"].includes(m.name)) return m.value > 0;
        return false;
      });

      return {
        allMetrics: metrics,
        flaggedMetrics: flagged,
        summary: flagged.length === 0
          ? "All metrics look healthy. Keep it up!"
          : `${flagged.length} metric${flagged.length > 1 ? "s" : ""} need${flagged.length === 1 ? "s" : ""} attention: ${flagged.map((f) => f.name).join(", ")}`,
        recommendations: flagged.map((f) => {
          switch (f.name) {
            case "Monthly Revenue": return "No revenue this month — focus on converting pending quotes and re-engaging stale leads.";
            case "Overdue Invoices": return `${f.value} overdue invoices — send follow-up reminders to protect cash flow.`;
            case "Stale Leads": return `${f.value} stale leads — a quick check-in message could re-activate them.`;
            case "Overdue Tasks": return `${f.value} overdue tasks — prioritize clearing these to improve project delivery health.`;
            case "Momentum Score": return `Momentum at ${f.value}/100 — clear overdue items and engage clients to boost it.`;
            case "Utilization Rate": return `Only ${f.value}% utilization — consider promotions or outreach to fill capacity.`;
            default: return `${f.name}: ${f.value} — review and take action.`;
          }
        }),
      };
    },
  },
  {
    id: "scan_risks",
    name: "Scan Risks",
    description: "AI scans for cash flow threats, churn signals, and overdue cascades",
    icon: "shield",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async (ctx) => {
      const res = await apiGet<Record<string, unknown>>(`/ai/businesses/${ctx.businessId}/ai/strategic/risks`);
      return res.data;
    },
  },
  {
    id: "scan_opportunities",
    name: "Scan Opportunities",
    description: "Discover upsells, neglected leads, and revenue potential",
    icon: "target",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async (ctx) => {
      const res = await apiGet<Record<string, unknown>>(`/ai/businesses/${ctx.businessId}/ai/strategic/opportunities`);
      return res.data;
    },
  },
  {
    id: "revenue_forecast",
    name: "Revenue Forecast",
    description: "30/60/90-day revenue projections with confidence intervals",
    icon: "trending-up",
    category: "analyze",
    requiresSelection: false,
    creditCost: 1,
    execute: async (ctx) => {
      const res = await apiGet<Record<string, unknown>>(`/ai/businesses/${ctx.businessId}/ai/strategic/revenue-forecast`);
      return res.data;
    },
  },
  {
    id: "weekly_plan",
    name: "Generate Weekly Plan",
    description: "AI creates a structured daily focus plan for this week",
    icon: "calendar",
    category: "generate",
    requiresSelection: false,
    creditCost: 1,
    execute: async (ctx) => {
      const res = await apiGet<Record<string, unknown>>(`/ai/businesses/${ctx.businessId}/ai/strategic/weekly-plan`);
      return res.data;
    },
  },
  {
    id: "send_overdue_reminders",
    name: "Send Payment Reminders",
    description: "Queue follow-up reminders for all overdue invoices (governed — requires approval if Tier 2+)",
    icon: "send",
    category: "automate",
    requiresSelection: false,
    creditCost: 2,
    execute: async (ctx) => {
      const { apiPostSimple } = await import("@/lib/api");
      const res = await apiPostSimple<Record<string, unknown>>(
        `/ai/businesses/${ctx.businessId}/ai/execute`,
        { toolId: "queue_payment_reminder", params: {} },
      );
      return res.data ?? { message: "Payment reminders queued (subject to governance tier)" };
    },
  },
];

export function useControlTowerAiHub(customData: TowerCustomData) {
  const businessId = getStoredBusinessId() ?? "";

  const ai = useModuleAi({
    moduleId: "control-tower",
    moduleName: "Control Tower",
    generateSuggestions: generateTowerSuggestions,
    tools: towerTools,
  });

  useEffect(() => {
    ai.updateContext({
      businessId,
      activeView: "control-tower",
      customData: customData as Record<string, unknown>,
    });
  }, [businessId, customData, ai.updateContext]);

  return ai;
}
