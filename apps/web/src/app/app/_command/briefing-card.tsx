"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { fetchAiBriefing, fetchFinancialPulse, fetchCampaignBriefings } from "@/lib/client";
import type { AiBriefing, FinancialPulse, CampaignBriefing } from "./types";
import { BriefingSummary, FinancialPulseSection, CampaignIntelSection } from "./briefing-sections";

interface BriefingCardProps {
  businessId: string | null;
  initialFinancialPulse?: FinancialPulse | null;
  initialCampaignBriefings?: CampaignBriefing[];
}

const STORAGE_KEY = "kf-briefing-seen";

export function BriefingCard({ businessId, initialFinancialPulse, initialCampaignBriefings = [] }: BriefingCardProps) {
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    return !localStorage.getItem(STORAGE_KEY);
  });

  const [briefing, setBriefing] = useState<AiBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [financialPulse, setFinancialPulse] = useState<FinancialPulse | null>(initialFinancialPulse ?? null);
  const [campaignBriefings, setCampaignBriefings] = useState<CampaignBriefing[]>(initialCampaignBriefings);

  const handleToggle = () => {
    setExpanded((prev) => {
      if (!prev === false) localStorage.setItem(STORAGE_KEY, "1");
      return !prev;
    });
  };

  const handleGenerate = useCallback(async () => {
    if (!businessId || briefingLoading) return;
    setBriefingLoading(true);
    try {
      const [briefRes, finRes, campRes] = await Promise.all([
        fetchAiBriefing(businessId),
        financialPulse ? Promise.resolve({ data: financialPulse }) : fetchFinancialPulse(businessId),
        campaignBriefings.length > 0 ? Promise.resolve({ data: campaignBriefings }) : fetchCampaignBriefings(businessId),
      ]);
      if (briefRes.data) setBriefing(briefRes.data);
      if (finRes.data) setFinancialPulse(finRes.data as FinancialPulse);
      if (campRes.data) setCampaignBriefings(campRes.data as CampaignBriefing[]);
      setExpanded(true);
    } catch {}
    setBriefingLoading(false);
  }, [businessId, briefingLoading, financialPulse, campaignBriefings]);

  useEffect(() => { if (initialFinancialPulse) setFinancialPulse(initialFinancialPulse); }, [initialFinancialPulse]);
  useEffect(() => { if (initialCampaignBriefings.length > 0) setCampaignBriefings(initialCampaignBriefings); }, [initialCampaignBriefings]);

  const hasContent = briefing || financialPulse || campaignBriefings.length > 0;

  return (
    <div className="kf-card overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3 border-b border-border hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sun className="w-4 h-4" style={{ color: "hsl(var(--kf-warning))" }} />
          <h2 className="kf-text-caption font-semibold uppercase tracking-wider">Daily Briefing</h2>
          {!hasContent && <span className="text-[10px] text-muted-foreground ml-1">Click Generate to start</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); handleGenerate(); }}
            disabled={briefingLoading || !businessId}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-40 bg-muted/30 border border-border hover:bg-muted/50"
          >
            <RefreshCw className={briefingLoading ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
            {briefing ? "Refresh" : "Generate"}
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="p-4 space-y-4">
              {briefingLoading && !briefing && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-3 rounded bg-muted/30 animate-pulse" style={{ width: `${50 + i * 15}%` }} />
                  ))}
                </div>
              )}
              {briefing && <BriefingSummary briefing={briefing} />}
              {financialPulse && <FinancialPulseSection pulse={financialPulse} />}
              <CampaignIntelSection briefings={campaignBriefings} />
              {!hasContent && !briefingLoading && (
                <div className="text-center py-6">
                  <Sun className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(var(--kf-warning) / 0.2)" }} />
                  <p className="text-[11px] text-muted-foreground">Generate your daily business summary</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
