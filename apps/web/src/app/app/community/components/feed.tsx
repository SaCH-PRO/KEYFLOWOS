"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Trophy,
  HelpCircle,
  MessageSquare,
  Heart,
  Send,
  ChevronLeft,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { CommunityPost, CommunityComment } from "@/lib/client";
import { PostCard, POST_TYPE_CONFIG, timeAgo } from "./post-card";
import { CreatePost } from "./create-post";
import { FeedSkeleton } from "./community-skeleton";

const POST_TYPES = ["ALL", "DISCUSSION", "QUESTION", "WIN", "RESOURCE"];

interface FeedProps {
  posts: CommunityPost[];
  loading: boolean;
  filterType: string;
  onFilterChange: (type: string) => void;
  expandedPost: (CommunityPost & { comments?: CommunityComment[] }) | null;
  onExpandPost: (postId: string) => void;
  onCollapsePost: () => void;
  onLike: (postId: string) => void;
  onCreatePost: (data: { title: string; content: string; type: string; tags: string }) => Promise<void>;
  onAddComment: (text: string) => Promise<void>;
  submittingComment: boolean;
}

export function Feed({
  posts,
  loading,
  filterType,
  onFilterChange,
  expandedPost,
  onExpandPost,
  onCollapsePost,
  onLike,
  onCreatePost,
  onAddComment,
  submittingComment,
}: FeedProps) {
  const [showNewPost, setShowNewPost] = useState(false);
  const [newPostTitle, setNewPostTitle] = useState("");
  const [newPostContent, setNewPostContent] = useState("");
  const [newPostType, setNewPostType] = useState("DISCUSSION");
  const [newPostTags, setNewPostTags] = useState("");
  const [posting, setPosting] = useState(false);
  const [commentText, setCommentText] = useState("");

  const handleSubmitPost = async () => {
    setPosting(true);
    await onCreatePost({
      title: newPostTitle,
      content: newPostContent,
      type: newPostType,
      tags: newPostTags,
    });
    setNewPostTitle("");
    setNewPostContent("");
    setNewPostType("DISCUSSION");
    setNewPostTags("");
    setShowNewPost(false);
    setPosting(false);
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim()) return;
    await onAddComment(commentText.trim());
    setCommentText("");
  };

  if (expandedPost) {
    const typeConfig = POST_TYPE_CONFIG[expandedPost.type] || POST_TYPE_CONFIG.DISCUSSION;
    const TypeIcon = typeConfig.icon;
    return (
      <div className="space-y-4">
        <button
          onClick={onCollapsePost}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Feed
        </button>

        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              {expandedPost.business?.name?.[0] || "?"}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{expandedPost.business?.name || "Anonymous"}</p>
              <p className="text-xs text-muted-foreground">{timeAgo(expandedPost.createdAt)}</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeConfig.bg} ${typeConfig.color} flex items-center gap-1`}>
              <TypeIcon className="w-3 h-3" />
              {typeConfig.label}
            </span>
          </div>

          {expandedPost.title && <h2 className="text-lg font-semibold">{expandedPost.title}</h2>}
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{expandedPost.content}</p>

          {expandedPost.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {expandedPost.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-muted-foreground">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 pt-2 border-t border-white/10">
            <button
              onClick={() => onLike(expandedPost.id)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-colors"
            >
              <Heart className="w-4 h-4" />
              {expandedPost.likes || 0}
            </button>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="w-4 h-4" />
              {expandedPost.comments?.length || 0} comments
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Comments</h3>
          {expandedPost.comments?.length ? (
            expandedPost.comments.map((comment) => (
              <motion.div
                key={comment.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold">
                    {comment.business?.name?.[0] || "?"}
                  </div>
                  <span className="text-xs font-medium">{comment.business?.name || "Anonymous"}</span>
                  <span className="text-[10px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
                </div>
                <p className="text-sm text-muted-foreground pl-8">{comment.content}</p>
              </motion.div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No comments yet. Be the first!</p>
          )}

          <div className="flex gap-2">
            <input
              placeholder="Add a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmitComment()}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/20"
            />
            <button
              onClick={handleSubmitComment}
              disabled={submittingComment || !commentText.trim()}
              className="kf-btn-primary px-3 py-2 rounded-lg disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 flex-wrap">
          {POST_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => onFilterChange(type)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterType === type
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              }`}
            >
              {type === "ALL" ? "All" : POST_TYPE_CONFIG[type]?.label || type}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setNewPostType("WIN");
              setShowNewPost(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors"
          >
            <Trophy className="w-3 h-3" />
            Share a Win
          </button>
          <button
            onClick={() => {
              setNewPostType("QUESTION");
              setShowNewPost(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
          >
            <HelpCircle className="w-3 h-3" />
            Ask a Question
          </button>
          <button
            onClick={() => setShowNewPost(true)}
            className="kf-btn-primary flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            New Post
          </button>
        </div>
      </div>

      <CreatePost
        isOpen={showNewPost}
        title={newPostTitle}
        content={newPostContent}
        postType={newPostType}
        tags={newPostTags}
        posting={posting}
        onTitleChange={setNewPostTitle}
        onContentChange={setNewPostContent}
        onTypeChange={setNewPostType}
        onTagsChange={setNewPostTags}
        onClose={() => setShowNewPost(false)}
        onSubmit={handleSubmitPost}
      />

      {loading ? (
        <FeedSkeleton />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No posts yet"
          description="Start the conversation! Share a discussion, question, win, or resource with the community."
          actionLabel="New Post"
          onAction={() => setShowNewPost(true)}
        />
      ) : (
        <div className="space-y-3">
          {posts.map((post, i) => (
            <PostCard
              key={post.id}
              post={post}
              index={i}
              onExpand={onExpandPost}
              onLike={onLike}
            />
          ))}
        </div>
      )}
    </div>
  );
}
