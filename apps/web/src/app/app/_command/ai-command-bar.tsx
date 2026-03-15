"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Terminal,
  Mic,
  MicOff,
  CornerDownLeft,
  Loader2,
  Brain,
  X,
} from "lucide-react";
import { sendAiChat } from "@/lib/client";
import type { ChatMessage } from "./types";

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Ready to assist. Ask me anything about your business — strategy, finances, operations, or run a command.",
};

interface AiCommandBarProps {
  businessId: string | null;
}

export function AiCommandBar({ businessId }: AiCommandBarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [aiInput, setAiInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVoiceSupported(
      typeof window !== "undefined" &&
        ("webkitSpeechRecognition" in window || "SpeechRecognition" in window),
    );
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!businessId || !aiInput.trim() || sending) return;
    const userMsg: ChatMessage = { role: "user", content: aiInput.trim() };
    const history = [...messages.slice(1), userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));
    setMessages((prev) => [...prev, userMsg]);
    setAiInput("");
    setSending(true);
    setChatOpen(true);
    try {
      const res = await sendAiChat(businessId, userMsg.content, history);
      const reply =
        res.data?.reply ||
        "Sorry, I couldn't process that. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    }
    setSending(false);
  }, [businessId, aiInput, sending, messages]);

  const startVoice = useCallback(() => {
    if (!voiceSupported) return;
    const SpeechRecognition =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setAiInput(transcript);
      setVoiceListening(false);
      inputRef.current?.focus();
    };
    recognition.onerror = () => setVoiceListening(false);
    recognition.onend = () => setVoiceListening(false);
    setVoiceListening(true);
    recognition.start();
  }, [voiceSupported]);

  return (
    <div>
      <div className="relative group">
        <div className="flex items-center gap-2 px-3 py-2.5 kf-radius-md border border-border bg-card group-focus-within:border-[hsl(var(--kf-accent1)/0.3)] transition-all">
          <Terminal className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && !e.shiftKey && handleSend()
            }
            onFocus={() => setChatOpen(true)}
            placeholder="Ask AI anything or run a command..."
            aria-label="AI command input"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
            disabled={sending || !businessId}
          />
          <div className="flex items-center gap-1">
            {voiceSupported && (
              <button
                onClick={startVoice}
                className={voiceListening
                  ? "p-1.5 rounded-md transition-all animate-pulse"
                  : "p-1.5 rounded-md transition-all text-muted-foreground hover:text-foreground hover:bg-muted"
                }
                style={voiceListening
                  ? { backgroundColor: "hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))" }
                  : undefined
                }
                title={voiceListening ? "Listening..." : "Voice input"}
              >
                {voiceListening ? (
                  <MicOff className="w-3.5 h-3.5" />
                ) : (
                  <Mic className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={sending || !aiInput.trim() || !businessId}
              aria-label="Send message"
              className="p-1.5 rounded-md transition-all disabled:opacity-30"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "hsl(var(--kf-on-accent))" }} />
              ) : (
                <CornerDownLeft className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-on-accent))" }} />
              )}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {["Daily briefing", "Cash flow", "Focus areas"].map((q) => (
            <button
              key={q}
              onClick={() => {
                setAiInput(q);
                inputRef.current?.focus();
              }}
              className="text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 transition-all"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {chatOpen && messages.length > 1 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mt-3"
          >
            <div className="kf-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                  <div
                    className="h-5 w-5 rounded flex items-center justify-center"
                    style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                  >
                    <Brain
                      className="w-3 h-3"
                      style={{ color: "hsl(var(--kf-accent1))" }}
                    />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    KeyFlow AI
                  </span>
                  {sending && (
                    <span className="text-[10px] text-muted-foreground/60 animate-pulse">
                      Thinking...
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setChatOpen(false)}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto p-3 space-y-2.5">
                {messages.slice(1).map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
                  >
                    <div
                      className={msg.role === "user"
                        ? "max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed bg-muted border border-border"
                        : "max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed"
                      }
                      style={
                        msg.role === "assistant"
                          ? {
                              background: "hsl(var(--kf-accent1) / 0.06)",
                              border:
                                "1px solid hsl(var(--kf-accent1) / 0.1)",
                            }
                          : undefined
                      }
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </motion.div>
                ))}
                {sending && (
                  <div className="flex justify-start">
                    <div
                      className="rounded-lg px-3.5 py-2.5 flex items-center gap-1.5"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.06)",
                        border: "1px solid hsl(var(--kf-accent1) / 0.1)",
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{
                          backgroundColor: "hsl(var(--kf-accent2))",
                        }}
                      />
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{
                          backgroundColor: "hsl(var(--kf-accent2))",
                          animationDelay: "0.2s",
                        }}
                      />
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{
                          backgroundColor: "hsl(var(--kf-accent2))",
                          animationDelay: "0.4s",
                        }}
                      />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
