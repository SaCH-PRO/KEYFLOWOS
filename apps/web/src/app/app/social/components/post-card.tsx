"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Send, Pencil, Trash2, MoreHorizontal, Clock, CheckCircle2, FileText, AlertTriangle, BookOpen, Hash, Facebook, Instagram, Linkedin, Twitter, XCircle, Music2 } from "lucide-react";
import type { SocialPost } from "@/lib/client";

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
  const publishResults = (post.publishResults ?? []) as Array<{ platform: string; success: boolean; error?: string }>;

  return (
    <motion.div
      whileHover={{ scale: 1.015, y: -2 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={`group relative rounded-2xl border backdrop-blur-xl p-4 space-y-3 transition-all cursor-default ${listView ? "flex gap-4 items-start space-y-0" : ""}`}
      style={{
        background: "hsl(var(--kf-card) / 0.7)",
        borderColor: "hsl(var(--kf-border))",
        boxShadow: "0 0 0 0 transparent",
      }}
      whileTap={{ scale: 0.995 }}
    >
      <div className={`${listView ? "flex-1 min-w-0 space-y-3" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <p className={`text-sm flex-1 leading-relaxed whitespace-pre-wrap ${listView ? "" : "line-clamp-4"}`}>{post.content}</p>
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--kf-muted))] transition-colors opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-36 rounded-xl border backdrop-blur-xl py-1 shadow-xl" style={{ background: "hsl(var(--kf-card))", borderColor: "hsl(var(--kf-border))" }}>
                  {post.status !== "POSTED" && (
                    <button
                      onClick={() => { onEdit(post); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[hsl(var(--kf-muted))] transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  )}
                  {post.status !== "POSTED" && (
                    <button
                      onClick={() => { onPublish(post.id); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-emerald-400 hover:bg-[hsl(var(--kf-muted))] transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" /> Publish Now
                    </button>
                  )}
                  <button
                    onClick={() => { onDelete(post.id); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-[hsl(var(--kf-muted))] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

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
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    borderColor: r.success ? "hsl(150 60% 40% / 0.3)" : "hsl(0 60% 40% / 0.3)",
                    background: r.success ? "hsl(150 60% 40% / 0.1)" : "hsl(0 60% 40% / 0.1)",
                    color: r.success ? "hsl(150 60% 60%)" : "hsl(0 60% 65%)",
                  }}
                  title={r.error || "Published successfully"}
                >
                  <PIcon className="w-3 h-3" style={{ color: plt.color }} />
                  {r.success ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
                </span>
              );
            })}
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
            className="kf-btn-secondary w-full text-xs inline-flex items-center justify-center gap-1.5"
            onClick={() => onPublish(post.id)}
          >
            <Send className="w-3 h-3" /> Publish Now
          </button>
        )}
      </div>
    </motion.div>
  );
}
