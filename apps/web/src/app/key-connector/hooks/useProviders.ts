'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/trpc/react';
import type { Provider } from '../types';

interface UseProvidersResult {
  providers: Provider[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * Hook for fetching and polling the list of integration providers.
 * Auto-refreshes every 30 seconds.
 */
export function useProviders(): UseProvidersResult {
  const utils = api.useUtils();
  const [error, setError] = useState<Error | null>(null);

  const {
    data: rawData,
    isLoading,
    error: queryError,
  } = api.keyConnector.getProviders.useQuery(undefined, {
    refetchInterval: 30_000, // 30 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Normalize data — handle both array and { providers: [] } shapes
  const providers: Provider[] = Array.isArray(rawData)
    ? rawData
    : rawData?.providers ?? [];

  useEffect(() => {
    if (queryError) {
      setError(
        queryError instanceof Error
          ? queryError
          : new Error(String(queryError)),
      );
    } else {
      setError(null);
    }
  }, [queryError]);

  const refresh = useCallback(() => {
    void utils.keyConnector.getProviders.invalidate();
  }, [utils]);

  return { providers, isLoading, error, refresh };
}
