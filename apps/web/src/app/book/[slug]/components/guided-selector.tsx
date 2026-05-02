"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPost } from "@/lib/api";
import {
  Sparkles, ArrowRight, ArrowLeft, CheckCircle2, Loader2,
  Target, Star, ChevronRight,
} from "lucide-react";
import { formatPrice } from "@/lib/format";

type Question = {
  id: string;
  label: string;
  type: "single" | "multi";
  options: { value: string; label: string; tags?: string[] }[];
};

type FlowSettings = {
  title: string;
  subtitle: string;
  showBudgetQuestion: boolean;
  showUrgencyQuestion: boolean;
  showExecutionPreference: boolean;
};

type Recommendation = {
  productId: string;
  productName: string;
  score: number;
  executionModel?: string;
  price: number;
  currency: string;
  matchReasons: string[];
};

type ProductInfo = {
  id: string;
  name: string;
  price: number;
  currency: string;
  category: string;
  description?: string | null;
  imageUrl?: string | null;
  executionModel?: string | null;
  executionMeta?: Record<string, any> | null;
};

type Props = {
  slug: string;
  primaryColor: string;
  secondaryColor: string;
  onClose: () => void;
  onSelectPackage: (product: ProductInfo) => void;
  onStartIntake?: (journeyId: string, productId: string) => void;
};

const BUDGET_OPTIONS = [
  { value: "under_500", label: "Under $500" },
  { value: "500_1000", label: "$500 – $1,000" },
  { value: "1000_2500", label: "$1,000 – $2,500" },
  { value: "2500_5000", label: "$2,500 – $5,000" },
  { value: "5000_plus", label: "$5,000+" },
  { value: "flexible", label: "Flexible / Not sure" },
];

const URGENCY_OPTIONS = [
  { value: "no_rush", label: "No rush" },
  { value: "within_month", label: "Within a month" },
  { value: "within_week", label: "This week" },
  { value: "urgent", label: "ASAP / Urgent" },
];

const EXECUTION_OPTIONS = [
  { value: "DIY", label: "DIY Kit", description: "I'll do it myself with templates & guides" },
  { value: "AI_ASSISTED", label: "AI-Assisted", description: "AI does the heavy lifting, I review" },
  { value: "HYBRID", label: "Hybrid Support", description: "Mix of self-serve and professional help" },
  { value: "FULL_SERVICE", label: "Full Service", description: "Done-for-me by professionals" },
];

const EXECUTION_LABELS: Record<string, string> = {
  DIY: "DIY Kit",
  AI_ASSISTED: "AI-Assisted",
  HYBRID: "Hybrid",
  FULL_SERVICE: "Full Service",
};

export function GuidedSelector({ slug, primaryColor, secondaryColor, onClose, onSelectPackage, onStartIntake }: Props) {
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [settings, setSettings] = useState<FlowSettings | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { answer: string; tags?: string[] }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [allProducts, setAllProducts] = useState<ProductInfo[]>([]);
  const [journeyId, setJourneyId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const res = await apiGet<{
        enabled: boolean;
        questions: Question[];
        settings: FlowSettings;
      }>(`/site/storefront/public/${encodeURIComponent(slug)}/qualification-flow`);
      if (res.data?.enabled) {
        const allQuestions: Question[] = [...(res.data.questions ?? [])];
        if (res.data.settings?.showBudgetQuestion) {
          allQuestions.push({ id: "budget", label: "What's your budget range?", type: "single", options: BUDGET_OPTIONS });
        }
        if (res.data.settings?.showUrgencyQuestion) {
          allQuestions.push({ id: "urgency", label: "How soon do you need this?", type: "single", options: URGENCY_OPTIONS });
        }
        if (res.data.settings?.showExecutionPreference) {
          allQuestions.push({
            id: "execution_preference",
            label: "How would you like to work?",
            type: "single",
            options: EXECUTION_OPTIONS.map(o => ({ value: o.value, label: `${o.label} — ${o.description}` })),
          });
        }
        setQuestions(allQuestions);
        setSettings(res.data.settings);
      }
      setLoading(false);
    };
    load();
  }, [slug]);

  const totalSteps = questions.length;
  const currentQuestion = questions[step];
  const isLastStep = step === totalSteps - 1;
  const hasAnswer = currentQuestion && !!answers[currentQuestion.id];

  const handleAnswer = (questionId: string, value: string, tags?: string[]) => {
    setAnswers(prev => ({ ...prev, [questionId]: { answer: value, tags } }));
  };

  const handleNext = async () => {
    if (isLastStep) {
      setSubmitting(true);
      const answersList = Object.entries(answers).map(([questionId, a]) => ({
        questionId,
        answer: a.answer,
        tags: a.tags,
      }));
      const res = await apiPost<{
        journeyId: string;
        recommendations: Recommendation[];
        allProducts: ProductInfo[];
      }>({
        path: `/site/storefront/public/${encodeURIComponent(slug)}/qualification-recommend`,
        body: { answers: answersList },
      });
      if (res.data) {
        setRecommendations(res.data.recommendations);
        setAllProducts(res.data.allProducts);
        setJourneyId(res.data.journeyId);
      }
      setSubmitting(false);
    } else {
      setStep(s => s + 1);
    }
  };

  const handleSelectRecommendation = async (rec: Recommendation) => {
    const product = allProducts.find(p => p.id === rec.productId);
    if (!product) return;

    if (journeyId) {
      await apiPost({
        path: `/site/storefront/public/qualification/${journeyId}/select`,
        body: { productId: rec.productId, executionModel: rec.executionModel },
      });
      if (onStartIntake) {
        onStartIntake(journeyId, rec.productId);
      } else {
        onSelectPackage(product);
      }
    } else {
      onSelectPackage(product);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: primaryColor }} />
        <p className="text-sm text-gray-400">Loading guided flow...</p>
      </div>
    );
  }

  if (questions.length === 0) {
    return null;
  }

  if (recommendations) {
    return (
      <div className="space-y-6 py-4">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center" style={{ background: `${primaryColor}15` }}>
            <Star className="w-6 h-6" style={{ color: primaryColor }} />
          </div>
          <h3 className="text-xl font-bold text-gray-900">Your Recommended Packages</h3>
          <p className="text-sm text-gray-500">Based on your answers, here are our best matches</p>
        </div>

        <div className="space-y-4">
          {recommendations.map((rec, idx) => {
            const product = allProducts.find(p => p.id === rec.productId);
            return (
              <div
                key={rec.productId}
                className="relative rounded-2xl border p-5 transition-all duration-200 cursor-pointer group hover:shadow-lg"
                style={{
                  borderColor: idx === 0 ? `${primaryColor}40` : "rgba(0,0,0,0.08)",
                  background: idx === 0 ? `linear-gradient(135deg, ${primaryColor}06, ${primaryColor}02)` : "white",
                }}
                onClick={() => handleSelectRecommendation(rec)}
              >
                {idx === 0 && (
                  <div
                    className="absolute -top-3 left-4 px-3 py-0.5 rounded-full text-[10px] font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
                  >
                    BEST MATCH
                  </div>
                )}

                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-gray-900">{rec.productName}</h4>
                      {rec.executionModel && (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{ background: `${primaryColor}12`, color: primaryColor }}
                        >
                          {EXECUTION_LABELS[rec.executionModel] ?? rec.executionModel}
                        </span>
                      )}
                    </div>
                    {product?.description && (
                      <p className="text-sm text-gray-500 line-clamp-2">{product.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {rec.matchReasons.map((reason, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-gray-600 bg-gray-100">
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                          {reason}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0 space-y-2">
                    <div className="text-lg font-bold" style={{ color: primaryColor }}>
                      {formatPrice(rec.price, rec.currency)}
                    </div>
                    <div
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium text-white transition-transform group-hover:scale-105"
                      style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
                    >
                      Select <ChevronRight className="w-3 h-3" />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${rec.score}%`,
                        background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-medium text-gray-400">{rec.score}% match</span>
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Browse all packages instead
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center" style={{ background: `${primaryColor}15` }}>
          <Target className="w-6 h-6" style={{ color: primaryColor }} />
        </div>
        <h3 className="text-xl font-bold text-gray-900">
          {settings?.title || "Find Your Perfect Package"}
        </h3>
        <p className="text-sm text-gray-500">
          {settings?.subtitle || "Answer a few questions and we'll recommend the best fit for you."}
        </p>
      </div>

      <div className="flex items-center gap-1">
        {questions.map((_, i) => (
          <div
            key={i}
            className="flex-1 h-1.5 rounded-full transition-all duration-300"
            style={{
              background: i <= step
                ? `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})`
                : "rgba(0,0,0,0.06)",
            }}
          />
        ))}
      </div>

      <div className="text-[10px] text-gray-400 text-center font-medium">
        Question {step + 1} of {totalSteps}
      </div>

      {currentQuestion && (
        <div className="space-y-4">
          <h4 className="text-base font-semibold text-gray-900 text-center">
            {currentQuestion.label}
          </h4>

          <div className="space-y-2">
            {currentQuestion.options.map(opt => {
              const isSelected = answers[currentQuestion.id]?.answer === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer(currentQuestion.id, opt.value, opt.tags)}
                  className="w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 text-sm"
                  style={{
                    borderColor: isSelected ? `${primaryColor}50` : "rgba(0,0,0,0.08)",
                    background: isSelected ? `${primaryColor}08` : "white",
                    color: isSelected ? primaryColor : "rgb(55, 65, 81)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        borderColor: isSelected ? primaryColor : "rgba(0,0,0,0.15)",
                        background: isSelected ? primaryColor : "transparent",
                      }}
                    >
                      {isSelected && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>
                    <span className={isSelected ? "font-medium" : ""}>{opt.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          onClick={() => step > 0 ? setStep(s => s - 1) : onClose()}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {step === 0 ? "Cancel" : "Back"}
        </button>

        <button
          onClick={handleNext}
          disabled={!hasAnswer || submitting}
          className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})` }}
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Finding matches...
            </>
          ) : isLastStep ? (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              Get Recommendations
            </>
          ) : (
            <>
              Next
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
