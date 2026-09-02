"use client";

import { useEffect } from "react";
import { useKeyChat, useKeyChatActions, KeyChatMessages, KeyChatInput, KeyChatVoiceBar } from "@/components/key/chat";
import { PanelLeft, Plus, MessageSquare, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface KeyChatShellProps {
  className?: string;
}

export function KeyChatShell({ className }: KeyChatShellProps) {
  const { status, showHistory, setShowHistory, activeSessionId, sessions } = useKeyChat();
  const { sendMessage, deepThink, stop, confirmAction, loadSessions, createNewSession, selectSession } = useKeyChatActions();

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const isLoading = status === "streaming" || status === "loading";

  return (
    <div className={cn("flex h-full w-full overflow-hidden", className)}>
      {/* Left Sidebar - Session History */}
      {showHistory && (
        <div className="w-64 shrink-0 border-r border-border/50 bg-muted/30 flex flex-col">
          <div className="flex items-center justify-between p-3 border-b border-border/50">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sessions
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={createNewSession}
              title="New session"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                No conversations yet
              </div>
            ) : (
              <div className="flex flex-col gap-1">
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
      )}

      {/* Center - Chat Thread */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                showHistory && "bg-muted"
              )}
              onClick={() => setShowHistory((s) => !s)}
              title="Toggle history"
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
            <Button
              variant="ghost"
              size="sm"
              onClick={createNewSession}
              className="text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              New Chat
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0">
          <KeyChatMessages onConfirmAction={confirmAction} />
        </div>

        {/* Voice Bar */}
        <KeyChatVoiceBar />

        {/* Input */}
        <KeyChatInput onSend={sendMessage} onStop={stop} onDeepThink={deepThink} />
      </div>
    </div>
  );
}
