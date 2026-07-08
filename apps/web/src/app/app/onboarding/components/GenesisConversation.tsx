"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ArrowRight, RotateCcw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { getGenome, type GenomeIntegrityResult } from "@/lib/api/business-genome";
import type {
  GenesisReadinessScore,
  GenesisIdeaAnalysis,
  GenesisProgress,
  GenesisQuestion,
  GenesisActionPlan,
  BlueprintData,
  ComplianceItem,
} from "@/lib/blueprint-types";
import { IdeaInput } from "./IdeaInput";
import { GenesisProfilePreview } from "./GenesisProfilePreview";
import { GenesisQuestionSet } from "./GenesisQuestionSet";
import { GenesisReadinessPanel } from "./GenesisReadinessPanel";
import { LegalDisclaimerModal } from "./LegalDisclaimerModal";

type Step = "idea" | "review" | "questions" | "dashboard";

interface GenesisConversationProps {
  onComplete?: () => void;
}

export function GenesisConversation({ onComplete }: GenesisConversationProps) {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idea");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<GenesisIdeaAnalysis | null>(null);
  const [questions, setQuestions] = useState<GenesisQuestion[]>([]);
  const [readiness, setReadiness] = useState<GenesisReadinessScore | null>(null);
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [_complianceItems, setComplianceItems] = useState<ComplianceItem[]>([]);
  const [actionPlan, setActionPlan] = useState<GenesisActionPlan | null>(null);
  const [loadingActionPlan, setLoadingActionPlan] = useState(false);

  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (!bid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of Genesis readiness
      setInitializing(false);
      setError("No business selected. Please sign in or create a workspace.");
      return;
    }
    setBusinessId(bid);

    Promise.all([
      apiGet<GenesisReadinessScore>(`/business-genesis/businesses/${bid}/readiness`),
      getGenome(bid),
    ])
      .then(([{ data: readinessData, error: readinessErr }, { data: genomeData }]) => {
        if (readinessErr || !readinessData) {
          setError(readinessErr || "Could not load readiness score.");
          return;
        }
        setReadiness(readinessData);
        // Use the same gate the server uses for onboarding completion:
        // the three-pillar minimum (founder, business, market each >= 50).
        if (genomeData?.threePillarMinimumMet) {
          setStep("dashboard");
        }
      })
      .finally(() => setInitializing(false));
  }, []);

  const handleAnalyzeIdea = useCallback(
    async (ideaText: string) => {
      if (!businessId) return;
      setLoading(true);
      setError(null);
      const { data, error: err } = await apiPost<GenesisIdeaAnalysis>({
        path: `/business-genesis/businesses/${businessId}/analyze-idea`,
        body: { ideaText },
      });
      setLoading(false);
      if (err || !data) {
        toast.error(err || "Could not analyze your idea. Please try again.");
        setError(err || "Analysis failed.");
        return;
      }
      setAnalysis(data);
      setReadiness(data.readiness);
      setStep("review");
    },
    [businessId],
  );

  const submitAnswersAndAdvance = useCallback(
    async (answers: Record<string, unknown>, source: "review" | "questions") => {
      if (!businessId) return;
      setLoading(true);
      setError(null);
      const { data, error: err } = await apiPost<GenesisProgress>({
        path: `/business-genesis/businesses/${businessId}/answers`,
        body: { answers },
      });
      setLoading(false);
      if (err || !data) {
        toast.error(err || "Could not save your answers.");
        setError(err || "Save failed.");
        return;
      }
      setReadiness(data.readiness);
      setBlueprint(data.blueprint);
      setComplianceItems(data.complianceItems);
      if (source === "review") {
        if (data.nextQuestions.length > 0) {
          setQuestions(data.nextQuestions);
          setStep("questions");
        } else {
          setStep("dashboard");
        }
      } else {
        if (data.nextQuestions.length > 0) {
          setQuestions(data.nextQuestions);
        } else {
          setStep("dashboard");
        }
      }
    },
    [businessId],
  );

  const handleReviewConfirm = useCallback(
    (answers: Record<string, unknown>) => {
      void submitAnswersAndAdvance(answers, "review");
    },
    [submitAnswersAndAdvance],
  );

  const handleSkipToQuestions = useCallback(() => {
    if (analysis?.extracted) {
      const fallback: Record<string, unknown> = {};
      for (const [section, sectionData] of Object.entries(analysis.extracted)) {
        if (sectionData && typeof sectionData === "object" && !Array.isArray(sectionData)) {
          for (const [field, value] of Object.entries(sectionData)) {
            if (value === null || value === undefined) continue;
            const type = typeof value;
            if (type === "boolean" || type === "number" || type === "string") {
              fallback[`${section}.${field}`] = value;
            } else if (
              Array.isArray(value) &&
              value.every((v) => ["boolean", "number", "string"].includes(typeof v))
            ) {
              fallback[`${section}.${field}`] = value;
            }
          }
        }
      }
      void submitAnswersAndAdvance(fallback, "review");
    } else {
      void submitAnswersAndAdvance({}, "review");
    }
  }, [analysis, submitAnswersAndAdvance]);

  const handleQuestionSubmit = useCallback(
    (answers: Record<string, unknown>) => {
      void submitAnswersAndAdvance(answers, "questions");
    },
    [submitAnswersAndAdvance],
  );

  const handleGenerateActionPlan = useCallback(async () => {
    if (!businessId) return;
    setLoadingActionPlan(true);
    setError(null);
    const { data, error: err } = await apiPost<GenesisActionPlan>({
      path: `/business-genesis/businesses/${businessId}/generate-roadmap`,
      body: {},
    });
    setLoadingActionPlan(false);
    if (err || !data) {
      toast.error(err || "Could not generate your action plan.");
      setError(err || "Action plan generation failed.");
      return;
    }
    setActionPlan(data);
  }, [businessId]);

  const handleAcceptDisclaimer = useCallback(async () => {
    if (!businessId) return;
    setLoadingActionPlan(true);
    const { error: err } = await apiPost<GenesisProgress>({
      path: `/business-genesis/businesses/${businessId}/answers`,
      body: { answers: { "legalProfile.disclaimerAcceptedAt": new Date().toISOString() } },
    });
    if (err) {
      toast.error(err);
      setLoadingActionPlan(false);
      return;
    }
    setDisclaimerAccepted(true);
    setShowDisclaimer(false);
    await handleGenerateActionPlan();
  }, [businessId, handleGenerateActionPlan]);

  const handleRequestActionPlan = useCallback(() => {
    if (disclaimerAccepted) {
      void handleGenerateActionPlan();
    } else {
      setShowDisclaimer(true);
    }
  }, [disclaimerAccepted, handleGenerateActionPlan]);

  const handleRetake = useCallback(() => {
    setStep("idea");
    setAnalysis(null);
    setQuestions([]);
    setActionPlan(null);
    setError(null);
  }, []);

  if (initializing) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="kf-card p-3 flex items-start gap-3"
          style={{ border: "1px solid hsl(var(--kf-error) / 0.3)" }}
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-error))" }} />
          <p className="text-sm" style={{ color: "hsl(var(--kf-error))" }}>
            {error}
          </p>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {step === "idea" && (
          <motion.div
            key="idea"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.25 }}
          >
            <IdeaInput onSubmit={handleAnalyzeIdea} loading={loading} />
          </motion.div>
        )}

        {step === "review" && analysis && (
          <motion.div
            key="review"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.25 }}
          >
            <GenesisProfilePreview
              analysis={analysis}
              onConfirm={handleReviewConfirm}
              onSkipToQuestions={handleSkipToQuestions}
              loading={loading}
            />
          </motion.div>
        )}

        {step === "questions" && (
          <motion.div
            key="questions"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.25 }}
          >
            <GenesisQuestionSet
              questions={questions}
              onSubmit={handleQuestionSubmit}
              loading={loading}
              readiness={readiness}
            />
          </motion.div>
        )}

        {step === "dashboard" && readiness && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.25 }}
          >
            <GenesisReadinessPanel
              readiness={readiness}
              blueprint={blueprint}
              onGenerateActionPlan={handleRequestActionPlan}
              actionPlan={actionPlan}
              loadingActionPlan={loadingActionPlan}
            />
            <div className="flex flex-col items-center justify-center gap-3 mt-6">
              {onComplete && (
                <button
                  onClick={onComplete}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1-foreground))] hover:brightness-110 transition-all"
                >
                  Continue onboarding
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={handleRetake}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retake onboarding
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {step !== "dashboard" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 text-xs text-muted-foreground"
        >
          <button
            onClick={() => (window.location.href = "/app/profile?tab=business-genome")}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Prefer manual setup?
          </button>
          <button
            onClick={() => (window.location.href = "/app/command-center")}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Continue to app
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}

      <LegalDisclaimerModal
        open={showDisclaimer}
        onAccept={handleAcceptDisclaimer}
        onCancel={() => setShowDisclaimer(false)}
        loading={loadingActionPlan}
      />
    </div>
  );
}
