'use client';

import { useState } from "react";
import { Badge, Button, Card, Input } from "@keyflow/ui";
import { apiPost, API_BASE } from "@/lib/api";

export default function PublicSocialPage() {
  const [businessId, setBusinessId] = useState("");
  const [postId, setPostId] = useState("");
  const [content, setContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const request = async (path: string, body: Record<string, unknown>) => {
    setStatus("Submitting...");
    const { data, error } = await apiPost<any>({ path, body });
    if (error) {
      setStatus(`Error: ${error}`);
      return;
    }
    setStatus(JSON.stringify(data));
    if ((data as any)?.id) setPostId((data as any).id);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-black text-white px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-2">
          <Badge tone="info">Public Social</Badge>
          <h1 className="text-3xl font-semibold">Social Post Tester</h1>
          <p className="text-sm text-slate-300">
            Create a draft and publish it via the live social endpoints at <code className="font-mono">{API_BASE}</code>.
          </p>
        </div>

        <Card title="Create & Publish" badge="Live" className="bg-[rgba(0,0,0,0.35)] border border-[var(--kf-border)]">
          <div className="grid grid-cols-1 gap-4">
            <Input label="Business ID" value={businessId} onChange={(e) => setBusinessId(e.target.value)} />
            <textarea
              className="w-full rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 py-2 text-sm text-[var(--kf-text)]"
              placeholder="Content"
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <Input
              label="Media URLs (comma separated, optional)"
              value={mediaUrls}
              onChange={(e) => setMediaUrls(e.target.value)}
            />
            <div className="flex gap-3">
              <Button
                type="button"
                onClick={() =>
                  request(`/social/businesses/${encodeURIComponent(businessId)}/posts`, {
                    content,
                    mediaUrls: mediaUrls ? mediaUrls.split(",").map((u) => u.trim()) : [],
                  })
                }
              >
                Create Draft
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  request(
                    `/social/businesses/${encodeURIComponent(businessId)}/posts/${encodeURIComponent(postId)}/publish`,
                    {},
                  )
                }
                disabled={!postId || !businessId}
              >
                Publish Draft
              </Button>
            </div>
          </div>
          <div className="mt-4 rounded border border-[var(--kf-border)] bg-[rgba(0,0,0,0.35)] px-4 py-3 text-sm text-[var(--kf-text)]">
            <p className="font-semibold mb-1">Post ID</p>
            <p>{postId || "None yet"}</p>
            <p className="font-semibold mt-3 mb-1">Status</p>
            <p>{status || "Idle"}</p>
          </div>
        </Card>
      </div>
    </main>
  );
}
