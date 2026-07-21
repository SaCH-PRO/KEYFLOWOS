"use client";

import { useEffect, useState } from "react";
import { Dna, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyChat } from "./key-chat-store";
import { useKeyChatActions } from "./use-key-chat-actions";
import { openGenomeConversation, GENOME_SESSION_ID } from "./open-genome-conversation";
import { getGenome, type GenomeIntegrityResult } from "@/lib/api/business-genome";
import { getStoredBusinessId } from "@/lib/workspace";

interface KeyGenomeChipProps {
  surface: "page" | "drawer";
}

/**
 * Compact genome status pill for chat headers — shows integrity (or a
 * ready check), and opens the one pinned genome conversation on click.
 */
export function KeyGenomeChip({ surface }: KeyGenomeChipProps) {
  const chat = useKeyChat();
  const { sendMessage } = useKeyChatActions();
  const [genome, setGenome] = useState<GenomeIntegrityResult | null>(null);

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    getGenome(businessId)
      .then(({ data }) => {
        if (data) setGenome(data);
      })
      .catch(() => undefined);
  }, []);

  const ready = genome?.threePillarMinimumMet ?? false;
  const integrity = genome ? Math.round(genome.genomeIntegrity ?? 0) : null;
  const active = chat.activeSessionId === GENOME_SESSION_ID;

  return (
    <button
      type="button"
      onClick={() => openGenomeConversation(chat, sendMessage, { surface })}
      title={ready ? "Business Genome ready — open the genome chat" : "Continue building your Business Genome"}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
        active
          ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
          : "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Dna className="h-3 w-3" />
      {ready ? (
        <span className="flex items-center gap-1">
          Genome <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        </span>
      ) : integrity !== null ? (
        <span>Genome {integrity}%</span>
      ) : (
        <span>Genome</span>
      )}
    </button>
  );
}
