"use client";

import { motion } from "framer-motion";
import {
  Heart,
  MessageSquare,
  Tag,
  MessageCircle,
  HelpCircle,
  Trophy,
  BookOpen,
} from "lucide-react";
import type { CommunityPost } from "@/lib/client";
import { API_BASE } from "@/lib/api";

const POST_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof MessageSquare }> = {
  DISCUSSION: { label: "Discussion", color: "text-blue-400", bg: "bg-blue-500/20", icon: MessageCircle },
  QUESTION: { label: "Question", color: "text-purple-400", bg: "bg-purple-500/20", icon: HelpCircle },
  WIN: { label: "Win", color: "text-amber-400", bg: "bg-amber-500/20", icon: Trophy },
  RESOURCE: { label: "Resource", color: "text-emerald-400", bg: "bg-emerald-500/20", icon: BookOpen },
};

export { POST_TYPE_CONFIG };

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface PostCardProps {
  post: CommunityPost;
  index: number;
  onExpand: (postId: string) => void;
  onLike: (postId: string) => void;
  onAuthorClick?: (businessId: string) => void;
}

export function PostCard({ post, index, onExpand, onLike, onAuthorClick }: PostCardProps) {
  const typeConfig = POST_TYPE_CONFIG[post.type] || POST_TYPE_CONFIG.DISCUSSION;
  const TypeIcon = typeConfig.icon;

  const logoUrl = post.business?.logoUrl
    ? post.business.logoUrl.startsWith("http") ? post.business.logoUrl : `${API_BASE}${post.business.logoUrl}`
    : null;

  return (
    <motion.div
      key={post.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={() => onExpand(post.id)}
      className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-4 space-y-3 cursor-pointer hover:bg-white/[0.07] transition-colors"
    >
      <div className="flex items-center gap-3">
        <div
          onClick={(e) => {
            if (onAuthorClick && post.business?.id) {
              e.stopPropagation();
              onAuthorClick(post.business.id);
            }
          }}
          className={`w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs overflow-hidden flex-shrink-0 ${onAuthorClick ? "cursor-pointer hover:ring-2 hover:ring-[hsl(var(--kf-accent1))]/50 transition-all" : ""}`}
        >
          {logoUrl ? (
            <img src={logoUrl} alt={post.business?.name || ""} className="w-full h-full object-cover" />
          ) : (
            post.business?.name?.[0] || "?"
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p
            onClick={(e) => {
              if (onAuthorClick && post.business?.id) {
                e.stopPropagation();
                onAuthorClick(post.business.id);
              }
            }}
            className={`text-sm font-medium truncate ${onAuthorClick ? "hover:text-[hsl(var(--kf-accent1))] cursor-pointer transition-colors" : ""}`}
          >
            {post.business?.name || "Anonymous"}
          </p>
          {post.business?.headline && (
            <p className="text-[10px] text-muted-foreground truncate">{post.business.headline}</p>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeConfig.bg} ${typeConfig.color} flex items-center gap-1 flex-shrink-0`}>
          <TypeIcon className="w-3 h-3" />
          {typeConfig.label}
        </span>
        <span className="text-[10px] text-muted-foreground flex-shrink-0">{timeAgo(post.createdAt)}</span>
      </div>

      {post.title && <h3 className="text-sm font-semibold">{post.title}</h3>}
      <p className="text-sm text-muted-foreground line-clamp-2">{post.content}</p>

      {post.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {post.tags.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground flex items-center gap-0.5">
              <Tag className="w-2.5 h-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLike(post.id);
          }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-colors"
        >
          <Heart className="w-3.5 h-3.5" />
          {post.likes || 0}
        </button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <MessageSquare className="w-3.5 h-3.5" />
          {post._count?.comments || 0}
        </span>
      </div>
    </motion.div>
  );
}
