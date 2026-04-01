"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Globe,
  Copy,
  ExternalLink,
  CheckCircle2,
  MessageCircle,
  Link2,
  ShoppingBag,
  ShoppingCart,
  CheckCircle,
  Eye,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
} from "lucide-react";
import { useState, useMemo } from "react";
import type { StoreAnalytics } from "@/lib/client";

type Props = {
  businessId: string;
  storeEnabled: boolean;
  publicUrl: string;
  servicesCount: number;
  productsCount: number;
  driftedCount: number;
  analytics: StoreAnalytics | null;
  businessName?: string;
  onTabChange: (tab: string) => void;
};

export function PerformanceTab({
  businessId,
  storeEnabled,
  publicUrl,
  servicesCount,
  productsCount,
  driftedCount,
  analytics,
  businessName,
  onTabChange,
}: Props) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleWhatsApp() {
    if (!publicUrl) return;
    const text = encodeURIComponent(
      `Check out ${businessName ? businessName + "'s" : "our"} store! Browse & book: ${publicUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }

  const kpis = useMemo(() => [
    { label: "Store Items", value: servicesCount, icon: ShoppingBag },
    { label: "Products", value: productsCount, icon: ShoppingCart },
    { label: "Total Bookings", value: analytics?.bookings?.total ?? 0, icon: CheckCircle },
    { label: "Page Views", value: analytics?.storefrontEvents?.page_view ?? 0, icon: Eye },
  ], [servicesCount, productsCount, analytics]);

  return (
    <div className="space-y-6">
      <Link
        href="/app/reports?tab=revenue"
        className="kf-card p-3 flex items-center justify-between gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs font-medium">View Full Store &amp; Revenue Report</span>
          <span className="text-xs text-muted-foreground">— deep analytics, trends &amp; AI insights</span>
        </div>
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden"
        style={{
          background: "hsl(var(--kf-card))",
          border: "1px solid hsl(var(--kf-border)/0.5)",
        }}
      >
        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
              >
                <Globe className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <div>
                <h2 className="text-sm font-bold leading-tight">Store Overview</h2>
                <p className="text-[10px] text-muted-foreground">Share to get bookings & sales</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  background: storeEnabled ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
                  boxShadow: storeEnabled ? "0 0 8px hsl(var(--kf-success)/0.5)" : "none",
                }}
              />
              <span
                className="text-[11px] font-semibold"
                style={{ color: storeEnabled ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))" }}
              >
                {storeEnabled ? "Live" : "Draft"}
              </span>
            </div>
          </div>

          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{
              background: "hsl(var(--kf-background)/0.5)",
              border: "1px solid hsl(var(--kf-border)/0.4)",
            }}
          >
            <Link2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-mono text-foreground/80 truncate flex-1">
              {publicUrl || "Set up your custom URL in Storefront tab"}
            </span>
            {publicUrl && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.2)]"
                  aria-label="Copy link"
                >
                  {copied ? (
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.2)]"
                  aria-label="Open store"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                </a>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!publicUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:scale-[1.02] disabled:opacity-40 text-white"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button
              onClick={handleWhatsApp}
              disabled={!publicUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] disabled:opacity-40"
              style={{ borderColor: "hsl(var(--kf-border)/0.6)" }}
            >
              <MessageCircle className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />
              WhatsApp
            </button>
            <a
              href={publicUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)]"
              style={{
                borderColor: "hsl(var(--kf-border)/0.6)",
                opacity: publicUrl ? 1 : 0.4,
                pointerEvents: publicUrl ? "auto" : "none",
              }}
            >
              <ExternalLink className="w-3 h-3 text-muted-foreground" />
              Preview
            </a>
          </div>
        </div>
      </motion.div>

      {driftedCount > 0 && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="w-full rounded-xl px-4 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)] text-left"
          style={{
            background: "hsl(var(--kf-card))",
            border: "1px solid hsl(var(--kf-border)/0.5)",
          }}
          onClick={() => onTabChange("products")}
          aria-label={`${driftedCount} items have outdated pricing. Go to Products tab to fix.`}
        >
          <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs text-muted-foreground flex-1">
            {driftedCount} item{driftedCount !== 1 ? "s have" : " has"} outdated pricing vs Commerce
          </span>
          <ArrowRight className="w-3 h-3 text-muted-foreground" />
        </motion.button>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + idx * 0.04 }}
              className="rounded-xl px-3.5 py-3"
              style={{
                background: "hsl(var(--kf-card))",
                border: "1px solid hsl(var(--kf-border)/0.5)",
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center"
                  style={{ background: "hsl(var(--kf-accent1)/0.1)" }}
                >
                  <Icon className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
              </div>
              <p className="text-lg font-bold text-foreground pl-0.5">
                {typeof kpi.value === "number" ? kpi.value.toLocaleString() : kpi.value}
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
