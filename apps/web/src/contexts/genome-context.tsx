"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import { getGenome, type GenomeIntegrityResult } from "@/lib/api/business-genome";

interface GenomeContextValue {
  genome: GenomeIntegrityResult | null;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  refresh: () => Promise<void>;
}

const GenomeContext = createContext<GenomeContextValue | null>(null);

export function GenomeProvider({ children }: { children: ReactNode }) {
  const businessId = getStoredBusinessId();
  const [state, setState] = useState<{
    genome: GenomeIntegrityResult | null;
    loading: boolean;
    error: string | null;
    hasLoaded: boolean;
  }>({
    genome: null,
    loading: false,
    error: null,
    hasLoaded: false,
  });
  const loadingRef = useRef(false);

  // Reset cached state when the active business changes.
  useEffect(() => {
    setState({
      genome: null,
      loading: false,
      error: null,
      hasLoaded: false,
    });
  }, [businessId]);

  const refresh = useCallback(async () => {
    if (!businessId) return;
    if (loadingRef.current) return;

    loadingRef.current = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const { data, error: apiError } = await getGenome(businessId);
      setState({
        genome: data ?? null,
        error: apiError || (!data ? "Failed to load Business Genome" : null),
        loading: false,
        hasLoaded: true,
      });
    } catch (err) {
      setState({
        genome: null,
        error: err instanceof Error ? err.message : "Network error",
        loading: false,
        hasLoaded: true,
      });
    } finally {
      loadingRef.current = false;
    }
  }, [businessId]);

  const value = useMemo<GenomeContextValue>(
    () => ({ ...state, refresh }),
    [state, refresh],
  );

  return <GenomeContext.Provider value={value}>{children}</GenomeContext.Provider>;
}

export function useGenome(): GenomeContextValue {
  const ctx = useContext(GenomeContext);
  if (!ctx) {
    throw new Error("useGenome must be used within a GenomeProvider");
  }

  const { hasLoaded, loading, refresh } = ctx;
  useEffect(() => {
    if (!hasLoaded && !loading) {
      void refresh();
    }
  }, [hasLoaded, loading, refresh]);

  return ctx;
}
