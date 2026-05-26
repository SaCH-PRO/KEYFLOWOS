"use client";

import { useState, useCallback, useEffect } from "react";
import {
  generatePlan,
  fetchPlans,
  fetchPlan,
  approvePlan,
  rejectPlan,
  deletePlan,
  reorderPlanEvents,
  analyzeImpact,
  executeInAppEvent,
  completeOutAppEvent,
  type ProjectPlan,
  type GeneratePlanInput,
} from "@/lib/project-plans-api";

export function useProjectPlans(businessId: string | null) {
  const [plans, setPlans] = useState<ProjectPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    const res = await fetchPlans(businessId);
    if (res.error) setError(res.error);
    else if (res.data) setPlans(res.data);
    setLoading(false);
  }, [businessId]);

  const createPlan = useCallback(async (input: GeneratePlanInput) => {
    if (!businessId) return { error: "No business selected" };
    setLoading(true);
    const res = await generatePlan(businessId, input);
    if (res.error) setError(res.error);
    else if (res.data) setPlans((prev) => res.data ? [res.data, ...prev] : prev);
    setLoading(false);
    return res;
  }, [businessId]);

  const removePlan = useCallback(async (planId: string) => {
    if (!businessId) return;
    const res = await deletePlan(businessId, planId);
    if (!res.error) setPlans((prev) => prev.filter((p) => p.id !== planId));
    return res;
  }, [businessId]);

  const approve = useCallback(async (planId: string) => {
    if (!businessId) return { error: "No business selected" };
    const res = await approvePlan(businessId, planId);
    if (res.data) {
      setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, status: "materialized" } : p)));
    }
    return res;
  }, [businessId]);

  const reject = useCallback(async (planId: string) => {
    if (!businessId) return { error: "No business selected" };
    const res = await rejectPlan(businessId, planId);
    if (res.data) {
      setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, status: "rejected" } : p)));
    }
    return res;
  }, [businessId]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  return {
    plans,
    loading,
    error,
    loadPlans,
    createPlan,
    removePlan,
    approve,
    reject,
  };
}

export function useProjectPlan(businessId: string | null, planId: string | null) {
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    if (!businessId || !planId) return;
    setLoading(true);
    setError(null);
    const res = await fetchPlan(businessId, planId);
    if (res.error) setError(res.error);
    else if (res.data) setPlan(res.data);
    setLoading(false);
  }, [businessId, planId]);

  const reorderEvents = useCallback(async (updates: { eventId: string; sortOrder: number }[]) => {
    if (!businessId || !planId) return { error: "Missing business or plan" };
    const res = await reorderPlanEvents(businessId, planId, updates);
    if (res.data) setPlan(res.data);
    return res;
  }, [businessId, planId]);

  const analyzeEventImpact = useCallback(async (eventId: string, newSortOrder: number) => {
    if (!businessId || !planId) return { error: "Missing business or plan", data: null };
    return analyzeImpact(businessId, planId, eventId, newSortOrder);
  }, [businessId, planId]);

  const executeEvent = useCallback(async (eventId: string) => {
    if (!businessId || !planId) return { error: "Missing business or plan", data: null };
    return executeInAppEvent(businessId, planId, eventId);
  }, [businessId, planId]);

  const completeEvent = useCallback(async (eventId: string, evidence?: string) => {
    if (!businessId || !planId) return { error: "Missing business or plan", data: null };
    return completeOutAppEvent(businessId, planId, eventId, evidence);
  }, [businessId, planId]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  return {
    plan,
    loading,
    error,
    loadPlan,
    reorderEvents,
    analyzeEventImpact,
    executeEvent,
    completeEvent,
  };
}
