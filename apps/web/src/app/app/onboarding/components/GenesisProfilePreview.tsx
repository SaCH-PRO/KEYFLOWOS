"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Pencil, Check, Building2, Users, Coins, Scale, Wallet, AlertTriangle, Loader2 } from "lucide-react";
import type { GenesisIdeaAnalysis, BlueprintData } from "@/lib/blueprint-types";

interface GenesisProfilePreviewProps {
  analysis: GenesisIdeaAnalysis;
  onConfirm: (answers: Record<string, unknown>) => void;
  onSkipToQuestions: () => void;
  loading?: boolean;
}

type PreviewCard = {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  value: string;
  inputType: "text" | "textarea" | "select";
  options?: string[];
};

const ENTITY_OPTIONS = [
  "SOLE_TRADER",
  "PARTNERSHIP",
  "LIMITED_COMPANY",
  "NONPROFIT",
  "UNKNOWN",
];

function formatEntity(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractPreviewCards(analysis: GenesisIdeaAnalysis): PreviewCard[] {
  const extracted = analysis.extracted as Partial<BlueprintData>;
  const cards: PreviewCard[] = [];

  const businessType =
    extracted.identity?.archetype ||
    extracted.identity?.industry ||
    extracted.operatingModel?.revenueModel ||
    "Not detected";
  cards.push({
    id: "business-type",
    label: "Business type",
    icon: <Building2 className="w-4 h-4" />,
    path: "identity.archetype",
    value: businessType,
    inputType: "text",
  });

  const targetCustomer = extracted.customerModel?.idealCustomer || "Not detected";
  cards.push({
    id: "target-customer",
    label: "Target customer",
    icon: <Users className="w-4 h-4" />,
    path: "customerModel.idealCustomer",
    value: targetCustomer,
    inputType: "textarea",
  });

  const revenueModel = extracted.operatingModel?.revenueModel || "Not detected";
  cards.push({
    id: "revenue-model",
    label: "Revenue model",
    icon: <Coins className="w-4 h-4" />,
    path: "operatingModel.revenueModel",
    value: revenueModel,
    inputType: "text",
  });

  const legalPath =
    extracted.legalProfile?.recommendedEntityType || analysis.suggestedEntityType || "UNKNOWN";
  cards.push({
    id: "legal-path",
    label: "Likely legal path",
    icon: <Scale className="w-4 h-4" />,
    path: "legalProfile.recommendedEntityType",
    value: formatEntity(String(legalPath)),
    inputType: "select",
    options: ENTITY_OPTIONS,
  });

  const startingBudget =
    extracted.constraints?.budgetRange ||
    (extracted.projectionProfile?.startupCapital !== undefined
      ? String(extracted.projectionProfile.startupCapital)
      : null) ||
    "Not detected";
  cards.push({
    id: "starting-budget",
    label: "Starting budget",
    icon: <Wallet className="w-4 h-4" />,
    path: "constraints.budgetRange",
    value: startingBudget,
    inputType: "text",
  });

  const riskFlags: string[] = [];
  if (extracted.riskProfile) {
    const sources = [
      extracted.riskProfile.financialRisks,
      extracted.riskProfile.legalRisks,
      extracted.riskProfile.marketRisks,
      extracted.riskProfile.operationalRisks,
      extracted.riskProfile.founderRisks,
    ];
    for (const list of sources) {
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.description) riskFlags.push(item.description);
        }
      }
    }
  }
  if (extracted.legalProfile?.legalRiskFlags?.length) {
    riskFlags.push(...extracted.legalProfile.legalRiskFlags);
  }
  cards.push({
    id: "risk-flags",
    label: "Risk flags",
    icon: <AlertTriangle className="w-4 h-4" />,
    path: "legalProfile.legalRiskFlags",
    value: riskFlags.length ? riskFlags.join("\n") : "No major risks detected",
    inputType: "textarea",
  });

  return cards;
}

export function GenesisProfilePreview({
  analysis,
  onConfirm,
  onSkipToQuestions,
  loading = false,
}: GenesisProfilePreviewProps) {
  const cards = useMemo(() => extractPreviewCards(analysis), [analysis]);
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    return Object.fromEntries(cards.map((c) => [c.path, c.value]));
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const buildAnswers = (): Record<string, unknown> => {
    const answers: Record<string, unknown> = {};
    for (const card of cards) {
      const raw = edits[card.path] ?? card.value;
      if (card.path === "legalProfile.legalRiskFlags") {
        const lines = raw
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        answers[card.path] = lines.length ? lines : [];
      } else if (card.path === "legalProfile.recommendedEntityType") {
        answers[card.path] = raw.toUpperCase().replace(/\s/g, "_");
      } else {
        answers[card.path] = raw;
      }
    }
    return answers;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-5"
    >
      <div className="text-center space-y-2">
        <h2 className="text-xl sm:text-2xl font-bold">Here&apos;s what KEY understood</h2>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          {analysis.summary || "Review the extracted profile and tap any card to correct it before we continue."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map((card, index) => {
          const isEditing = editingId === card.id;
          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="kf-card p-4 group"
              style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span style={{ color: "hsl(var(--kf-accent2))" }}>{card.icon}</span>
                  {card.label}
                </div>
                <button
                  onClick={() => setEditingId(isEditing ? null : card.id)}
                  disabled={loading}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                  title={isEditing ? "Done editing" : "Edit"}
                >
                  {isEditing ? (
                    <Check className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} />
                  ) : (
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>

              {isEditing ? (
                card.inputType === "select" ? (
                  <select
                    value={edits[card.path] ?? card.value}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [card.path]: e.target.value }))}
                    className="w-full kf-input"
                    disabled={loading}
                  >
                    {card.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {formatEntity(opt)}
                      </option>
                    ))}
                  </select>
                ) : card.inputType === "textarea" ? (
                  <textarea
                    value={edits[card.path] ?? card.value}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [card.path]: e.target.value }))}
                    rows={3}
                    className="w-full kf-input resize-none"
                    disabled={loading}
                  />
                ) : (
                  <input
                    type="text"
                    value={edits[card.path] ?? card.value}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [card.path]: e.target.value }))}
                    className="w-full kf-input"
                    disabled={loading}
                  />
                )
              ) : (
                <p className="text-sm font-medium whitespace-pre-line">{edits[card.path] ?? card.value}</p>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          onClick={() => onConfirm(buildAnswers())}
          disabled={loading}
          className="kf-btn-primary flex items-center gap-2 px-5 py-2.5"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>Looks right — continue</span>
        </button>
        <button
          onClick={onSkipToQuestions}
          disabled={loading}
          className="kf-btn-secondary px-5 py-2.5"
        >
          Ask me the missing questions
        </button>
      </div>
    </motion.div>
  );
}
