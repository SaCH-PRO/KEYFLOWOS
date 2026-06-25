'use client';

import { useCallback, useState } from 'react';
import { api } from '@/trpc/react';
import type { SyncJob } from '../types';

interface UseSyncStatusResult {
  syncStatus: SyncJob[];
  isLoading: boolean;
  error: Error | null;
  triggerSync: (providerKey: string) => void;
  isSyncing: boolean;
  refresh: () => void;
}

/**
 * Hook for fetching real-time sync status across all connections.
 * Polls every 10 seconds for live updates.
 */
export function useSyncStatus(): UseSyncStatusResult {
  const utils = api.useUtils();
  const [isSyncing, setIsSyncing] = useState(false);

  const {
    data: rawData,
    isLoading,
    error: queryError,
  } = api.keyConnector.getSyncHistory.useQuery(undefined, {
    refetchInterval: 10_000, // 10 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
  });

  const syncMutation = api.keyConnector.triggerSync.useMutation({
    onMutate: () => setIsSyncing(true),
    onSettled: () => {
      setIsSyncing(false);
      void utils.keyConnector.getSyncHistory.invalidate();
    },
  });

  // Normalize data — handle both array and { jobs: [] } shapes
  const syncStatus: SyncJob[] = Array.isArray(rawData)
    ? rawData
    : rawData?.jobs ?? [];

  const triggerSync = useCallback(
    (providerKey: string) => {
      syncMutation.mutate({ providerKey });
    },
    [syncMutation],
  );

  const refresh = useCallback(() => {
    void utils.keyConnector.getSyncHistory.invalidate();
  }, [utils]);

  const error = queryError
    ? queryError instanceof Error
      ? queryError
      : new Error(String(queryError))
    : null;

  return {
    syncStatus,
    isLoading,
    error,
    triggerSync,
    isSyncing: isSyncing || syncMutation.isPending,
    refresh,
  };
}
