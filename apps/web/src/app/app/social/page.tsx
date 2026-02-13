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
  FileText,
  Clock,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import {
  SocialPost,
  SocialConnection,
  fetchPosts,
  createPost,
  updatePost,
  deletePost,
  publishPost,
  fetchSocialConnections,
} from "@/lib/client";
import { PostComposer } from "./components/post-composer";
import { PostsFeed } from "./components/posts-feed";
import { ContentCalendar } from "./components/content-calendar";
import { ChannelsPanel } from "./components/channels-panel";
import { AIStudio } from "./components/ai-studio";
import { AnalyticsPanel } from "./components/analytics-stub";

type Tab = "posts" | "calendar" | "channels" | "ai" | "analytics";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "posts", label: "Posts", icon: LayoutGrid },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "channels", label: "Channels", icon: Link2 },
  { key: "ai", label: "AI Studio", icon: Sparkles },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
];

const STATUS_FILTERS = ["ALL", "DRAFT", "SCHEDULED", "POSTED"] as const;

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } },
};

export default function SocialPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("posts");
  const [showComposer, setShowComposer] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [connections, setConnections] = useState<SocialConnection[]>([]);

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

  const loadConnections = useCallback(async () => {
    const { data } = await fetchSocialConnections();
    if (data) setConnections(data);
  }, []);

  useEffect(() => {
    void loadPosts();
    void loadConnections();
  }, [loadPosts, loadConnections]);

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
  const publishingRate = posts.length > 0 ? Math.round((postedCount / posts.length) * 100) : 0;

  const kpiCards = [
    { label: "Drafts", value: draftCount, icon: FileText, color: "hsl(var(--kf-muted-foreground))" },
    { label: "Scheduled", value: scheduledCount, icon: Clock, color: "hsl(var(--kf-accent2))" },
    { label: "Posted", value: postedCount, icon: CheckCircle2, color: "hsl(150 60% 45%)" },
    { label: "Publishing Rate", value: `${publishingRate}%`, icon: TrendingUp, color: "hsl(var(--kf-accent1))" },
  ];

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
        variants={stagger}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.label}
              variants={fadeUp}
              className="rounded-2xl border backdrop-blur-xl p-4 text-center space-y-1"
              style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
            >
              <Icon className="w-4 h-4 mx-auto" style={{ color: kpi.color }} />
              <p className="text-xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
            </motion.div>
          );
        })}
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
              connections={connections}
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
              initial={{ content: editingPost.content, scheduledFor: editingPost.scheduledAt || editingPost.scheduledFor || "", channelIds: editingPost.channelIds }}
              mode="edit"
              connections={connections}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl border backdrop-blur-xl p-4 space-y-4"
        style={{ background: "hsl(var(--kf-card) / 0.7)", borderColor: "hsl(var(--kf-border))" }}
      >
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
      </motion.div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative px-5 py-2.5 text-sm font-medium rounded-xl transition-all flex items-center gap-2 whitespace-nowrap ${
              activeTab === key
                ? "text-[hsl(var(--kf-accent1))]"
                : "text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--kf-muted)/0.5)]"
            }`}
          >
            {activeTab === key && (
              <motion.div
                layoutId="social-tab-pill"
                className="absolute inset-0 rounded-xl border shadow-lg"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.12), hsl(var(--kf-accent2) / 0.08))",
                  borderColor: "hsl(var(--kf-accent1) / 0.3)",
                  boxShadow: "0 4px 12px hsl(var(--kf-accent1) / 0.1)",
                }}
                transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <Icon className="w-4 h-4" />
              {label}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
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
          {activeTab === "analytics" && <AnalyticsPanel posts={posts} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
