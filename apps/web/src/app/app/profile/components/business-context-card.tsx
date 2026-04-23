"use client";

import { Building2, Briefcase, TrendingUp, User, Target, Sparkles } from "lucide-react";
import type { ProfileBusinessData } from "./profile-types";

interface BusinessContextCardProps {
  businessData: ProfileBusinessData | null;
}

export function BusinessContextCard({ businessData }: BusinessContextCardProps) {
  const items = [
    { label: "Business", value: businessData?.name, icon: Building2 },
    { label: "Industry", value: businessData?.industry, icon: Briefcase },
    { label: "Stage", value: businessData?.businessStage?.replace(/_/g, " "), icon: TrendingUp },
    { label: "Team", value: businessData?.teamSize?.replace(/_/g, " "), icon: User },
    { label: "Location", value: [businessData?.city, businessData?.country].filter(Boolean).join(", "), icon: Target },
  ].filter((i) => i.value);

  if (items.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
        border: "1px solid hsl(var(--kf-accent1) / 0.12)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} aria-hidden="true" />
        <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
          What KEYFLOWOS sees
        </span>
      </div>
      <div className="flex flex-wrap gap-2" role="list" aria-label="Business context">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              role="listitem"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
              style={{
                background: "hsl(var(--kf-card))",
                border: "1px solid hsl(var(--kf-border) / 0.2)",
              }}
            >
              <Icon className="w-3 h-3 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              <span className="text-[hsl(var(--muted-foreground))]">{item.label}:</span>
              <span className="font-medium text-[hsl(var(--foreground))]">{item.value}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-2">
        This data powers AI-generated documents and recommendations.
      </p>
    </div>
  );
}
