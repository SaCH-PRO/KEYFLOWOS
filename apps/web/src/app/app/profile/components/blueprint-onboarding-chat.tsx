"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, RotateCcw, Loader2, CheckCircle2, Bot, User, ArrowRight } from "lucide-react";
import { apiPostSimple as apiPost } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { toast } from "sonner";
import type { BlueprintData, BlueprintSectionKey } from "@/lib/blueprint-types";

export interface OnboardingMessage {
  role: "user" | "assistant";
  content: string;
}

export interface OnboardingChatResult {
  reply: string;
  blueprint: BlueprintData;
  completeness: number;
  confidenceScores: Record<string, number>;
  extracted: Array<{
    section: BlueprintSectionKey;
    field: string;
    value: unknown;
    confidence: number;
  }>;
  nextSection: BlueprintSectionKey | null;
}

interface BlueprintOnboardingChatProps {
  businessId?: string;
  fullPage?: boolean;
  onComplete?: () => void;
  className?: string;
}

const SECTION_LABELS: Record<BlueprintSectionKey, string> = {
  identity: "Identity",
  operatingModel: "Operating Model",
  goals: "Goals",
  constraints: "Constraints",
  brand: "Brand",
  customerModel: "Customer Model",
  financials: "Financials",
  intelligence: "Intelligence",
  workflowModel: "Workflow Model",
  aiPreferences: "AI Preferences",
  // Genesis sections
  founderProfile: "Founder Profile",
  legalProfile: "Legal Profile",
  registrationProfile: "Registration Profile",
  taxProfile: "Tax Profile",
  ownershipProfile: "Ownership Profile",
  marketProfile: "Market Profile",
  offerArchitecture: "Offer Architecture",
  salesSystem: "Sales System",
  marketingSystem: "Marketing System",
  operationsSystem: "Operations System",
  projectionProfile: "Projection Profile",
  riskProfile: "Risk Profile",
  complianceProfile: "Compliance Profile",
  executionRoadmap: "Execution Roadmap",
  // Patch 2: Legal & Document Pack
  documentProfile: "Document Pack",
};

function useBusinessId(propId?: string) {
  return propId ?? getStoredBusinessId() ?? null;
}

export function BlueprintOnboardingChat({
  businessId: propBusinessId,
  fullPage = false,
  onComplete,
  className = "",
}: BlueprintOnboardingChatProps) {
  const businessId = useBusinessId(propBusinessId);
  const [messages, setMessages] = useState<OnboardingMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(() => !!businessId);
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [completeness, setCompleteness] = useState(0);
  const [currentSection, setCurrentSection] = useState<BlueprintSectionKey | null>("identity");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!businessId) return;
    // Seed the conversation with a welcome message from KEY.
    apiPost<OnboardingChatResult>(`/blueprint/businesses/${businessId}/onboarding-chat`, {
      message: "Hi KEY, I'm ready to build my Business Genome.",
      history: [],
    })
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error(error || "Failed to start onboarding.");
          return;
        }
        setMessages([
          {
            role: "assistant",
            content: data.reply,
          },
        ]);
        setBlueprint(data.blueprint);
        setCompleteness(data.completeness);
        setCurrentSection(data.nextSection);
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  const handleSend = useCallback(async () => {
    if (!businessId || !input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    const history = messages.map((m) => m);
    const { data, error } = await apiPost<OnboardingChatResult>(
      `/blueprint/businesses/${businessId}/onboarding-chat`,
      { message: userMsg, history },
    );

    setLoading(false);
    if (error || !data) {
      toast.error(error || "KEY had trouble thinking that through.");
      return;
    }

    setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    setBlueprint(data.blueprint);
    setCompleteness(data.completeness);
    setCurrentSection(data.nextSection);

    if (data.completeness >= 80 && onComplete) {
      onComplete();
    }
  }, [businessId, input, loading, messages, onComplete]);

  const handleReset = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    await apiPost(`/blueprint/businesses/${businessId}/onboarding-reset`, {});
    setMessages([]);
    setCompleteness(0);
    setCurrentSection("identity");
    setBlueprint(null);
    const { data, error } = await apiPost<OnboardingChatResult>(
      `/blueprint/businesses/${businessId}/onboarding-chat`,
      { message: "Hi KEY, I'm ready to build my Business Genome.", history: [] },
    );
    setLoading(false);
    if (error || !data) {
      toast.error(error || "Failed to restart onboarding.");
      return;
    }
    setMessages([{ role: "assistant", content: data.reply }]);
    setBlueprint(data.blueprint);
    setCompleteness(data.completeness);
    setCurrentSection(data.nextSection);
  }, [businessId]);

  const sectionLabel = currentSection ? SECTION_LABELS[currentSection] : "Wrapping up";

  return (
    <div className={`flex flex-col ${fullPage ? "h-[calc(100vh-180px)]" : "h-[600px]"} ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-[hsl(var(--kf-border))]">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
          >
            <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Build your Business Genome</h2>
            <p className="text-xs text-muted-foreground">
              {completeness < 80
                ? `Currently exploring: ${sectionLabel}`
                : "Business Genome nearly complete"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end gap-1">
            <span className="text-xs font-medium">{completeness}% complete</span>
            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "hsl(var(--kf-accent1))" }}
                initial={{ width: 0 }}
                animate={{ width: `${completeness}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </div>
          <button
            onClick={handleReset}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="Start over"
          >
            <RotateCcw className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            const isUser = msg.role === "user";
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isUser ? "bg-muted" : ""
                  }`}
                  style={{
                    background: isUser ? undefined : "hsl(var(--kf-accent1) / 0.1)",
                  }}
                >
                  {isUser ? (
                    <User className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <Bot className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  )}
                </div>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    isUser ? "rounded-br-md" : "rounded-bl-md"
                  }`}
                  style={{
                    background: isUser
                      ? "hsl(var(--kf-accent1))"
                      : "hsl(var(--kf-card))",
                    color: isUser ? "hsl(var(--kf-accent1-foreground, var(--kf-background)))" : undefined,
                    border: isUser ? undefined : "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
                  {msg.content}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
            >
              <Bot className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <div
              className="rounded-2xl rounded-bl-md px-4 py-3 text-sm flex items-center gap-2"
              style={{
                background: "hsl(var(--kf-card))",
                border: "1px solid hsl(var(--kf-border) / 0.3)",
              }}
            >
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
              <span className="text-muted-foreground">KEY is thinking...</span>
            </div>
          </motion.div>
        )}

        {completeness >= 80 && !loading && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl p-4 text-center space-y-2"
            style={{
              background: "hsl(var(--kf-success) / 0.08)",
              border: "1px solid hsl(var(--kf-success) / 0.2)",
            }}
          >
            <CheckCircle2 className="w-6 h-6 mx-auto" style={{ color: "hsl(var(--kf-success))" }} />
            <p className="text-sm font-medium" style={{ color: "hsl(var(--kf-success))" }}>
              Your Business Genome is strong enough for KEY to start helping.
            </p>
            <p className="text-xs text-muted-foreground">
              You can keep chatting to refine it, or dive into the app. You can always return via Profile → Business Genome.
            </p>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-4 border-t border-[hsl(var(--kf-border))]">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Tell KEY about your business..."
            disabled={loading}
            className="flex-1 px-4 py-3 rounded-xl text-sm"
            style={{
              background: "hsl(var(--kf-card))",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={loading || !input.trim()}
            className="px-4 py-3 rounded-xl font-medium text-sm flex items-center gap-2 transition-opacity disabled:opacity-50"
            style={{
              background: "hsl(var(--kf-accent1))",
              color: "hsl(var(--kf-accent1-foreground, var(--kf-background)))",
            }}
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          KEY uses this to personalize every recommendation, message, and workflow.
        </p>
      </div>
    </div>
  );
}

export function BlueprintOnboardingCTA({ className = "" }: { className?: string }) {
  return (
    <a
      href="/app/profile?tab=business-genome"
      className={`flex items-center gap-3 rounded-xl p-4 transition-colors hover:opacity-90 ${className}`}
      style={{
        background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1), hsl(var(--kf-accent2) / 0.05))",
        border: "1px solid hsl(var(--kf-accent1) / 0.2)",
      }}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
      >
        <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">Build your Business Genome</p>
        <p className="text-xs text-muted-foreground truncate">
          Chat with KEY for 3 minutes so it can operate like your digital co-founder.
        </p>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </a>
  );
}
