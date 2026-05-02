"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { apiGet } from "@/lib/api";

interface ProgressivePrompt {
  id: string;
  trigger: string;
  subProfile: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

export function ProgressivePrompts({ businessId = null, moduleFilter }: { businessId?: string | null; moduleFilter?: string[] }) {
  const router = useRouter();
  const [prompts, setPrompts] = useState<ProgressivePrompt[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (!businessId) { setLoading(false); return; }
    setLoading(true);

    const stored = localStorage.getItem(`dismissed-prompts-${businessId}`);
    try {
      setDismissed(stored ? new Set(JSON.parse(stored)) : new Set());
    } catch {
      setDismissed(new Set());
    }

    apiGet<ProgressivePrompt[]>(`/identity/businesses/${businessId}/progressive-prompts`)
      .then(({ data }) => {
        if (data) setPrompts(data);
      })
      .catch((err) => {
        console.error("Failed to load progressive prompts:", err);
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  const dismiss = useCallback((promptId: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(promptId);
      if (businessId) {
        localStorage.setItem(`dismissed-prompts-${businessId}`, JSON.stringify([...next]));
      }
      return next;
    });
  }, [businessId]);

  if (loading) return null;

  const visible = prompts
    .filter(p => !dismissed.has(p.id))
    .filter(p => !moduleFilter || moduleFilter.includes(p.subProfile))
    .slice(0, 2);
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {visible.map((prompt) => (
          <motion.div
            key={prompt.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl p-3 relative"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
              border: "1px solid hsl(var(--kf-accent1) / 0.15)",
            }}
          >
            <button
              onClick={() => dismiss(prompt.id)}
              className="absolute top-2 right-2 p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.15)] transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
            </button>

            <div className="flex items-start gap-2.5 pr-6">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: "hsl(var(--kf-accent1) / 0.12)" }}
              >
                <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold mb-0.5">{prompt.title}</h4>
                <p className="text-xs mb-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  {prompt.body}
                </p>
                <button
                  onClick={() => router.push(prompt.ctaHref)}
                  className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{
                    background: "hsl(var(--kf-accent1) / 0.1)",
                    color: "hsl(var(--kf-accent1))",
                  }}
                >
                  {prompt.ctaLabel}
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
