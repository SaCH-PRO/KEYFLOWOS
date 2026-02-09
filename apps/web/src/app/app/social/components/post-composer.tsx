"use client";

import { useState } from "react";
import { Button, Input } from "@keyflow/ui";
import { X, Clock, ImagePlus, Send, FileText, Sparkles } from "lucide-react";

const MAX_CHARS = 2200;

type Props = {
  onSubmit: (data: { content: string; scheduledFor?: string }) => Promise<void>;
  onClose: () => void;
  submitting?: boolean;
  initial?: { content: string; scheduledFor?: string };
  mode?: "create" | "edit";
};

export function PostComposer({ onSubmit, onClose, submitting, initial, mode = "create" }: Props) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [scheduledFor, setScheduledFor] = useState(initial?.scheduledFor ?? "");
  const [showSchedule, setShowSchedule] = useState(!!initial?.scheduledFor);

  const charCount = content.length;
  const overLimit = charCount > MAX_CHARS;
  const charPercent = Math.min((charCount / MAX_CHARS) * 100, 100);

  async function handleSubmit() {
    if (!content.trim() || overLimit) return;
    await onSubmit({ content, scheduledFor: showSchedule && scheduledFor ? scheduledFor : undefined });
  }

  return (
    <div className="rounded-2xl border border-primary/30 bg-slate-950/90 backdrop-blur-sm p-5 space-y-4 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <FileText className="w-4 h-4 text-primary" />
          {mode === "edit" ? "Edit Post" : "Compose Post"}
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="relative">
        <textarea
          className="w-full rounded-xl border border-border/60 bg-slate-900/80 px-4 py-3 text-sm min-h-[120px] resize-none focus:border-primary/60 focus:outline-none transition-colors"
          placeholder="What's on your mind? Share updates, promotions, or announcements..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoFocus
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <div className="relative w-6 h-6">
            <svg className="w-6 h-6 -rotate-90" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-border/40" />
              <circle
                cx="12" cy="12" r="10" fill="none" strokeWidth="2"
                strokeDasharray={`${charPercent * 0.628} 62.8`}
                className={overLimit ? "stroke-red-500" : charCount > MAX_CHARS * 0.9 ? "stroke-amber-400" : "stroke-primary"}
              />
            </svg>
          </div>
          <span className={`text-[10px] font-mono ${overLimit ? "text-red-400" : "text-muted-foreground"}`}>
            {charCount}/{MAX_CHARS}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          onClick={() => setShowSchedule(!showSchedule)}
        >
          <Clock className="w-3.5 h-3.5" />
          Schedule
        </button>
        <button className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors opacity-50 cursor-not-allowed" title="Coming soon">
          <ImagePlus className="w-3.5 h-3.5" />
          Media
        </button>
        <button className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors opacity-50 cursor-not-allowed" title="AI assistance coming soon">
          <Sparkles className="w-3.5 h-3.5" />
          AI Assist
        </button>
      </div>

      {showSchedule && (
        <div className="flex items-center gap-3 rounded-xl bg-slate-900/60 border border-border/40 p-3">
          <Clock className="w-4 h-4 text-primary flex-shrink-0" />
          <Input
            type="datetime-local"
            className="flex-1"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
          />
          <button onClick={() => { setShowSchedule(false); setScheduledFor(""); }} className="text-xs text-muted-foreground hover:text-foreground">
            Clear
          </button>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={!content.trim() || overLimit || submitting}>
          <Send className="w-3.5 h-3.5 mr-1.5" />
          {submitting ? "Saving..." : showSchedule && scheduledFor ? "Schedule Post" : mode === "edit" ? "Update" : "Save Draft"}
        </Button>
      </div>
    </div>
  );
}
