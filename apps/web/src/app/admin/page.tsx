"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Users, Building2, Zap, MessageSquare, Activity } from "lucide-react";
import { fetchAdminOverview, fetchAdminActivationFunnel, fetchAdminIntegrationHealth } from "@/lib/api/admin-analytics";
import type { PlatformOverview, ActivationFunnel, IntegrationHealth } from "@/lib/api/admin-analytics";

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border/70 bg-slate-950/70 p-4 shadow-soft-elevated"
    >
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground uppercase tracking-[0.12em]">{label}</div>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </motion.div>
  );
}

function FunnelBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value.toLocaleString()}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400"
        />
      </div>
    </div>
  );
}

export default function AdminHome() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [funnel, setFunnel] = useState<ActivationFunnel | null>(null);
  const [health, setHealth] = useState<IntegrationHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [o, f, h] = await Promise.all([
          fetchAdminOverview(),
          fetchAdminActivationFunnel(30),
          fetchAdminIntegrationHealth(),
        ]);
        if (o.data) setOverview(o.data);
        if (f.data) setFunnel(f.data);
        if (h.data) setHealth(h.data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const metrics = overview
    ? [
        { label: "Total Users", value: overview.totalUsers.toLocaleString(), icon: Users, color: "text-blue-400" },
        { label: "Businesses", value: overview.totalBusinesses.toLocaleString(), icon: Building2, color: "text-emerald-400" },
        { label: "Commands", value: overview.totalCommands.toLocaleString(), icon: Zap, color: "text-amber-400" },
        { label: "Feedback", value: overview.totalFeedback.toLocaleString(), icon: MessageSquare, color: "text-purple-400" },
      ]
    : [];

  const funnelMax = funnel
    ? Math.max(
        funnel.milestones.contactCreated,
        funnel.milestones.productCreated,
        funnel.milestones.invoiceCreated,
        funnel.milestones.quoteCreated,
        funnel.milestones.paymentReceived,
        1,
      )
    : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overwatch</h1>
        <p className="text-sm text-muted-foreground">
          Platform-wide visibility across users, businesses, revenue, and automations.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl border border-border/70 bg-slate-950/70 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <MetricCard key={m.label} {...m} />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Activation Funnel */}
        <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Activation Funnel (30d)</h3>
              <p className="text-xs text-muted-foreground">Key business milestones reached</p>
            </div>
            <span className="text-[11px] rounded-full bg-primary/10 border border-primary/40 px-2 py-1 text-primary">
              Live
            </span>
          </div>
          {funnel ? (
            <div className="space-y-3">
              <FunnelBar label="Contacts created" value={funnel.milestones.contactCreated} max={funnelMax} />
              <FunnelBar label="Products created" value={funnel.milestones.productCreated} max={funnelMax} />
              <FunnelBar label="Invoices created" value={funnel.milestones.invoiceCreated} max={funnelMax} />
              <FunnelBar label="Quotes created" value={funnel.milestones.quoteCreated} max={funnelMax} />
              <FunnelBar label="Payments received" value={funnel.milestones.paymentReceived} max={funnelMax} />
              <FunnelBar label="Storefront published" value={funnel.milestones.storefrontPublished} max={funnelMax} />
              <FunnelBar label="KEY commands used" value={funnel.milestones.keyCommandUsed} max={funnelMax} />
              <FunnelBar label="Integrations connected" value={funnel.milestones.integrationConnected} max={funnelMax} />
            </div>
          ) : (
            <div className="h-48 rounded-xl border border-border/60 bg-slate-900/50 flex items-center justify-center text-xs text-muted-foreground">
              No funnel data yet
            </div>
          )}
        </div>

        {/* Integration Health */}
        <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Integration Health</h3>
              <p className="text-xs text-muted-foreground">Connected apps and sync status</p>
            </div>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </div>

          {health ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-center">
                  <div className="text-lg font-semibold text-emerald-400">{health.healthy}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Healthy</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-center">
                  <div className="text-lg font-semibold text-amber-400">{health.needsAttention}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Attention</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-center">
                  <div className="text-lg font-semibold text-blue-400">{health.totalProviders}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Providers</div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Syncs</p>
                {health.recentSyncs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No sync runs yet</p>
                ) : (
                  health.recentSyncs.slice(0, 5).map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs rounded-lg border border-border/40 bg-slate-900/50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${s.status === 'SUCCESS' ? 'bg-emerald-400' : s.status === 'FAILED' ? 'bg-red-400' : 'bg-amber-400'}`} />
                        <span className="font-medium">{s.providerKey}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {s.recordsCreated > 0 && `+${s.recordsCreated} `}
                        {s.error ? <span className="text-red-400">Failed</span> : s.status}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="h-48 rounded-xl border border-border/60 bg-slate-900/50 flex items-center justify-center text-xs text-muted-foreground">
              No integration data yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
