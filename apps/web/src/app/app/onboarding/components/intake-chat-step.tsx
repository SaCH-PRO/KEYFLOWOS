"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2 } from "lucide-react";
import {
  sendConciergeMessage,
  fetchConciergeWelcome,
  type ConciergeMessage,
} from "@/lib/api/onboarding-concierge";
import { getStoredBusinessId } from "@/lib/workspace";
import { useTts, SpeakButton } from "@/components/tts";

interface IntakeChatStepProps {
  onComplete: () => void;
}

export function IntakeChatStep({ onComplete }: IntakeChatStepProps) {
  const businessId = getStoredBusinessId();
  const { engine, state: ttsState } = useTts();
  const [messages, setMessages] = useState<ConciergeMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!businessId) return;
    fetchConciergeWelcome(businessId).then(({ data }) => {
      if (data) {
        setMessages([data]);
      }
      setLoading(false);
    });
  }, [businessId]);

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

  // Stop speaking when the user leaves the step
  useEffect(() => {
    return () => engine.cancel();
  }, [engine]);

  const handleSend = async () => {
    if (!businessId || !input.trim()) return;
    const text = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const { data } = await sendConciergeMessage(businessId, text, history);

    if (data) {
      setMessages((prev) => [...prev, data]);
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[60vh] sm:h-[calc(100vh-220px)] max-h-[700px]">
      <div className="text-center mb-4">
        <h2 className="text-xl font-semibold">Tell KEY about your business</h2>
        <p className="text-sm text-muted-foreground">
          The more you share, the better I can configure things for you.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                m.role === "user"
                  ? "bg-muted"
                  : "bg-[hsl(var(--kf-accent1)/0.12)]"
              }`}
            >
              {m.role === "user" ? (
                <User className="w-4 h-4" />
              ) : (
                <Bot className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
              )}
            </div>
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span>{m.content}</span>
                {m.role === "assistant" && (
                  <SpeakButton text={m.content} businessId={businessId} />
                )}
              </div>
              {m.quickReplies && m.quickReplies.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {m.quickReplies.map((reply) => (
                    <button
                      key={reply}
                      onClick={() => {
                        setInput(reply);
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-background border border-border hover:border-[hsl(var(--kf-accent1))] transition-colors"
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[hsl(var(--kf-accent1)/0.12)]">
              <Bot className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            </div>
            <div className="bg-card border border-border/40 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">KEY is thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer…"
          className="flex-1 px-4 py-3 rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))] text-sm"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!input.trim() || loading}
          className="px-4 py-3 rounded-xl bg-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1-foreground))] hover:brightness-110 disabled:opacity-50 transition-all"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          onClick={onComplete}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          I&apos;ve shared enough — continue
        </button>
      </div>
    </div>
  );
}
