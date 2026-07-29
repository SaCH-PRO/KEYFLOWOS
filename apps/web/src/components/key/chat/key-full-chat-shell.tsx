"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { useKeyChat, useKeyChatActions, KeyChatMessages, KeyChatInput, KeyChatVoiceBar } from "@/components/key/chat";
import { PanelLeft, Plus, MessageSquare, Bot, LayoutGrid, Dna, Shield, TrendingUp, Users, Settings, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KeyActionChips } from "./key-action-chips";
import { KeyGenomePreview } from "./key-genome-preview";

type ChatMode = "general" | "genome_onboarding" | "executive" | "finance" | "sales" | "operations";

const MODES: { id: ChatMode; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "general", label: "General", icon: <LayoutGrid className="h-3.5 w-3.5" />, description: "General assistance" },
  { id: "genome_onboarding", label: "Genome", icon: <Dna className="h-3.5 w-3.5" />, description: "Business genome onboarding" },
  { id: "executive", label: "Executive", icon: <Shield className="h-3.5 w-3.5" />, description: "Executive decisions" },
  { id: "finance", label: "Finance", icon: <TrendingUp className="h-3.5 w-3.5" />, description: "Financial analysis" },
  { id: "sales", label: "Sales", icon: <Users className="h-3.5 w-3.5" />, description: "Sales and CRM" },
  { id: "operations", label: "Operations", icon: <Settings className="h-3.5 w-3.5" />, description: "Operations" },
];

export function KeyFullChatShell() {
  const { status, showHistory, setShowHistory, activeSessionId, sessions, chatMode, setChatMode, setMessages, setActiveSessionId, setInput, setStatus, setError } = useKeyChat();
  const { sendMessage, stop, confirmAction, loadSessions, createNewSession, selectSession } = useKeyChatActions();
  const [mode, setMode] = useState<ChatMode>(chatMode ?? "general");
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  // Sync local mode state with store
  useEffect(() => {
    if (mode !== chatMode) {
      setChatMode(mode);
    }
  }, [mode, chatMode, setChatMode]);

  // Sync store mode to local when it changes externally (e.g., resetForNewSession)
  // Use a ref to avoid cascading renders from setState in effect
  const modeSyncRef = useRef<string | undefined>(chatMode);
  useEffect(() => {
    if (chatMode && chatMode !== mode && chatMode !== modeSyncRef.current) {
      modeSyncRef.current = chatMode;
      // Defer setState to avoid synchronous setState in effect
      const timeout = setTimeout(() => setMode(chatMode as ChatMode), 0);
      return () => clearTimeout(timeout);
    }
  }, [chatMode, mode]);

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

  // Reset chat state when mode changes (clear messages, start fresh)
  const handleModeChange = useCallback((newMode: ChatMode) => {
    setMode(newMode);
    setShowModeMenu(false);
    // Reset chat state for the new mode
    setMessages([]);
    setActiveSessionId(null);
    setInput("");
    setStatus("idle");
    setError(undefined);
  }, [setMessages, setActiveSessionId, setInput, setStatus, setError]);

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

        {/* New Chat Button */}
        <div className="p-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={createNewSession}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Chat
          </Button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-2">
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent
          </div>
          {sessions.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => selectSession(session.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors",
                    activeSessionId === session.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="flex-1 truncate">{session.title}</span>
                </button>
              ))}
            </div>
          )}
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
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-muted">
              {mode === "general" ? "General" : MODES.find(m => m.id === mode)?.label}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0">
          <KeyChatMessages onConfirmAction={confirmAction} />
        </div>

        {/* Voice Bar */}
        <KeyChatVoiceBar />

        {/* Input */}
        <KeyChatInput onSend={sendMessage} onStop={stop} />
      </div>

      {/* Right Context Rail */}
      <div className="w-72 shrink-0 border-l border-border/50 bg-muted/20 flex flex-col">
        {/* Genome Preview - only in genome mode */}
        {mode === "genome_onboarding" && (
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
        <div className="p-4 flex-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Pending Approvals
          </h3>
          <div className="text-xs text-muted-foreground">
            No pending approvals
          </div>
        </div>
      </div>
    </div>
  );
}
