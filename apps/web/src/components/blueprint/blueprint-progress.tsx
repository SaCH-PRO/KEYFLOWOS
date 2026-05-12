"use client";

import { useMemo } from "react";

interface SectionScore {
  key: string;
  label: string;
  score: number;
}

interface BlueprintProgressProps {
  completeness: number;
  confidenceScores?: Record<string, number>;
}

const SECTION_LABELS: Record<string, string> = {
  identity: "Identity",
  operatingModel: "Operating Model",
  goals: "Goals",
  constraints: "Constraints",
  brand: "Brand",
  customerModel: "Customer Model",
  financials: "Financials",
  intelligence: "Intelligence",
  workflowModel: "Workflow",
  aiPreferences: "AI Preferences",
};

export function BlueprintProgress({ completeness, confidenceScores }: BlueprintProgressProps) {
  const sections = useMemo<SectionScore[]>(() => {
    if (!confidenceScores) return [];
    return Object.entries(confidenceScores)
      .map(([key, score]) => ({ key, label: SECTION_LABELS[key] || key, score: score ?? 0 }))
      .sort((a, b) => a.score - b.score);
  }, [confidenceScores]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Blueprint Completeness</span>
        <span className="text-sm font-bold">{completeness}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${completeness}%` }}
        />
      </div>
      {sections.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-2">
          {sections.map((s) => (
            <div key={s.key} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.label}</span>
              <span className={s.score < 50 ? "text-destructive" : s.score < 80 ? "text-amber-500" : "text-green-600"}>
                {s.score}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
