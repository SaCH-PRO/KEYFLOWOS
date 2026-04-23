"use client";

import { Settings, ArrowRight } from "lucide-react";
import Link from "next/link";

interface SetupModeBannerProps {
  label?: string;
  settingsHref?: string;
}

export function SetupModeBanner({
  label = "You're in Setup Mode",
  settingsHref,
}: SetupModeBannerProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm"
      style={{
        background: "hsl(var(--kf-accent2) / 0.08)",
        border: "1px solid hsl(var(--kf-accent2) / 0.2)",
      }}
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "hsl(var(--kf-accent2) / 0.15)" }}
      >
        <Settings className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
      </div>
      <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>
        {label}
      </span>
      {settingsHref && (
        <Link
          href={settingsHref}
          className="ml-auto flex items-center gap-1 text-xs font-medium transition-colors hover:opacity-80"
          style={{ color: "hsl(var(--kf-accent2))" }}
        >
          Open in Settings <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}
