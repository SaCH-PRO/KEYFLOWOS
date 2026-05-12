"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Sun,
  X,
  ChevronDown,
  ChevronUp,
  Calendar,
  DollarSign,
  Users,
  FileText,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { fetchMorningBriefing } from "@/lib/client";
import { toast } from "sonner";

function formatTTD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function getDismissKey(businessId: string): string {
  return `kf:morning-briefing:dismissed:${businessId}:${new Date().toISOString().slice(0, 10)}`;
}

function isDismissed(businessId: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(getDismissKey(businessId)) === "1";
}

function setDismissed(businessId: string) {
  localStorage.setItem(getDismissKey(businessId), "1");
}

interface MorningBriefingProps {
  businessId: string;
}

export function MorningBriefing({ businessId }: MorningBriefingProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissedState] = useState(() => isDismissed(businessId));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    revenueToday: number;
    openInvoices: number;
    activeLeads: number;
    schedule: Array<Record<string, unknown>>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMorningBriefing(businessId)
      .then((res) => {
        if (cancelled) return;
        if (res.data) setData(res.data);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("Failed to load morning briefing");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  if (dismissed) return null;
  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/50 p-4 animate-pulse">
        <div className="h-5 w-40 bg-muted rounded mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="h-16 bg-muted rounded" />
          <div className="h-16 bg-muted rounded" />
          <div className="h-16 bg-muted rounded" />
          <div className="h-16 bg-muted rounded" />
        </div>
      </div>
    );
  }
  if (!data) return null;

  const statCards = [
    {
      label: "Revenue Today",
      value: formatTTD(data.revenueToday),
      icon: DollarSign,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      onClick: () => router.push("/app/commerce"),
    },
    {
      label: "Open Invoices",
      value: String(data.openInvoices),
      icon: FileText,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      onClick: () => router.push("/app/commerce"),
    },
    {
      label: "Active Leads",
      value: String(data.activeLeads),
      icon: Users,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      onClick: () => router.push("/app/crm"),
    },
    {
      label: "Today's Events",
      value: String(data.schedule.length),
      icon: Calendar,
      color: "text-violet-500",
      bg: "bg-violet-500/10",
      onClick: () => router.push("/app/bookings"),
    },
  ];

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <Sun className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Morning Briefing</h3>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {new Date().toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground transition-colors"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => {
              setDismissedState(true);
              setDismissed(businessId);
            }}
            className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground transition-colors"
            aria-label="Dismiss for today"
            title="Dismiss for today"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {statCards.map((s) => (
              <button
                key={s.label}
                onClick={s.onClick}
                className="text-left rounded-lg border border-border/40 bg-background/50 p-3 hover:border-border/80 hover:bg-background transition-all group"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className={`p-1 rounded-md ${s.bg}`}>
                    <s.icon className={`w-3 h-3 ${s.color}`} />
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">{s.value}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            ))}
          </div>

          {data.schedule.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Upcoming Today
              </h4>
              <div className="space-y-1.5">
                {data.schedule.slice(0, 5).map((evt, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs py-1.5 px-2 rounded-md bg-muted/30"
                  >
                    <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground shrink-0">
                      {evt.occurredAt
                        ? new Date(String(evt.occurredAt)).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </span>
                    <span className="truncate">{String(evt.title ?? evt.description ?? "Event")}</span>
                  </div>
                ))}
                {data.schedule.length > 5 && (
                  <button
                    onClick={() => router.push("/app/bookings")}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left px-2"
                  >
                    +{data.schedule.length - 5} more →
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>No scheduled events for today.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
