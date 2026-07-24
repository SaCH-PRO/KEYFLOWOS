"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, MessageSquare, Dna, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { formatTime } from "./utils";
import { getGenome, type GenomeIntegrityResult } from "@/lib/api/business-genome";
import { getStoredBusinessId } from "@/lib/workspace";
import { openGenomeConversation, GENOME_SESSION_ID } from "./open-genome-conversation";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import { EmptyState } from "@/components/ui-v2/empty-state";

function GenomePillarBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-12 shrink-0 text-[9px] text-muted-foreground">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={cn(
            "h-full transition-all",
            score >= 50 ? "bg-mint" : "bg-gold"
          )}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
    </div>
  );
}

export function KeyChatHistory() {
  const chat = useKeyChat();
  const { sessions, activeSessionId, status } = chat;
  const { loadSessions, selectSession, createNewSession, deleteSession, sendMessage } = useKeyChatActions();
  const [genome, setGenome] = useState<GenomeIntegrityResult | null>(null);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    getGenome(businessId)
      .then(({ data }) => {
        if (data) setGenome(data);
      })
      .catch(() => {
        // progress is informational; never block the sidebar on it
      });
  }, []);

  const openGenomeChat = async () => {
    // Restore the saved genome conversation if one exists — otherwise the
    // helper seeds the built-in one so the user lands IN the chat.
    const businessId = getStoredBusinessId();
    if (businessId) {
      await selectSession(GENOME_SESSION_ID);
    }
    openGenomeConversation(chat, sendMessage, { surface: "drawer" });
  };

  const genomeActive = activeSessionId === GENOME_SESSION_ID;
  const pillarMet = genome?.threePillarMinimumMet ?? false;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 p-3">
        <Badge variant="status" color="muted">
          Chat history
        </Badge>
        <Button
          type="button"
          variant="icon"
          onClick={createNewSession}
          aria-label="New chat"
          className="h-7 w-7"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Pinned: the Business Genome & onboarding conversation. Every chat
            feeds the genome; this is where you grow it deliberately. */}
        <Surface
          role="button"
          tabIndex={0}
          onClick={openGenomeChat}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void openGenomeChat();
            }
          }}
          variant={genomeActive ? "accent" : "interactive"}
          className={cn(
            "mb-3 flex w-full flex-col gap-2 p-2.5 text-left",
            genomeActive && "cursor-pointer border-violet/30 bg-violet/10"
          )}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet/15">
              <Dna className="h-3.5 w-3.5 text-violet" />
            </div>
            <span className="flex-1 text-xs font-medium text-foreground">
              Business Genome &amp; Onboarding
            </span>
            {pillarMet ? (
              <Badge color="mint" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Ready
              </Badge>
            ) : (
              <Badge color="violet">In progress</Badge>
            )}
          </div>
          {genome ? (
            <div className="space-y-1">
              <GenomePillarBar label="Founder" score={genome.genomeDnaScores?.founder ?? 0} />
              <GenomePillarBar label="Business" score={genome.genomeDnaScores?.business ?? 0} />
              <GenomePillarBar label="Market" score={genome.genomeDnaScores?.market ?? 0} />
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              {pillarMet ? "Genome ready" : "Keep building your genome with KEY"}
            </p>
          )}
        </Surface>

        {status === "loading" && sessions.length === 0 ? (
          <div className="flex flex-col gap-2">
            <Surface variant="elevated" className="h-10 animate-pulse" />
            <Surface variant="elevated" className="h-10 animate-pulse" />
            <Surface variant="elevated" className="h-10 animate-pulse" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No conversations yet"
            description="Start a new chat to get help from KEY."
            actionLabel="New chat"
            onAction={createNewSession}
            className="py-8"
          />
        ) : (
          <div className="flex flex-col gap-1">
            {sessions.map((session) => (
              <Surface
                key={session.id}
                variant={activeSessionId === session.id ? "accent" : "default"}
                as="div"
                role="button"
                tabIndex={0}
                onClick={() => selectSession(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void selectSession(session.id);
                  }
                }}
                className={cn(
                  "group flex w-full cursor-pointer items-center gap-2 px-2 py-2 text-left text-xs transition-colors",
                  activeSessionId === session.id
                    ? "border-violet/30 bg-violet/10 text-foreground"
                    : "hover:bg-surface-muted"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{session.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatTime(new Date(session.updatedAt).getTime())}
                </span>
                <Button
                  type="button"
                  variant="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteSession(session.id);
                  }}
                  aria-label="Delete chat"
                  className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </Button>
              </Surface>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
