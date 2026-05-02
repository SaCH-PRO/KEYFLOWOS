"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Filter,
  ChevronDown,
  X,
  LayoutGrid,
  CalendarDays,
  RefreshCw,
  Plus,
} from "lucide-react";
import type { SocialPost, SocialConnection, Booking, Service, StaffMember } from "@/lib/client";
import {
  fetchPosts,
  createPost,
  updatePost,
  deletePost,
  publishPost,
  fetchSocialConnections,
  fetchBookings,
  fetchServices,
  fetchStaff,
  createBooking,
  syncBookingToCalendar,
} from "@/lib/client";
import { toast } from "sonner";
import { moduleEvents } from "@/lib/module-events";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PostComposer, type ComposerSubmitData } from "./social/post-composer";
import { PostsFeed } from "./social/posts-feed";
import { ContentCalendar } from "./social/content-calendar";
type SocialView = "posts" | "calendar";

const STATUS_FILTERS = ["ALL", "DRAFT", "SCHEDULED", "POSTED"] as const;

interface SocialTabContentProps {
  businessId: string | null;
  onPostsLoaded?: (posts: SocialPost[]) => void;
}

export function SocialTabContent({ businessId, onPostsLoaded }: SocialTabContentProps) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [calBookings, setCalBookings] = useState<Booking[]>([]);
  const [calServices, setCalServices] = useState<Service[]>([]);
  const [calStaff, setCalStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [subView, setSubView] = useState<SocialView>("posts");
  const [showComposer, setShowComposer] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; action: () => void }>({
    open: false,
    action: () => {},
  });

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    onPostsLoaded?.(posts);
  }, [posts, onPostsLoaded]);

  const loadPosts = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const { data } = await fetchPosts(businessId);
    setPosts(data ?? []);
    setLoading(false);
  }, [businessId]);

  const loadConnections = useCallback(async () => {
    if (!businessId) return;
    const { data } = await fetchSocialConnections(businessId);
    if (data) setConnections(data);
  }, [businessId]);

  const loadCalendarData = useCallback(async () => {
    if (!businessId) return;
    const [bRes, sRes, stRes] = await Promise.all([
      fetchBookings(businessId),
      fetchServices(businessId),
      fetchStaff(businessId),
    ]);
    if (bRes.data) setCalBookings(bRes.data);
    if (sRes.data) setCalServices(sRes.data);
    if (stRes.data) setCalStaff(stRes.data);
  }, [businessId]);

  useEffect(() => {
    void loadPosts();
    void loadConnections();
    void loadCalendarData();
  }, [loadPosts, loadConnections, loadCalendarData]);

  const filteredPosts = posts.filter((p) => {
    if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
    if (search && !p.content.toLowerCase().includes(search)) return false;
    return true;
  });

  async function handleCreate(data: ComposerSubmitData) {
    setSubmitting(true);
    const { data: post, error } = await createPost({
      businessId: businessId ?? undefined,
      content: data.content,
      scheduledFor: data.scheduledFor,
      channelIds: data.channelIds,
      mediaUrls: data.mediaUrls,
    });
    if (error) {
      toast.error(error);
      setSubmitting(false);
      return;
    }
    if (post) {
      if (data.action === "publish") {
        const channels =
          data.channelIds && data.channelIds.length > 0 ? data.channelIds : undefined;
        const { data: pubData, error: pubError } = await publishPost(
          post.id,
          channels,
          businessId ?? undefined,
        );
        if (pubError) toast.error(pubError);
        else {
          moduleEvents.emit("marketing:social_post_published", "marketing", { postId: post.id });
          toast.success("Post published");
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
        const published = pubData ? ((pubData as any).post || pubData) : post;
        setPosts((prev) => [published, ...prev]);
      } else {
        moduleEvents.emit("marketing:social_post_created", "marketing", { postId: post.id });
        setPosts((prev) => [post, ...prev]);
        toast.success("Post created");
      }
      setShowComposer(false);
    }
    setSubmitting(false);
  }

  async function handleUpdate(data: ComposerSubmitData) {
    if (!editingPost) return;
    setSubmitting(true);
    const { data: updated, error } = await updatePost(
      editingPost.id,
      {
        content: data.content,
        scheduledAt: data.scheduledFor || null,
        channelIds: data.channelIds,
        mediaUrls: data.mediaUrls,
      },
      businessId ?? undefined,
    );
    if (error) {
      toast.error(error);
      setSubmitting(false);
      return;
    }
    if (updated) {
      if (data.action === "publish") {
        const channels =
          data.channelIds && data.channelIds.length > 0 ? data.channelIds : undefined;
        const { data: pubData, error: pubError } = await publishPost(
          updated.id,
          channels,
          businessId ?? undefined,
        );
        if (pubError) toast.error(pubError);
        else {
          moduleEvents.emit("marketing:social_post_published", "marketing", { postId: updated.id });
          toast.success("Post published");
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
        const published = pubData ? ((pubData as any).post || pubData) : updated;
        setPosts((prev) => prev.map((p) => (p.id === editingPost.id ? published : p)));
      } else {
        setPosts((prev) => prev.map((p) => (p.id === editingPost.id ? updated : p)));
        toast.success("Post updated");
      }
      setEditingPost(null);
    }
    setSubmitting(false);
  }

  async function handlePublish(postId: string) {
    const post = posts.find((p) => p.id === postId);
    const channelIds =
      post?.channelIds && post.channelIds.length > 0 ? post.channelIds : undefined;
    const { data, error } = await publishPost(postId, channelIds, businessId ?? undefined);
    if (error) toast.error(error);
    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
      const updated = (data as any).post || data;
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
      moduleEvents.emit("marketing:social_post_published", "marketing", { postId });
      toast.success("Post published");
    }
  }

  async function handleDelete(postId: string) {
    setConfirmState({
      open: true,
      action: async () => {
        const { error } = await deletePost(postId, businessId ?? undefined);
        if (error) {
          toast.error(error);
        } else {
          setPosts((prev) => prev.filter((p) => p.id !== postId));
          toast.success("Post deleted");
        }
      },
    });
  }

  function handleEditStart(post: SocialPost) {
    setEditingPost(post);
    setShowComposer(false);
  }

  function handleCalendarSelect(post: SocialPost) {
    setEditingPost(post);
    setShowComposer(false);
    setSubView("posts");
  }

  async function handleCalendarBooking(data: { date: string; time: string; serviceId: string; staffId: string }) {
    if (!businessId) return;
    const selectedService = calServices.find((s) => s.id === data.serviceId);
    const startTime = new Date(`${data.date}T${data.time}`).toISOString();
    const endTime = selectedService
      ? new Date(new Date(`${data.date}T${data.time}`).getTime() + (selectedService.durationMins ?? selectedService.duration ?? 60) * 60 * 1000).toISOString()
      : new Date(new Date(`${data.date}T${data.time}`).getTime() + 60 * 60 * 1000).toISOString();
    const { data: result, error } = await createBooking({
      businessId,
      serviceId: data.serviceId,
      staffId: data.staffId,
      startTime,
      endTime,
    });
    if (error) { toast.error(error); throw new Error(error); }
    if (result) {
      toast.success("Booking created");
      moduleEvents.emit("booking:created", "bookings", { booking: result });
      void loadCalendarData();
      syncBookingToCalendar(result.id, businessId).then(({ error: syncErr }) => {
        if (syncErr) toast.info("Booking created — connect Google Calendar in Settings to sync");
      });
    }
  }

  const SUB_VIEWS: { key: SocialView; label: string; icon: React.ElementType }[] = [
    { key: "posts", label: "Posts", icon: LayoutGrid },
    { key: "calendar", label: "Calendar", icon: CalendarDays },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 p-0.5 rounded-xl bg-muted/40 border border-border/30">
          {SUB_VIEWS.map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.key}
                onClick={() => setSubView(v.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  subView === v.key
                    ? "bg-[hsl(var(--kf-accent1))] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {v.label}
              </button>
            );
          })}
        </div>
        {subView === "posts" && (
          <button
            data-social-new-post
            onClick={() => {
              setShowComposer(true);
              setEditingPost(null);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/90 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Post
          </button>
        )}
      </div>

      {subView === "posts" && (
        <>
          <AnimatePresence>
            {showComposer && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
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
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <PostComposer
                  onSubmit={handleUpdate}
                  onClose={() => setEditingPost(null)}
                  submitting={submitting}
                  initial={{
                    content: editingPost.content,
                    scheduledFor:
                      editingPost.scheduledAt || editingPost.scheduledFor || "",
                    channelIds: editingPost.channelIds,
                    mediaUrls: editingPost.mediaUrls,
                  }}
                  mode="edit"
                  connections={connections}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div
            className="rounded-xl border p-3 space-y-3"
            style={{
              background: "hsl(var(--kf-card) / 0.5)",
              borderColor: "hsl(var(--kf-border) / 0.5)",
            }}
          >
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search posts..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="kf-input w-full pl-10 text-sm"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`kf-btn-secondary inline-flex items-center gap-1.5 text-xs ${showFilters ? "ring-1 ring-[hsl(var(--kf-accent1))]" : ""}`}
              >
                <Filter className="w-3.5 h-3.5" />
                Filters
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`}
                />
              </button>
              <button
                onClick={() => void loadPosts()}
                disabled={loading}
                className="kf-btn-secondary inline-flex items-center gap-1.5 text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-wrap gap-1.5"
                >
                  {STATUS_FILTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-2.5 py-1 text-xs rounded-lg transition-all ${
                        statusFilter === s ? "kf-btn-primary" : "kf-btn-secondary"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  {statusFilter !== "ALL" && (
                    <button
                      onClick={() => {
                        setStatusFilter("ALL");
                        setSearchInput("");
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      Clear
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <PostsFeed
            posts={filteredPosts}
            loading={loading}
            onPublish={handlePublish}
            onEdit={handleEditStart}
            onDelete={handleDelete}
            onNewPost={() => {
              setShowComposer(true);
              setEditingPost(null);
            }}
          />
        </>
      )}

      {subView === "calendar" && (
        <ContentCalendar
          posts={posts}
          bookings={calBookings}
          services={calServices}
          staff={calStaff}
          onSelectPost={handleCalendarSelect}
          onSelectBooking={() => {}}
          onCreateBooking={handleCalendarBooking}
        />
      )}

      <ConfirmDialog
        open={confirmState.open}
        title="Delete Post"
        message="Are you sure you want to delete this post?"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          confirmState.action();
          setConfirmState({ open: false, action: () => {} });
        }}
        onCancel={() => setConfirmState({ open: false, action: () => {} })}
      />
    </div>
  );
}
