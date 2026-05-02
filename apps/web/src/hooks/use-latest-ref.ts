"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * Holds the latest value of `value` in a ref so it can be read inside
 * stable callbacks/effects without including the value in the dependency
 * array. Updating the ref happens in a passive effect, which keeps the
 * write out of the render phase and satisfies the React 19
 * `react-hooks/refs` rule.
 *
 * Use only for "read latest in event handlers" patterns. Do NOT read
 * `ref.current` during render — read state instead.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
