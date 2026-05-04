"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Share2,
  PenSquare,
  CalendarDays,
  LayoutList,
  BarChart3,
  Plus,
  Plug,
  RefreshCw,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchPosts,
  fetchSocialConnections,
  fetchBookings,
  fetchServices,
  fetchStaff,
  createPost,
  updatePost,
  deletePost,
  publishPost,
  type SocialPost,
  type SocialConnection,
  type Booking,
  type Service,
  type StaffMember,
} from "@/lib/client";
import { PostComposer, type ComposerSubmitData } from "../marketing/components/social/post-composer";
import { PostsFeed } from "../marketing/components/social/posts-feed";
import { ContentCalendar } from "../marketing/components/social/content-calendar";
import { AnalyticsPanel } from "../marketing/components/social/analytics-stub";

type View = "feed" | "calendar" | "drafts" | "analytics";

const VIEWS: { key: View; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "feed", label: "Feed", icon: LayoutList },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "drafts", label: "Drafts", icon: PenSquare },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
];

export default function SocialComposerPage() {
  const businessId = getStoredBusinessId();
  const [view, setView] = useState<View>("feed");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmState, setConfirmState] = useState<{ open: boolean; action: () => void }>({
    open: false,
    action: () => {},
  });

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [pRes, cRes, bRes, sRes, stRes] = await Promise.all([
      fetchPosts(businessId),
      fetchSocialConnections(businessId),
      fetchBookings(businessId),
      fetchServices(businessId),
      fetchStaff(businessId),
    ]);
    setPosts(pRes.data ?? []);
    setConnections(cRes.data ?? []);
    setBookings(bRes.data ?? []);
    setServices(sRes.data ?? []);
    setStaff(stRes.data ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates async/server data into local state
    void load();
  }, [load]);

  const handleSubmit = async (data: ComposerSubmitData) => {
    setSubmitting(true);
    if (!businessId) {
      toast.error("Pick a workspace before saving posts.");
      setSubmitting(false);
      return;
    }
    if (editingPost) {
      const { error } = await updatePost(
        editingPost.id,
        {
          content: data.content,
          scheduledAt: data.scheduledFor ?? null,
          channelIds: data.channelIds,
          mediaUrls: data.mediaUrls,
        },
        businessId,
      );
      if (error) toast.error(error);
      else {
        toast.success("Post updated");
        if (data.action === "publish") {
          const { error: pubErr } = await publishPost(editingPost.id, undefined, businessId);
          if (pubErr) toast.error(pubErr);
          else toast.success("Post published");
        }
      }
    } else {
      const { data: created, error } = await createPost({
        businessId,
        content: data.content,
        scheduledFor: data.scheduledFor,
        channelIds: data.channelIds,
        mediaUrls: data.mediaUrls,
      });
      if (error) toast.error(error);
      else if (created) {
        toast.success(data.action === "schedule" ? "Post scheduled" : "Draft saved");
        if (data.action === "publish") {
          const { error: pubErr } = await publishPost(created.id, undefined, businessId);
          if (pubErr) toast.error(pubErr);
          else toast.success("Post published");
        }
      }
    }
    setSubmitting(false);
    setShowComposer(false);
    setEditingPost(null);
    await load();
  };

  const handleDelete = (id: string) => {
    if (!businessId) {
      toast.error("Pick a workspace before deleting posts.");
      return;
    }
    setConfirmState({
      open: true,
      action: async () => {
        const { error } = await deletePost(id, businessId);
        if (error) toast.error(error);
        else {
          toast.success("Post deleted");
          await load();
        }
      },
    });
  };

  const handlePublish = async (id: string) => {
    if (!businessId) {
      toast.error("Pick a workspace before publishing posts.");
      return;
    }
    const { error } = await publishPost(id, undefined, businessId);
    if (error) toast.error(error);
    else {
      toast.success("Post published");
      await load();
    }
  };

  const drafts = posts.filter((p) => p.status === "DRAFT");
  const visiblePosts =
    view === "drafts" ? drafts : posts;
  const connectedCount = connections.filter((c) => c.status === "CONNECTED").length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-white shadow-lg">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Social Composer</h1>
            <p className="text-sm text-muted-foreground">
              Compose, schedule, and analyse posts across every connected channel.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/connect#social"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-muted/30 transition-colors"
          >
            <Plug className="h-3.5 w-3.5" />
            {connectedCount} channel{connectedCount === 1 ? "" : "s"} connected
          </Link>
          <Button onClick={() => load()} variant="ghost" size="sm" disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={() => {
              setEditingPost(null);
              setShowComposer(true);
            }}
            size="sm"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> New post
          </Button>
        </div>
      </motion.div>

      <div className="flex items-center gap-1 border-b border-border/40">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = view === v.key;
          const count = v.key === "drafts" ? drafts.length : undefined;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {v.label}
              {count !== undefined && count > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40">{count}</span>
              )}
              {active && (
                <motion.span
                  layoutId="social-tab-indicator"
                  className="absolute -bottom-px left-0 right-0 h-0.5 bg-[hsl(var(--kf-accent1))]"
                />
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : connectedCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/40 p-8 text-center space-y-3">
          <div className="h-12 w-12 mx-auto rounded-2xl bg-muted/20 flex items-center justify-center">
            <Plug className="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold">Connect a channel to get started</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Link Meta, Instagram, LinkedIn, TikTok, X, or WhatsApp from KeyFlow Connect
            to publish from this composer.
          </p>
          <Link
            href="/app/connect#social"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))] text-white"
          >
            <Plug className="h-3.5 w-3.5" /> Open KeyFlow Connect
          </Link>
        </div>
      ) : (
        <>
          {(view === "feed" || view === "drafts") && (
            <PostsFeed
              posts={visiblePosts}
              loading={loading}
              onPublish={handlePublish}
              onEdit={(post) => {
                setEditingPost(post);
                setShowComposer(true);
              }}
              onDelete={handleDelete}
              onNewPost={() => {
                setEditingPost(null);
                setShowComposer(true);
              }}
            />
          )}
          {view === "calendar" && (
            <ContentCalendar
              posts={posts}
              bookings={bookings}
              services={services}
              staff={staff}
              onSelectPost={(post) => {
                setEditingPost(post);
                setShowComposer(true);
              }}
            />
          )}
          {view === "analytics" && <AnalyticsPanel posts={posts} />}
        </>
      )}

      {showComposer && (
        <PostComposer
          mode={editingPost ? "edit" : "create"}
          initial={
            editingPost
              ? {
                  content: editingPost.content,
                  scheduledFor: editingPost.scheduledFor ?? undefined,
                  channelIds: editingPost.channelIds ?? [],
                  mediaUrls: editingPost.mediaUrls ?? [],
                }
              : undefined
          }
          connections={connections}
          submitting={submitting}
          onClose={() => {
            setShowComposer(false);
            setEditingPost(null);
          }}
          onSubmit={handleSubmit}
        />
      )}

      <ConfirmDialog
        open={confirmState.open}
        title="Delete post"
        message="Delete this post? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          confirmState.action();
          setConfirmState((p) => ({ ...p, open: false }));
        }}
        onCancel={() => setConfirmState((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}
