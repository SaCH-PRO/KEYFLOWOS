"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Loader2, AlertTriangle, RefreshCw, Bot, BrainCircuit, Clock, Inbox, Target } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getStoredBusinessId } from "@/lib/workspace";
import { getBusinessCommandCenterSnapshot, type BusinessCommandCenterSnapshot } from "@/lib/api/business-command-center";
import { CommandHealthStrip } from "./components/command-health-strip";
import { CommandItemCard } from "./components/command-item-card";
import { CommandExecutiveModeGrid } from "./components/command-executive-mode-grid";
import { CommandGenomeCard } from "./components/command-genome-card";
import { CommandConstitutionCard } from "./components/command-constitution-card";

export default function CommandCenterPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<BusinessCommandCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusinessId(getStoredBusinessId() ?? null);
  }, []);

  const load = async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: apiError } = await getBusinessCommandCenterSnapshot(businessId);
    if (apiError || !data) {
      setError(apiError || "Failed to load command center");
      setSnapshot(null);
    } else {
      setSnapshot(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  if (loading) {
    return (
      <WorkspaceShell icon={LayoutDashboard} title="Business Command Center" subtitle="Your operating cockpit">
        <div className="rounded-2xl border border-border/40 bg-card/40 p-8 flex flex-col items-center justify-center gap-3 h-48 animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading command center...</p>
        </div>
      </WorkspaceShell>
    );
  }

  if (error || !businessId || !snapshot) {
    return (
      <WorkspaceShell icon={LayoutDashboard} title="Business Command Center" subtitle="Your operating cockpit">
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center">
          <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive">{error || "No business selected"}</p>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      icon={LayoutDashboard}
      title="Business Command Center"
      subtitle="Your operating cockpit for priorities, risks, approvals, and KEY recommendations"
      actionLabel="Refresh"
      actionIcon={RefreshCw}
      onAction={load}
    >
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
        <CommandHealthStrip health={snapshot.health} />

        <div className="rounded-2xl p-4 border border-border/30 bg-card/40 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Today&apos;s KEY Summary</h2>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">{snapshot.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <QuickLink href="/app/key-autonomy" icon={Bot} label="KEY Autonomy" />
            <QuickLink href="/app/key-modes" icon={BrainCircuit} label="KEY Modes" />
            <QuickLink href="/app/temporal-flow" icon={Clock} label="Temporal Flow" />
            <QuickLink href="/app/key-inbox" icon={Inbox} label="Key Inbox" />
            <QuickLink href="/app/profile?tab=business-genome" icon={Target} label="Business Genome" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <SectionCard title={`Top Priorities (${snapshot.topPriorities.length})`} icon={LayoutDashboard} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.topPriorities.length === 0 && (
                  <p className="text-sm text-muted-foreground">No top priorities right now.</p>
                )}
                {snapshot.topPriorities.map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title={`Pending Approvals (${snapshot.pendingApprovals.length})`} icon={AlertTriangle} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.pendingApprovals.length === 0 && (
                  <p className="text-sm text-muted-foreground">No pending approvals.</p>
                )}
                {snapshot.pendingApprovals.map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </SectionCard>

            <SectionCard title={`Urgent Items (${snapshot.urgentItems.length})`} icon={AlertTriangle} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.urgentItems.length === 0 && (
                  <p className="text-sm text-muted-foreground">No urgent Temporal Flow items.</p>
                )}
                {snapshot.urgentItems.map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-5">
            <SectionCard title="Risks" icon={AlertTriangle} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.risks.length === 0 && <p className="text-sm text-muted-foreground">No active risks.</p>}
                {snapshot.risks.slice(0, 5).map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Opportunities" icon={LayoutDashboard} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.opportunities.length === 0 && (
                  <p className="text-sm text-muted-foreground">No opportunities detected.</p>
                )}
                {snapshot.opportunities.slice(0, 5).map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </SectionCard>

            <CommandGenomeCard genome={snapshot.genome} />
            <CommandConstitutionCard constitution={snapshot.constitution} />

            <SectionCard title="Executive Modes" icon={LayoutDashboard} noPadding compact>
              <div className="p-3">
                <CommandExecutiveModeGrid modes={snapshot.executiveModes} />
              </div>
            </SectionCard>
          </div>
        </div>
      </motion.div>
    </WorkspaceShell>
  );
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 hover:bg-muted/80 text-xs font-medium text-foreground transition-colors"
    >
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      {label}
    </Link>
  );
}
