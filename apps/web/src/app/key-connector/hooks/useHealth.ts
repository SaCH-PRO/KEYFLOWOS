'use client';

import { useCallback, useMemo } from 'react';
import { api } from '@/trpc/react';
import type { HealthCheck, HealthStatus, OverallHealth } from '../types';

interface UseHealthResult {
  healthResults: HealthCheck[];
  overallScore: number;
  overallStatus: HealthStatus;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * Hook for fetching connection health data.
 * Polls every 30 seconds.
 */
export function useHealth(): UseHealthResult {
  const utils = api.useUtils();

  const {
    data: rawData,
    isLoading,
    error: queryError,
  } = api.keyConnector.getConnectionHealth.useQuery(undefined, {
    refetchInterval: 30_000, // 30 seconds
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
  });

  // Normalize data
  const checks: HealthCheck[] = Array.isArray(rawData)
    ? rawData
    : rawData?.checks ?? [];

  const overall: OverallHealth | null =
    rawData && 'score' in rawData
      ? (rawData as unknown as OverallHealth)
      : null;

  const overallScore = useMemo(
    () => overall?.score ?? Math.round(
      checks.length > 0
        ? checks.reduce((sum, c) => sum + c.score, 0) / checks.length
        : 0,
    ),
    [overall, checks],
  );

  const overallStatus: HealthStatus = useMemo(() => {
    if (overall?.status) return overall.status;
    if (checks.length === 0) return 'unknown';
    const unhealthy = checks.filter((c) => c.status === 'unhealthy').length;
    const degraded = checks.filter((c) => c.status === 'degraded').length;
    if (unhealthy > 0) return 'unhealthy';
    if (degraded > 0) return 'degraded';
    return 'healthy';
  }, [overall, checks]);

  const refresh = useCallback(() => {
    void utils.keyConnector.getConnectionHealth.invalidate();
  }, [utils]);

  const error = queryError
    ? queryError instanceof Error
      ? queryError
      : new Error(String(queryError))
    : null;

  return {
    healthResults: checks,
    overallScore,
    overallStatus,
    isLoading,
    error,
    refresh,
  };
}
