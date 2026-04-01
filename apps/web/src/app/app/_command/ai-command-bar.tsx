"use client";

import { useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { Brain } from "lucide-react";
import { sendAiChat } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import type { ChatMessage } from "./types";
import { AiChatDrawer } from "./ai-chat-drawer";

const WELCOME: ChatMessage = {
  role: "assistant",
  content: "Ready to assist. Ask me anything about your business — strategy, finances, operations, or run a command.",
};

type ModuleQuickPrompts = { module: string; prompts: string[] };

const MODULE_PROMPTS: Record<string, ModuleQuickPrompts> = {
  "/app": { module: "Today", prompts: ["Daily briefing", "Cash flow", "Focus areas"] },
  "/app/crm": { module: "CRM", prompts: ["Score my leads", "Churn risk scan", "Pipeline analysis"] },
  "/app/commerce": { module: "Commerce", prompts: ["Cash flow forecast", "Overdue recovery", "Revenue analysis"] },
  "/app/bookings": { module: "Bookings", prompts: ["Schedule optimizer", "No-show predictions", "Revenue insights"] },
  "/app/marketing": { module: "Marketing", prompts: ["Campaign performance", "Subject line ideas", "Audience segments"] },
  "/app/store": { module: "Store", prompts: ["Store optimizer", "SEO advice", "Pricing analysis"] },
  "/app/expenses": { module: "Expenses", prompts: ["Spending trends", "Budget review", "Tax deductions"] },
  "/app/projects": { module: "Projects", prompts: ["Task priorities", "Automation ideas", "Project status"] },
  "/app/reports": { module: "Reports", prompts: ["Revenue trends", "Growth analysis", "Key metrics"] },
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
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 pl-3.5 pr-4 py-2.5 min-w-[44px] min-h-[44px] rounded-2xl border border-border/50 bg-card/90 backdrop-blur-xl hover:border-[hsl(var(--kf-accent1))]/30 text-foreground/80 hover:text-foreground shadow-lg shadow-black/30 hover:shadow-xl transition-all"
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
