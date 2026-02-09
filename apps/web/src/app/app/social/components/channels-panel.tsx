"use client";

import { Facebook, Instagram, MessageCircle, Lock } from "lucide-react";
import { Button } from "@keyflow/ui";

const CHANNELS = [
  {
    name: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    description: "Pages, posts & stories",
  },
  {
    name: "Instagram",
    icon: Instagram,
    color: "#E4405F",
    description: "Feed posts & reels",
  },
  {
    name: "WhatsApp Business",
    icon: MessageCircle,
    color: "#25D366",
    description: "Status updates & broadcasts",
  },
  {
    name: "TikTok",
    icon: ({ className }: { className?: string }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.87a8.16 8.16 0 003.76.92V6.34a4.83 4.83 0 01-.01.35z" />
      </svg>
    ),
    color: "#000000",
    description: "Short videos & clips",
  },
];

export function ChannelsPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">Coming Soon</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Connect your social accounts to publish posts directly from KeyFlowOS. One post, all platforms.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {CHANNELS.map((ch) => {
          const Icon = ch.icon;
          return (
            <div
              key={ch.name}
              className="rounded-2xl border border-border/40 bg-slate-900/50 p-4 flex items-center gap-4 opacity-70"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${ch.color}18` }}
              >
                <Icon className="w-5 h-5" style={{ color: ch.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{ch.name}</p>
                <p className="text-[11px] text-muted-foreground">{ch.description}</p>
              </div>
              <Button variant="outline" disabled className="text-xs h-8 opacity-50">
                Connect
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
