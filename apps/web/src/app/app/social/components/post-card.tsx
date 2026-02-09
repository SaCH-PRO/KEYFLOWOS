"use client";

import { useState } from "react";
import { Send, Pencil, Trash2, MoreHorizontal, Clock, CheckCircle2, FileText, AlertTriangle } from "lucide-react";
import type { SocialPost } from "@/lib/client";

type Props = {
  post: SocialPost;
  onPublish: (id: string) => void;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType }> = {
  DRAFT: { label: "Draft", icon: FileText },
  SCHEDULED: { label: "Scheduled", icon: Clock },
  POSTED: { label: "Posted", icon: CheckCircle2 },
  FAILED: { label: "Failed", icon: AlertTriangle },
};

function getStatusClasses(status: string) {
  switch (status) {
    case "POSTED": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "SCHEDULED": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "FAILED": return "bg-red-500/15 text-red-400 border-red-500/30";
    default: return "bg-[hsl(var(--kf-muted))] text-muted-foreground border-[hsl(var(--kf-border))]";
  }
}

export function PostCard({ post, onPublish, onEdit, onDelete }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const cfg = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.DRAFT;
  const StatusIcon = cfg.icon;

  const postedDate = post.postedAt || post.publishedAt;
  const scheduledDate = post.scheduledAt || post.scheduledFor;
  const dateLabel = postedDate
    ? `Posted ${new Date(postedDate).toLocaleDateString("en-TT", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : scheduledDate
    ? `Scheduled ${new Date(scheduledDate).toLocaleDateString("en-TT", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : `Created ${new Date(post.createdAt).toLocaleDateString("en-TT", { month: "short", day: "numeric" })}`;

  return (
    <div className="group kf-card p-4 space-y-3 hover:border-[hsl(var(--kf-accent1)/0.3)] transition-all">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm line-clamp-4 flex-1 leading-relaxed whitespace-pre-wrap">{post.content}</p>
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
              <div className="absolute right-0 top-8 z-20 w-36 kf-card py-1 shadow-xl">
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

      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[11px] font-medium ${getStatusClasses(post.status)}`}>
          <StatusIcon className="w-3 h-3" />
          {cfg.label}
        </span>
        <span className="text-[11px] text-muted-foreground">{dateLabel}</span>
      </div>

      {post.status === "DRAFT" && (
        <button
          className="kf-btn-secondary w-full text-xs inline-flex items-center justify-center gap-1.5"
          onClick={() => onPublish(post.id)}
        >
          <Send className="w-3 h-3" /> Publish Now
        </button>
      )}
    </div>
  );
}
