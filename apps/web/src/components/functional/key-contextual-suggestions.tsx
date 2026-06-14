"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { Sparkles, ArrowRight, X, Dna } from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import type { BlueprintData } from "@/lib/blueprint-types";

interface Suggestion {
  prompt: string;
  label: string;
  icon?: string;
}

const ROUTE_SUGGESTIONS: Record<string, Suggestion[]> = {
  "/app/crm": [
    { prompt: "Who are my hottest leads right now?", label: "Hot leads" },
    { prompt: "Draft follow-ups for stale contacts", label: "Follow-ups" },
    { prompt: "Show me my pipeline forecast", label: "Forecast" },
  ],
  "/app/money": [
    { prompt: "Which invoices are overdue?", label: "Overdue" },
    { prompt: "What's my cash position this month?", label: "Cash position" },
    { prompt: "Generate a revenue report", label: "Revenue report" },
  ],
  "/app/bookings": [
    { prompt: "Fill empty slots in my calendar", label: "Fill calendar" },
    { prompt: "Show today's schedule", label: "Today's schedule" },
    { prompt: "Optimize my availability", label: "Optimize" },
  ],
  "/app/projects": [
    { prompt: "What projects are at risk?", label: "At risk" },
    { prompt: "Summarize project progress", label: "Progress" },
    { prompt: "Create tasks from my emails", label: "Email tasks" },
  ],
  "/app/marketing": [
    { prompt: "Draft a social media post", label: "Social post" },
    { prompt: "What's my campaign performance?", label: "Performance" },
    { prompt: "Generate email subject lines", label: "Subject lines" },
  ],
};

function getSuggestionsForPath(pathname: string): Suggestion[] {
  // Find the most specific matching route
  const routes = Object.keys(ROUTE_SUGGESTIONS).sort((a, b) => b.length - a.length);
  for (const route of routes) {
    if (pathname.startsWith(route)) {
      return ROUTE_SUGGESTIONS[route];
    }
  }
  return [
    { prompt: "What should I focus on today?", label: "Focus" },
    { prompt: "Why is cash slow?", label: "Cash flow" },
    { prompt: "Fill my calendar", label: "Calendar" },
  ];
}

export function KeyContextualSuggestions() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [dismissedAt, setDismissedAt] = useState<number>(0);
  const [blueprintCompleteness, setBlueprintCompleteness] = useState<number | null>(null);

  const suggestions = useMemo(() => getSuggestionsForPath(pathname), [pathname]);
  const blueprintIncomplete = blueprintCompleteness !== null && blueprintCompleteness < 100;

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    let cancelled = false;
    apiGet<BlueprintData>(`/blueprint/businesses/${businessId}`)
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setBlueprintCompleteness(data.completeness);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Show suggestions when entering a new route (after a delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (Date.now() - dismissedAt > 30000) {
        setVisible(true);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [pathname, dismissedAt]);

  const handleDismiss = () => {
    setVisible(false);
    setDismissedAt(Date.now());
  };

  const handleSuggest = (prompt: string) => {
    window.dispatchEvent(
      new CustomEvent("kf:open-key", { detail: { mode: "chat", prompt } })
    );
    setVisible(false);
  };

  const handleOpenBlueprintOnboarding = () => {
    window.location.href = "/app/blueprint?onboarding=1";
  };

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.96 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="fixed bottom-[88px] md:bottom-6 left-4 md:left-6 z-[var(--kf-z-key-presence)] max-w-sm"
      >
        <div className="kf-glass-key p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {blueprintIncomplete ? "Finish setup" : "KEY Suggests"}
              </span>
            </div>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {blueprintIncomplete ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center"
                  style={{ background: "hsl(var(--kf-accent1) / 0.12)" }}
                >
                  <Dna className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <p className="text-xs font-medium">Business Genome {blueprintCompleteness}% complete</p>
                  <p className="text-[10px] text-muted-foreground">
                    KEY can finish it with a few questions.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSuggest("Hi KEY, can you help me complete my Business Genome?")}
                  className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-r from-orange-500/12 to-teal-500/8 border border-orange-500/15 text-foreground/90 hover:border-orange-500/30 transition-all"
                >
                  Chat with KEY
                  <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/50" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleOpenBlueprintOnboarding}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-border hover:bg-muted/30 transition-all"
                >
                  Open
                </motion.button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <motion.button
                  key={s.label}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSuggest(s.prompt)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-gradient-to-r from-orange-500/8 to-teal-500/5 border border-orange-500/10 text-foreground/80 hover:border-orange-500/25 hover:from-orange-500/12 hover:to-teal-500/8 transition-all"
                >
                  {s.label}
                  <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/50" />
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
