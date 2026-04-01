"use client";

import { useCallback, useMemo } from "react";
import { useModuleAi, type ModuleContext, type AiSuggestion, type AiTool } from "@/hooks/use-module-ai";

type ExpenseCustomData = {
  expenses?: unknown[];
  totalExpenses?: number;
  categories?: unknown[];
  summary?: Record<string, unknown> | null;
};

async function generateExpenseSuggestions(context: ModuleContext): Promise<AiSuggestion[]> {
  const { businessId, customData } = context;
  if (!businessId) return [];

  const suggestions: AiSuggestion[] = [];
  const data = (customData ?? {}) as ExpenseCustomData;
  const expenses = (data.expenses ?? []) as Record<string, unknown>[];
  const categories = (data.categories ?? []) as Record<string, unknown>[];
  const summary = data.summary as Record<string, unknown> | null;

  if (expenses.length === 0) {
    suggestions.push({
      id: `no-expenses-${Date.now()}`,
      type: "tip",
      title: "Start Tracking Expenses",
      description: "Add your first expense to begin tracking spending patterns and get AI-powered insights.",
      priority: "medium",
      actionLabel: "Add expense",
      actionKey: "add_expense",
    });
  }

  if (categories.length === 0) {
    suggestions.push({
      id: `no-categories-${Date.now()}`,
      type: "insight",
      title: "Set Up Categories",
      description: "Categorize expenses for clearer reports and smarter budget recommendations.",
      priority: "medium",
      actionLabel: "Go to categories",
      actionKey: "switch_tab:analytics",
    });
  }

  const uncategorized = expenses.filter((e) => !e.category && !e.categoryId);
  if (uncategorized.length > 3) {
    suggestions.push({
      id: `uncategorized-${Date.now()}`,
      type: "warning",
      title: `${uncategorized.length} Uncategorized Expenses`,
      description: "Categorize these expenses to improve budget tracking and reporting accuracy.",
      priority: "high",
      actionLabel: "Review expenses",
      actionKey: "switch_tab:expenses",
    });
  }

  if (summary) {
    const totalThisMonth = (summary.totalThisMonth as number) ?? 0;
    const totalLastMonth = (summary.totalLastMonth as number) ?? 0;
    if (totalLastMonth > 0 && totalThisMonth > totalLastMonth * 1.2) {
      const pctIncrease = Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 100);
      suggestions.push({
        id: `spending-spike-${Date.now()}`,
        type: "warning",
        title: "Spending Increase Detected",
        description: `This month's expenses are ${pctIncrease}% higher than last month. Review recent entries to identify the cause.`,
        priority: "high",
        actionLabel: "View analytics",
        actionKey: "switch_tab:analytics",
      });
    }
  }

  const hasReceipts = expenses.filter((e) => e.receiptUrl || e.attachmentUrl);
  if (expenses.length > 5 && hasReceipts.length < expenses.length * 0.3) {
    suggestions.push({
      id: `missing-receipts-${Date.now()}`,
      type: "tip",
      title: "Attach Receipts",
      description: "Less than 30% of your expenses have receipts. Attaching receipts helps with tax compliance.",
      priority: "low",
    });
  }

  return suggestions;
}

const expenseTools: AiTool[] = [
  {
    id: "expense-categorize",
    name: "Auto-Categorize Expenses",
    description: "Use AI to suggest categories for uncategorized expenses",
    icon: "📂",
    category: "automate",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Expenses categorized" }),
  },
  {
    id: "expense-anomaly",
    name: "Detect Anomalies",
    description: "Scan for unusual spending patterns or duplicate entries",
    icon: "🔍",
    category: "detect",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Anomaly scan complete" }),
  },
  {
    id: "expense-forecast",
    name: "Forecast Monthly Spending",
    description: "Predict next month's expenses based on historical patterns",
    icon: "📊",
    category: "analyze",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Forecast generated" }),
  },
  {
    id: "expense-optimize",
    name: "Spending Optimization Tips",
    description: "Get AI recommendations to reduce costs and optimize spending",
    icon: "💡",
    category: "optimize",
    requiresSelection: false,
    creditCost: 1,
    execute: async () => ({ status: "success", message: "Optimization tips generated" }),
  },
];

export function useExpensesAiHub(
  businessId: string | null,
  customData?: ExpenseCustomData,
) {
  const context: ModuleContext = useMemo(() => ({
    businessId: businessId ?? "",
    customData: customData as Record<string, unknown>,
  }), [businessId, customData]);

  const config = useMemo(() => ({
    moduleId: "expenses",
    moduleName: "Expenses",
    generateSuggestions: generateExpenseSuggestions,
    tools: expenseTools,
  }), []);

  const ai = useModuleAi(config, context);

  const handleAction = useCallback((actionKey: string) => {
    console.log("[ExpensesAI] action:", actionKey);
  }, []);

  return { ai, handleAction };
}
