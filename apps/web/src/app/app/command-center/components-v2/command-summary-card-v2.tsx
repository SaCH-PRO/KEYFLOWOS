"use client";

import { Bot, BrainCircuit, Clock, Inbox, Target, ArrowRight } from "lucide-react";
import Link from "next/link";

interface CommandSummaryCardV2Props {
  summary: string;
}

const ACTIONS = [
  { href: "/app/key-autonomy", icon: Bot, label: "Autonomy", description: "Let KEY run" },
  { href: "/app/key-modes", icon: BrainCircuit, label: "Modes", description: "Expert personas" },
  { href: "/app/temporal-flow", icon: Clock, label: "Temporal", description: "Time & tasks" },
  { href: "/app/key-inbox", icon: Inbox, label: "Inbox", description: " Approvals & msgs" },
  { href: "/app/genome", icon: Target, label: "Genome", description: "Business DNA" },
] as const;

export function CommandSummaryCardV2({ summary }: CommandSummaryCardV2Props) {
  return (
    <div
      className="rounded-2xl p-5 sm:p-6 relative overflow-hidden border"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-primary) / 0.06) 50%, hsl(var(--kf-secondary) / 0.04) 100%)",
        borderColor: "hsl(var(--kf-border) / 0.2)",
      }}
    >
      <div className="relative flex flex-col lg:flex-row lg:items-start gap-5">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary shadow-lg">
            <Bot className="h-7 w-7 text-white" />
            <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-mint border-2 border-background" />
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-semibold text-foreground">Today&apos;s KEY Summary</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">{summary}</p>
          </div>
        </div>

        <Link
          href="/app/key/chat"
          className="inline-flex items-center justify-center gap-1.5 shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition-colors"
          style={{ background: "hsl(var(--kf-primary))", color: "hsl(var(--kf-primary-foreground, 0 0% 100%))" }}
        >
          Chat with KEY
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="relative mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="group flex items-center gap-2.5 rounded-xl border border-border/30 bg-card/40 p-2.5 transition-all hover:bg-card hover:border-border/50 hover:shadow-sm"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{action.label}</div>
                <div className="text-[10px] text-muted-foreground truncate">{action.description}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
