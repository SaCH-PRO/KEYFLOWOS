"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import type { SocialPost } from "@/lib/client";
import { PostCard } from "./post-card";

type Filter = "ALL" | "DRAFT" | "SCHEDULED" | "POSTED";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "DRAFT", label: "Drafts" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "POSTED", label: "Posted" },
];

type Props = {
  posts: SocialPost[];
  loading: boolean;
  onPublish: (id: string) => void;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
};

export function PostsFeed({ posts, loading, onPublish, onEdit, onDelete }: Props) {
  const [filter, setFilter] = useState<Filter>("ALL");

  const filtered = filter === "ALL" ? posts : posts.filter((p) => p.status === filter);

  const counts = {
    ALL: posts.length,
    DRAFT: posts.filter((p) => p.status === "DRAFT").length,
    SCHEDULED: posts.filter((p) => p.status === "SCHEDULED").length,
    POSTED: posts.filter((p) => p.status === "POSTED").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
              filter === key
                ? "bg-primary/20 text-primary border border-primary/40"
                : "text-muted-foreground hover:text-foreground border border-transparent hover:border-border/40"
            }`}
          >
            {label}
            <span className="ml-1.5 text-[10px] opacity-70">{counts[key]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading posts...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/50 p-8 text-center space-y-2">
          <FileText className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            {filter === "ALL" ? "No posts yet. Create your first post to get started." : `No ${filter.toLowerCase()} posts.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onPublish={onPublish}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
