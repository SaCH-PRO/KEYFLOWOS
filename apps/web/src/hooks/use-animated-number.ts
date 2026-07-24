"use client";

import { useEffect, useState } from "react";

export function useAnimatedNumber(
  target: number,
  options: { duration?: number; decimals?: number; delay?: number } = {},
): number {
  const { duration = 800, decimals = 0, delay = 0 } = options;
  const [value, setValue] = useState(target);

  useEffect(() => {
    let raf = 0;
    const startTimeout = window.setTimeout(() => {
      const start = value;
      const delta = target - start;
      const startTime = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const next = start + delta * eased;
        setValue(Number(next.toFixed(decimals)));
        if (progress < 1) {
          raf = requestAnimationFrame(tick);
        }
      };

      raf = requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(startTimeout);
      cancelAnimationFrame(raf);
    };
  }, [target, duration, decimals, delay, value]);

  return value;
}
