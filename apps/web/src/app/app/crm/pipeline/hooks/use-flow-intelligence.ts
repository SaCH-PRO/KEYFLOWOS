"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { NextAction as NextActionUI } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import {
  fetchFlowIntelligence, fetchNextActions,
  fetchAutopilotActionsForCrm, fetchPredictiveRevenue,
  completeNextAction,
  approveAutopilotAction as approveAutopilotActionApi,
  denyAutopilotAction as denyAutopilotActionApi,
} from "@/lib/client";

export function useFlowIntelligence(businessId: string | null) {
  const [flowIntelligence, setFlowIntelligence] = useState<FlowIntelligenceData | null>(null);
  const [nextActions, setNextActions] = useState<NextActionUI[]>([]);
  const [autopilotActions, setAutopilotActions] = useState<AutopilotAction[]>([]);
  const [autopilotPaused, setAutopilotPaused] = useState(false);
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [flowDataLoading, setFlowDataLoading] = useState(false);

  const loadFlowData = useCallback(async () => {
    if (!businessId) return;
    setFlowDataLoading(true);
    try {
      const [flowRes, actionsRes, autopilotRes, revenueRes] = await Promise.all([
        fetchFlowIntelligence(businessId),
        fetchNextActions(businessId),
        fetchAutopilotActionsForCrm(businessId),
        fetchPredictiveRevenue(businessId),
      ]);
      if (flowRes.data) setFlowIntelligence(flowRes.data);
      if (actionsRes.data) {
        setNextActions(actionsRes.data.map((a) => ({
          id: a.id, type: a.type, contactId: a.contactId, contactName: a.contactName,
          description: a.description, aiDraft: a.aiDraft, estimatedTime: a.estimatedTime,
          priority: a.priority, dueDate: a.dueDate, value: a.value,
        })));
      }
      if (autopilotRes.data) setAutopilotActions(autopilotRes.data);
      if (revenueRes.data) setRevenueData(revenueRes.data);
    } catch {
      toast.error("Failed to load flow intelligence");
    } finally {
      setFlowDataLoading(false);
    }
  }, [businessId]);

  const handleCompleteNextAction = async (actionId: string) => {
    if (!businessId) return;
    try {
      await completeNextAction(actionId, businessId);
      setNextActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch {
      toast.error("Failed to complete action");
    }
  };

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
    const backup = autopilotActions;
    setAutopilotActions((prev) => prev.filter((a) => a.id !== id));
    try {
      await denyAutopilotActionApi(id, businessId);
    } catch {
      setAutopilotActions(backup);
      toast.error("Failed to deny action");
    }
  }, [businessId, autopilotActions]);

  return {
    flowIntelligence, flowDataLoading,
    nextActions, autopilotActions, setAutopilotActions,
    autopilotPaused, setAutopilotPaused,
    revenueData,
    loadFlowData,
    handleCompleteNextAction, handleApproveAutopilot, handleDenyAutopilot,
  };
}
