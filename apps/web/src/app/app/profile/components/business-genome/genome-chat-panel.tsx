"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, User, Send, Loader2, Sparkles, CheckCircle2, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { useTts, SpeakButton } from "@/components/tts";
import { Textarea } from "@/components/ui/textarea";
import {
  getGenomeMessages,
  sendGenomeMessage,
  applyGenomeUpdates,
  type GenomeIntegrityResult,
  type DnaSectionKey,
  type ProposedGenomeUpdate,
  type GenomeChatMessage,
} from "@/lib/api/business-genome";

interface GenomeChatPanelProps {
  genome: GenomeIntegrityResult;
  onGenomeUpdate: (result?: GenomeIntegrityResult) => void;
}

interface PendingProposal {
  messageId: string;
  proposal: ProposedGenomeUpdate;
}

const QUICK_PROMPTS = [
  "What should I add to Financial DNA?",
  "Help me improve Market DNA",
  "Summarize my weakest DNA section",
  "What does the Three-Pillar Minimum need?",
];

function sectionLabel(genome: GenomeIntegrityResult, key: DnaSectionKey): string {
  return genome.dnaSections.find((s) => s.key === key)?.label || key;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function ProposalEditor({
  proposal,
  onCancel,
  onSave,
  saving,
}: {
  proposal: ProposedGenomeUpdate;
  onCancel: () => void;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const entries = Object.entries(proposal.data);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (Array.isArray(value)) {
        initial[key] = value.join(", ");
      } else if (typeof value === "boolean") {
        initial[key] = value ? "true" : "false";
      } else {
        initial[key] = value === undefined || value === null ? "" : String(value);
      }
    }
    return initial;
  });

  const handleChange = (key: string, raw: string) => {
    setValues((prev) => ({ ...prev, [key]: raw }));
  };

  const handleSave = () => {
    const coerced: Record<string, unknown> = {};
    for (const [key, original] of entries) {
      const raw = values[key] ?? "";
      const trimmed = raw.trim();
      if (trimmed === "") continue;

      if (typeof original === "boolean") {
        coerced[key] = trimmed === "true";
      } else if (typeof original === "number") {
        coerced[key] = Number(trimmed);
      } else if (Array.isArray(original)) {
        coerced[key] = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        coerced[key] = trimmed;
      }
    }
    onSave(coerced);
  };

  return (
    <div className="mt-3 rounded-xl border border-[hsl(var(--kf-border)/0.25)] bg-[hsl(var(--kf-muted)/0.06)] p-3 space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Edit proposed values</p>
      {entries.map(([key, original]) => {
        const isBoolean = typeof original === "boolean";
        const isArray = Array.isArray(original);
        return (
          <div key={key} className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground capitalize">{key}</label>
            {isBoolean ? (
              <select
                value={values[key] || "false"}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                type={isArray ? "text" : typeof original === "number" ? "number" : "text"}
                value={values[key] || ""}
                onChange={(e) => handleChange(key, e.target.value)}
                placeholder={isArray ? "Comma-separated values" : undefined}
                className="w-full rounded-lg border border-[hsl(var(--kf-border)/0.3)] bg-background px-3 py-2 text-sm"
              />
            )}
          </div>
        );
      })}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
          style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          Save edits
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-2 rounded-lg text-xs font-medium border border-[hsl(var(--kf-border)/0.3)] hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function GenomeChatPanel({ genome, onGenomeUpdate }: GenomeChatPanelProps) {
  const businessId = getStoredBusinessId();
  const { engine, state: ttsState } = useTts();
  const [messages, setMessages] = useState<GenomeChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  const [ignoredProposalIds, setIgnoredProposalIds] = useState<Set<string>>(new Set());
  const [editingProposal, setEditingProposal] = useState<PendingProposal | null>(null);
  const [applying, setApplying] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = useCallback(async () => {
    if (!businessId) return;
    setLoadingMessages(true);
    const { data, error } = await getGenomeMessages(businessId);
    if (error || !data) {
      toast.error(error || "Failed to load Genome Chat");
    } else {
      setMessages(data);
      const lastAssistant = [...data].reverse().find((m) => m.role === "assistant");
      if (
        lastAssistant &&
        lastAssistant.metadata &&
        (lastAssistant.metadata as Record<string, unknown>).proposedUpdates &&
        !ignoredProposalIds.has(lastAssistant.id)
      ) {
        const proposed = (lastAssistant.metadata as { proposedUpdates: ProposedGenomeUpdate }).proposedUpdates;
        setPendingProposal({ messageId: lastAssistant.id, proposal: proposed });
      }
    }
    setLoadingMessages(false);
  }, [businessId, ignoredProposalIds]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial async load of Genome Chat history
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-speak the latest assistant message
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && businessId && ttsState.autoSpeak) {
      engine.speak(last.content, businessId);
    }
  }, [messages, businessId, engine, ttsState.autoSpeak]);

  // Stop speaking when the panel unmounts
  useEffect(() => {
    return () => engine.cancel();
  }, [engine]);

  const ignoreProposal = (messageId: string) => {
    setIgnoredProposalIds((prev) => new Set(prev).add(messageId));
    setPendingProposal(null);
    setEditingProposal(null);
  };

  const handleApply = async (messageId: string, proposal: ProposedGenomeUpdate, data: Record<string, unknown>) => {
    if (!businessId) return;
    setApplying(true);
    const { data: result, error } = await applyGenomeUpdates(businessId, proposal.section, data);
    setApplying(false);

    if (error || !result) {
      toast.error(error || "Failed to apply update");
      return;
    }

    toast.success(`Saved to ${sectionLabel(genome, proposal.section)} — Genome Integrity is now ${result.genomeIntegrity}%`);
    onGenomeUpdate(result);
    setIgnoredProposalIds((prev) => new Set(prev).add(messageId));
    setPendingProposal(null);
    setEditingProposal(null);
    void loadMessages();
  };

  const handleSend = async () => {
    if (!businessId || !input.trim() || loading) return;
    const userContent = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { id: `optimistic-${Date.now()}`, role: "user", content: userContent, createdAt: new Date().toISOString() }]);
    setLoading(true);
    setPendingProposal(null);
    setEditingProposal(null);

    const { data, error } = await sendGenomeMessage(businessId, userContent);
    setLoading(false);

    if (error || !data) {
      toast.error(error || "KEY had trouble thinking that through.");
      return;
    }

    setMessages((prev) => [...prev, data.message]);
    if (data.proposedUpdates) {
      setPendingProposal({ messageId: data.message.id, proposal: data.proposedUpdates });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const insertPrompt = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  if (loadingMessages) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3 min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Genome Chat...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[640px]">
      <div
        className="flex-1 overflow-y-auto px-1 py-4 space-y-4"
        style={{ scrollBehavior: "smooth" }}
      >
        {messages.length === 0 && (
          <div className="text-center py-8 space-y-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
            >
              <Sparkles className="w-6 h-6" style={{ color: "hsl(var(--kf-accent1))" }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Build your Business Genome with KEY</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Tell KEY about your business. It will suggest structured DNA updates you can review before saving.
              </p>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const isSystem = msg.role === "system";

            if (isSystem) {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-center"
                >
                  <div
                    className="px-3 py-1.5 rounded-full text-[11px] font-medium text-muted-foreground"
                    style={{ background: "hsl(var(--kf-muted) / 0.12)" }}
                  >
                    {msg.content}
                  </div>
                </motion.div>
              );
            }

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: isUser ? "hsl(var(--kf-muted) / 0.2)" : "hsl(var(--kf-accent1) / 0.1)" }}
                >
                  {isUser ? (
                    <User className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <Bot className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  )}
                </div>
                <div className="flex flex-col max-w-[80%]">
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      isUser ? "rounded-br-md" : "rounded-bl-md"
                    }`}
                    style={{
                      background: isUser ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-card))",
                      color: isUser ? "hsl(var(--kf-accent1-foreground, var(--kf-background)))" : undefined,
                      border: isUser ? undefined : "1px solid hsl(var(--kf-border) / 0.3)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span>{msg.content}</span>
                      {!isUser && <SpeakButton text={msg.content} businessId={businessId} />}
                    </div>
                  </div>
                  <span className={`text-[10px] text-muted-foreground mt-1 ${isUser ? "text-right" : ""}`}>
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {pendingProposal && !editingProposal && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start pl-11"
          >
            <div
              className="max-w-[80%] rounded-xl p-3 space-y-3"
              style={{
                background: "hsl(var(--kf-accent1) / 0.06)",
                border: "1px solid hsl(var(--kf-accent1) / 0.2)",
              }}
            >
              <div className="flex items-start gap-2">
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                >
                  <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium">
                    Proposed update to{" "}
                    <span style={{ color: "hsl(var(--kf-accent1))" }}>
                      {sectionLabel(genome, pendingProposal.proposal.section)} DNA
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pendingProposal.proposal.summary || "Review the suggested changes before saving."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleApply(pendingProposal.messageId, pendingProposal.proposal, pendingProposal.proposal.data)}
                  disabled={applying}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
                  style={{ background: "hsl(var(--kf-accent1))", color: "#fff" }}
                >
                  {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Save to Genome
                </button>
                <button
                  onClick={() => setEditingProposal(pendingProposal)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[hsl(var(--kf-border)/0.3)] hover:bg-muted transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit first
                </button>
                <button
                  onClick={() => ignoreProposal(pendingProposal.messageId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Ignore
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {editingProposal && (
          <div className="flex justify-start pl-11">
            <div className="max-w-[80%] w-full">
              <ProposalEditor
                proposal={editingProposal.proposal}
                saving={applying}
                onCancel={() => setEditingProposal(null)}
                onSave={(data) => handleApply(editingProposal.messageId, editingProposal.proposal, data)}
              />
            </div>
          </div>
        )}

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

        <div ref={bottomRef} />
      </div>

      <div className="pt-4 border-t border-[hsl(var(--kf-border))] space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => insertPrompt(prompt)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-[hsl(var(--kf-border)/0.25)] hover:bg-muted transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell KEY about your business..."
            disabled={loading}
            rows={1}
            className="flex-1 min-h-[48px] max-h-[160px] resize-none rounded-xl text-sm"
            style={{
              background: "hsl(var(--kf-card))",
              border: "1px solid hsl(var(--kf-border) / 0.3)",
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
        <p className="text-[10px] text-muted-foreground text-center">
          KEY may propose DNA updates. You review and confirm every change.
        </p>
      </div>
    </div>
  );
}
