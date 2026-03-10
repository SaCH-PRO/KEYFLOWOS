"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FileText, RefreshCw, LayoutGrid, List } from "lucide-react";
import type { SocialPost } from "@/lib/client";
import { PostCard } from "./post-card";

type Props = {
  posts: SocialPost[];
  loading: boolean;
  onPublish: (id: string) => void;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

function SkeletonCard() {
  return (
    <div className="rounded-2xl border p-4 space-y-3 animate-pulse" style={{ background: "hsl(var(--kf-card) / 0.5)", borderColor: "hsl(var(--kf-border))" }}>
      <div className="h-3 rounded-full w-3/4" style={{ background: "hsl(var(--kf-muted))" }} />
      <div className="h-3 rounded-full w-1/2" style={{ background: "hsl(var(--kf-muted))" }} />
      <div className="h-3 rounded-full w-2/3" style={{ background: "hsl(var(--kf-muted))" }} />
      <div className="flex justify-between pt-2">
        <div className="h-5 w-16 rounded-lg" style={{ background: "hsl(var(--kf-muted))" }} />
        <div className="h-3 w-24 rounded-full" style={{ background: "hsl(var(--kf-muted))" }} />
      </div>
    </div>
  );
}

export function PostsFeed({ posts, loading, onPublish, onEdit, onDelete }: Props) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  if (loading && posts.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <div className="h-8 w-20 rounded-lg animate-pulse" style={{ background: "hsl(var(--kf-muted))" }} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="p-8 text-center">
        <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-medium mb-1">No posts yet</p>
        <p className="text-muted-foreground">Create your first post to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 transition-colors ${viewMode === "grid" ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
            style={viewMode === "grid" ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 transition-colors ${viewMode === "list" ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
            style={viewMode === "list" ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className={viewMode === "grid" ? "grid gap-3 md:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-3"}
      >
        {posts.map((post) => (
          <motion.div key={post.id} variants={item}>
            <PostCard
              post={post}
              onPublish={onPublish}
              onEdit={onEdit}
              onDelete={onDelete}
              listView={viewMode === "list"}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
