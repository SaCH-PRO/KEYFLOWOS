"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Copy, Check, Globe, Settings } from "lucide-react";
import { toast } from "sonner";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface ServiceLinkData {
  slug: string | null;
  storeEnabled: boolean;
  publicUrl: string | null;
}

async function loadServiceLink(businessId: string): Promise<ServiceLinkData> {
  const res = await apiGet<{ slug?: string | null; storeEnabled?: boolean; metaData?: Record<string, unknown> }>(
    `/identity/businesses/${businessId}`,
  );
  const slug = (res.data?.slug ?? null) || null;
  const meta = (res.data?.metaData as Record<string, unknown> | undefined) ?? {};
  const storeEnabled = (meta.storeEnabled as boolean | undefined) ?? !!res.data?.storeEnabled;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const identifier = slug || businessId;
  const publicUrl = identifier ? `${origin}/book/${identifier}` : null;
  return { slug, storeEnabled, publicUrl };
}

export function ServiceLinkWidget({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<ServiceLinkData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    loadServiceLink(businessId).then(setData).catch(() => setData({ slug: null, storeEnabled: false, publicUrl: null }));
  }, []);

  const copy = async () => {
    if (!data?.publicUrl) return;
    try {
      await navigator.clipboard.writeText(data.publicUrl);
      setCopied(true);
      toast.success("Service link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy link");
    }
  };

  if (!data) return null;

  if (!data.storeEnabled || !data.publicUrl) {
    return (
      <Link
        href="/app/store"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors"
        style={{
          background: "hsl(var(--kf-warning) / 0.08)",
          color: "hsl(var(--kf-warning))",
          borderColor: "hsl(var(--kf-warning) / 0.2)",
        }}
        title="Customize and publish your storefront to share your service link"
      >
        <Settings className="w-3 h-3" />
        Set up Service Link
      </Link>
    );
  }

  const display = data.publicUrl.replace(/^https?:\/\//, "");

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px]"
        style={{ background: "hsl(var(--kf-muted) / 0.12)", borderColor: "hsl(var(--kf-border) / 0.5)" }}>
        <Globe className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="font-medium truncate max-w-[180px]" title={data.publicUrl}>{display}</span>
        <button
          onClick={copy}
          className="p-0.5 rounded hover:bg-muted/30 transition-colors"
          title="Copy service link"
          aria-label="Copy service link"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
        </button>
        <a
          href={data.publicUrl}
          target="_blank"
          rel="noreferrer"
          className="p-0.5 rounded hover:bg-muted/30 transition-colors"
          title="Open service link"
          aria-label="Open service link"
        >
          <ExternalLink className="w-3 h-3 text-muted-foreground" />
        </a>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-xl border"
      style={{ background: "hsl(var(--kf-muted) / 0.08)", borderColor: "hsl(var(--kf-border) / 0.5)" }}
    >
      <div className="p-1.5 rounded-lg shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
        <Globe className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Your Service Link</div>
        <div className="text-xs font-medium truncate" title={data.publicUrl}>{display}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors"
          style={{
            background: copied ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--card))",
            color: copied ? "hsl(var(--kf-success))" : "hsl(var(--muted-foreground))",
            borderColor: "hsl(var(--kf-border) / 0.5)",
          }}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          href={data.publicUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors"
          style={{ background: "hsl(var(--card))", color: "hsl(var(--muted-foreground))", borderColor: "hsl(var(--kf-border) / 0.5)" }}
        >
          <ExternalLink className="w-3 h-3" />
          Open
        </a>
      </div>
    </div>
  );
}
