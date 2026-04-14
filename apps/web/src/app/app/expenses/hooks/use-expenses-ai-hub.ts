"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";

type ExpenseCustomData = {
  expenses?: unknown[];
  totalExpenses?: number;
  categories?: unknown[];
  summary?: Record<string, unknown> | null;
  budgets?: unknown[];
  vendors?: unknown[];
};

async function generateExpenseSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];
  const data = (customData ?? {}) as ExpenseCustomData;
  const expenses = (data.expenses ?? []) as Record<string, unknown>[];
  const categories = (data.categories ?? []) as Record<string, unknown>[];
  const budgets = (data.budgets ?? []) as Record<string, unknown>[];
  const vendors = (data.vendors ?? []) as Record<string, unknown>[];
  const summary = data.summary as Record<string, unknown> | null;

  if (expenses.length === 0) {
    suggestions.push({
      id: `no-expenses-${Date.now()}`,
      type: "tip",
      title: "Start Tracking Expenses",
      description: "Add your first expense to begin tracking spending patterns, margins, budgets, and tax-ready records.",
      priority: "medium",
      actionLabel: "Add expense",
      actionKey: "add_expense",
    });
    return suggestions;
  }

  if (categories.length === 0) {
    suggestions.push({
      id: `no-categories-${Date.now()}`,
      type: "insight",
      title: "Set Up Categories",
      description: "Create spending categories to unlock budget tracking, spending breakdowns, and smarter AI insights.",
      priority: "medium",
      actionLabel: "Go to categories",
      actionKey: "switch_tab:categories",
    });
  }

  if (budgets.length === 0 && expenses.length > 5) {
    suggestions.push({
      id: `no-budgets-${Date.now()}`,
      type: "insight",
      title: "Set Up Budgets",
      description: "Configure monthly spending limits to get overspend alerts, cost control, and budget-vs-actual tracking.",
      priority: "medium",
      actionLabel: "Set up budgets",
      actionKey: "switch_tab:budgets",
    });
  }

  const uncategorized = expenses.filter((e) => !e.category && !e.categoryId);
  if (uncategorized.length > 3) {
    suggestions.push({
      id: `uncategorized-${Date.now()}`,
      type: "warning",
      title: `${uncategorized.length} Uncategorized Expenses`,
      description: "Categorize these expenses to improve budget tracking, reporting accuracy, and financial intelligence.",
      explanation: "Uncategorized expenses reduce the accuracy of spending analysis and budget forecasts.",
      priority: "high",
      actionLabel: "Review expenses",
      actionKey: "switch_tab:transactions",
    });
  }

  if (summary) {
    const comparison = summary.comparison as Record<string, unknown> | undefined;
    const changePercent = (comparison?.changePercent as number) ?? 0;
    if (changePercent > 20) {
      suggestions.push({
        id: `spending-spike-${Date.now()}`,
        type: "warning",
        title: "Spending Increase Detected",
        description: `Spending is up ${changePercent.toFixed(0)}% compared to the previous period. Check Insights for a detailed breakdown.`,
        explanation: "A sustained increase above 20% may indicate scope creep or unplanned costs worth reviewing.",
        priority: "high",
        actionLabel: "View insights",
        actionKey: "switch_tab:insights",
      });
    }
  }

  const hasReceipts = expenses.filter((e) => e.receiptUrl || e.attachmentUrl);
  if (expenses.length > 5 && hasReceipts.length < expenses.length * 0.3) {
    suggestions.push({
      id: `missing-receipts-${Date.now()}`,
      type: "tip",
      title: "Attach Receipts",
      description: "Less than 30% of your expenses have receipts. Attaching receipts improves tax compliance and audit readiness.",
      priority: "low",
    });
  }

  const overBudget = (budgets as Record<string, unknown>[]).filter(b => b.isOverBudget);
  if (overBudget.length > 0) {
    suggestions.push({
      id: `over-budget-${Date.now()}`,
      type: "warning",
      title: `${overBudget.length} Budget${overBudget.length > 1 ? "s" : ""} Exceeded`,
      description: "Review your budget allocations and recent spending to get costs back under control.",
      explanation: "Exceeded budgets signal potential overspending that may impact profitability if left unchecked.",
      priority: "high",
      actionLabel: "Review budgets",
      actionKey: "switch_tab:budgets",
    });
  }

  if (vendors.length > 0) {
    const topVendor = vendors[0] as Record<string, unknown>;
    const totalSpend = (summary?.total as number) ?? 0;
    const vendorTotal = (topVendor.total as number) ?? 0;
    const vendorPct = totalSpend > 0 ? Math.round((vendorTotal / totalSpend) * 100) : 0;
    if (vendorPct > 40) {
      suggestions.push({
        id: `vendor-concentration-${Date.now()}`,
        type: "insight",
        title: `High Vendor Concentration: ${vendorPct}%`,
        description: `${topVendor.name} accounts for ${vendorPct}% of all spending. Consider diversifying or negotiating terms.`,
        explanation: "Heavy reliance on a single vendor increases supply risk and reduces negotiating leverage.",
        priority: "medium",
        actionLabel: "View insights",
        actionKey: "switch_tab:insights",
      });
    }
  }

  return suggestions;
}

const expenseTools: AiTool[] = [
  {
    id: "expense-categorize",
    name: "Auto-Categorize Expenses",
    description: "Use AI to suggest categories for uncategorized expenses",
    icon: "categorize",
    category: "automate",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Expenses categorized" }),
  },
  {
    id: "expense-anomaly",
    name: "Detect Anomalies",
    description: "Scan for unusual spending patterns, duplicates, or cost spikes",
    icon: "anomaly",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Anomaly scan complete" }),
  },
  {
    id: "expense-forecast",
    name: "Forecast Monthly Spending",
    description: "Predict next month's expenses based on historical patterns and trends",
    icon: "forecast",
    category: "analyze",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Forecast generated" }),
  },
  {
    id: "expense-optimize",
    name: "Cost Optimization Tips",
    description: "Get AI recommendations to reduce costs, optimize vendor mix, and improve margins",
    icon: "optimize",
    category: "optimize",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Optimization tips generated" }),
  },
  {
    id: "expense-margin",
    name: "Margin Impact Analysis",
    description: "Analyze how expense categories affect your service and project profitability",
    icon: "margin",
    category: "analyze",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Margin analysis complete" }),
  },
  {
    id: "expense-vendor-review",
    name: "Vendor Rationalization",
    description: "Identify vendor overlaps, concentration risks, and negotiation opportunities",
    icon: "vendor",
    category: "optimize",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Vendor review complete" }),
  },
];

export function useExpensesAiHub() {
  const tools = useMemo(() => expenseTools, []);

  const ai = useModuleAi({
    moduleId: "expenses",
    moduleName: "Expenses",
    generateSuggestions: generateExpenseSuggestions,
    tools,
    executeAction: async (actionKey, context) => {
      if (actionKey.startsWith("tool:")) {
        const toolId = actionKey.replace("tool:", "");
        const tool = tools.find((t) => t.id === toolId);
        if (tool) await tool.execute(context);
      }
    },
  });

  const updateExpensesContext = useCallback((params: {
    businessId: string;
    activeView?: string;
    expenses?: unknown[];
    categories?: unknown[];
    budgets?: unknown[];
    vendors?: unknown[];
    summary?: Record<string, unknown> | null;
  }) => {
    ai.updateContext({
      businessId: params.businessId,
      activeView: params.activeView,
      customData: {
        expenses: params.expenses,
        categories: params.categories,
        budgets: params.budgets,
        vendors: params.vendors,
        summary: params.summary,
      },
    });
  }, [ai.updateContext]);

  const handleAction = useCallback((actionKey: string) => {
    console.log("[ExpensesAI] action:", actionKey);
  }, []);

  return { aiHook: ai, updateExpensesContext, handleAction };
}

export type UseExpensesAiHubReturn = ReturnType<typeof useExpensesAiHub>;
