"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ArrowRight, Dna } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { getGenomeIntegrity } from "@/lib/api/business-genome";

const HIDE_ON_PATHS = ["/app/profile", "/app/auth", "/app/onboarding", "/app/blueprint"];

function shouldShowForPath(pathname: string): boolean {
  if (!pathname) return false;
  return !HIDE_ON_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}?`) || pathname.startsWith(`${p}/`));
}

export function GenomeIntegrityBanner() {
  const pathname = usePathname();
  const router = useRouter();
  const [integrity, setIntegrity] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no businessId available on mount
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getGenomeIntegrity(businessId)
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setIntegrity(data.genomeIntegrity);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const visible =
    !loading &&
    !dismissed &&
    shouldShowForPath(pathname || "") &&
    integrity !== null &&
    integrity < 100;

  if (!visible) return null;

  const color =
    integrity >= 80
      ? "hsl(var(--kf-success, 160 70% 45%))"
      : integrity >= 40
        ? "hsl(var(--kf-accent1))"
        : "hsl(var(--kf-warning, 30 90% 50%))";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.25 }}
        className="relative z-40 w-full"
        style={{
          background: "linear-gradient(90deg, hsl(var(--kf-accent1) / 0.12), hsl(var(--kf-accent2) / 0.06))",
          borderBottom: "1px solid hsl(var(--kf-accent1) / 0.15)",
        }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5">
          <div className="flex items-center gap-3 sm:gap-4">
            <div
              className="hidden sm:flex h-9 w-9 rounded-lg items-center justify-center flex-shrink-0"
              style={{ background: "hsl(var(--kf-accent1) / 0.12)" }}
            >
              <Dna className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 sm:hidden" style={{ color: "hsl(var(--kf-accent1))" }} />
                  <span className="text-sm font-semibold truncate">Build your Business Genome</span>
                  <span className="text-xs font-medium tabular-nums" style={{ color }}>
                    {integrity}%
                  </span>
                </div>
                <div className="flex-1 max-w-xs">
                  <div className="h-1.5 w-full rounded-full bg-background/50 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${integrity}%` }}
                      transition={{ duration: 0.6 }}
                      style={{ background: color }}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground hidden md:block">
                  Genome Integrity — KEY works best when it knows your business.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => router.push("/app/profile?tab=business-genome")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  background: "hsl(var(--kf-accent1))",
                  color: "hsl(var(--kf-accent1-foreground, var(--kf-background)))",
                }}
              >
                Continue
                <ArrowRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/40 transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
