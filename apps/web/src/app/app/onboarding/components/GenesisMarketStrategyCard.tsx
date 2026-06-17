"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Target, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { generateMarketStrategy, getMarketStrategy } from "@/lib/api/business-genesis";

export function GenesisMarketStrategyCard() {
  const [generating, setGenerating] = useState(false);
  const [exists, setExists] = useState(false);

  const checkExists = useCallback(async () => {
    const bid = getStoredBusinessId();
    if (!bid) return;
    const { data } = await getMarketStrategy(bid);
    if (data?.strategy) setExists(true);
  }, []);

  const handleGenerate = async () => {
    const bid = getStoredBusinessId();
    if (!bid) return;
    setGenerating(true);
    const { data, error } = await generateMarketStrategy(bid);
    setGenerating(false);
    if (error || !data) {
      toast.error(error || "Could not generate market strategy.");
      return;
    }
    setExists(true);
    toast.success("Market strategy generated.");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-5 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
        >
          <Target className="w-5 h-5" />
        </div>
        <div className="space-y-1 flex-1">
          <h3 className="text-sm font-semibold">Market Strategy & Intelligence</h3>
          <p className="text-sm text-muted-foreground">
            Build a SWOT, PESTLE, competitor profile, positioning statement, and 90-day launch plan.
          </p>
        </div>
      </div>
      <button
        onClick={handleGenerate}
        disabled={generating}
        onMouseEnter={() => {
          if (!exists) void checkExists();
        }}
        className="kf-btn-secondary flex items-center gap-2 px-5 py-2.5 w-full sm:w-auto justify-center"
      >
        {generating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{exists ? "Regenerating strategy..." : "Generating strategy..."}</span>
          </>
        ) : (
          <>
            <Target className="w-4 h-4" />
            <span>{exists ? "Regenerate market strategy" : "Generate market strategy"}</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </motion.div>
  );
}
