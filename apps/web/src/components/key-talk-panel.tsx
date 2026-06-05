"use client";

import { useState, useRef, useCallback } from "react";
import {
  keyInterpretFlow,
  keyBuildFlow,
  keyExecuteFlow,
  keyTalkFlow,
  keyInterpretDelegation,
  keyBuildDelegation,
  keyExecuteDelegation,
  keyTalkDelegation,
  keyInterpretCalendar,
  keyBuildCalendar,
  keyExecuteCalendar,
  keyTalkCalendar,
} from "@/lib/client";
import {
  Mic,
  MicOff,
  Send,
  Bot,
  X,
  Loader2,
  CheckCircle2,
  Play,
  Sparkles,
  ChevronRight,
  RotateCcw,
  AlertCircle,
} from "lucide-react";

type PanelMode = "flow" | "autopilot" | "calendar";

type Step = "input" | "interpreting" | "review" | "building" | "executing" | "proof";

interface KeyTalkPanelProps {
  mode: PanelMode;
  businessId?: string;
}

interface ProposedFlow {
  name?: string;
  triggerEvent?: string;
  condition?: string;
  actions?: Array<{ type?: string }>;
}

interface ProposedEvent {
  title?: string;
  type?: string;
  startAt?: string;
  endAt?: string;
  priority?: string;
  description?: string;
}

interface Alternative {
  label?: string;
  description?: string;
  triggerEvent?: string;
  proposedEvent?: Record<string, unknown>;
  loopType?: string;
}

interface InterpretationData {
  interpretation?: string;
  recommendation?: string;
  confidence?: number;
  proposedFlow?: ProposedFlow;
  proposedEvent?: ProposedEvent;
  recommendedLoopType?: string;
  proposedConfig?: Record<string, unknown>;
  alternatives?: Alternative[];
}

interface BuiltEntityData {
  name?: string;
  flowId?: string;
  loopId?: string;
  eventId?: string;
  flow?: { name?: string; triggerEvent?: string; loopType?: string; enabled?: boolean };
  loop?: { loopType?: string; enabled?: boolean };
  event?: { title?: string; type?: string; startAt?: string };
  triggerEvent?: string;
  loopType?: string;
  enabled?: boolean;
  title?: string;
  type?: string;
  startAt?: string;
}

interface ActivityLogEntry {
  title?: string;
  action?: string;
}

interface RecentTask {
  title?: string;
}

interface ExecutionProofData {
  proof?: {
    activityLog?: ActivityLogEntry[];
    recentTasks?: RecentTask[];
    sourceType?: string;
  };
  executed?: boolean;
  actionsRun?: unknown[];
  result?: {
    status?: string;
    actionsCreated?: number;
  };
  event?: {
    status?: string;
    createdAt?: string;
  };
}

interface TalkResponseData {
  success: boolean;
  error?: string;
  interpretation?: string;
  recommendation?: string;
  confidence?: number;
  flow?: Record<string, unknown> & { id?: string };
  event?: Record<string, unknown> & { id?: string };
  loop?: Record<string, unknown> & { id?: string; loopType?: string; config?: Record<string, unknown> };
  executionProof?: Record<string, unknown>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

export function KeyTalkPanel({ mode, businessId }: KeyTalkPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>("input");
  const [intent, setIntent] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [interpretation, setInterpretation] = useState<InterpretationData | null>(null);
  const [builtEntity, setBuiltEntity] = useState<BuiltEntityData | null>(null);
  const [executionProof, setExecutionProof] = useState<ExecutionProofData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const reset = useCallback(() => {
    setStep("input");
    setIntent("");
    setInterpretation(null);
    setBuiltEntity(null);
    setExecutionProof(null);
    setError(null);
  }, []);

  const startListening = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setError("Voice input not supported in this browser");
      return;
    }
    const SpeechRecognition = ((window as WindowWithSpeech).SpeechRecognition || (window as WindowWithSpeech).webkitSpeechRecognition)!;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: { results: Array<Array<{ transcript: string }>> }) => {
      const transcript = event.results[0][0].transcript;
      setIntent((prev) => (prev ? prev + " " + transcript : transcript));
    };
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const handleInterpret = useCallback(async () => {
    if (!intent.trim()) return;
    setStep("interpreting");
    setError(null);
    try {
      let res;
      if (mode === "flow") {
        res = await keyInterpretFlow({ businessId, intent });
      } else if (mode === "autopilot") {
        res = await keyInterpretDelegation({ businessId, intent });
      } else {
        res = await keyInterpretCalendar({ businessId, intent });
      }
      const data = res.data;
      if (!data?.success) {
        setError(data?.error || res.error || "Interpretation failed");
        setStep("input");
        return;
      }
      setInterpretation(data as InterpretationData);
      setStep("review");
    } catch (e: unknown) {
      setError((e as { message?: string }).message || "Network error");
      setStep("input");
    }
  }, [intent, mode, businessId]);

  const handleBuild = useCallback(async () => {
    if (!interpretation) return;
    setStep("building");
    try {
      let res;
      if (mode === "flow") {
        res = await keyBuildFlow({ businessId, proposedFlow: interpretation.proposedFlow });
      } else if (mode === "autopilot") {
        if (!interpretation.recommendedLoopType) {
          setError("No loop type recommended");
          setStep("review");
          return;
        }
        res = await keyBuildDelegation({
          businessId,
          recommendedLoopType: interpretation.recommendedLoopType,
          proposedConfig: interpretation.proposedConfig,
          enabled: true,
        });
      } else {
        res = await keyBuildCalendar({ businessId, proposedEvent: interpretation.proposedEvent });
      }
      const data = res.data;
      if (!data?.success) {
        setError(data?.error || res.error || "Build failed");
        setStep("review");
        return;
      }
      setBuiltEntity(data as BuiltEntityData);
      setStep("proof");
    } catch (e: unknown) {
      setError((e as { message?: string }).message || "Network error");
      setStep("review");
    }
  }, [interpretation, mode, businessId]);

  const handleExecute = useCallback(async () => {
    if (!builtEntity) return;
    setStep("executing");
    try {
      let res;
      if (mode === "flow") {
        if (!builtEntity.flowId) { setError("No flow ID"); setStep("proof"); return; }
        res = await keyExecuteFlow({ businessId, flowId: builtEntity.flowId });
      } else if (mode === "autopilot") {
        if (!builtEntity.loopId) { setError("No loop ID"); setStep("proof"); return; }
        res = await keyExecuteDelegation({ businessId, loopId: builtEntity.loopId });
      } else {
        if (!builtEntity.eventId) { setError("No event ID"); setStep("proof"); return; }
        res = await keyExecuteCalendar({ businessId, eventId: builtEntity.eventId });
      }
      const data = res.data;
      if (!data?.success) {
        setError(data?.error || res.error || "Execution failed");
        setStep("proof");
        return;
      }
      setExecutionProof(data as ExecutionProofData);
      setStep("proof");
    } catch (e: unknown) {
      setError((e as { message?: string }).message || "Network error");
      setStep("proof");
    }
  }, [builtEntity, mode, businessId]);

  const handleTalk = useCallback(async () => {
    if (!intent.trim()) return;
    setStep("interpreting");
    setError(null);
    try {
      let res;
      if (mode === "flow") {
        res = await keyTalkFlow({ businessId, intent, autoExecute: false });
      } else if (mode === "autopilot") {
        res = await keyTalkDelegation({ businessId, intent, autoExecute: false });
      } else {
        res = await keyTalkCalendar({ businessId, intent, autoExecute: false });
      }
      const data = res.data as TalkResponseData | undefined;
      if (!data?.success) {
        setError(data?.error || res.error || "Talk pipeline failed");
        setStep("input");
        return;
      }
      setInterpretation({
        interpretation: data.interpretation,
        recommendation: data.recommendation,
        confidence: data.confidence,
        proposedFlow: data.flow as ProposedFlow | undefined,
        proposedEvent: data.event as ProposedEvent | undefined,
        recommendedLoopType: data.loop?.loopType,
        proposedConfig: data.loop?.config,
      });
      if (mode === "calendar") {
        setBuiltEntity(data.event ? { eventId: data.event.id, ...data.event } as BuiltEntityData : null);
      } else {
        setBuiltEntity(data.flow ? { flowId: data.flow.id, ...data.flow } as BuiltEntityData : data.loop ? { loopId: data.loop.id, ...data.loop } as BuiltEntityData : null);
      }
      setExecutionProof((data.executionProof as ExecutionProofData | undefined) ?? null);
      setStep("proof");
    } catch (e: unknown) {
      setError((e as { message?: string }).message || "Network error");
      setStep("input");
    }
  }, [intent, mode, businessId]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)] text-white font-medium shadow-lg hover:shadow-xl hover:scale-105 transition-all"
      >
        <Sparkles className="w-5 h-5" />
        <span>Talk to KEY</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/[0.08] bg-[hsl(20_14%_6%)] shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[hsl(30_20%_98%)]">Talk to KEY</h3>
            <p className="text-[10px] text-[hsl(30_10%_50%)]">
              {mode === "flow"
                ? "Build automations with your voice"
                : mode === "autopilot"
                  ? "Create delegation loops with your voice"
                  : "Schedule and manage events with your voice"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={reset} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-[hsl(30_10%_50%)] transition-colors" title="Reset">
            <RotateCcw className="w-4 h-4" />
          </button>
          <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg hover:bg-white/[0.05] text-[hsl(30_10%_50%)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-h-[60vh]">
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Input step */}
        {(step === "input" || step === "interpreting") && (
          <div className="space-y-3">
            <label className="text-xs font-medium text-[hsl(30_10%_55%)]">
              {mode === "calendar" ? "What do you want to schedule?" : "What do you want to automate?"}
            </label>
            <div className="relative">
              <textarea
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder={
                  mode === "flow"
                    ? "e.g. When a new contact is added, send a welcome email and create a follow-up task"
                    : mode === "autopilot"
                      ? "e.g. I want to automatically follow up on overdue invoices every week"
                      : "e.g. Schedule a team meeting tomorrow at 2pm for 1 hour about Q3 planning"
                }
                className="w-full h-24 px-3 py-2.5 rounded-xl text-sm outline-none resize-none bg-white/[0.03] border border-white/[0.08] text-[hsl(30_20%_98%)] placeholder:text-[hsl(30_10%_30%)] focus:border-[hsl(24_95%_53%/0.5)] focus:ring-1 focus:ring-[hsl(24_95%_53%/0.25)]"
              />
              <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                <button
                  onClick={isListening ? stopListening : startListening}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isListening
                      ? "bg-red-500/20 text-red-400 animate-pulse"
                      : "hover:bg-white/[0.05] text-[hsl(30_10%_50%)]"
                  }`}
                  title={isListening ? "Stop listening" : "Voice input"}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleInterpret}
                disabled={!intent.trim() || step === "interpreting"}
                className="flex-1 py-2.5 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {step === "interpreting" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    KEY is thinking...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Interpret
                  </>
                )}
              </button>
              <button
                onClick={handleTalk}
                disabled={!intent.trim() || step === "interpreting"}
                className="px-4 py-2.5 rounded-xl font-medium text-sm text-[hsl(30_20%_98%)] bg-white/[0.05] hover:bg-white/[0.08] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Review step */}
        {step === "review" && interpretation && (
          <div className="space-y-4 animate-kf-fade-in">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(30_10%_50%)]">What I understood</h4>
              <p className="text-sm text-[hsl(30_20%_98%)] leading-relaxed">{interpretation.interpretation}</p>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(30_10%_50%)]">Recommendation</h4>
              <p className="text-sm text-[hsl(30_10%_55%)] leading-relaxed">{interpretation.recommendation}</p>
              {interpretation.confidence && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]"
                      style={{ width: `${Math.round(interpretation.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-[hsl(30_10%_50%)]">{Math.round(interpretation.confidence * 100)}% confident</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(30_10%_50%)]">
                Proposed {mode === "flow" ? "Flow" : mode === "autopilot" ? "Delegation" : "Event"}
              </h4>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                {mode === "flow" && interpretation.proposedFlow && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[hsl(30_10%_50%)]">Name</span>
                      <span className="text-sm text-[hsl(30_20%_98%)] font-medium">{interpretation.proposedFlow.name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[hsl(30_10%_50%)]">Trigger</span>
                      <span className="text-sm text-[hsl(24_95%_53%)]">{interpretation.proposedFlow.triggerEvent}</span>
                    </div>
                    {interpretation.proposedFlow.condition && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Condition</span>
                        <span className="text-sm text-[hsl(30_20%_98%)]">{interpretation.proposedFlow.condition}</span>
                      </div>
                    )}
                    <div className="pt-1">
                      <span className="text-xs text-[hsl(30_10%_50%)]">Actions</span>
                      <div className="mt-1 space-y-1">
                        {(interpretation.proposedFlow.actions || []).map((action, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm text-[hsl(30_20%_98%)]">
                            <ChevronRight className="w-3 h-3 text-[hsl(24_95%_53%)]" />
                            <span className="capitalize">{action.type?.replace(/_/g, " ")}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {mode === "autopilot" && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[hsl(30_10%_50%)]">Loop Type</span>
                      <span className="text-sm text-[hsl(24_95%_53%)] capitalize">{interpretation.recommendedLoopType?.replace(/_/g, " ")}</span>
                    </div>
                    {interpretation.proposedConfig && (
                      <div className="pt-1">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Configuration</span>
                        <pre className="mt-1 text-xs text-[hsl(30_20%_98%)] bg-white/[0.03] rounded-lg p-2 overflow-x-auto">
                          {JSON.stringify(interpretation.proposedConfig, null, 2)}
                        </pre>
                      </div>
                    )}
                  </>
                )}
                {mode === "calendar" && interpretation.proposedEvent && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[hsl(30_10%_50%)]">Title</span>
                      <span className="text-sm text-[hsl(30_20%_98%)] font-medium">{interpretation.proposedEvent.title}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[hsl(30_10%_50%)]">Type</span>
                      <span className="text-sm text-[hsl(24_95%_53%)] capitalize">{interpretation.proposedEvent.type?.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[hsl(30_10%_50%)]">Start</span>
                      <span className="text-sm text-[hsl(30_20%_98%)]">
                        {interpretation.proposedEvent.startAt ? new Date(interpretation.proposedEvent.startAt).toLocaleString() : "—"}
                      </span>
                    </div>
                    {interpretation.proposedEvent.endAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">End</span>
                        <span className="text-sm text-[hsl(30_20%_98%)]">
                          {new Date(interpretation.proposedEvent.endAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {interpretation.proposedEvent.priority && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Priority</span>
                        <span className="text-sm text-[hsl(30_20%_98%)]">{interpretation.proposedEvent.priority}</span>
                      </div>
                    )}
                    {interpretation.proposedEvent.description && (
                      <div className="pt-1">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Description</span>
                        <p className="mt-1 text-sm text-[hsl(30_10%_55%)]">{interpretation.proposedEvent.description}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {(interpretation.alternatives?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(30_10%_50%)]">Alternatives</h4>
                <div className="space-y-1.5">
                  {interpretation.alternatives!.map((alt, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (mode === "flow") {
                          setInterpretation({
                            ...interpretation,
                            proposedFlow: { ...interpretation.proposedFlow, triggerEvent: alt.triggerEvent },
                          });
                        } else if (mode === "calendar") {
                          setInterpretation({
                            ...interpretation,
                            proposedEvent: { ...interpretation.proposedEvent, ...alt.proposedEvent },
                          });
                        } else {
                          setInterpretation({
                            ...interpretation,
                            recommendedLoopType: alt.loopType,
                          });
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                    >
                      <p className="text-sm text-[hsl(30_20%_98%)]">{alt.label}</p>
                      <p className="text-xs text-[hsl(30_10%_50%)]">{alt.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleBuild}
                className="flex-1 py-2.5 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Build it
              </button>
              <button
                onClick={reset}
                className="px-4 py-2.5 rounded-xl font-medium text-sm text-[hsl(30_10%_55%)] bg-white/[0.05] hover:bg-white/[0.08] transition-all"
              >
                Start over
              </button>
            </div>
          </div>
        )}

        {/* Building / Executing states */}
        {(step === "building" || step === "executing") && (
          <div className="flex flex-col items-center gap-3 py-8 animate-kf-fade-in">
            <Loader2 className="w-8 h-8 animate-spin text-[hsl(24_95%_53%)]" />
            <p className="text-sm text-[hsl(30_10%_55%)]">
              {step === "building"
                ? mode === "calendar"
                  ? "KEY is scheduling your event..."
                  : "KEY is building your automation..."
                : mode === "calendar"
                  ? "KEY is confirming your event..."
                  : "KEY is executing your automation..."}
            </p>
          </div>
        )}

        {/* Proof step */}
        {(step === "proof" || executionProof) && builtEntity && (
          <div className="space-y-4 animate-kf-fade-in">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-medium">
                {mode === "flow"
                  ? "Flow created successfully"
                  : mode === "autopilot"
                    ? "Delegation configured successfully"
                    : "Event scheduled successfully"}
              </span>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(30_10%_50%)]">Created {mode === "flow" ? "Flow" : mode === "autopilot" ? "Delegation" : "Event"}</h4>
              {mode === "flow" && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(30_10%_50%)]">Name</span>
                    <span className="text-sm text-[hsl(30_20%_98%)]">{builtEntity.name || builtEntity.flow?.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(30_10%_50%)]">Trigger</span>
                    <span className="text-sm text-[hsl(24_95%_53%)]">{builtEntity.triggerEvent || builtEntity.flow?.triggerEvent}</span>
                  </div>
                </>
              )}
              {mode === "autopilot" && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(30_10%_50%)]">Loop</span>
                    <span className="text-sm text-[hsl(30_20%_98%)] capitalize">{builtEntity.loopType?.replace(/_/g, " ") || builtEntity.loop?.loopType?.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(30_10%_50%)]">Status</span>
                    <span className="text-sm text-emerald-400">{(builtEntity.enabled ?? builtEntity.loop?.enabled) ? "Enabled" : "Disabled"}</span>
                  </div>
                </>
              )}
              {mode === "calendar" && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(30_10%_50%)]">Title</span>
                    <span className="text-sm text-[hsl(30_20%_98%)]">{builtEntity.title || builtEntity.event?.title}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(30_10%_50%)]">Type</span>
                    <span className="text-sm text-[hsl(24_95%_53%)] capitalize">{(builtEntity.type || builtEntity.event?.type)?.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[hsl(30_10%_50%)]">Start</span>
                    <span className="text-sm text-[hsl(30_20%_98%)]">
                      {(() => {
                        const start = builtEntity.startAt || builtEntity.event?.startAt;
                        return start ? new Date(start).toLocaleString() : "—";
                      })()}
                    </span>
                  </div>
                </>
              )}
            </div>

            {executionProof && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(30_10%_50%)]">Proof of Execution</h4>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
                  {mode === "flow" && executionProof.proof && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Executed</span>
                        <span className="text-sm text-[hsl(30_20%_98%)]">{executionProof.executed ? "Yes" : "No"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Actions Run</span>
                        <span className="text-sm text-[hsl(30_20%_98%)]">{(executionProof.actionsRun || []).length}</span>
                      </div>
                      {(executionProof.proof?.activityLog?.length ?? 0) > 0 && (
                        <div className="pt-1">
                          <span className="text-xs text-[hsl(30_10%_50%)]">Recent Activity</span>
                          <div className="mt-1 space-y-1">
                            {executionProof.proof.activityLog!.slice(0, 5).map((log, i) => (
                              <div key={i} className="text-xs text-[hsl(30_10%_55%)] truncate">
                                {log.title || log.action}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {mode === "autopilot" && executionProof.proof && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Run Status</span>
                        <span className="text-sm text-emerald-400">{executionProof.result?.status || "Completed"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Tasks Created</span>
                        <span className="text-sm text-[hsl(30_20%_98%)]">{executionProof.result?.actionsCreated || 0}</span>
                      </div>
                      {(executionProof.proof?.recentTasks?.length ?? 0) > 0 && (
                        <div className="pt-1">
                          <span className="text-xs text-[hsl(30_10%_50%)]">Recent Tasks</span>
                          <div className="mt-1 space-y-1">
                            {executionProof.proof.recentTasks!.slice(0, 5).map((task, i) => (
                              <div key={i} className="text-xs text-[hsl(30_10%_55%)] truncate">
                                {task.title}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {mode === "calendar" && executionProof && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Status</span>
                        <span className="text-sm text-emerald-400">{executionProof.event?.status || "Scheduled"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[hsl(30_10%_50%)]">Source</span>
                        <span className="text-sm text-[hsl(30_20%_98%)] capitalize">{executionProof.proof?.sourceType || "manual"}</span>
                      </div>
                      {executionProof.event?.createdAt && (
                        <div className="pt-1">
                          <span className="text-xs text-[hsl(30_10%_50%)]">Created</span>
                          <p className="mt-1 text-xs text-[hsl(30_10%_55%)]">
                            {new Date(executionProof.event.createdAt).toLocaleString()}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              {!executionProof && (
                <button
                  onClick={handleExecute}
                  className="flex-1 py-2.5 rounded-xl font-medium text-sm text-white bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] hover:brightness-110 transition-all flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" />
                  Execute Now
                </button>
              )}
              <button
                onClick={reset}
                className="px-4 py-2.5 rounded-xl font-medium text-sm text-[hsl(30_10%_55%)] bg-white/[0.05] hover:bg-white/[0.08] transition-all"
              >
                New request
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
