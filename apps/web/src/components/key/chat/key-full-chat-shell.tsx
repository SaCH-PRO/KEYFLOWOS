"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import Link from "next/link";
import { useKeyChat, useKeyChatActions, KeyChatMessages, KeyChatInput, KeyChatVoiceBar, KeyChatHistory } from "@/components/key/chat";
import { PanelLeft, Bot, LayoutGrid, Dna, Shield, TrendingUp, Users, Settings, ChevronDown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KeyActionChips } from "./key-action-chips";
import { KeyGenomePreview } from "./key-genome-preview";
import { KeyGenomeChip } from "./key-genome-chip";
import { openGenomeConversation, GENOME_SESSION_ID } from "./open-genome-conversation";
import { fetchAiApprovals, type AiApprovalItem } from "@/lib/api/ai-approvals";
import { getStoredBusinessId } from "@/lib/workspace";

type ChatMode = "general" | "genome_onboarding" | "executive" | "finance" | "sales" | "operations";

const MODES: { id: ChatMode; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "general", label: "General", icon: <LayoutGrid className="h-3.5 w-3.5" />, description: "General assistance" },
  { id: "genome_onboarding", label: "Genome", icon: <Dna className="h-3.5 w-3.5" />, description: "Business genome onboarding" },
  { id: "executive", label: "Executive", icon: <Shield className="h-3.5 w-3.5" />, description: "Executive decisions" },
  { id: "finance", label: "Finance", icon: <TrendingUp className="h-3.5 w-3.5" />, description: "Financial analysis" },
  { id: "sales", label: "Sales", icon: <Users className="h-3.5 w-3.5" />, description: "Sales and CRM" },
  { id: "operations", label: "Operations", icon: <Settings className="h-3.5 w-3.5" />, description: "Operations" },
];

function ApprovalsRail() {
  const [items, setItems] = useState<AiApprovalItem[] | null>(null);

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    fetchAiApprovals(businessId, { status: "pending", limit: 3 })
      .then(({ data }) => setItems(data?.items ?? []))
      .catch(() => setItems([]));
  }, []);

  return (
    <div className="p-4 flex-1">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Pending Approvals
        </h3>
        <Link href="/app/approvals" className="flex items-center gap-1 text-[10px] text-[hsl(var(--kf-accent1))] hover:underline">
          Review <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {items === null ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No pending approvals</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href="/app/approvals"
              className="block rounded-lg border border-border/50 bg-card/60 p-2.5 transition-colors hover:bg-card"
            >
              <p className="truncate text-xs font-medium text-foreground">{item.title}</p>
              <p className="text-[10px] text-muted-foreground">
                Tier {item.riskTier} · {item.toolName.replace(/_/g, " ")}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function KeyFullChatShell() {
  const chat = useKeyChat();
  const { status, showHistory, setShowHistory, chatMode, setChatMode, activeSessionId, messages, setCurrentModule, setPageContext, setActiveSessionId, appendMessage, setOpen } = chat;
  const { sendMessage, stop, confirmAction, loadSessions, selectSession } = useKeyChatActions();
  // Mode lives in the chat store (sendMessage branches on it); no local copy.
  const mode = (chatMode as ChatMode) ?? "general";
  const inGenomeThread = activeSessionId === GENOME_SESSION_ID;
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions, chatMode]);

  // Click-outside handler for mode dropdown
  useEffect(() => {
    if (!showModeMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showModeMenu]);

  // Mode is a hint for subsequent messages — never wipes the conversation.
  // "Genome" is not a backend mode: it opens the ONE pinned genome thread
  // (same conversation as the sidebar pinned card and the auto-nudge).
  const handleModeChange = useCallback(
    (newMode: ChatMode) => {
      if (newMode === "genome_onboarding") {
        void selectSession(GENOME_SESSION_ID).then(() =>
          openGenomeConversation(
            { messages, setCurrentModule, setPageContext, setActiveSessionId, appendMessage, setOpen },
            sendMessage,
            { surface: "page" },
          ),
        );
      } else {
        setChatMode(newMode);
      }
      setShowModeMenu(false);
    },
    [appendMessage, messages, selectSession, sendMessage, setActiveSessionId, setChatMode, setCurrentModule, setOpen, setPageContext],
  );

  // Card advances outside /app/onboarding drive the flow conversationally.
  const handleCardAdvance = useCallback(
    (step: string) => {
      void sendMessage(
        `The user finished the "${step}" onboarding step. Present the next step's card.`,
        { silent: true },
      );
    },
    [sendMessage],
  );

  const isLoading = status === "streaming" || status === "loading";

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden">
      {/* Left Sidebar */}
      <div className={cn(
        "shrink-0 border-r border-border/50 bg-muted/30 flex flex-col transition-all duration-200",
        showHistory ? "w-64" : "w-0 overflow-hidden"
      )}>
        {/* Mode Selector */}
        <div className="p-3 border-b border-border/50">
          <div className="relative" ref={modeMenuRef}>
            <button
              onClick={() => setShowModeMenu(!showModeMenu)}
              className="flex w-full items-center gap-2 rounded-lg bg-card px-3 py-2 text-left text-sm font-medium shadow-sm hover:bg-card/80 transition-colors"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-orange-500 to-teal-500">
                <Bot className="h-3 w-3 text-white" />
              </div>
              <span className="flex-1">{MODES.find(m => m.id === mode)?.label}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            {showModeMenu && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-border/50 bg-card shadow-lg p-1">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleModeChange(m.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      mode === m.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"
                    )}
                  >
                    {m.icon}
                    <div>
                      <div className="font-medium">{m.label}</div>
                      <div className="text-[10px] opacity-70">{m.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Shared history: pinned genome chat + sessions */}
        <div className="flex-1 min-h-0">
          <KeyChatHistory />
        </div>
      </div>

      {/* Center - Chat Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", showHistory && "bg-muted")}
              onClick={() => setShowHistory((s) => !s)}
              title="Toggle sidebar"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-teal-500">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">KEY</h2>
                <p className="text-[10px] text-muted-foreground">
                  {isLoading ? "Thinking..." : "Ready to help"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <KeyGenomeChip surface="page" />
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-muted">
              {inGenomeThread ? "Genome" : mode === "general" ? "General" : MODES.find(m => m.id === mode)?.label}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0">
          <KeyChatMessages onConfirmAction={confirmAction} onCardAdvance={handleCardAdvance} />
        </div>

        {/* Voice Bar */}
        <KeyChatVoiceBar />

        {/* Input */}
        <KeyChatInput onSend={sendMessage} onStop={stop} />
      </div>

      {/* Right Context Rail */}
      <div className="w-72 shrink-0 border-l border-border/50 bg-muted/20 flex flex-col">
        {/* Genome Preview - shown inside the genome thread */}
        {inGenomeThread && (
          <div className="p-4 border-b border-border/50">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Genome Preview
            </h3>
            <KeyGenomePreview />
          </div>
        )}

        {/* Action Chips */}
        <div className="p-4 border-b border-border/50">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Quick Actions
          </h3>
          <KeyActionChips />
        </div>

        {/* Approvals Queue */}
        <ApprovalsRail />
      </div>
    </div>
  );
}
