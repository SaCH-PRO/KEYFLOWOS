"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Clock, ImagePlus, Send, FileText, Hash, ChevronDown, Layers, Globe,
  Trash2, Image as ImageIcon, Loader2, Eye, Calendar,
} from "lucide-react";
import { SocialConnection } from "@/lib/client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

const MAX_CHARS = 2200;

const HASHTAG_SUGGESTIONS = [
  "#business", "#caribbean", "#trinidad", "#entrepreneur",
  "#smallbusiness", "#servicebusiness", "#growyourbusiness", "#ttbusiness",
];

const CONTENT_TEMPLATES: { label: string; emoji: string; text: string }[] = [
  { label: "Promotion", emoji: "🔥", text: "🔥 Special Offer!\n\nFor a limited time, enjoy [discount]% off [service/product].\n\nDon't miss out — book today!\n\n#promotion #deal" },
  { label: "Announcement", emoji: "📢", text: "📢 Exciting News!\n\nWe're thrilled to announce [your news here].\n\nStay tuned for more updates!\n\n#announcement #news" },
  { label: "Behind the Scenes", emoji: "🎬", text: "🎬 Behind the Scenes\n\nEver wondered what goes into [process]? Here's a peek at how we [action].\n\n#behindthescenes #dayinthelife" },
  { label: "Customer Spotlight", emoji: "⭐", text: "⭐ Customer Spotlight\n\nShoutout to [customer name] for [achievement/story]!\n\nThank you for choosing us.\n\n#customerspotlight #testimonial" },
  { label: "Tips & Advice", emoji: "💡", text: "💡 Quick Tip\n\nDid you know? [Insert helpful tip related to your industry].\n\nShare this with someone who needs it!\n\n#tips #advice" },
];

const PLATFORM_ICONS: Record<string, { label: string; color: string }> = {
  FACEBOOK: { label: "Facebook", color: "#1877F2" },
  INSTAGRAM: { label: "Instagram", color: "#E4405F" },
  LINKEDIN: { label: "LinkedIn", color: "#0A66C2" },
  TWITTER: { label: "Twitter", color: "#1DA1F2" },
  TIKTOK: { label: "TikTok", color: "#00F2EA" },
};

type MediaFile = {
  id: string;
  file?: File;
  url: string;
  objectPath?: string;
  uploading?: boolean;
  error?: string;
  preview?: string;
};

export type ComposerSubmitData = {
  content: string;
  scheduledFor?: string;
  channelIds?: string[];
  mediaUrls?: string[];
  action: "draft" | "schedule" | "publish";
};

type Props = {
  onSubmit: (data: ComposerSubmitData) => Promise<void>;
  onClose: () => void;
  submitting?: boolean;
  initial?: { content: string; scheduledFor?: string; channelIds?: string[]; mediaUrls?: string[] };
  mode?: "create" | "edit";
  connections?: SocialConnection[];
};

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage?.getItem("kf_token");
}

export function PostComposer({ onSubmit, onClose, submitting, initial, mode = "create", connections = [] }: Props) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [scheduledFor, setScheduledFor] = useState(initial?.scheduledFor ?? "");
  const [showSchedule, setShowSchedule] = useState(!!initial?.scheduledFor);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set(initial?.channelIds ?? []));
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>(
    (initial?.mediaUrls ?? []).map((url, i) => ({ id: `existing-${i}`, url, objectPath: url }))
  );
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const charCount = content.length;
  const overLimit = charCount > MAX_CHARS;
  const charPercent = Math.min((charCount / MAX_CHARS) * 100, 100);
  const ringColor = overLimit ? "hsl(0 70% 50%)" : charCount > MAX_CHARS * 0.9 ? "hsl(40 90% 50%)" : charCount > MAX_CHARS * 0.7 ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-accent1))";

  const connectedChannels = connections.filter(c => c.status === "CONNECTED");
  const isUploading = mediaFiles.some(m => m.uploading);

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

  function selectAllChannels() {
    if (selectedChannels.size === connectedChannels.length) {
      setSelectedChannels(new Set());
    } else {
      setSelectedChannels(new Set(connectedChannels.map(c => c.platform)));
    }
  }

  const uploadFile = useCallback(async (file: File) => {
    const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;

    setMediaFiles(prev => [...prev, { id, file, url: "", uploading: true, preview }]);

    try {
      const token = getAuthToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/uploads/request-url`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { uploadURL, objectPath } = await res.json();

      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });

      const publicUrl = uploadURL.split("?")[0];

      setMediaFiles(prev => prev.map(m =>
        m.id === id ? { ...m, uploading: false, url: publicUrl, objectPath } : m
      ));
    } catch (err: any) {
      setMediaFiles(prev => prev.map(m =>
        m.id === id ? { ...m, uploading: false, error: err.message || "Upload failed" } : m
      ));
    }
  }, []);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(f => uploadFile(f));
    e.target.value = "";
  }

  function removeMedia(id: string) {
    setMediaFiles(prev => {
      const item = prev.find(m => m.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter(m => m.id !== id);
    });
  }

  async function handleSubmit(action: "draft" | "schedule" | "publish") {
    if (!content.trim() || overLimit) return;

    const successMedia = mediaFiles.filter(m => !m.uploading && !m.error && m.url);
    const urls = successMedia.map(m => m.objectPath || m.url);

    let finalSchedule: string | undefined;
    if (action === "schedule" && scheduledFor) {
      finalSchedule = scheduledFor;
    }

    const channelIds = selectedChannels.size > 0 ? Array.from(selectedChannels) : undefined;

    await onSubmit({
      content,
      scheduledFor: finalSchedule,
      channelIds,
      mediaUrls: urls.length > 0 ? urls : undefined,
      action,
    });
  }

  const canPublish = content.trim() && !overLimit && !submitting && !isUploading;
  const canSchedule = canPublish && scheduledFor;

  return (
    <div
      className="rounded-2xl border backdrop-blur-xl overflow-hidden"
      style={{ background: "hsl(var(--kf-card) / 0.85)", borderColor: "hsl(var(--kf-border))" }}
    >
      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.05))",
          borderBottom: "1px solid hsl(var(--kf-border))",
        }}
      >
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          {mode === "edit" ? "Edit Post" : "Compose Post"}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`p-1.5 rounded-lg transition-all ${showPreview ? "bg-[hsl(var(--kf-accent1)/0.15)] text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
            title="Preview"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
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
                  className="absolute top-9 right-2 z-20 w-56 rounded-xl border backdrop-blur-xl py-1 shadow-xl"
                  style={{ background: "hsl(var(--kf-card))", borderColor: "hsl(var(--kf-border))" }}
                >
                  {CONTENT_TEMPLATES.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => applyTemplate(t.text)}
                      className="w-full text-left px-3 py-2.5 text-xs hover:bg-[hsl(var(--kf-muted))] transition-colors flex items-center gap-2"
                    >
                      <span>{t.emoji}</span>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <textarea
            ref={textareaRef}
            className="kf-input w-full min-h-[140px] resize-none pr-28 text-sm leading-relaxed"
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

        <AnimatePresence>
          {mediaFiles.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="flex flex-wrap gap-2">
                {mediaFiles.map((media) => (
                  <div
                    key={media.id}
                    className="relative w-20 h-20 rounded-xl border overflow-hidden group"
                    style={{ borderColor: media.error ? "hsl(0 60% 50% / 0.5)" : "hsl(var(--kf-border))" }}
                  >
                    {media.preview ? (
                      <img src={media.preview} alt="" className="w-full h-full object-cover" />
                    ) : media.url ? (
                      <img src={media.url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" style={{ background: "hsl(var(--kf-muted))" }}>
                        <ImageIcon className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    {media.uploading && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-white" />
                      </div>
                    )}
                    {media.error && (
                      <div className="absolute inset-0 bg-red-900/60 flex items-center justify-center">
                        <X className="w-5 h-5 text-red-300" />
                      </div>
                    )}
                    <button
                      onClick={() => removeMedia(media.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mr-0.5 flex-shrink-0">
            <Hash className="w-3 h-3" />
          </div>
          {HASHTAG_SUGGESTIONS.map((tag) => (
            <button
              key={tag}
              onClick={() => insertHashtag(tag)}
              className="px-2.5 py-1 sm:px-2 sm:py-0.5 rounded-lg text-[10px] font-medium border transition-all hover:scale-105 flex-shrink-0 active:scale-95"
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

        {connectedChannels.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Globe className="w-3 h-3" />
                Publish to channels
              </div>
              <button
                onClick={selectAllChannels}
                className="text-[10px] font-medium transition-colors"
                style={{ color: "hsl(var(--kf-accent1))" }}
              >
                {selectedChannels.size === connectedChannels.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {connectedChannels.map((conn) => {
                const selected = selectedChannels.has(conn.platform);
                const plt = PLATFORM_ICONS[conn.platform];
                return (
                  <button
                    key={conn.platform}
                    onClick={() => toggleChannel(conn.platform)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                      selected
                        ? "border-[hsl(var(--kf-accent1)/0.5)] bg-[hsl(var(--kf-accent1)/0.12)] text-[hsl(var(--kf-accent1))] shadow-sm"
                        : "border-[hsl(var(--kf-border))] text-muted-foreground hover:bg-[hsl(var(--kf-muted)/0.5)]"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: selected ? (plt?.color || "hsl(var(--kf-accent1))") : "hsl(var(--kf-muted-foreground))" }}
                      />
                      {plt?.label || conn.platform.charAt(0) + conn.platform.slice(1).toLowerCase()}
                      {conn.accountName ? ` · ${conn.accountName}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 border-t pt-3" style={{ borderColor: "hsl(var(--kf-border))" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs py-2.5 sm:py-2"
          >
            {isUploading ? <Loader2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 animate-spin" /> : <ImagePlus className="w-4 h-4 sm:w-3.5 sm:h-3.5" />}
            Media
          </button>
          <button
            className={`kf-btn-secondary inline-flex items-center gap-1.5 text-xs py-2.5 sm:py-2 ${showSchedule ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
            onClick={() => setShowSchedule(!showSchedule)}
          >
            <Clock className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            Schedule
          </button>
        </div>

        <AnimatePresence>
          {showSchedule && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div
                className="rounded-xl border p-3 flex items-center gap-3"
                style={{ background: "hsl(var(--kf-accent1) / 0.04)", borderColor: "hsl(var(--kf-accent1) / 0.2)" }}
              >
                <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-accent1))" }} />
                <input
                  type="datetime-local"
                  className="kf-input flex-1"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                />
                <button onClick={() => { setShowSchedule(false); setScheduledFor(""); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Clear
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showPreview && content.trim() && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div
                className="rounded-xl border p-4 space-y-3"
                style={{ background: "hsl(var(--kf-muted) / 0.3)", borderColor: "hsl(var(--kf-border))" }}
              >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  <Eye className="w-3 h-3" />
                  Preview
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
                {mediaFiles.filter(m => !m.error && (m.preview || m.url)).length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {mediaFiles.filter(m => !m.error && (m.preview || m.url)).map(m => (
                      <img key={m.id} src={m.preview || m.url} alt="" className="w-24 h-24 object-cover rounded-lg" />
                    ))}
                  </div>
                )}
                {selectedChannels.size > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {Array.from(selectedChannels).map(ch => {
                      const plt = PLATFORM_ICONS[ch];
                      return (
                        <span key={ch} className="text-[10px] px-2 py-0.5 rounded-full border" style={{ borderColor: `${plt?.color || "#888"}40`, color: plt?.color || "#888" }}>
                          {plt?.label || ch}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1">
          <button className="kf-btn-secondary text-xs py-2.5 sm:py-2 order-last sm:order-first" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              className="kf-btn-secondary inline-flex items-center justify-center gap-1.5 text-xs py-2.5 sm:py-2"
              onClick={() => handleSubmit("draft")}
              disabled={!canPublish}
              style={{ opacity: !canPublish ? 0.5 : 1 }}
              title="Save as draft"
            >
              <FileText className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              {submitting ? "Saving..." : "Save Draft"}
            </button>
            {showSchedule && scheduledFor && (
              <button
                className="inline-flex items-center justify-center gap-1.5 text-xs font-medium px-4 py-2.5 sm:py-2 rounded-xl border transition-all"
                onClick={() => handleSubmit("schedule")}
                disabled={!canSchedule}
                style={{
                  opacity: !canSchedule ? 0.5 : 1,
                  background: "hsl(220 80% 50% / 0.12)",
                  borderColor: "hsl(220 80% 50% / 0.3)",
                  color: "hsl(220 80% 60%)",
                }}
                title="Schedule for later"
              >
                <Clock className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                Schedule
              </button>
            )}
            <button
              className="kf-btn-primary inline-flex items-center justify-center gap-1.5 text-xs py-2.5 sm:py-2"
              onClick={() => handleSubmit("publish")}
              disabled={!canPublish}
              style={{ opacity: !canPublish ? 0.5 : 1 }}
              title={selectedChannels.size > 0 ? "Publish now to selected channels" : "Save and mark ready"}
            >
              <Send className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              {submitting ? "Publishing..." : "Publish Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
