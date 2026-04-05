"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Compass, ArrowRight, BarChart3, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@keyflow/ui";
import {
  getGuidanceStatus,
  getGuidanceCompletionPercentage,
  loadGuidanceDraft,
  type GuidanceStatus,
} from "./guidance-storage";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

interface GuidanceCardProps {
  onLaunchWizard: () => void;
}

export default function GuidanceCard({ onLaunchWizard }: GuidanceCardProps) {
  const [status, setStatus] = useState<GuidanceStatus>("not_started");
  const [percentage, setPercentage] = useState(0);

  useEffect(() => {
    setStatus(getGuidanceStatus());
    const draft = loadGuidanceDraft();
    setPercentage(getGuidanceCompletionPercentage(draft));
  }, []);

  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Compass className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Business Guidance
      </div>

      {status === "not_started" && (
        <>
          <div className="space-y-2">
            <p className="text-sm text-foreground font-medium">
              Get a personalized business assessment
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Answer structured questions about your business and receive tailored recommendations,
              risk analysis, financial insights, and growth strategies — all in about 15 minutes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Clarity", "Financial Visibility", "Risk Awareness", "Growth Plan"].map((tag) => (
              <span
                key={tag}
                className="px-2 py-1 rounded-lg text-[11px] font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
              >
                {tag}
              </span>
            ))}
          </div>
          <Button onClick={onLaunchWizard} className="w-full sm:w-auto min-h-[44px]">
            <span className="flex items-center gap-2">
              Start Assessment
              <ArrowRight className="w-4 h-4" />
            </span>
          </Button>
        </>
      )}

      {status === "in_progress" && (
        <>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <p className="text-sm text-foreground font-medium">Assessment in progress</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You've completed {percentage}% — pick up where you left off.
              </p>
            </div>
            <div className="relative w-12 h-12 flex items-center justify-center flex-shrink-0">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" opacity="0.3" />
                <circle
                  cx="24" cy="24" r="20" fill="none"
                  stroke="hsl(var(--kf-accent1))"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 20}
                  strokeDashoffset={2 * Math.PI * 20 * (1 - percentage / 100)}
                  className="transition-all duration-500"
                />
              </svg>
              <span className="absolute text-[10px] font-bold">{percentage}%</span>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted/20 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${percentage}%`,
                background: "hsl(var(--kf-accent1))",
              }}
            />
          </div>
          <Button onClick={onLaunchWizard} className="w-full sm:w-auto min-h-[44px]">
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Resume Assessment
            </span>
          </Button>
        </>
      )}

      {status === "complete" && (
        <>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-foreground font-medium">Assessment complete</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your business analysis has been generated.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={onLaunchWizard} className="min-h-[44px]">
              <span className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                View Results
              </span>
            </Button>
          </div>
        </>
      )}
    </motion.div>
  );
}
