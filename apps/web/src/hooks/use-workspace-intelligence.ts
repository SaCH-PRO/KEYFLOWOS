"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchWorkspaceRecommendations,
  fetchAutomationCoverage,
  type WorkspaceRecommendation,
  type AutomationCoverage,
} from "@/lib/client";

interface UseWorkspaceIntelligenceOptions {
  businessId: string | null;
  module: string;
  enabled?: boolean;
}

export function useWorkspaceIntelligence({ businessId, module, enabled = true }: UseWorkspaceIntelligenceOptions) {
  const [recommendations, setRecommendations] = useState<WorkspaceRecommendation[]>([]);
  const [coverage, setCoverage] = useState<AutomationCoverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const fetchedRef = useRef(false);

  const loadRecommendations = useCallback(async () => {
    if (!businessId || !enabled) return;
    setLoading(true);
    try {
      const [recsRes, covRes] = await Promise.all([
        fetchWorkspaceRecommendations(businessId, module),
        fetchAutomationCoverage(businessId),
      ]);
      if (recsRes.data) setRecommendations(recsRes.data);
      if (covRes.data) setCoverage(covRes.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [businessId, module, enabled]);

  useEffect(() => {
    if (!businessId || !enabled || fetchedRef.current) return;
    fetchedRef.current = true;
    void loadRecommendations();
  }, [businessId, enabled, loadRecommendations]);

  useEffect(() => {
    fetchedRef.current = false;
  }, [module, businessId]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  }, []);

  const visibleRecs = recommendations.filter((r) => !dismissed.has(r.id));

  const moduleCoverage = coverage?.modules.find((m) => m.module === module) ?? null;

  return {
    recommendations: visibleRecs,
    coverage,
    moduleCoverage,
    loading,
    dismiss,
    refresh: loadRecommendations,
  };
}
