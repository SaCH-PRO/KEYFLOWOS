"use client";

import { useCallback, useEffect, useState } from "react";
import type React from "react";
import Link from "next/link";
import {
  useKeyChat,
  useKeyChatActions,
  KeyChatMessages,
  KeyChatInput,
  KeyChatVoiceBar,
  KeyChatHistory,
  KeyChatModeTabs,
} from "@/components/key/chat";
import { PanelLeft, PanelRight, Bot, ArrowRight } from "lucide-react";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import { KeyActionGrid } from "./key-action-grid";
import { KeyGenomePreview } from "./key-genome-preview";
import { KeyGenomeChip } from "./key-genome-chip";
import { openGenomeConversation, GENOME_SESSION_ID } from "./open-genome-conversation";
import { fetchAiApprovals, type AiApprovalItem } from "@/lib/api/ai-approvals";
import { getStoredBusinessId } from "@/lib/workspace";
import type { KeyChatMode } from "./types";

// Mode vocabulary lives in ./types. This file used to redeclare it locally with
// six members while the shared union had nine, so KeyChatModeTabs' onChange
// (mode: KeyChatMode) => void could not accept this shell's handler.
type ChatMode = KeyChatMode;

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
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pending Approvals
        </h3>
        <Link href="/app/approvals" className="flex items-center gap-1 text-[10px] text-primary hover:underline">
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
              className="block rounded-xl border border-border/40 bg-surface-muted p-2.5 transition-colors hover:bg-muted"
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

export function KeyFullChatShellV2() {
  const chat = useKeyChat();
  const { status, showHistory, setShowHistory, chatMode, setChatMode, activeSessionId, messages, setCurrentModule, setPageContext, setActiveSessionId, appendMessage, setOpen } = chat;
  const { sendMessage, stop, confirmAction, loadSessions, selectSession } = useKeyChatActions();
  const mode = (chatMode as ChatMode) ?? "general";
  const inGenomeThread = activeSessionId === GENOME_SESSION_ID;
  const [showRightRail, setShowRightRail] = useState(true);

  // Mobile: the right rail is an overlay — start collapsed so the conversation
  // is visible first (audit: rail covered the chat canvas on phones).
  useEffect(() => {
    const t = setTimeout(() => {
      if (window.matchMedia("(max-width: 1023px)").matches) setShowRightRail(false);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions, chatMode]);

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
    },
    [appendMessage, messages, selectSession, sendMessage, setActiveSessionId, setChatMode, setCurrentModule, setOpen, setPageContext],
  );

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

  const MODES_ORDER: ChatMode[] = ["general", "genome_onboarding", "executive", "finance", "sales", "operations"];
  const { swipeHandlers } = useSwipeTabs({
    tabs: MODES_ORDER,
    activeTab: mode,
    onTabChange: (tab) => handleModeChange(tab as ChatMode),
  });

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-background">
      {/* Left Sidebar */}
      <Surface
        variant="glass"
        className={cn(
          "shrink-0 border-r border-border/50 flex flex-col transition-all duration-base absolute lg:relative z-20 h-full",
          showHistory ? "w-64" : "w-0 overflow-hidden border-r-0",
        )}
      >
        <div className="p-3 border-b border-border/50">
          <div className="flex items-center gap-2 rounded-xl bg-surface-elevated px-3 py-2 shadow-sm">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-primary to-secondary">
              <Bot className="h-3 w-3 text-white" />
            </div>
            <span className="text-sm font-medium">Chat History</span>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <KeyChatHistory />
        </div>
      </Surface>

      {/* Center Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <Surface variant="elevated" className="rounded-none border-x-0 border-t-0 px-3 py-3 md:px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="ghost"
                leftIcon={<PanelLeft className="h-4 w-4" />}
                className={cn("h-9 w-9 flex-shrink-0", showHistory && "bg-muted")}
                onClick={() => setShowHistory((s) => !s)}
                aria-label="Toggle sidebar"
              />
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary shadow-md">
                  <Bot className="h-4 w-4 text-white" />
                  {isLoading && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet" />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-semibold text-foreground">KEY</h2>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {isLoading ? "Thinking..." : "Ready to help"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <KeyGenomeChip surface="page" />
              <Badge color={inGenomeThread ? "violet" : "muted"} className="hidden sm:inline-flex">
                {inGenomeThread ? "Genome" : mode === "general" ? "General" : mode}
              </Badge>
              <Button
                variant="ghost"
                leftIcon={<PanelRight className="h-4 w-4" />}
                className={cn("h-9 w-9 lg:hidden", showRightRail && "bg-muted")}
                onClick={() => setShowRightRail((s) => !s)}
                aria-label="Toggle context rail"
              />
            </div>
          </div>
        </Surface>

        <div className="border-b border-border/50 bg-background/95 px-3 py-2 md:px-4">
          <KeyChatModeTabs mode={mode} onChange={handleModeChange} />
        </div>

        <div className="flex-1 min-h-0" {...swipeHandlers}>
          <KeyChatMessages onConfirmAction={confirmAction} onCardAdvance={handleCardAdvance} />
        </div>

        <KeyChatVoiceBar />
        <KeyChatInput onSend={sendMessage} onStop={stop} />
      </div>

      {/* Right Context Rail */}
      <Surface
        variant="glass"
        className={cn(
          "shrink-0 border-l border-border/50 flex flex-col absolute right-0 top-0 h-full z-20 transition-all duration-base bg-background/95 backdrop-blur-sm lg:relative lg:bg-transparent lg:backdrop-blur-none",
          showRightRail ? "w-72" : "w-0 overflow-hidden border-l-0",
        )}
      >
        <div className="w-72 h-full flex flex-col overflow-y-auto">
          {inGenomeThread && (
            <div className="p-4 border-b border-border/50">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Genome Preview
              </h3>
              <KeyGenomePreview />
            </div>
          )}

          <div className="p-4 border-b border-border/50">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Quick Actions
            </h3>
            <KeyActionGrid />
          </div>

          <ApprovalsRail />
        </div>
      </Surface>

      {/* Backdrop for mobile rails */}
      {(showHistory || showRightRail) && (
        <button
          type="button"
          className="absolute inset-0 z-10 bg-black/20 lg:hidden"
          onClick={() => {
            setShowHistory(false);
            setShowRightRail(false);
          }}
          aria-label="Close side panels"
        />
      )}
    </div>
  );
}
