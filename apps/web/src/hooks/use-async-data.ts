import { useState, useCallback } from "react";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

export function useAsyncData<T>(fetcher: () => Promise<ApiResponse<T>>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetcher();
      if (res.error) {
        setError(res.error);
        setData(null);
      } else {
        setData(res.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, load, clear, setData };
}
