"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkUsernameAvailability,
  validateUsernameFormat,
  type UsernameAvailability,
} from "@/lib/username-availability";

export type UsernameStatus =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "unknown";

export interface UseUsernameAvailabilityOptions {
  debounceMs?: number;
}

export interface UseUsernameAvailabilityResult {
  status: UsernameStatus;
  error?: string;
  check: (username: string) => Promise<UsernameAvailability | null>;
  reset: () => void;
}

export function useUsernameAvailability(
  options: UseUsernameAvailabilityOptions = {},
): UseUsernameAvailabilityResult {
  const { debounceMs = 300 } = options;
  const [status, setStatus] = useState<UsernameStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serialRef = useRef(0);

  const reset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setStatus("idle");
    setError(undefined);
  }, []);

  const check = useCallback(
    async (username: string): Promise<UsernameAvailability | null> => {
      reset();

      const value = username.trim();
      const format = validateUsernameFormat(value);
      if (!format.valid) {
        setStatus("unknown");
        setError(format.error);
        return null;
      }

      setStatus("checking");
      setError(undefined);

      const serial = ++serialRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      return new Promise((resolve) => {
        timeoutRef.current = setTimeout(async () => {
          try {
            const result = await checkUsernameAvailability(value, {
              signal: controller.signal,
            });
            // Ignore stale results from out-of-order responses.
            if (serial !== serialRef.current) {
              resolve(null);
              return;
            }
            setStatus(result.status);
            if (result.status === "unknown") {
              setError("Couldn’t verify username. Check your connection and try again.");
            }
            resolve(result);
          } catch (err) {
            if (serial !== serialRef.current) {
              resolve(null);
              return;
            }
            if (err instanceof Error && err.name === "AbortError") {
              resolve(null);
              return;
            }
            setStatus("unknown");
            setError("Couldn’t verify username. Check your connection and try again.");
            resolve({ status: "unknown", available: null });
          } finally {
            if (abortRef.current === controller) {
              abortRef.current = null;
            }
          }
        }, debounceMs);
      });
    },
    [debounceMs, reset],
  );

  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  return { status, error, check, reset };
}
