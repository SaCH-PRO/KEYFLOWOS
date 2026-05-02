"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { NextAction as NextActionUI } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import {
  fetchFlowIntelligence,
  fetchNextActions,
  fetchAutopilotActionsForCrm,
  fetchPredictiveRevenue,
  fetchFinancialGrowth,
  fetchAiNextActions,
  completeNextAction,
  approveAutopilotAction as approveAutopilotActionApi,
  denyAutopilotAction as denyAutopilotActionApi,
  type FinancialGrowthData,
  type AiNextAction,
} from "@/lib/client";

export function useFlowIntelligence(businessId: string | null) {
  const [flowIntelligence, setFlowIntelligence] = useState<FlowIntelligenceData | null>(null);
  const [nextActions, setNextActions] = useState<NextActionUI[]>([]);
  const [autopilotActions, setAutopilotActions] = useState<AutopilotAction[]>([]);
  const [autopilotPaused, setAutopilotPaused] = useState(false);
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [financialGrowth, setFinancialGrowth] = useState<FinancialGrowthData | null>(null);
  const [aiNextActions, setAiNextActions] = useState<AiNextAction[]>([]);
  const [flowDataLoading, setFlowDataLoading] = useState(false);
  const flowAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { flowAbortRef.current?.abort(); };
  }, []);

  const loadFlowData = useCallback(async () => {
    if (!businessId) return;
    flowAbortRef.current?.abort();
    const controller = new AbortController();
    flowAbortRef.current = controller;
    setFlowDataLoading(true);
    try {
      const [flowRes, actionsRes, autopilotRes, revenueRes, growthRes, aiActionsRes] = await Promise.allSettled([
        fetchFlowIntelligence(businessId, { signal: controller.signal }),
        fetchNextActions(businessId, { signal: controller.signal }),
        fetchAutopilotActionsForCrm(businessId, { signal: controller.signal }),
        fetchPredictiveRevenue(businessId, { signal: controller.signal }),
        fetchFinancialGrowth(businessId, { signal: controller.signal }),
        fetchAiNextActions(businessId, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (flowRes.status === "fulfilled" && flowRes.value.data) setFlowIntelligence(flowRes.value.data);
      if (actionsRes.status === "fulfilled" && actionsRes.value.data) {
        setNextActions(actionsRes.value.data.map((a) => ({
          id: a.id, type: a.type, contactId: a.contactId, contactName: a.contactName,
          description: a.description, aiDraft: a.aiDraft, estimatedTime: a.estimatedTime,
          priority: a.priority, dueDate: a.dueDate, value: a.value,
        })));
      }
      if (autopilotRes.status === "fulfilled" && autopilotRes.value.data) setAutopilotActions(autopilotRes.value.data);
      if (revenueRes.status === "fulfilled" && revenueRes.value.data) setRevenueData(revenueRes.value.data);
      if (growthRes.status === "fulfilled" && growthRes.value.data) setFinancialGrowth(growthRes.value.data);
      if (aiActionsRes.status === "fulfilled" && aiActionsRes.value.data) setAiNextActions(aiActionsRes.value.data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.error("Failed to load flow intelligence");
    } finally {
      if (!controller.signal.aborted) setFlowDataLoading(false);
    }
  }, [businessId]);

  const handleCompleteNextAction = useCallback(async (actionId: string) => {
    if (!businessId) return;
    try {
      await completeNextAction(actionId, businessId);
      setNextActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch {
      toast.error("Failed to complete action");
    }
  }, [businessId]);

  const handleApproveAutopilot = useCallback(async (id: string) => {
    if (!businessId) return;
    setAutopilotActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: "completed" as const } : a)));
    try {
      await approveAutopilotActionApi(id, businessId);
    } catch {
      setAutopilotActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: "needs_approval" as const } : a)));
      toast.error("Failed to approve action");
    }
  }, [businessId]);

  const handleDenyAutopilot = useCallback(async (id: string) => {
    if (!businessId) return;
    let backup: AutopilotAction[] = [];
    setAutopilotActions((prev) => {
      backup = prev;
      return prev.filter((a) => a.id !== id);
    });
    try {
      await denyAutopilotActionApi(id, businessId);
    } catch {
      setAutopilotActions(backup);
      toast.error("Failed to deny action");
    }
  }, [businessId]);

  return {
    flowIntelligence, flowDataLoading,
    nextActions, autopilotActions, setAutopilotActions,
    autopilotPaused, setAutopilotPaused,
    revenueData, financialGrowth, aiNextActions,
    loadFlowData,
    handleCompleteNextAction, handleApproveAutopilot, handleDenyAutopilot,
  };
}
