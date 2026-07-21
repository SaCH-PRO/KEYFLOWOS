"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, MessageSquare, Loader2, Dna, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { formatTime, nanoid } from "./utils";
import { getGenome, type GenomeIntegrityResult } from "@/lib/api/business-genome";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchFlowSessions } from "@/lib/client";

const GENOME_SESSION_ID = "onboarding";

function GenomePillarBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-12 shrink-0 text-[9px] text-muted-foreground">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full transition-all",
            score >= 50 ? "bg-emerald-500" : "bg-amber-500"
          )}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
    </div>
  );
}

export function KeyChatHistory() {
  const { sessions, activeSessionId, status, setCurrentModule, setPageContext, appendMessage } = useKeyChat();
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
    setCurrentModule("onboarding");
    setPageContext({
      route: window.location.pathname,
      surface: "drawer",
      mode: "onboarding",
      hints: ["business genome completion"],
    });

    // Restore the saved genome conversation if one exists — otherwise seed
    // the built-in one so the user lands IN the chat, not on an empty thread.
    const businessId = getStoredBusinessId();
    let hasSavedConversation = false;
    if (businessId) {
      const res = await fetchFlowSessions(businessId);
      hasSavedConversation = Boolean(
        (res.data as Array<Record<string, unknown>> | null)?.find(
          (s) =>
            s.id === GENOME_SESSION_ID &&
            Array.isArray(s.messages) &&
            (s.messages as unknown[]).length > 0,
        ),
      );
    }

    await selectSession(GENOME_SESSION_ID);

    if (!hasSavedConversation) {
      // Straight into the work: a brief hello, then KEY opens the genome
      // intake herself — no cards, no buttons, no leaving this chat.
      appendMessage({
        id: nanoid(),
        role: "assistant",
        content:
          "Hi! I’m KEY. Let’s finish your Business Genome — I’ll ask a few quick questions one at a time and fill in the rest.",
        timestamp: Date.now(),
      });
      void sendMessage(
        "Let's complete my Business Genome. Ask me the first question, one at a time.",
        { silent: true },
      );
    }
  };

  const genomeActive = activeSessionId === GENOME_SESSION_ID;
  const pillarMet = genome?.threePillarMinimumMet ?? false;

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
        {/* Pinned: the Business Genome & onboarding conversation. Every chat
            feeds the genome; this is where you grow it deliberately. */}
        <button
          type="button"
          onClick={openGenomeChat}
          className={cn(
            "mb-3 flex w-full flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors",
            genomeActive
              ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10"
              : "border-border/60 bg-card/60 hover:bg-card"
          )}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--kf-accent1))]/15">
              <Dna className="h-3.5 w-3.5 text-[hsl(var(--kf-accent1))]" />
            </div>
            <span className="flex-1 text-xs font-medium text-foreground">
              Business Genome &amp; Onboarding
            </span>
            {pillarMet && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
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
        </button>

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
              <div
                key={session.id}
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
                  "group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors",
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
