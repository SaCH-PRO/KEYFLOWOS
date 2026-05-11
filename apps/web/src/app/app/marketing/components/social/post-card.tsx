// @keyflow:dormant
"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Send, Pencil, Trash2, MoreHorizontal, Clock, CheckCircle2, FileText, AlertTriangle, BookOpen, Hash, Facebook, Instagram, Linkedin, Twitter, XCircle, Music2, Image as ImageIcon, ImageOff, ExternalLink } from "lucide-react";
import type { SocialPost } from "@/lib/client";
import Image from "next/image";

type Props = {
  post: SocialPost;
  onPublish: (id: string) => void;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  listView?: boolean;
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; gradient: string; bg: string; text: string; border: string }> = {
  DRAFT: { label: "Draft", icon: FileText, gradient: "from-slate-500/20 to-slate-600/10", bg: "bg-slate-500/15", text: "text-slate-300", border: "border-slate-500/30" },
  SCHEDULED: { label: "Scheduled", icon: Clock, gradient: "from-blue-500/20 to-blue-600/10", bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
  POSTED: { label: "Posted", icon: CheckCircle2, gradient: "from-emerald-500/20 to-emerald-600/10", bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30" },
  FAILED: { label: "Failed", icon: AlertTriangle, gradient: "from-red-500/20 to-red-600/10", bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30" },
};

const PLATFORM_ICONS: Record<string, { icon: React.ElementType; color: string }> = {
  FACEBOOK: { icon: Facebook, color: "#1877F2" },
  INSTAGRAM: { icon: Instagram, color: "#E4405F" },
  LINKEDIN: { icon: Linkedin, color: "#0A66C2" },
  TWITTER: { icon: Twitter, color: "#1DA1F2" },
  TIKTOK: { icon: Music2, color: "#00F2EA" },
};

function extractHashtags(content: string): string[] {
  const matches = content.match(/#[\w]+/g);
  return matches ? [...new Set(matches)] : [];
}

const HASHTAG_COLORS = [
  "bg-violet-500/15 text-violet-400 border-violet-500/30",
  "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "bg-pink-500/15 text-pink-400 border-pink-500/30",
  "bg-teal-500/15 text-teal-400 border-teal-500/30",
];

function MediaThumb({ url, large }: { url: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`flex items-center justify-center gap-2 text-muted-foreground ${large ? "py-6 text-xs" : ""}`} style={large ? {} : { background: "hsl(var(--kf-muted) / 0.3)", width: "100%", height: "100%" }}>
        <ImageOff className="w-4 h-4" />
        {large && <span>Image</span>}
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={large ? "Post media" : "Media attachment"}
      className={large ? "w-full h-full object-cover max-h-48" : "w-full h-full object-cover"}
      onError={() => setFailed(true)}
     fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
  );
}

export function PostCard({ post, onPublish, onEdit, onDelete, listView }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cfg = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.DRAFT;
  const StatusIcon = cfg.icon;

  const hashtags = useMemo(() => extractHashtags(post.content), [post.content]);
  const wordCount = useMemo(() => post.content.trim().split(/\s+/).filter(Boolean).length, [post.content]);
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  const postedDate = post.postedAt || post.publishedAt;
  const scheduledDate = post.scheduledAt || post.scheduledFor;
  const dateLabel = postedDate
    ? `Posted ${new Date(postedDate).toLocaleDateString("en-TT", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : scheduledDate
    ? `Scheduled ${new Date(scheduledDate).toLocaleDateString("en-TT", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : `Created ${new Date(post.createdAt).toLocaleDateString("en-TT", { month: "short", day: "numeric" })}`;

  const channelIds = post.channelIds ?? [];
  const publishResults = (post.publishResults ?? []) as Array<{ platform: string; success: boolean; error?: string; externalUrl?: string; platformPostId?: string }>;

  return (
    <motion.div
      whileHover={{ scale: 1.01, y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`group relative rounded-xl border backdrop-blur-xl px-3 py-2.5 space-y-2 transition-all cursor-default ${listView ? "flex gap-3 items-start space-y-0" : ""}`}
      style={{
        background: "hsl(var(--kf-card) / 0.7)",
        borderColor: "hsl(var(--kf-border))",
        boxShadow: "0 0 0 0 transparent",
      }}
      whileTap={{ scale: 0.995 }}
    >
      <div className={`${listView ? "flex-1 min-w-0 space-y-2" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[13px] flex-1 leading-snug whitespace-pre-wrap ${listView ? "" : "line-clamp-3"}`}>{post.content}</p>
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-11 h-11 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--kf-muted))] transition-colors sm:opacity-0 sm:group-hover:opacity-100"
              aria-label="Post actions menu"
            >
              <MoreHorizontal className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10 sm:bg-transparent bg-black/30" onClick={() => setMenuOpen(false)} />
                <div role="menu" className="fixed inset-x-3 bottom-3 sm:absolute sm:inset-auto sm:right-0 sm:top-10 z-20 sm:w-40 rounded-2xl sm:rounded-xl border backdrop-blur-xl py-1 shadow-xl" style={{ background: "hsl(var(--kf-card))", borderColor: "hsl(var(--kf-border))" }}>
                  {post.status !== "POSTED" && (
                    <button
                      onClick={() => { onEdit(post); setMenuOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 sm:px-3 sm:py-2 text-sm sm:text-xs hover:bg-[hsl(var(--kf-muted))] active:bg-[hsl(var(--kf-muted))] transition-colors"
                    >
                      <Pencil className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> Edit
                    </button>
                  )}
                  {post.status !== "POSTED" && (
                    <button
                      onClick={() => { onPublish(post.id); setMenuOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 sm:px-3 sm:py-2 text-sm sm:text-xs text-emerald-400 hover:bg-[hsl(var(--kf-muted))] active:bg-[hsl(var(--kf-muted))] transition-colors"
                    >
                      <Send className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> Publish Now
                    </button>
                  )}
                  <button
                    onClick={() => { onDelete(post.id); setMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 sm:px-3 sm:py-2 text-sm sm:text-xs text-red-400 hover:bg-[hsl(var(--kf-muted))] active:bg-[hsl(var(--kf-muted))] transition-colors"
                  >
                    <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> Delete
                  </button>
                  <button
                    onClick={() => setMenuOpen(false)}
                    className="sm:hidden w-full flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-foreground border-t mt-1" style={{ borderColor: "hsl(var(--kf-border))" }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {post.mediaUrls && post.mediaUrls.length > 0 && (
          <div className={`flex gap-2 ${post.mediaUrls.length === 1 && !listView ? "" : "flex-wrap"}`}>
            {post.mediaUrls.length === 1 && !listView ? (
              <div className="w-full max-h-48 rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
                <MediaThumb url={post.mediaUrls[0]} large />
              </div>
            ) : (
              <>
                {post.mediaUrls.slice(0, 4).map((url, i) => (
                  <div key={i} className="w-20 h-20 sm:w-16 sm:h-16 rounded-lg border overflow-hidden flex-shrink-0" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <MediaThumb url={url} />
                  </div>
                ))}
                {post.mediaUrls.length > 4 && (
                  <div className="w-20 h-20 sm:w-16 sm:h-16 rounded-lg border flex items-center justify-center text-xs text-muted-foreground flex-shrink-0" style={{ borderColor: "hsl(var(--kf-border))", background: "hsl(var(--kf-muted)/0.3)" }}>
                    <ImageIcon className="w-4 h-4 mr-0.5" />+{post.mediaUrls.length - 4}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {hashtags.slice(0, 5).map((tag, i) => (
              <span key={tag} className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-medium ${HASHTAG_COLORS[i % HASHTAG_COLORS.length]}`}>
                <Hash className="w-2.5 h-2.5" />
                {tag.slice(1)}
              </span>
            ))}
            {hashtags.length > 5 && (
              <span className="text-[10px] text-muted-foreground px-1">+{hashtags.length - 5}</span>
            )}
          </div>
        )}

        {channelIds.length > 0 && post.status !== "POSTED" && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Targeting:</span>
            <div className="flex items-center gap-1">
              {channelIds.map((ch) => {
                const plt = PLATFORM_ICONS[ch.toUpperCase()];
                if (!plt) return null;
                const PIcon = plt.icon;
                return (
                  <span key={ch} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]" style={{ borderColor: `${plt.color}40`, color: plt.color }}>
                    <PIcon className="w-3 h-3" />
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {publishResults.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {publishResults.map((r, i) => {
              const plt = PLATFORM_ICONS[r.platform?.toUpperCase()];
              if (!plt) return null;
              const PIcon = plt.icon;
              const inner = (
                <>
                  <PIcon className="w-3 h-3" style={{ color: plt.color }} />
                  {r.success ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
                  {r.success && r.externalUrl && <ExternalLink className="w-2.5 h-2.5 opacity-70" />}
                </>
              );
              const styleProps = {
                borderColor: r.success ? "hsl(150 60% 40% / 0.3)" : "hsl(0 60% 40% / 0.3)",
                background: r.success ? "hsl(150 60% 40% / 0.1)" : "hsl(0 60% 40% / 0.1)",
                color: r.success ? "hsl(150 60% 60%)" : "hsl(0 60% 65%)",
              } as const;
              if (r.success && r.externalUrl) {
                return (
                  <a
                    key={i}
                    href={r.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-medium hover:opacity-80 transition-opacity"
                    style={styleProps}
                    title={`View on ${r.platform}`}
                  >
                    {inner}
                  </a>
                );
              }
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-medium"
                  style={styleProps}
                  title={r.error || "Published successfully"}
                >
                  {inner}
                </span>
              );
            })}
            {post.externalUrl && !publishResults.some((r) => r.externalUrl) && (
              <a
                href={post.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-medium text-emerald-400 hover:opacity-80"
                style={{ borderColor: "hsl(150 60% 40% / 0.3)", background: "hsl(150 60% 40% / 0.1)" }}
                title="View live post"
              >
                <ExternalLink className="w-3 h-3" /> View
              </a>
            )}
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[11px] font-medium ${cfg.bg} ${cfg.text} ${cfg.border}`}>
              <StatusIcon className="w-3 h-3" />
              {cfg.label}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <BookOpen className="w-3 h-3" />
              {wordCount}w · {readingTime} min read
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground">{dateLabel}</span>
        </div>

        {(post.status === "DRAFT" || post.status === "SCHEDULED") && (
          <button
            className="kf-btn-secondary w-full text-xs inline-flex items-center justify-center gap-1.5 py-1.5 active:scale-[0.98] transition-transform opacity-0 group-hover:opacity-100"
            onClick={() => onPublish(post.id)}
          >
            <Send className="w-3 h-3" /> Publish Now
          </button>
        )}
      </div>
    </motion.div>
  );
}