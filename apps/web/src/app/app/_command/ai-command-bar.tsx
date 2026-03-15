"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Terminal, Mic, MicOff, CornerDownLeft, Loader2 } from "lucide-react";
import { sendAiChat } from "@/lib/client";
import type { ChatMessage } from "./types";
import { AiChatDrawer } from "./ai-chat-drawer";

interface SpeechRecognitionResult {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionEvent {
  readonly results: { readonly [index: number]: { readonly [index: number]: SpeechRecognitionResult } };
}

const WELCOME: ChatMessage = {
  role: "assistant",
  content: "Ready to assist. Ask me anything about your business — strategy, finances, operations, or run a command.",
};

interface AiCommandBarProps {
  businessId: string | null;
}

export function AiCommandBar({ businessId }: AiCommandBarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [aiInput, setAiInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVoiceSupported(
      typeof window !== "undefined" &&
        ("webkitSpeechRecognition" in window || "SpeechRecognition" in window),
    );
  }, []);

  const handleSend = useCallback(async () => {
    if (!businessId || !aiInput.trim() || sending) return;
    const userMsg: ChatMessage = { role: "user", content: aiInput.trim() };
    const history = [...messages.slice(1), userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setAiInput("");
    setSending(true);
    setChatOpen(true);
    try {
      const res = await sendAiChat(businessId, userMsg.content, history);
      const reply = res.data?.reply || "Sorry, I couldn't process that. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setSending(false);
  }, [businessId, aiInput, sending, messages]);

  const startVoice = useCallback(() => {
    if (!voiceSupported) return;
    type SpeechRecognitionInstance = { start(): void; stop(): void; lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((e: SpeechRecognitionEvent) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
    const SpeechRecognitionCtor =
      (window as unknown as Record<string, new () => SpeechRecognitionInstance>).webkitSpeechRecognition ||
      (window as unknown as Record<string, new () => SpeechRecognitionInstance>).SpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      setAiInput(event.results[0][0].transcript);
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
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
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
                style={voiceListening ? { backgroundColor: "hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))" } : undefined}
                title={voiceListening ? "Listening..." : "Voice input"}
              >
                {voiceListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={sending || !aiInput.trim() || !businessId}
              aria-label="Send message"
              className="p-1.5 rounded-md transition-all disabled:opacity-30 text-white"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CornerDownLeft className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {["Daily briefing", "Cash flow", "Focus areas"].map((q) => (
            <button
              key={q}
              onClick={() => { setAiInput(q); inputRef.current?.focus(); }}
              className="text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 transition-all"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
      <AiChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} messages={messages} sending={sending} />
    </div>
  );
}
