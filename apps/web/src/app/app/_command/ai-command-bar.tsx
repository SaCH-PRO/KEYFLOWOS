"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { Terminal, Mic, MicOff, CornerDownLeft, Loader2, Brain } from "lucide-react";
import { sendAiChat } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
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

type ModuleQuickPrompts = { module: string; prompts: string[] };

const MODULE_PROMPTS: Record<string, ModuleQuickPrompts> = {
  "/app": { module: "Today", prompts: ["Daily briefing", "Cash flow", "Focus areas"] },
  "/app/crm": { module: "CRM", prompts: ["Score my leads", "Find inactive contacts", "Suggest follow-ups"] },
  "/app/commerce": { module: "Commerce", prompts: ["Summarize overdue", "Revenue this month", "Draft reminder"] },
  "/app/bookings": { module: "Bookings", prompts: ["Today's schedule", "Empty slots this week", "Rebooking suggestions"] },
  "/app/marketing": { module: "Marketing", prompts: ["Campaign performance", "Best send time", "Audience health"] },
  "/app/store": { module: "Store", prompts: ["Store optimizer", "SEO advice", "Pricing analysis"] },
  "/app/expenses": { module: "Expenses", prompts: ["Spending summary", "Over budget alerts", "Tax estimate"] },
  "/app/projects": { module: "Projects", prompts: ["Task priorities", "Automation ideas", "Project status"] },
  "/app/reports": { module: "Reports", prompts: ["Executive brief", "Cash flow forecast", "Revenue trends"] },
  "/app/automations": { module: "Automations", prompts: ["Suggest playbooks", "Recent failures", "Optimization tips"] },
  "/app/learn": { module: "Learn", prompts: ["Recommended courses", "Track progress", "Skill assessment"] },
  "/app/community": { module: "Community", prompts: ["Trending topics", "My engagement", "Find collaborators"] },
  "/app/settings": { module: "Settings", prompts: ["Setup checklist", "Security review", "Integration status"] },
  "/app/marketplace": { module: "Marketplace", prompts: ["Discover partners", "Trending services", "Competitor analysis"] },
  "/app/profile": { module: "Profile", prompts: ["Complete my profile", "AI profile generator"] },
};

function getModuleContext(pathname: string): ModuleQuickPrompts {
  const sorted = Object.keys(MODULE_PROMPTS).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (pathname === key || pathname.startsWith(key + "/")) {
      return MODULE_PROMPTS[key];
    }
  }
  return MODULE_PROMPTS["/app"];
}

export function AiCommandBar() {
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [aiInput, setAiInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const moduleCtx = useMemo(() => getModuleContext(pathname), [pathname]);

  useEffect(() => {
    setVoiceSupported(
      typeof window !== "undefined" &&
        ("webkitSpeechRecognition" in window || "SpeechRecognition" in window),
    );
  }, []);

  const handleSend = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId || !aiInput.trim() || sending) return;
    const contextPrefix = moduleCtx.module !== "Today"
      ? `[Context: user is in the ${moduleCtx.module} module] `
      : "";
    const userMsg: ChatMessage = { role: "user", content: aiInput.trim() };
    const history = [...messages.slice(1), userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setAiInput("");
    setSending(true);
    setChatOpen(true);
    try {
      const res = await sendAiChat(businessId, contextPrefix + userMsg.content, history);
      const reply = res.data?.reply || "Sorry, I couldn't process that. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setSending(false);
  }, [aiInput, sending, messages, moduleCtx.module]);

  const handleDrawerSend = useCallback(async (text: string) => {
    const businessId = getStoredBusinessId();
    if (!businessId || !text.trim() || sending) return;
    const contextPrefix = moduleCtx.module !== "Today"
      ? `[Context: user is in the ${moduleCtx.module} module] `
      : "";
    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const history = [...messages.slice(1), userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const res = await sendAiChat(businessId, contextPrefix + userMsg.content, history);
      const reply = res.data?.reply || "Sorry, I couldn't process that. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setSending(false);
  }, [messages, sending, moduleCtx.module]);

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
    <div className="flex-1 min-w-0">
      <div className="relative group">
        <div className="flex items-center gap-2 px-3 py-2 kf-radius-md border border-border bg-card group-focus-within:border-[hsl(var(--kf-accent1)/0.3)] transition-all min-h-[44px]">
          <Terminal className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={moduleCtx.module !== "Today" ? `Ask AI about ${moduleCtx.module}...` : "Ask AI anything or run a command..."}
            aria-label="AI command input"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 min-w-0"
            disabled={sending}
          />
          {moduleCtx.module !== "Today" && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] shrink-0 hidden sm:inline">
              {moduleCtx.module}
            </span>
          )}
          <div className="flex items-center gap-1">
            {voiceSupported && (
              <button
                onClick={startVoice}
                className="p-1.5 rounded-md transition-all min-w-[44px] min-h-[44px] flex items-center justify-center sm:min-w-0 sm:min-h-0"
                style={voiceListening
                  ? { backgroundColor: "hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))" }
                  : undefined
                }
                title={voiceListening ? "Listening..." : "Voice input"}
              >
                {voiceListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={sending || !aiInput.trim()}
              aria-label="Send message"
              className="p-1.5 rounded-md transition-all disabled:opacity-30 min-w-[44px] min-h-[44px] flex items-center justify-center sm:min-w-0 sm:min-h-0"
              style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-foreground))" }}
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CornerDownLeft className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
      <AiChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={messages}
        sending={sending}
        quickPrompts={moduleCtx.prompts}
        onQuickPrompt={handleDrawerSend}
        moduleLabel={moduleCtx.module !== "Today" ? moduleCtx.module : undefined}
      />
    </div>
  );
}

export function AiCopilotTrigger() {
  const pathname = usePathname();
  const moduleCtx = useMemo(() => getModuleContext(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [sending, setSending] = useState(false);

  const handleSendFromTrigger = useCallback(async (text: string) => {
    const businessId = getStoredBusinessId();
    if (!businessId || !text.trim() || sending) return;
    const contextPrefix = moduleCtx.module !== "Today"
      ? `[Context: user is in the ${moduleCtx.module} module] `
      : "";
    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const history = [...messages.slice(1), userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const res = await sendAiChat(businessId, contextPrefix + userMsg.content, history);
      const reply = res.data?.reply || "Sorry, I couldn't process that. Please try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setSending(false);
  }, [messages, sending, moduleCtx.module]);

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          if (messages.length <= 1) {
            const greeting: ChatMessage = {
              role: "assistant",
              content: moduleCtx.module !== "Today"
                ? `I'm ready to help with ${moduleCtx.module}. Try: "${moduleCtx.prompts[0]}" or ask me anything.`
                : WELCOME.content,
            };
            setMessages([greeting]);
          }
        }}
        className="fixed right-4 bottom-4 z-40 flex md:hidden items-center gap-2 pl-3.5 pr-4 py-2.5 min-w-[44px] min-h-[44px] rounded-2xl border border-border/50 bg-card/90 backdrop-blur-xl hover:border-[hsl(var(--kf-accent1))]/30 text-foreground/80 hover:text-foreground shadow-lg shadow-black/30 hover:shadow-xl transition-all"
        aria-label="Open AI Copilot"
      >
        <Brain className="w-5 h-5" />
        <span className="text-sm font-medium">AI</span>
        {moduleCtx.module !== "Today" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] font-semibold">
            {moduleCtx.module}
          </span>
        )}
      </button>
      <AiChatDrawer
        open={open}
        onClose={() => setOpen(false)}
        messages={messages}
        sending={sending}
        quickPrompts={moduleCtx.prompts}
        onQuickPrompt={handleSendFromTrigger}
        moduleLabel={moduleCtx.module !== "Today" ? moduleCtx.module : undefined}
      />
    </>
  );
}
