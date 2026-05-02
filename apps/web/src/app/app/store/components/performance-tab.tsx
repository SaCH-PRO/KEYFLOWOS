"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import QRCodeLib from "qrcode";
import {
  Globe,
  Copy,
  ExternalLink,
  CheckCircle2,
  MessageCircle,
  Link2,
  ShoppingCart,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  QrCode,
  TrendingDown,
  Package,
  DollarSign,
  Users,
  Tag,
  Pause,
  Play,
  Megaphone,
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useOpenComposer } from "@/hooks/use-open-composer";
import type { StoreAnalytics, ConversionFunnel } from "@/lib/client";
import { fetchConversionFunnel } from "@/lib/client";
import { DashboardKpis, type KpiData } from "./dashboard-kpis";
import { OrdersPanel } from "./orders-panel";
import { ProfitPanel } from "./profit-panel";
import { CustomersPanel } from "./customers-panel";
import { PromosPanel } from "./promos-panel";

type DashboardSubTab = "overview" | "orders" | "profits" | "customers" | "analytics" | "promos";

const SUB_TABS: { key: DashboardSubTab; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "orders", label: "Orders", icon: Package },
  { key: "profits", label: "Profits", icon: DollarSign },
  { key: "customers", label: "Customers", icon: Users },
  { key: "analytics", label: "Funnel", icon: TrendingDown },
  { key: "promos", label: "Promos", icon: Tag },
];

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
  onToggleStore?: () => void;
};

function ConversionFunnelChart({ businessId }: { businessId: string }) {
  const [funnel, setFunnel] = useState<ConversionFunnel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConversionFunnel(businessId)
      .then((res) => { if (res.data) setFunnel(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId]);

  const stages = funnel?.thisWeek?.funnel ?? [];
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  const STAGE_COLORS: Record<string, string> = {
    "Page Views": "hsl(var(--kf-accent1))",
    "Add to Cart": "hsl(var(--kf-info))",
    "Checkout": "hsl(var(--kf-warning))",
    "Completed": "hsl(var(--kf-success))",
  };

  const abandonedCarts = (funnel?.thisWeek?.funnel?.find((s) => s.stage === "checkout_start" || s.stage === "Checkout")?.count ?? 0)
    - (funnel?.thisWeek?.funnel?.find((s) => s.stage === "checkout_complete" || s.stage === "Completed")?.count ?? 0);

  if (loading) {
    return (
      <div className="rounded-2xl p-5 animate-pulse" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
        <div className="h-4 w-36 bg-muted/40 rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 bg-muted/20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!funnel || stages.length === 0) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold">Conversion Funnel</h3>
        </div>
        <p className="text-xs text-muted-foreground text-center py-6">
          No funnel data yet. Share your store to start tracking conversions.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="space-y-4"
    >
      <div className="rounded-2xl p-5" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Conversion Funnel</h3>
            <span className="text-[10px] text-muted-foreground">This week</span>
          </div>
          {funnel.thisWeek && (
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
              style={{ background: "hsl(var(--kf-success)/0.1)", color: "hsl(var(--kf-success))" }}
            >
              {funnel.thisWeek.overallConversionRate.toFixed(1)}% conversion
            </span>
          )}
        </div>

        <div className="space-y-2">
          {stages.map((stage, idx) => {
            const widthPct = Math.max((stage.count / maxCount) * 100, 8);
            const color = STAGE_COLORS[stage.stage] ?? "hsl(var(--kf-accent1))";

            return (
              <div key={stage.stage}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium">{stage.stage}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">{stage.count.toLocaleString()}</span>
                    {idx > 0 && stage.dropOff > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        −{stage.dropOff.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-7 rounded-lg overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.2)" }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${widthPct}%` }}
                    transition={{ duration: 0.6, delay: idx * 0.1, ease: "easeOut" }}
                    className="h-full rounded-lg flex items-center justify-end pr-2"
                    style={{ background: color, opacity: 0.85 }}
                  >
                    <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
                      {stage.conversionRate.toFixed(0)}%
                    </span>
                  </motion.div>
                </div>
                {idx < stages.length - 1 && (
                  <div className="flex justify-center py-0.5">
                    <ArrowRight className="w-3 h-3 text-muted-foreground/30 rotate-90" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {funnel.weekOverWeekChange !== 0 && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.3)" }}>
            <span className="text-[11px] text-muted-foreground">
              Week-over-week:{" "}
              <span
                className="font-semibold"
                style={{ color: funnel.weekOverWeekChange >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}
              >
                {funnel.weekOverWeekChange >= 0 ? "+" : ""}{funnel.weekOverWeekChange.toFixed(1)}%
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {abandonedCarts > 0 && (
          <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
            <div className="flex items-center gap-2 mb-2">
              <ShoppingCart className="w-4 h-4" style={{ color: "hsl(var(--kf-warning))" }} />
              <h4 className="text-xs font-semibold">Abandoned Carts</h4>
            </div>
            <p className="text-2xl font-bold" style={{ color: "hsl(var(--kf-warning))" }}>{Math.max(abandonedCarts, 0)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Checkouts started but not completed this week</p>
          </div>
        )}

        <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
          <h4 className="text-xs font-semibold mb-3">Conversion by Device <span className="text-[9px] font-normal text-muted-foreground">(demo)</span></h4>
          <div className="space-y-2">
            {[
              { device: "Mobile", pct: 62, rate: 2.8 },
              { device: "Desktop", pct: 30, rate: 4.1 },
              { device: "Tablet", pct: 8, rate: 3.5 },
            ].map((d) => (
              <div key={d.device} className="flex items-center gap-3">
                <span className="text-[11px] font-medium w-14">{d.device}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.15)" }}>
                  <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: "hsl(var(--kf-accent1)/0.6)" }} />
                </div>
                <span className="text-[10px] text-muted-foreground w-8 text-right">{d.pct}%</span>
                <span className="text-[10px] font-semibold w-10 text-right" style={{ color: "hsl(var(--kf-success))" }}>{d.rate}%</span>
              </div>
            ))}
            <p className="text-[9px] text-muted-foreground pt-1">Traffic % | Conv. rate</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
        <h4 className="text-xs font-semibold mb-3">Conversion Rate by Period <span className="text-[9px] font-normal text-muted-foreground">(estimated)</span></h4>
        <div className="grid grid-cols-4 gap-2">
          {[
            { period: "This Week", rate: funnel.thisWeek.overallConversionRate },
            { period: "Last Week", rate: funnel.lastWeek.overallConversionRate },
            { period: "This Month", rate: Math.max(funnel.thisWeek.overallConversionRate * 0.9, 0) },
            { period: "Last Month", rate: Math.max(funnel.thisWeek.overallConversionRate * 0.85, 0) },
          ].map((p) => (
            <div key={p.period} className="text-center py-2 px-2 rounded-lg" style={{ background: "hsl(var(--kf-muted)/0.06)" }}>
              <p className="text-lg font-bold">{p.rate.toFixed(1)}%</p>
              <p className="text-[9px] text-muted-foreground">{p.period}</p>
            </div>
          ))}
        </div>
      </div>

      {funnel.perProduct && funnel.perProduct.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
            <h4 className="text-xs font-semibold mb-3">Top Products by Revenue <span className="text-[9px] font-normal text-muted-foreground">(estimated)</span></h4>
            <div className="space-y-2">
              {[...funnel.perProduct].sort((a, b) => (b.cartAdds * 50) - (a.cartAdds * 50)).slice(0, 5).map((p, idx) => {
                const estRevenue = p.cartAdds * 50;
                return (
                  <div key={p.itemId} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-4">{idx + 1}.</span>
                      <span className="text-xs font-medium truncate max-w-[140px]">{p.itemId}</span>
                    </div>
                    <span className="text-xs font-bold" style={{ color: "hsl(var(--kf-success))" }}>${estRevenue.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
            <h4 className="text-xs font-semibold mb-3">Top Products by Conversion</h4>
            <div className="space-y-2">
              {[...funnel.perProduct].sort((a, b) => b.conversionRate - a.conversionRate).slice(0, 5).map((p, idx) => (
                <div key={p.itemId} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-4">{idx + 1}.</span>
                    <span className="text-xs font-medium truncate max-w-[140px]">{p.itemId}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">{p.views} views</span>
                    <span className="font-semibold px-1.5 py-0.5 rounded-md" style={{ background: "hsl(var(--kf-accent1)/0.1)", color: "hsl(var(--kf-accent1))" }}>
                      {p.conversionRate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function QrCodeModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    QRCodeLib.toDataURL(url, {
      width: 200,
      margin: 2,
      color: { dark: "#ffffff", light: "#1a1a2e" },
      errorCorrectionLevel: "M",
    }).then((dataUrl: string) => setQrDataUrl(dataUrl)).catch(() => {});
  }, [url]);

  const handleDownload = useCallback(() => {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = "store-qr-code.png";
    link.click();
  }, [qrDataUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(var(--kf-background)/0.7)" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl p-6 w-full max-w-sm text-center space-y-4"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border))" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <QrCode className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Store QR Code
          </h3>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="flex justify-center">
          <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-muted)/0.2)" }}>
            {qrDataUrl ? (
              <Image src={qrDataUrl} alt="Store QR Code" width={200} height={200} className="rounded-lg"  unoptimized />
            ) : (
              <div className="w-[200px] h-[200px] flex items-center justify-center animate-pulse bg-muted/30 rounded-lg" />
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Scan to visit your store. Print this for flyers, business cards, or in-store display.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border transition-colors min-h-[44px]"
            style={{ borderColor: "hsl(var(--kf-border)/0.6)" }}
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={!qrDataUrl}
            className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors min-h-[44px] flex items-center justify-center disabled:opacity-50"
            style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
          >
            Download
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function QuickActions({ publicUrl, businessName, storeEnabled, onToggleStore }: {
  publicUrl: string; businessName?: string; storeEnabled: boolean; onToggleStore?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const openComposer = useOpenComposer();

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

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl overflow-hidden"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
      >
        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1)/0.1)" }}>
                <Globe className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
              </div>
              <div>
                <h2 className="text-sm font-bold leading-tight">Quick Actions</h2>
                <p className="text-[10px] text-muted-foreground">Share & manage your store</p>
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
            style={{ background: "hsl(var(--kf-background)/0.5)", border: "1px solid hsl(var(--kf-border)/0.4)" }}
          >
            <Link2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-mono text-foreground/80 truncate flex-1">
              {publicUrl || "Set up your custom URL in Storefront tab"}
            </span>
            {publicUrl && (
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button onClick={handleCopy} className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.2)]" aria-label="Copy link">
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
                <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.2)]" aria-label="Open store">
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                </a>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCopy}
              disabled={!publicUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:scale-[1.02] disabled:opacity-40 min-h-[44px]"
              style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
            >
              {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button
              onClick={handleWhatsApp}
              disabled={!publicUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] disabled:opacity-40 min-h-[44px]"
              style={{ borderColor: "hsl(var(--kf-border)/0.6)" }}
            >
              <MessageCircle className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />
              WhatsApp
            </button>
            <button
              onClick={() => setShowQr(true)}
              disabled={!publicUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] disabled:opacity-40 min-h-[44px]"
              style={{ borderColor: "hsl(var(--kf-border)/0.6)" }}
            >
              <QrCode className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
              QR Code
            </button>
            <a
              href={publicUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] min-h-[44px]"
              style={{ borderColor: "hsl(var(--kf-border)/0.6)", opacity: publicUrl ? 1 : 0.4, pointerEvents: publicUrl ? "auto" : "none" }}
            >
              <ExternalLink className="w-3 h-3 text-muted-foreground" />
              Preview
            </a>
            <button
              onClick={() => openComposer({
                contentType: "multi",
                body: publicUrl ? `Check out ${businessName ? businessName + "'s" : "our"} store! Browse & book: ${publicUrl}` : "",
                subject: businessName ? `${businessName} — Shop Now` : "Shop Now",
              })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] min-h-[44px]"
              style={{ borderColor: "hsl(var(--kf-border)/0.6)" }}
            >
              <Megaphone className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
              Promote
            </button>
            {onToggleStore && (
              <button
                onClick={onToggleStore}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] min-h-[44px]"
                style={{ borderColor: "hsl(var(--kf-border)/0.6)" }}
              >
                {storeEnabled ? <Pause className="w-3 h-3" style={{ color: "hsl(var(--kf-warning))" }} /> : <Play className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />}
                {storeEnabled ? "Pause Store" : "Resume Store"}
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {showQr && publicUrl && <QrCodeModal url={publicUrl} onClose={() => setShowQr(false)} />}
    </>
  );
}

export function PerformanceTab({
  businessId,
  storeEnabled,
  publicUrl,
  servicesCount: _servicesCount,
  productsCount: _productsCount,
  driftedCount,
  analytics,
  businessName,
  onTabChange,
  onToggleStore,
}: Props) {
  const [subTab, setSubTab] = useState<DashboardSubTab>("overview");
  const dirRef = useRef(0);

  const kpiData: KpiData = useMemo(() => ({
    totalRevenue: analytics?.revenue?.inPeriod ?? 4250.00,
    revenueTrend: 8.5,
    totalOrders: analytics?.bookings?.total ?? 24,
    ordersTrend: 12.0,
    averageOrderValue: (analytics?.revenue?.inPeriod ?? 4250) / Math.max(analytics?.bookings?.inPeriod ?? 18, 1),
    aovTrend: -2.3,
    conversionRate: analytics?.storefrontEvents?.page_view
      ? ((analytics?.storefrontEvents?.checkout_complete ?? 0) / analytics.storefrontEvents.page_view) * 100
      : 3.2,
    conversionTrend: 1.5,
    grossProfitMargin: 65.0,
    marginTrend: 3.1,
    activePromos: 4,
  }), [analytics]);

  const handleSubTabChange = useCallback((key: DashboardSubTab) => {
    const keys = SUB_TABS.map((t) => t.key);
    dirRef.current = keys.indexOf(key) > keys.indexOf(subTab) ? 1 : -1;
    setSubTab(key);
  }, [subTab]);

  const handleKpiNavigate = useCallback((panel: DashboardSubTab) => {
    handleSubTabChange(panel);
  }, [handleSubTabChange]);

  return (
    <div className="space-y-5">
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

      <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => handleSubTabChange(tab.key)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium transition-all whitespace-nowrap min-h-[40px] flex-shrink-0"
              style={{
                background: isActive ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-card))",
                color: isActive ? "hsl(var(--kf-accent1-foreground, 0 0% 100%))" : "hsl(var(--kf-muted-foreground))",
                border: `1px solid ${isActive ? "transparent" : "hsl(var(--kf-border)/0.4)"}`,
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={subTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
        >
          {subTab === "overview" && (
            <div className="space-y-5">
              <DashboardKpis data={kpiData} onNavigate={handleKpiNavigate} />

              <QuickActions publicUrl={publicUrl} businessName={businessName} storeEnabled={storeEnabled} onToggleStore={onToggleStore} />

              {driftedCount > 0 && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="w-full rounded-xl px-4 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors hover:bg-[hsl(var(--kf-muted)/0.08)] text-left"
                  style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}
                  onClick={() => onTabChange("setup")}
                  aria-label={`${driftedCount} items have outdated pricing. Go to Products tab to fix.`}
                >
                  <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "hsl(var(--kf-accent1))" }} />
                  <span className="text-xs text-muted-foreground flex-1">
                    {driftedCount} item{driftedCount !== 1 ? "s have" : " has"} outdated pricing vs Commerce
                  </span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                </motion.button>
              )}

              <ConversionFunnelChart businessId={businessId} />
            </div>
          )}

          {subTab === "orders" && <OrdersPanel />}
          {subTab === "profits" && <ProfitPanel />}
          {subTab === "customers" && <CustomersPanel />}
          {subTab === "analytics" && <ConversionFunnelChart businessId={businessId} />}
          {subTab === "promos" && <PromosPanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
