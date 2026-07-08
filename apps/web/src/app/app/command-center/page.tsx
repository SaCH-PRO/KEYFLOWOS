"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Loader2, AlertTriangle, RefreshCw, Bot, BrainCircuit, Clock, Inbox, Target, TrendingUp, ShieldCheck, Zap } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getStoredBusinessId, ensureWorkspace } from "@/lib/workspace";
import { getBusinessCommandCenterSnapshot, type BusinessCommandCenterSnapshot } from "@/lib/api/business-command-center";
import {
  fetchCommandItems,
  completeCommandItem,
  approveCommandItem,
  executeCommandItem,
  assignCommandItem,
  dismissCommandItem,
  snoozeCommandItem,
  reopenCommandItem,
  type CommandItem,
} from "@/lib/api/command";
import { CommandQueue } from "@/components/command/command-queue";
import { CommandHealthStrip } from "./components/command-health-strip";
import { BusinessPulseCard } from "@/components/business-pulse-card";
import { KeyBriefingCard } from "./components/key-briefing-card";
import { GovernanceSummaryCard } from "./components/governance-summary-card";
import { CommandItemCard } from "./components/command-item-card";
import { CommandExecutiveModeGrid } from "./components/command-executive-mode-grid";
import { CommandGenomeCard } from "./components/command-genome-card";
import { CommandKeyGenomeCard } from "./components/command-key-genome-card";
import { CommandModuleReadinessPanel } from "./components/command-module-readiness-panel";
import { CommandConstitutionCard } from "./components/command-constitution-card";
import { CrossDomainPanel } from "./components/cross-domain-panel";
import { CommandGenomeOutcomesCard } from "./components/command-genome-outcomes-card";
import { NudgesWidget } from "./components/nudges-widget";

export default function CommandCenterPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<BusinessCommandCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [commandItems, setCommandItems] = useState<CommandItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueLoading, setQueueLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const resolveBusinessId = async () => {
      const stored = getStoredBusinessId() ?? null;
      if (stored) {
        if (!cancelled) setBusinessId(stored);
        return;
      }
      const resolved = await ensureWorkspace();
      if (!cancelled) setBusinessId(resolved);
    };
    void resolveBusinessId();
    return () => { cancelled = true; };
  }, []);

  const loadSnapshot = async () => {
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

  const loadQueue = async () => {
    if (!businessId) return;
    setQueueLoading(true);
    try {
      const { data } = await fetchCommandItems(businessId, { status: "OPEN", limit: 50 });
      setCommandItems(data?.items ?? []);
      setQueueTotal(data?.total ?? 0);
    } finally {
      setQueueLoading(false);
    }
  };

  useEffect(() => {
    void loadSnapshot();
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const handleComplete = async (id: string) => {
    if (!businessId) return;
    await completeCommandItem(businessId, id);
    await loadQueue();
  };

  const handleApprove = async (id: string) => {
    if (!businessId) return;
    await approveCommandItem(businessId, id);
    await loadQueue();
  };

  const handleExecute = async (id: string) => {
    if (!businessId) return;
    await executeCommandItem(businessId, id);
    await loadQueue();
  };

  const handleAssign = async (id: string) => {
    if (!businessId) return;
    await assignCommandItem(businessId, id, "USER", "me");
    await loadQueue();
  };

  const handleDismiss = async (id: string) => {
    if (!businessId) return;
    await dismissCommandItem(businessId, id);
    await loadQueue();
  };

  const handleSnooze = async (id: string) => {
    if (!businessId) return;
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await snoozeCommandItem(businessId, id, until);
    await loadQueue();
  };

  const handleReopen = async (id: string) => {
    if (!businessId) return;
    await reopenCommandItem(businessId, id);
    await loadQueue();
  };

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
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center flex flex-col items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-destructive" />
          <p className="text-sm text-destructive">{error || "No business selected"}</p>
          {(error || businessId) && (
            <button
              type="button"
              onClick={() => { void loadSnapshot(); void loadQueue(); }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          )}
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
      onAction={() => { void loadSnapshot(); void loadQueue(); }}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BusinessPulseCard
            overallScore={snapshot.pulse.overallScore}
            dimensions={snapshot.pulse.dimensions}
          />
          <KeyBriefingCard briefing={snapshot.briefing} />
          <GovernanceSummaryCard governance={snapshot.governance} />
        </div>

        <SectionCard title={`Command Queue (${queueTotal})`} icon={LayoutDashboard} noPadding compact>
          <div className="p-3">
            <CommandQueue
              items={commandItems}
              total={queueTotal}
              loading={queueLoading}
              onRefresh={loadQueue}
              onComplete={handleComplete}
              onApprove={handleApprove}
              onExecute={handleExecute}
              onAssign={handleAssign}
              onDismiss={handleDismiss}
              onSnooze={handleSnooze}
              onReopen={handleReopen}
            />
          </div>
        </SectionCard>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <SectionCard title={`Top Priorities (${snapshot.topPriorities.length})`} icon={LayoutDashboard} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.topPriorities.length === 0 && (
                  <EmptyState
                    icon={Target}
                    title="No top priorities right now"
                    description="KEY hasn't surfaced anything urgent. Ask KEY to scan for priorities."
                    actionLabel="Ask KEY for priorities"
                    actionIcon={Bot}
                    onAction={() => router.push("/app/key-modes")}
                    variant="compact"
                  />
                )}
                {snapshot.topPriorities.map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title={`Pending Approvals (${snapshot.pendingApprovals.length})`} icon={AlertTriangle} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.pendingApprovals.length === 0 && (
                  <EmptyState
                    icon={Inbox}
                    title="No pending approvals"
                    description="You're all caught up. Approvals appear when KEY recommends actions that need your sign-off."
                    variant="compact"
                    tip="Check back after KEY runs its next business scan."
                  />
                )}
                {snapshot.pendingApprovals.map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </SectionCard>

            <SectionCard title={`Urgent Items (${snapshot.urgentItems.length})`} icon={AlertTriangle} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.urgentItems.length === 0 && (
                  <EmptyState
                    icon={Clock}
                    title="No urgent Temporal Flow items"
                    description="Your calendar and deadlines look clear."
                    actionLabel="Go to Temporal Flow"
                    actionIcon={BrainCircuit}
                    onAction={() => router.push("/app/temporal-flow")}
                    variant="compact"
                  />
                )}
                {snapshot.urgentItems.map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-5">
            <NudgesWidget businessId={businessId} />

            <SectionCard title="Risks" icon={AlertTriangle} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.risks.length === 0 && (
                  <EmptyState
                    icon={AlertTriangle}
                    title="No active risks"
                    description="KEY isn't tracking any risks right now. Populate your Genome to surface them."
                    actionLabel="Populate Genome"
                    actionIcon={ShieldCheck}
                    onAction={() => router.push("/app/profile?tab=business-genome")}
                    variant="compact"
                  />
                )}
                {snapshot.risks.slice(0, 5).map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Opportunities" icon={LayoutDashboard} noPadding compact>
              <div className="p-3 space-y-2">
                {snapshot.opportunities.length === 0 && (
                  <EmptyState
                    icon={TrendingUp}
                    title="No opportunities detected"
                    description="KEY hasn't found growth opportunities yet. A quick scan can change that."
                    actionLabel="Ask KEY for opportunities"
                    actionIcon={Zap}
                    onAction={() => router.push("/app/key-modes")}
                    variant="compact"
                  />
                )}
                {snapshot.opportunities.slice(0, 5).map((item, index) => (
                  <CommandItemCard key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </SectionCard>

            <CommandKeyGenomeCard keyGenome={snapshot.keyGenome} />
            <CommandModuleReadinessPanel modules={snapshot.moduleReadiness} />
            <CommandGenomeCard genome={snapshot.genome} />
            <CommandConstitutionCard constitution={snapshot.constitution} />

            <SectionCard title="Executive Modes" icon={LayoutDashboard} noPadding compact>
              <div className="p-3">
                <CommandExecutiveModeGrid modes={snapshot.executiveModes} />
              </div>
            </SectionCard>
          </div>
        </div>

        <CommandGenomeOutcomesCard key={businessId} businessId={businessId} />

        <CrossDomainPanel businessId={businessId} />
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
