'use client';

import { useState } from 'react';
import { Button } from '@keyflow/ui';
import { API_BASE, apiPost } from '@/lib/api';

export default function SocialPage() {
  const [businessId, setBusinessId] = useState('');
  const [postId, setPostId] = useState('');
  const [content, setContent] = useState('');
  const [mediaUrls, setMediaUrls] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const request = async (path: string, body: Record<string, unknown>) => {
    setStatus('Submitting...');
    const { data, error } = await apiPost<any>({ path, body });
    if (error) {
      setStatus(`Error: ${error}`);
      return;
    }
    setStatus(JSON.stringify(data));
    if ((data as any)?.id) setPostId((data as any).id);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        <h1 className="text-3xl font-bold">Social Post Tester</h1>
        <p className="text-slate-600">Create a draft and publish it via the Nest social endpoints.</p>

        <div className="space-y-3">
          <input
            className="w-full rounded border border-slate-300 px-3 py-2"
            placeholder="Business ID"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
          />
          <textarea
            className="w-full rounded border border-slate-300 px-3 py-2"
            placeholder="Content"
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <input
            className="w-full rounded border border-slate-300 px-3 py-2"
            placeholder="Media URLs (comma separated, optional)"
            value={mediaUrls}
            onChange={(e) => setMediaUrls(e.target.value)}
          />
          <div className="flex gap-3">
            <Button
              type="button"
              onClick={() =>
                request(`/social/businesses/${encodeURIComponent(businessId)}/posts`, {
                  content,
                  mediaUrls: mediaUrls ? mediaUrls.split(',').map((u) => u.trim()) : [],
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

        <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold mb-1">Post ID</p>
          <p>{postId || 'None yet'}</p>
          <p className="font-semibold mt-3 mb-1">Status</p>
          <p>{status || 'Idle'}</p>
        </div>
      </div>
    </main>
  );
}
