"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

export type PlanTier = "FREE" | "FLOW" | "KEYFLOW";

interface ResourceUsage {
  key: string;
  label: string;
  description: string;
  category: string;
  current: number;
  limit: number;
  isUnlimited: boolean;
  percent: number;
  atLimit: boolean;
  nearLimit: boolean;
}

interface FeatureAccess {
  key: string;
  label: string;
  description: string;
  category: string;
  hasAccess: boolean;
  availableFrom: string;
}

interface PlanData {
  plan: {
    id: PlanTier;
    name: string;
    tagline: string;
    status: string;
    trialExpired: boolean;
  };
  resourceUsage: ResourceUsage[];
  featureAccess: FeatureAccess[];
}

interface UsePlanResult {
  plan: PlanTier;
  planName: string;
  loading: boolean;
  isFreePlan: boolean;
  trialExpired: boolean;
  checkFeature: (featureKey: string) => { hasAccess: boolean; availableFrom: string };
  checkLimit: (resourceKey: string) => { atLimit: boolean; nearLimit: boolean; current: number; limit: number; isUnlimited: boolean; percent: number };
  resourceUsage: ResourceUsage[];
  featureAccess: FeatureAccess[];
  refresh: () => Promise<void>;
}

const planCache: { data: PlanData | null; timestamp: number; businessId: string | null } = {
  data: null,
  timestamp: 0,
  businessId: null,
};

const CACHE_TTL = 5 * 60 * 1000;

export function usePlan(): UsePlanResult {
  const [data, setData] = useState<PlanData | null>(planCache.data);
  const [loading, setLoading] = useState(!planCache.data);

  const businessId = typeof window !== "undefined" ? getStoredBusinessId() : null;

  const load = useCallback(async (force = false) => {
    if (!businessId) return;

    const now = Date.now();
    if (!force && planCache.data && planCache.businessId === businessId && now - planCache.timestamp < CACHE_TTL) {
      setData(planCache.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await apiGet<PlanData>(`/subscriptions/businesses/${businessId}/billing-dashboard`);
      if (res.data) {
        const planData: PlanData = {
          plan: res.data.plan as PlanData["plan"],
          resourceUsage: (res.data as any).resourceUsage ?? [],
          featureAccess: (res.data as any).featureAccess ?? [],
        };
        planCache.data = planData;
        planCache.timestamp = Date.now();
        planCache.businessId = businessId;
        setData(planData);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const plan = (data?.plan?.id ?? "FREE") as PlanTier;

  const checkFeature = useCallback((featureKey: string) => {
    if (!data) return { hasAccess: true, availableFrom: "FREE" };
    const feature = data.featureAccess.find((f) => f.key === featureKey);
    if (!feature) return { hasAccess: true, availableFrom: "FREE" };
    return { hasAccess: feature.hasAccess, availableFrom: feature.availableFrom };
  }, [data]);

  const checkLimit = useCallback((resourceKey: string) => {
    if (!data) return { atLimit: false, nearLimit: false, current: 0, limit: -1, isUnlimited: true, percent: 0 };
    const resource = data.resourceUsage.find((r) => r.key === resourceKey);
    if (!resource) return { atLimit: false, nearLimit: false, current: 0, limit: -1, isUnlimited: true, percent: 0 };
    return {
      atLimit: resource.atLimit,
      nearLimit: resource.nearLimit,
      current: resource.current,
      limit: resource.limit,
      isUnlimited: resource.isUnlimited,
      percent: resource.percent,
    };
  }, [data]);

  return {
    plan,
    planName: data?.plan?.name ?? "Free",
    loading,
    isFreePlan: plan === "FREE",
    trialExpired: data?.plan?.trialExpired ?? false,
    checkFeature,
    checkLimit,
    resourceUsage: data?.resourceUsage ?? [],
    featureAccess: data?.featureAccess ?? [],
    refresh: () => load(true),
  };
}
