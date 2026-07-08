"use client";

import { useEffect } from "react";
import { Plus, Trash2, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { formatTime } from "./utils";

export function KeyChatHistory() {
  const { sessions, activeSessionId, status } = useKeyChat();
  const { loadSessions, selectSession, createNewSession, deleteSession } = useKeyChatActions();

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return (
    <div className="flex h-full w-full flex-col border-r border-border/50 bg-muted/30">
      <div className="flex items-center justify-between border-b border-border/50 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Chat history
        </span>
        <button
          type="button"
          onClick={createNewSession}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {status === "loading" && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            No conversations yet. Start one!
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => selectSession(session.id)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors",
                  activeSessionId === session.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="flex-1 truncate">{session.title}</span>
                <span className="shrink-0 text-[10px] opacity-50">
                  {formatTime(new Date(session.updatedAt).getTime())}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteSession(session.id);
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Delete chat"
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
