"use client";

import { Facebook, Instagram, MessageCircle } from "lucide-react";
import { Button } from "@keyflow/ui";

interface MetaBusinessSuiteSectionProps {
  businessId: string;
}

const PLATFORMS: {
  key: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    key: "facebook_page",
    label: "Facebook Page",
    description: "Connect your Facebook business page to capture reviews, messages, and leads in Key Inbox.",
    icon: Facebook,
  },
  {
    key: "instagram",
    label: "Instagram Business",
    description: "Sync Instagram Business messages, comments, and mentions with Key Inbox.",
    icon: Instagram,
  },
  {
    key: "meta_messenger",
    label: "Messenger",
    description: "Receive and respond to Facebook Messenger conversations from Key Inbox.",
    icon: MessageCircle,
  },
];

export function MetaBusinessSuiteSection({ businessId }: MetaBusinessSuiteSectionProps) {
  return (
    <section className="space-y-3" id="meta-business-suite">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 border border-border/40 flex items-center justify-center text-[11px] font-bold">
          M
        </div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Meta Business Suite
        </h3>
        <span className="text-[10px] text-muted-foreground/60">Coming soon</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          return (
            <div
              key={platform.key}
              className="rounded-2xl border border-border/40 bg-card p-4 space-y-3"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/30 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold truncate">{platform.label}</h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-zinc-500/10 text-zinc-400 border-zinc-500/30">
                      Coming soon
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{platform.description}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="default" disabled className="h-7 text-xs">
                  Coming soon
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
