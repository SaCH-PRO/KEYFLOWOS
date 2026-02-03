"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@keyflow/ui";
import { CalendarDays, Share2, Plus, Send, FileText } from "lucide-react";
import { SocialPost, fetchPosts, createPost, publishPost } from "@/lib/client";

export default function SocialPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ content: "", scheduledFor: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await fetchPosts();
      setPosts(data ?? []);
      if (error) setError(error);
      setLoading(false);
    };
    void load();
  }, []);

  async function handleCreate() {
    setFormError(null);
    if (!form.content.trim()) {
      setFormError("Content is required");
      return;
    }
    const { data, error } = await createPost({
      content: form.content,
      scheduledFor: form.scheduledFor || undefined,
    });
    if (error) setFormError(error);
    if (data) {
      setPosts((prev) => [data, ...prev]);
      setForm({ content: "", scheduledFor: "" });
      setShowComposer(false);
    }
  }

  async function handlePublish(postId: string) {
    const { data, error } = await publishPost(postId);
    if (error) {
      setError(error);
    } else if (data) {
      setPosts((prev) => prev.map((p) => (p.id === postId ? data : p)));
    }
  }

  function getStatusBadge(status: string) {
    const styles: Record<string, string> = {
      DRAFT: "bg-slate-500/20 text-slate-300 border-slate-500/40",
      SCHEDULED: "bg-blue-500/20 text-blue-300 border-blue-500/40",
      PUBLISHED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    };
    return styles[status] ?? styles.DRAFT;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Social</h1>
            <p className="text-sm text-muted-foreground">Content calendar, channel connections, and scheduling.</p>
          </div>
        </div>
        <Button onClick={() => setShowComposer(!showComposer)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Post
        </Button>
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      {showComposer && (
        <div className="rounded-2xl border border-primary/40 bg-slate-950/80 p-4 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <FileText className="w-4 h-4" /> Compose Post
          </h3>
          <textarea
            className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm min-h-[100px] resize-none"
            placeholder="What's on your mind? Share updates, promotions, or announcements..."
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          />
          <div className="flex items-end gap-3">
            <Input
              label="Schedule for (optional)"
              type="datetime-local"
              className="w-64"
              value={form.scheduledFor}
              onChange={(e) => setForm((f) => ({ ...f, scheduledFor: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowComposer(false)}>Cancel</Button>
              <Button onClick={handleCreate}>
                {form.scheduledFor ? "Schedule" : "Save Draft"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Content Calendar</div>
          <button className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
            <CalendarDays className="w-4 h-4" />
            Calendar View
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Loading posts...</div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No posts yet. Create your first post to start building your content calendar.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <div
                key={post.id}
                className="rounded-2xl border border-border/60 bg-slate-900/60 p-3 text-sm space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-foreground line-clamp-3">{post.content}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${getStatusBadge(post.status)}`}>
                    {post.status}
                  </span>
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {post.publishedAt
                    ? `Published: ${new Date(post.publishedAt).toLocaleDateString()}`
                    : post.scheduledFor
                    ? `Scheduled: ${new Date(post.scheduledFor).toLocaleDateString()}`
                    : `Created: ${new Date(post.createdAt).toLocaleDateString()}`}
                </div>
                {post.status === "DRAFT" && (
                  <Button
                    variant="outline"
                    className="w-full text-xs gap-1"
                    onClick={() => handlePublish(post.id)}
                  >
                    <Send className="w-3 h-3" /> Publish Now
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
          Coming soon: Channel connectors (Facebook/Instagram/WhatsApp), AI drafts, and multi-platform publishing.
        </div>
      </div>
    </div>
  );
}
