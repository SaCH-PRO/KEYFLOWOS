"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Users, Mail, ShieldOff, CheckCircle, Tag, TrendingUp,
  RefreshCw, Search, ArrowRight, BarChart3, AlertTriangle,
} from "lucide-react";
import { getAudienceHealth } from "@/lib/client";
import type { AudienceHealthResult } from "@/lib/client";
import { useRouter } from "next/navigation";

interface AudienceHealthDashboardProps {
  businessId: string | null;
  onCreateCampaign?: () => void;
}

export function AudienceHealthDashboard({ businessId, onCreateCampaign }: AudienceHealthDashboardProps) {
  const router = useRouter();
  const [data, setData] = useState<AudienceHealthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await getAudienceHealth(businessId);
      if (res.data) setData(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  const filteredSegments = useMemo(() => {
    if (!data?.segments) return [];
    if (!search.trim()) return data.segments;
    const q = search.toLowerCase();
    return data.segments.filter((s) => s.tag.toLowerCase().includes(q));
  }, [data?.segments, search]);

  if (loading) {
    return (
      <div className="kf-card p-6 text-center">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Loading audience health...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="kf-card p-6 text-center">
        <Users className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">No audience data available</p>
      </div>
    );
  }

  const coverageColor = data.emailCoverage >= 80 ? "text-emerald-400" : data.emailCoverage >= 50 ? "text-amber-400" : "text-red-400";
  const deliverabilityColor = data.deliverabilityRate >= 90 ? "text-emerald-400" : data.deliverabilityRate >= 70 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kf-card p-3 text-center">
          <Users className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
          <p className="text-xl font-bold tabular-nums">{data.totalContacts}</p>
          <p className="text-[10px] text-muted-foreground">Total Contacts</p>
        </div>
        <div className="kf-card p-3 text-center">
          <Mail className="w-4 h-4 mx-auto mb-1" style={{ color: "hsl(var(--kf-accent1))" }} />
          <p className="text-xl font-bold tabular-nums">{data.withEmail}</p>
          <p className="text-[10px] text-muted-foreground">With Email</p>
          <p className={`text-[9px] font-medium ${coverageColor}`}>{data.emailCoverage}% coverage</p>
        </div>
        <div className="kf-card p-3 text-center">
          <CheckCircle className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
          <p className="text-xl font-bold tabular-nums text-emerald-400">{data.optedIn}</p>
          <p className="text-[10px] text-muted-foreground">Email-Ready</p>
          <p className={`text-[9px] font-medium ${deliverabilityColor}`}>{data.deliverabilityRate}% deliverable</p>
        </div>
        <div className="kf-card p-3 text-center">
          <ShieldOff className="w-4 h-4 mx-auto mb-1 text-amber-400" />
          <p className={`text-xl font-bold tabular-nums ${data.suppressed > 0 ? "text-amber-400" : ""}`}>{data.suppressed}</p>
          <p className="text-[10px] text-muted-foreground">Suppressed</p>
          {data.suppressed > 0 && (
            <p className="text-[9px] text-amber-400/60">Opted out / DNC</p>
          )}
        </div>
      </div>

      {data.emailCoverage < 50 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Low email coverage ({data.emailCoverage}%). Many contacts are missing email addresses. Update contacts in CRM to improve campaign reach.</span>
        </div>
      )}

      <div className="kf-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            <h3 className="text-sm font-semibold">Audience Segments</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{data.segments.length} segment{data.segments.length !== 1 ? "s" : ""}</span>
            <button onClick={load} className="p-1 rounded hover:bg-muted/20 transition-colors">
              <RefreshCw className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        </div>

        {data.segments.length > 5 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter segments..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/30 border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
        )}

        {filteredSegments.length === 0 ? (
          <div className="py-6 text-center">
            <Tag className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No segments yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Tag contacts in CRM to create audience segments</p>
          </div>
        ) : (
          <div className="space-y-1 max-h-[320px] overflow-y-auto">
            {filteredSegments.map((seg) => {
              const pct = data.totalContacts > 0 ? Math.round((seg.count / data.totalContacts) * 100) : 0;
              return (
                <div key={seg.tag} className="group">
                  <button
                    onClick={() => router.push(`/app/crm?filter=tag:${encodeURIComponent(seg.tag)}`)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-muted/30 transition-colors"
                  >
                    <Tag className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-medium flex-1 truncate">{seg.tag}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-border/20 overflow-hidden">
                        <div className="h-full rounded-full bg-[hsl(var(--kf-accent2))]" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{seg.count}</span>
                      <span className="text-[10px] text-muted-foreground/50 w-8 text-right">{pct}%</span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {data.segments.length > 0 && onCreateCampaign && (
          <div className="pt-2 border-t border-border/20">
            <button
              onClick={onCreateCampaign}
              className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              Send campaign to a segment
            </button>
          </div>
        )}
      </div>

      <div className="kf-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Deliverability Overview</h3>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Email Coverage</span>
            <span className={`font-medium ${coverageColor}`}>{data.emailCoverage}%</span>
          </div>
          <div className="h-2 rounded-full bg-border/20 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${data.emailCoverage >= 80 ? "bg-emerald-400" : data.emailCoverage >= 50 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${data.emailCoverage}%` }} />
          </div>

          <div className="flex items-center justify-between text-xs mt-2">
            <span className="text-muted-foreground">Deliverability Rate</span>
            <span className={`font-medium ${deliverabilityColor}`}>{data.deliverabilityRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-border/20 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${data.deliverabilityRate >= 90 ? "bg-emerald-400" : data.deliverabilityRate >= 70 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${data.deliverabilityRate}%` }} />
          </div>

          <div className="flex items-center gap-4 pt-2 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Good ({"\u2265"}80%)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Fair (50-79%)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span>Low ({"<"}50%)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
