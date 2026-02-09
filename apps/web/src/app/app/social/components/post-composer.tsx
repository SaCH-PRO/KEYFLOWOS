"use client";

import { useState } from "react";
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
    <div className="kf-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          {mode === "edit" ? "Edit Post" : "Compose Post"}
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="relative">
        <textarea
          className="kf-input w-full min-h-[120px] resize-none"
          placeholder="What's on your mind? Share updates, promotions, or announcements..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoFocus
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <div className="relative w-6 h-6">
            <svg className="w-6 h-6 -rotate-90" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-[hsl(var(--kf-border))]" />
              <circle
                cx="12" cy="12" r="10" fill="none" strokeWidth="2"
                strokeDasharray={`${charPercent * 0.628} 62.8`}
                style={{ stroke: overLimit ? "hsl(0 70% 50%)" : charCount > MAX_CHARS * 0.9 ? "hsl(40 90% 50%)" : "hsl(var(--kf-accent1))" }}
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
          className={`kf-btn-secondary inline-flex items-center gap-1.5 text-xs ${showSchedule ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
          onClick={() => setShowSchedule(!showSchedule)}
        >
          <Clock className="w-3.5 h-3.5" />
          Schedule
        </button>
        <button className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs opacity-50 cursor-not-allowed" title="Coming soon">
          <ImagePlus className="w-3.5 h-3.5" />
          Media
        </button>
        <button className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs opacity-50 cursor-not-allowed" title="AI assistance coming soon">
          <Sparkles className="w-3.5 h-3.5" />
          AI Assist
        </button>
      </div>

      {showSchedule && (
        <div className="kf-card p-3 flex items-center gap-3">
          <Clock className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
          <input
            type="datetime-local"
            className="kf-input flex-1"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
          />
          <button onClick={() => { setShowSchedule(false); setScheduledFor(""); }} className="text-xs text-muted-foreground hover:text-foreground">
            Clear
          </button>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button className="kf-btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
        <button
          className="kf-btn-primary inline-flex items-center gap-1.5"
          onClick={handleSubmit}
          disabled={!content.trim() || overLimit || submitting}
          style={{ opacity: !content.trim() || overLimit || submitting ? 0.5 : 1 }}
        >
          <Send className="w-3.5 h-3.5" />
          {submitting ? "Saving..." : showSchedule && scheduledFor ? "Schedule Post" : mode === "edit" ? "Update" : "Save Draft"}
        </button>
      </div>
    </div>
  );
}
