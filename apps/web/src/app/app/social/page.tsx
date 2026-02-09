"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  Filter,
  ChevronDown,
  X,
  LayoutGrid,
  CalendarDays,
  Link2,
  Sparkles,
  BarChart3,
  RefreshCw,
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

const STATUS_FILTERS = ["ALL", "DRAFT", "SCHEDULED", "POSTED"] as const;

export default function SocialPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("posts");
  const [showComposer, setShowComposer] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

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

  const filteredPosts = posts.filter((p) => {
    if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
    if (search && !p.content.toLowerCase().includes(search)) return false;
    return true;
  });

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
    if (!confirm("Are you sure you want to delete this post?")) return;
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCalendarSelect(post: SocialPost) {
    setEditingPost(post);
    setActiveTab("posts");
  }

  const draftCount = posts.filter((p) => p.status === "DRAFT").length;
  const scheduledCount = posts.filter((p) => p.status === "SCHEDULED").length;
  const postedCount = posts.filter((p) => p.status === "POSTED").length;

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Social</h1>
          <p className="text-muted-foreground mt-1">Content calendar, scheduling & publishing</p>
        </div>
        <button
          onClick={() => { setShowComposer(true); setEditingPost(null); }}
          className="kf-btn-primary inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Post
        </button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-3 gap-3"
      >
        <div className="kf-card p-3 text-center">
          <p className="text-lg font-bold">{draftCount}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Drafts</p>
        </div>
        <div className="kf-card p-3 text-center" style={{ borderColor: "hsl(var(--kf-accent2) / 0.3)" }}>
          <p className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent2))" }}>{scheduledCount}</p>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: "hsl(var(--kf-accent2) / 0.7)" }}>Scheduled</p>
        </div>
        <div className="kf-card p-3 text-center" style={{ borderColor: "hsl(150 60% 40% / 0.3)" }}>
          <p className="text-lg font-bold text-emerald-400">{postedCount}</p>
          <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider">Posted</p>
        </div>
      </motion.div>

      {error && (
        <div className="kf-card p-3 text-xs" style={{ borderColor: "hsl(40 90% 50% / 0.4)", background: "hsl(40 90% 50% / 0.1)", color: "hsl(40 90% 90%)" }}>
          {error}
        </div>
      )}

      <AnimatePresence>
        {showComposer && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <PostComposer
              onSubmit={handleCreate}
              onClose={() => setShowComposer(false)}
              submitting={submitting}
              mode="create"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingPost && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <PostComposer
              onSubmit={handleUpdate}
              onClose={() => setEditingPost(null)}
              submitting={submitting}
              initial={{ content: editingPost.content, scheduledFor: editingPost.scheduledAt || editingPost.scheduledFor || "" }}
              mode="edit"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="kf-card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search posts..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="kf-input w-full pl-10"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`kf-btn-secondary inline-flex items-center gap-2 ${showFilters ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
          >
            <Filter className="w-4 h-4" />
            Filters
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </button>
          <button
            onClick={() => void loadPosts()}
            disabled={loading}
            className="kf-btn-secondary inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-2"
            >
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                    statusFilter === s ? "kf-btn-primary" : "kf-btn-secondary"
                  }`}
                >
                  {s}
                </button>
              ))}
              {statusFilter !== "ALL" && (
                <button
                  onClick={() => { setStatusFilter("ALL"); setSearchInput(""); }}
                  className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="kf-card overflow-hidden">
        <div className="flex border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-all border-b-2 ${
                activeTab === key
                  ? "text-[hsl(var(--kf-accent1))]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              style={activeTab === key ? { borderColor: "hsl(var(--kf-accent1))" } : {}}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === "posts" && (
            <PostsFeed
              posts={filteredPosts}
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
