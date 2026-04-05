"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Compass, ArrowRight, BarChart3, CheckCircle2, Clock,
  TrendingUp, Shield, Target, Lightbulb,
} from "lucide-react";
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

const BENEFITS = [
  { icon: Target, label: "Business Clarity", desc: "Understand your strengths and gaps" },
  { icon: TrendingUp, label: "Financial Visibility", desc: "Revenue, costs, and profitability insights" },
  { icon: Shield, label: "Risk Awareness", desc: "Identify threats before they grow" },
  { icon: Lightbulb, label: "Growth Plan", desc: "Prioritized steps to scale your business" },
];

export default function GuidanceCard({ onLaunchWizard }: GuidanceCardProps) {
  const [status, setStatus] = useState<GuidanceStatus>("not_started");
  const [percentage, setPercentage] = useState(0);

  useEffect(() => {
    setStatus(getGuidanceStatus());
    const draft = loadGuidanceDraft();
    setPercentage(getGuidanceCompletionPercentage(draft));
  }, []);

  return (
    <motion.div variants={fadeUp} className="space-y-4">
      {status === "not_started" && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.06))",
            border: "1px solid hsl(var(--kf-accent1) / 0.2)",
          }}
        >
          <div className="px-6 pt-6 pb-4 space-y-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
              >
                <Compass className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>
                  Business Guidance Engine
                </h3>
                <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  ~15 min assessment · AI-powered analysis
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed" style={{ color: "hsl(var(--kf-foreground) / 0.85)" }}>
              Get a comprehensive analysis of your business with personalized recommendations,
              financial insights, and a prioritized growth roadmap.
            </p>
          </div>

          <div className="px-6 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {BENEFITS.map((b) => (
              <div
                key={b.label}
                className="flex items-start gap-2.5 p-3 rounded-xl"
                style={{
                  background: "hsl(var(--kf-card) / 0.5)",
                  border: "1px solid hsl(var(--kf-border) / 0.3)",
                }}
              >
                <b.icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                <div>
                  <p className="text-xs font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>{b.label}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{b.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="px-6 pb-6">
            <Button onClick={onLaunchWizard} className="w-full sm:w-auto min-h-[44px]">
              <span className="flex items-center gap-2">
                Start Assessment
                <ArrowRight className="w-4 h-4" />
              </span>
            </Button>
          </div>
        </div>
      )}

      {status === "in_progress" && (
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-accent1) / 0.2)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}
            >
              <Compass className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>
                Assessment in Progress
              </h3>
              <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {percentage}% complete — pick up where you left off
              </p>
            </div>
            <div className="relative w-14 h-14 flex items-center justify-center flex-shrink-0">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="22" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" opacity="0.3" />
                <circle
                  cx="28" cy="28" r="22" fill="none"
                  stroke="hsl(var(--kf-accent1))"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 22}
                  strokeDashoffset={2 * Math.PI * 22 * (1 - percentage / 100)}
                  className="transition-all duration-500"
                />
              </svg>
              <span className="absolute text-[11px] font-bold">{percentage}%</span>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.2)" }}>
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
        </div>
      )}

      {status === "complete" && (
        <div
          className="rounded-2xl p-6"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-success) / 0.2)",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-success) / 0.1)" }}>
              <CheckCircle2 className="w-5 h-5" style={{ color: "hsl(var(--kf-success))" }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>Assessment Complete</p>
              <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                Your business analysis has been generated.
              </p>
            </div>
            <Button onClick={onLaunchWizard} className="min-h-[44px]">
              <span className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                View Results
              </span>
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
