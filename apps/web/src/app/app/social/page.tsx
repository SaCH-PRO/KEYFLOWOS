"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@keyflow/ui";
import {
  Share2,
  Plus,
  LayoutGrid,
  CalendarDays,
  Link2,
  Sparkles,
  BarChart3,
} from "lucide-react";
import {
  SocialPost,
  fetchPosts,
  createPost,
  updatePost,
  deletePost,
  publishPost,
} from "@/lib/client";
import { PostComposer } from "./components/post-composer";
import { PostsFeed } from "./components/posts-feed";
import { ContentCalendar } from "./components/content-calendar";
import { ChannelsPanel } from "./components/channels-panel";
import { AIStudio } from "./components/ai-studio";
import { AnalyticsStub } from "./components/analytics-stub";

type Tab = "posts" | "calendar" | "channels" | "ai" | "analytics";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "posts", label: "Posts", icon: LayoutGrid },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "channels", label: "Channels", icon: Link2 },
  { key: "ai", label: "AI Studio", icon: Sparkles },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
];

export default function SocialPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("posts");
  const [showComposer, setShowComposer] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchPosts();
    setPosts(data ?? []);
    if (error) setError(error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  async function handleCreate(data: { content: string; scheduledFor?: string }) {
    setSubmitting(true);
    setError(null);
    const { data: post, error } = await createPost({
      content: data.content,
      scheduledFor: data.scheduledFor,
    });
    if (error) setError(error);
    if (post) {
      setPosts((prev) => [post, ...prev]);
      setShowComposer(false);
    }
    setSubmitting(false);
  }

  async function handleUpdate(data: { content: string; scheduledFor?: string }) {
    if (!editingPost) return;
    setSubmitting(true);
    setError(null);
    const { data: updated, error } = await updatePost(editingPost.id, {
      content: data.content,
      scheduledAt: data.scheduledFor || null,
    });
    if (error) setError(error);
    if (updated) {
      setPosts((prev) => prev.map((p) => (p.id === editingPost.id ? updated : p)));
      setEditingPost(null);
    }
    setSubmitting(false);
  }

  async function handlePublish(postId: string) {
    setError(null);
    const { data, error } = await publishPost(postId);
    if (error) setError(error);
    if (data) {
      setPosts((prev) => prev.map((p) => (p.id === postId ? data : p)));
    }
  }

  async function handleDelete(postId: string) {
    setError(null);
    const { error } = await deletePost(postId);
    if (error) {
      setError(error);
    } else {
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    }
  }

  function handleEditStart(post: SocialPost) {
    setEditingPost(post);
    setShowComposer(false);
  }

  function handleCalendarSelect(post: SocialPost) {
    setEditingPost(post);
    setActiveTab("posts");
  }

  const draftCount = posts.filter((p) => p.status === "DRAFT").length;
  const scheduledCount = posts.filter((p) => p.status === "SCHEDULED").length;
  const postedCount = posts.filter((p) => p.status === "POSTED").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Social</h1>
            <p className="text-xs text-muted-foreground">Content calendar, scheduling & publishing</p>
          </div>
        </div>
        <Button
          onClick={() => { setShowComposer(true); setEditingPost(null); }}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          New Post
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/40 bg-slate-900/50 p-3 text-center">
          <p className="text-lg font-bold text-foreground">{draftCount}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Drafts</p>
        </div>
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-3 text-center">
          <p className="text-lg font-bold text-blue-400">{scheduledCount}</p>
          <p className="text-[10px] text-blue-400/70 uppercase tracking-wider">Scheduled</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
          <p className="text-lg font-bold text-emerald-400">{postedCount}</p>
          <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider">Posted</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      {showComposer && (
        <PostComposer
          onSubmit={handleCreate}
          onClose={() => setShowComposer(false)}
          submitting={submitting}
          mode="create"
        />
      )}

      {editingPost && (
        <PostComposer
          onSubmit={handleUpdate}
          onClose={() => setEditingPost(null)}
          submitting={submitting}
          initial={{ content: editingPost.content, scheduledFor: editingPost.scheduledAt || editingPost.scheduledFor || "" }}
          mode="edit"
        />
      )}

      <div className="rounded-3xl border border-border/50 bg-slate-950/60 backdrop-blur overflow-hidden">
        <div className="flex border-b border-border/40 overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium whitespace-nowrap transition-all border-b-2 ${
                activeTab === key
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === "posts" && (
            <PostsFeed
              posts={posts}
              loading={loading}
              onPublish={handlePublish}
              onEdit={handleEditStart}
              onDelete={handleDelete}
            />
          )}
          {activeTab === "calendar" && (
            <ContentCalendar posts={posts} onSelectPost={handleCalendarSelect} />
          )}
          {activeTab === "channels" && <ChannelsPanel />}
          {activeTab === "ai" && <AIStudio />}
          {activeTab === "analytics" && <AnalyticsStub />}
        </div>
      </div>
    </div>
  );
}
