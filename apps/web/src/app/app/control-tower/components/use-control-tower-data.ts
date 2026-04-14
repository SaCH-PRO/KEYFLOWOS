"use client";

import { useState, useEffect, useCallback } from "react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchControlTower,
  type ControlTowerData,
  type ControlTowerPriority,
} from "@/lib/client";

export type ControlTowerState = {
  loading: boolean;
  error: string | null;
  businessId: string;
  data: ControlTowerData | null;
  priorities: ControlTowerPriority[];
  refresh: () => void;
};

export function useControlTowerData(): ControlTowerState {
  const businessId = getStoredBusinessId() ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ControlTowerData | null>(null);

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      setError("No business selected");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchControlTower(businessId);
      if (res.data) {
        setData(res.data);
      } else {
        setError("Failed to load Control Tower data");
      }
    } catch {
      setError("Failed to load Control Tower data");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    error,
    businessId,
    data,
    priorities: data?.priorities ?? [],
    refresh: load,
  };
}
