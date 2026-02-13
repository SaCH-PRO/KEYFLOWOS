"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, ImagePlus, Send, FileText, Sparkles, Hash, ChevronDown, Layers, Globe } from "lucide-react";
import { SocialConnection } from "@/lib/client";

const MAX_CHARS = 2200;

const HASHTAG_SUGGESTIONS = [
  "#business", "#caribbean", "#trinidad", "#entrepreneur",
  "#smallbusiness", "#servicebusiness", "#growyourbusiness", "#ttbusiness",
];

const CONTENT_TEMPLATES: { label: string; text: string }[] = [
  { label: "Promotion", text: "🔥 Special Offer!\n\nFor a limited time, enjoy [discount]% off [service/product].\n\nDon't miss out — book today!\n\n#promotion #deal" },
  { label: "Announcement", text: "📢 Exciting News!\n\nWe're thrilled to announce [your news here].\n\nStay tuned for more updates!\n\n#announcement #news" },
  { label: "Behind the Scenes", text: "🎬 Behind the Scenes\n\nEver wondered what goes into [process]? Here's a peek at how we [action].\n\n#behindthescenes #dayinthelife" },
  { label: "Customer Spotlight", text: "⭐ Customer Spotlight\n\nShoutout to [customer name] for [achievement/story]!\n\nThank you for choosing us.\n\n#customerspotlight #testimonial" },
  { label: "Tips & Advice", text: "💡 Quick Tip\n\nDid you know? [Insert helpful tip related to your industry].\n\nShare this with someone who needs it!\n\n#tips #advice" },
];

type Props = {
  onSubmit: (data: { content: string; scheduledFor?: string; channelIds?: string[] }) => Promise<void>;
  onClose: () => void;
  submitting?: boolean;
  initial?: { content: string; scheduledFor?: string; channelIds?: string[] };
  mode?: "create" | "edit";
  connections?: SocialConnection[];
};

export function PostComposer({ onSubmit, onClose, submitting, initial, mode = "create", connections = [] }: Props) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [scheduledFor, setScheduledFor] = useState(initial?.scheduledFor ?? "");
  const [showSchedule, setShowSchedule] = useState(!!initial?.scheduledFor);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set(initial?.channelIds ?? []));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const charCount = content.length;
  const overLimit = charCount > MAX_CHARS;
  const charPercent = Math.min((charCount / MAX_CHARS) * 100, 100);
  const ringColor = overLimit ? "hsl(0 70% 50%)" : charCount > MAX_CHARS * 0.9 ? "hsl(40 90% 50%)" : charCount > MAX_CHARS * 0.7 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))";

  function insertHashtag(tag: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setContent((prev) => prev + (prev.endsWith(" ") || prev === "" ? "" : " ") + tag + " ");
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const prefix = before.endsWith(" ") || before === "" ? "" : " ";
    const newContent = before + prefix + tag + " " + after;
    setContent(newContent);
    setTimeout(() => {
      const pos = start + prefix.length + tag.length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }, 0);
  }

  function applyTemplate(text: string) {
    setContent(text);
    setShowTemplates(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function toggleChannel(platform: string) {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  async function handleSubmit() {
    if (!content.trim() || overLimit) return;
    await onSubmit({
      content,
      scheduledFor: showSchedule && scheduledFor ? scheduledFor : undefined,
      channelIds: selectedChannels.size > 0 ? Array.from(selectedChannels) : undefined,
    });
  }

  return (
    <div className="rounded-2xl border backdrop-blur-xl p-5 space-y-4" style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}>
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
        <div className="relative">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="absolute top-2 right-2 z-10 kf-btn-secondary inline-flex items-center gap-1 text-[10px] !px-2 !py-1"
          >
            <Layers className="w-3 h-3" />
            Templates
            <ChevronDown className={`w-3 h-3 transition-transform ${showTemplates ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {showTemplates && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-9 right-2 z-20 w-52 rounded-xl border backdrop-blur-xl py-1 shadow-xl"
                style={{ background: "hsl(var(--kf-card))", borderColor: "hsl(var(--kf-border))" }}
              >
                {CONTENT_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => applyTemplate(t.text)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-[hsl(var(--kf-muted))] transition-colors"
                  >
                    {t.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <textarea
          ref={textareaRef}
          className="kf-input w-full min-h-[120px] resize-none pr-28"
          placeholder="What's on your mind? Share updates, promotions, or announcements..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoFocus
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <div className="relative w-7 h-7">
            <svg className="w-7 h-7 -rotate-90" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-[hsl(var(--kf-border))]" />
              <circle
                cx="12" cy="12" r="10" fill="none" strokeWidth="2.5"
                strokeDasharray={`${charPercent * 0.628} 62.8`}
                strokeLinecap="round"
                style={{ stroke: ringColor, transition: "stroke 0.3s" }}
              />
            </svg>
          </div>
          <span className={`text-[10px] font-mono ${overLimit ? "text-red-400" : "text-muted-foreground"}`}>
            {charCount}/{MAX_CHARS}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Hash className="w-3 h-3" />
          Hashtag suggestions
        </div>
        <div className="flex flex-wrap gap-1.5">
          {HASHTAG_SUGGESTIONS.map((tag) => (
            <button
              key={tag}
              onClick={() => insertHashtag(tag)}
              className="px-2 py-1 rounded-lg text-[11px] font-medium border transition-all hover:scale-105"
              style={{
                background: "hsl(var(--kf-accent1) / 0.08)",
                borderColor: "hsl(var(--kf-accent1) / 0.2)",
                color: "hsl(var(--kf-accent1))",
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {connections.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Globe className="w-3 h-3" />
            Publish to channels
          </div>
          <div className="flex flex-wrap gap-2">
            {connections.filter(c => c.status === "CONNECTED").map((conn) => {
              const selected = selectedChannels.has(conn.platform);
              return (
                <button
                  key={conn.platform}
                  onClick={() => toggleChannel(conn.platform)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    selected
                      ? "border-[hsl(var(--kf-accent1)/0.5)] bg-[hsl(var(--kf-accent1)/0.12)] text-[hsl(var(--kf-accent1))]"
                      : "border-[hsl(var(--kf-border))] text-muted-foreground hover:bg-[hsl(var(--kf-muted)/0.5)]"
                  }`}
                >
                  {conn.platform.charAt(0) + conn.platform.slice(1).toLowerCase()}
                  {conn.accountName ? ` · ${conn.accountName}` : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      <AnimatePresence>
        {showSchedule && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="rounded-xl border p-3 flex items-center gap-3" style={{ background: "hsl(var(--kf-card) / 0.5)", borderColor: "hsl(var(--kf-border))" }}>
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
          </motion.div>
        )}
      </AnimatePresence>

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
