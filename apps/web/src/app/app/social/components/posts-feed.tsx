"use client";

import { FileText, RefreshCw } from "lucide-react";
import type { SocialPost } from "@/lib/client";
import { PostCard } from "./post-card";

type Props = {
  posts: SocialPost[];
  loading: boolean;
  onPublish: (id: string) => void;
  onEdit: (post: SocialPost) => void;
  onDelete: (id: string) => void;
};

export function PostsFeed({ posts, loading, onPublish, onEdit, onDelete }: Props) {
  if (loading && posts.length === 0) {
    return (
      <div className="p-8 text-center">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">Loading posts...</p>
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
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onPublish={onPublish}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
