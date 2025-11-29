"use client";

import { CalendarDays, Share2 } from "lucide-react";

const posts = [
  { title: "IG Reel: New service launch", status: "Scheduled", time: "Tomorrow 9:00 AM" },
  { title: "WhatsApp broadcast: Promo", status: "Draft", time: "Pending" },
  { title: "Facebook post: Success story", status: "Posted", time: "2h ago" },
];

export default function SocialPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <Share2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Social</h1>
          <p className="text-sm text-muted-foreground">Content calendar, channel connections, and scheduling.</p>
        </div>
      </div>

      <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Calendar Snapshot</div>
          <button className="inline-flex items-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20">
            <CalendarDays className="w-4 h-4" />
            Open calendar
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {posts.map((post) => (
            <div key={post.title} className="rounded-2xl border border-border/60 bg-slate-900/60 p-3 text-sm space-y-1">
              <div className="font-semibold">{post.title}</div>
              <div className="text-[12px] text-muted-foreground">Status: {post.status}</div>
              <div className="text-[12px] text-muted-foreground">When: {post.time}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
          Future: channel connectors (Facebook/Instagram/WhatsApp), AI drafts, and publish/pause controls.
        </div>
      </div>
    </div>
  );
}
