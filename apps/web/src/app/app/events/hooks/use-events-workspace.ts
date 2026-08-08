"use client";

import { useEffect, useState } from "react";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";

export function useEventsWorkspace() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        setLoading(false);
        return;
      }
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
        setLoading(false);
        return;
      }
      setError("Could not find your workspace. Please sign in again.");
      setLoading(false);
    };
    void initWorkspace();
  }, []);

  return { businessId, loading, error };
}
