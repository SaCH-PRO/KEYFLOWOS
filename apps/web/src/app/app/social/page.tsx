"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Badge, Button, Card, Input } from "@keyflow/ui";
import {
  SocialConnection,
  SocialPost,
  createSocialConnection,
  createSocialPost,
  deleteSocialPost,
  fetchSocialConnections,
  fetchSocialPosts,
  updateSocialPost,
} from "@/lib/client";

export default function SocialPage() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [postForm, setPostForm] = useState({ content: "", mediaUrls: "", scheduledAt: "" });
  const [connectionForm, setConnectionForm] = useState({ platform: "INSTAGRAM", platformId: "", token: "" });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [postRes, connectionRes] = await Promise.all([fetchSocialPosts(), fetchSocialConnections()]);
      setPosts(postRes.data ?? []);
      setConnections(connectionRes.data ?? []);
      setError(postRes.error || connectionRes.error);
      setLoading(false);
    };
    void load();
  }, []);

  const refreshPosts = async () => {
    const res = await fetchSocialPosts();
    setPosts(res.data ?? []);
  };

  const handleCreateDraft = async () => {
    if (!postForm.content.trim()) return;
    const mediaUrls = postForm.mediaUrls
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    await createSocialPost({ content: postForm.content.trim(), mediaUrls });
    setPostForm({ content: "", mediaUrls: "", scheduledAt: "" });
    await refreshPosts();
  };

  const handleSchedule = async (postId: string) => {
    if (!postForm.scheduledAt) return;
    await updateSocialPost({
      postId,
      status: "SCHEDULED",
      scheduledAt: postForm.scheduledAt,
    });
    await refreshPosts();
  };

  const handlePublish = async (postId: string) => {
    await updateSocialPost({ postId, status: "POSTED" });
    await refreshPosts();
  };

  const handleDelete = async (postId: string) => {
    await deleteSocialPost({ postId });
    await refreshPosts();
  };

  const handleConnect = async () => {
    if (!connectionForm.token.trim()) return;
    await createSocialConnection({
      platform: connectionForm.platform,
      platformId: connectionForm.platformId || undefined,
      token: connectionForm.token,
    });
    setConnectionForm({ platform: "INSTAGRAM", platformId: "", token: "" });
    const res = await fetchSocialConnections();
    setConnections(res.data ?? []);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <CalendarDays className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Social</h1>
          <p className="text-sm text-muted-foreground">Draft, schedule, and publish social content.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Live API unreachable — showing demo data.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card title="Create post" badge="Live">
          <div className="space-y-3">
            <textarea
              className="w-full rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 py-2 text-sm text-[var(--kf-text)]"
              placeholder="Write your post..."
              rows={4}
              value={postForm.content}
              onChange={(e) => setPostForm((prev) => ({ ...prev, content: e.target.value }))}
            />
            <Input
              label="Media URLs (comma separated)"
              value={postForm.mediaUrls}
              onChange={(e) => setPostForm((prev) => ({ ...prev, mediaUrls: e.target.value }))}
            />
            <Input
              label="Schedule at"
              type="datetime-local"
              value={postForm.scheduledAt}
              onChange={(e) => setPostForm((prev) => ({ ...prev, scheduledAt: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button onClick={handleCreateDraft}>Save draft</Button>
              <Button variant="outline" onClick={() => refreshPosts()}>
                Refresh
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Connections" badge={`${connections.length}`}>
          <div className="space-y-2">
            <div className="grid gap-2">
              <select
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
                value={connectionForm.platform}
                onChange={(e) => setConnectionForm((prev) => ({ ...prev, platform: e.target.value }))}
              >
                {["INSTAGRAM", "FACEBOOK", "WHATSAPP"].map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
              <Input
                label="Platform ID"
                value={connectionForm.platformId}
                onChange={(e) => setConnectionForm((prev) => ({ ...prev, platformId: e.target.value }))}
              />
              <Input
                label="Token"
                value={connectionForm.token}
                onChange={(e) => setConnectionForm((prev) => ({ ...prev, token: e.target.value }))}
              />
              <Button variant="outline" onClick={handleConnect}>
                Connect channel
              </Button>
            </div>
            {connections.length === 0 && <div className="text-xs text-muted-foreground">No channels connected.</div>}
            {connections.map((connection) => (
              <div key={connection.id} className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm">
                <div className="font-semibold">{connection.platform}</div>
                <div className="text-xs text-muted-foreground">{connection.platformId ?? "No platform ID"}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Scheduled & published" badge={loading ? "Loading" : `${posts.length}`}>
        <div className="space-y-2">
          {posts.length === 0 && <div className="text-xs text-muted-foreground">No posts yet.</div>}
          {posts.map((post) => (
            <div key={post.id} className="rounded-2xl border border-border/60 bg-background p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{post.content.slice(0, 80)}</div>
                <Badge tone={post.status === "POSTED" ? "success" : post.status === "SCHEDULED" ? "info" : "default"}>
                  {post.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {post.scheduledAt ? `Scheduled ${new Date(post.scheduledAt).toLocaleString()}` : "Not scheduled"}
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="xs" onClick={() => handlePublish(post.id)}>
                  Publish
                </Button>
                <Button variant="outline" size="xs" onClick={() => handleSchedule(post.id)}>
                  Schedule
                </Button>
                <Button variant="outline" size="xs" onClick={() => handleDelete(post.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
