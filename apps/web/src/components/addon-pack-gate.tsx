"use client";

import Link from "next/link";
import {
  Lock,
  ArrowLeft,
  Package,
  ShieldCheck,
  Search,
  Phone,
  BrainCircuit,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { isFeatureEnabled, type DormantFeatureFlagKey } from "@/lib/feature-flags";

interface AddonPackGateProps {
  pack: DormantFeatureFlagKey;
  title: string;
  description: string;
  features: string[];
  icon?: React.ElementType;
  children: React.ReactNode;
}

const PACK_META: Record<
  string,
  { icon: React.ElementType; color: string; bg: string; cta: string }
> = {
  agencyPack: {
    icon: Package,
    color: "hsl(var(--kf-accent1))",
    bg: "hsl(var(--kf-accent1) / 0.08)",
    cta: "Enable Agency Pack",
  },
  compliancePack: {
    icon: ShieldCheck,
    color: "hsl(150 60% 45%)",
    bg: "hsl(150 60% 45% / 0.08)",
    cta: "Enable Compliance Pack",
  },
  webPresencePack: {
    icon: Search,
    color: "hsl(270 60% 55%)",
    bg: "hsl(270 60% 55% / 0.08)",
    cta: "Enable Web Presence Pack",
  },
  salesPack: {
    icon: Phone,
    color: "hsl(200 70% 50%)",
    bg: "hsl(200 70% 50% / 0.08)",
    cta: "Enable Sales Pack",
  },
  blueprintPostOnboard: {
    icon: BrainCircuit,
    color: "hsl(45 90% 55%)",
    bg: "hsl(45 90% 55% / 0.08)",
    cta: "Re-open Blueprint",
  },
};

export function AddonPackGate({
  pack,
  title,
  description,
  features,
  children,
}: AddonPackGateProps) {
  if (isFeatureEnabled(pack)) {
    return <>{children}</>;
  }

  const meta = PACK_META[pack] ?? {
    icon: Sparkles,
    color: "hsl(var(--kf-accent2))",
    bg: "hsl(var(--kf-accent2) / 0.08)",
    cta: "Contact Support",
  };
  const Icon = meta.icon;

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full text-center space-y-6">
        <div
          className="mx-auto h-16 w-16 rounded-2xl flex items-center justify-center border"
          style={{ background: meta.bg, borderColor: `${meta.color}20` }}
        >
          <Icon className="h-7 w-7" style={{ color: meta.color }} />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Add-on Pack
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {description}
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/50 p-5 text-left space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What&apos;s included
          </p>
          <ul className="space-y-2">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: meta.color }} />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/app/settings/business?tab=billing"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all hover:scale-[1.02] min-h-[44px] min-w-[140px]"
            style={{ background: meta.color, color: "hsl(var(--kf-foreground))" }}
          >
            {meta.cta}
          </Link>
          <Link
            href="/app/keyflow-command"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-4 py-2.5 text-sm font-medium text-foreground/80 hover:bg-muted/70 transition-colors min-h-[44px]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Cockpit
          </Link>
        </div>

        <p className="text-[11px] text-muted-foreground/70">
          Add-on packs can be enabled from Settings → Billing or by contacting your account manager.
        </p>
      </div>
    </div>
  );
}
