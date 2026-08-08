"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Sparkles } from "lucide-react";

const PARTICLE_COUNT = 18;

const THRESHOLDS = [25, 50, 80, 100];

function getHighestMetThreshold(integrity: number): number | null {
  let highest: number | null = null;
  for (const t of THRESHOLDS) {
    if (integrity >= t) highest = t;
  }
  return highest;
}

function storageKey(businessId: string | null, threshold: number): string {
  return `kf-genome-milestone-${businessId ?? "anon"}-${threshold}`;
}

interface GenomeMilestoneProps {
  businessId: string | null;
  integrity: number;
}

export function GenomeMilestone({ businessId, integrity }: GenomeMilestoneProps) {
  const [show, setShow] = useState(false);
  const [threshold, setThreshold] = useState<number | null>(null);

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }).map((_, i) => ({
        id: i,
        x: (Math.sin(i * 1.7) * 0.5 + 0.5) * 220 - 110,
        y: (Math.cos(i * 2.3) * 0.5 + 0.5) * 220 - 110,
        duration: 1.2 + ((i * 0.13) % 0.8),
        delay: (i * 0.03) % 0.3,
        rotation: (i * 47) % 360,
        color:
          i % 3 === 0
            ? "hsl(var(--kf-accent1))"
            : i % 3 === 1
              ? "hsl(var(--kf-accent2))"
              : "hsl(var(--kf-success))",
      })),
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const highest = getHighestMetThreshold(integrity);
    if (!highest) return;
    const key = storageKey(businessId, highest);
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    const showTimer = window.setTimeout(() => {
      setThreshold(highest);
      setShow(true);
    }, 0);
    const hideTimer = window.setTimeout(() => setShow(false), 4500);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [businessId, integrity]);

  if (!threshold) return null;

  const label =
    threshold === 100
      ? "Genome Complete"
      : threshold === 80
        ? "Genome Strong"
      : threshold === 50
        ? "Genome Halfway"
        : "Genome Bootstrapped";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -8 }}
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        >
          <div className="absolute inset-0 bg-black/20" />
          <motion.div
            className="relative pointer-events-auto rounded-2xl px-8 py-6 text-center shadow-2xl"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.2) 100%)",
              border: "1px solid hsl(var(--kf-accent1) / 0.3)",
            }}
          >
            <div className="absolute inset-0 overflow-hidden rounded-2xl">
              {particles.map((p) => (
                <motion.div
                  key={p.id}
                  initial={{
                    opacity: 0,
                    x: 0,
                    y: 0,
                    scale: 0,
                  }}
                  animate={{
                    opacity: [0, 1, 0],
                    x: p.x,
                    y: p.y,
                    scale: [0, 1, 0.5],
                    rotate: p.rotation,
                  }}
                  transition={{
                    duration: p.duration,
                    delay: p.delay,
                    ease: "easeOut",
                  }}
                  className="absolute left-1/2 top-1/2 w-2 h-2 rounded-full"
                  style={{ background: p.color }}
                />
              ))}
            </div>

            <div className="relative">
              <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-200 to-amber-500 text-amber-950 shadow-lg">
                <Trophy className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-bold">{label}</h3>
              <p className="mt-1 text-sm text-muted-foreground flex items-center justify-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                Genome integrity reached {threshold}%
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
