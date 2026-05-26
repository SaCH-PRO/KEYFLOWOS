"use client";

import { Sparkles, Send } from "lucide-react";

interface DetailAIActionsProps {
  contactId: string | null | undefined;
  type: string;
  status: string;
  number: string;
  onViewClientIntel?: (id: string) => void;
  onAiDraftReminder?: (num: string) => void;
}

export function DetailAIActions({
  contactId,
  type,
  status,
  number,
  onViewClientIntel,
  onAiDraftReminder,
}: DetailAIActionsProps) {
  if ((!onViewClientIntel && !onAiDraftReminder) || !contactId) return null;

  const showReminder = onAiDraftReminder && type === "invoice" && (status === "OVERDUE" || status === "SENT");

  return (
    <div className="flex items-center gap-2">
      {onViewClientIntel && (
        <button
          onClick={() => onViewClientIntel(contactId)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 transition-colors text-xs font-medium"
          title="AI Analyze — client payment intelligence"
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI Analyze
        </button>
      )}
      {showReminder && (
        <button
          onClick={() => onAiDraftReminder!(number)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 border border-[hsl(var(--kf-accent1))]/20 transition-colors text-xs font-medium"
          title="AI Draft Reminder"
        >
          <Send className="w-3.5 h-3.5" />
          AI Draft Reminder
        </button>
      )}
    </div>
  );
}
