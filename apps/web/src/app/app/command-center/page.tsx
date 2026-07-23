"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { openKey } from "@/components/key";
import {
  LayoutDashboard,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Bot,
  BrainCircuit,
  Clock,
  Inbox,
  Target,
  TrendingUp,
  ShieldCheck,
  Zap,
  LayoutGrid,
  Banknote,
  Users,
  Megaphone,
  BriefcaseBusiness,
  MessageSquare,
  Store,
  Calendar,
  Settings,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
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
import { CommandQueueV2 } from "@/components/command/command-queue-v2";
import { CommandHealthStripV2 } from "./components-v2/command-health-strip-v2";
import { CommandSummaryCardV2 } from "./components-v2/command-summary-card-v2";
import { BusinessPulseCardV2 } from "./components-v2/business-pulse-card-v2";
import { KeyBriefingCardV2 } from "./components-v2/key-briefing-card-v2";
import { GovernanceSummaryCardV2 } from "./components-v2/governance-summary-card-v2";
import { CommandItemCardV2 } from "./components-v2/command-item-card-v2";
import { CommandExecutiveModeGridV2 } from "./components-v2/command-executive-mode-grid-v2";
import { CommandGenomeOrbCard } from "./components/command-genome-orb-card";
import { CommandKeyGenomeCardV2 } from "./components-v2/command-key-genome-card-v2";
import { CommandModuleReadinessGrid } from "./components-v2/command-module-readiness-grid";
import { CommandConstitutionCardV2 } from "./components-v2/command-constitution-card-v2";
import { CrossDomainPanelV2 } from "./components-v2/cross-domain-panel-v2";
import { CommandGenomeOutcomesCardV2 } from "./components-v2/command-genome-outcomes-card-v2";
import { NudgesWidgetV2 } from "./components-v2/nudges-widget-v2";
import { MissionControlHero } from "./components-v2/mission-control-hero";
import { CommandSection } from "./components/command-section";
import {
  ModuleLauncherSheet,
  type ModuleLauncherSection,
} from "@/components/ui/module-launcher-sheet";

function CommandQuickLauncher() {
  const [open, setOpen] = useState(false);

  const sections: ModuleLauncherSection[] = [
    {
      id: "flows",
      label: "Flows",
      items: [
        { id: "financial", label: "Money", icon: Banknote, href: "/app/financial-flow", tone: "gold" },
        { id: "temporal", label: "Time", icon: Clock, href: "/app/temporal-flow", tone: "sky" },
        { id: "people", label: "People", icon: Users, href: "/app/people-flow", tone: "violet" },
        { id: "marketing", label: "Marketing", icon: Megaphone, href: "/app/marketing-flow", tone: "rose" },
        { id: "operations", label: "Ops", icon: BriefcaseBusiness, href: "/app/operations-flow", tone: "mint" },
        { id: "governance", label: "Gov", icon: ShieldCheck, href: "/app/governance-flow", tone: "default" },
      ],
    },
    {
      id: "core",
      label: "Core",
      items: [
        { id: "key-chat", label: "KEY Chat", icon: MessageSquare, href: "/app/key/chat", tone: "primary" },
        { id: "commerce", label: "Commerce", icon: TrendingUp, href: "/app/commerce", tone: "orange" },
        { id: "events", label: "Events", icon: Calendar, href: "/app/events", tone: "teal" },
        { id: "storefront", label: "Storefront", icon: Store, href: "/app/commerce", tone: "violet" },
        { id: "inbox", label: "Inbox", icon: Inbox, href: "/app/data-inbox", tone: "default" },
      ],
    },
    {
      id: "build",
      label: "Build",
      items: [
        { id: "genome", label: "Genome", icon: LayoutGrid, href: "/app/genome", tone: "teal" },
        { id: "settings", label: "Settings", icon: Settings, href: "/app/settings", tone: "default" },
      ],
    },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open module launcher"
        className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/60 bg-card/60 hover:bg-card hover:border-primary/20 transition-all active:scale-95 focus-ring"
      >
        <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground" />
        <span>Launch</span>
      </button>
      <ModuleLauncherSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Launch Pad"
        subtitle="Quick access to flows and modules"
        sections={sections}
      />
    </>
  );
}

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
    return () => {
      cancelled = true;
    };
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
              onClick={() => {
                void loadSnapshot();
                void loadQueue();
              }}
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
      onAction={() => {
        void loadSnapshot();
        void loadQueue();
      }}
      headerRight={<CommandQuickLauncher />}
    >
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
        <MissionControlHero businessId={businessId} hullScore={snapshot.keyGenome.overall} />

        <CommandHealthStripV2 health={snapshot.health} />

        <CommandSummaryCardV2 summary={snapshot.summary} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <BusinessPulseCardV2
            overallScore={snapshot.pulse.overallScore}
            dimensions={snapshot.pulse.dimensions}
          />
          <KeyBriefingCardV2 briefing={snapshot.briefing} />
          <GovernanceSummaryCardV2 governance={snapshot.governance} />
        </div>

        <CommandSection icon={LayoutDashboard} title={`Command Queue (${queueTotal})`}>
          <CommandQueueV2
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
        </CommandSection>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <CommandSection icon={LayoutDashboard} title={`Top Priorities (${snapshot.topPriorities.length})`}>
              <div className="space-y-2">
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
                  <CommandItemCardV2 key={item.id} item={item} index={index} />
                ))}
              </div>
            </CommandSection>

            <CommandSection icon={Inbox} title={`Pending Approvals (${snapshot.pendingApprovals.length})`}>
              <div className="space-y-2">
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
                  <CommandItemCardV2 key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </CommandSection>

            <CommandSection icon={Clock} title={`Urgent Items (${snapshot.urgentItems.length})`}>
              <div className="space-y-2">
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
                  <CommandItemCardV2 key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </CommandSection>
          </div>

          <div className="space-y-5">
            <NudgesWidgetV2 businessId={businessId} />

            <CommandSection icon={AlertTriangle} title="Risks">
              <div className="space-y-2">
                {snapshot.risks.length === 0 && (
                  <EmptyState
                    icon={AlertTriangle}
                    title="No active risks"
                    description="KEY isn't tracking any risks right now. Populate your Genome to surface them."
                    actionLabel="Populate Genome"
                    actionIcon={ShieldCheck}
                    onAction={() => openKey({ mode: "onboarding" })}
                    variant="compact"
                  />
                )}
                {snapshot.risks.slice(0, 5).map((item, index) => (
                  <CommandItemCardV2 key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </CommandSection>

            <CommandSection icon={TrendingUp} title="Opportunities">
              <div className="space-y-2">
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
                  <CommandItemCardV2 key={item.id} item={item} index={index} compact />
                ))}
              </div>
            </CommandSection>

            <CommandKeyGenomeCardV2 keyGenome={snapshot.keyGenome} />
            <CommandModuleReadinessGrid
              modules={snapshot.moduleReadiness}
              onReview={() => openKey({ mode: "onboarding" })}
            />
            <CommandGenomeOrbCard />
            <CommandConstitutionCardV2 constitution={snapshot.constitution} />

            <CommandSection icon={LayoutDashboard} title="Executive Modes">
              <CommandExecutiveModeGridV2 modes={snapshot.executiveModes} />
            </CommandSection>
          </div>
        </div>

        <CommandGenomeOutcomesCardV2 key={businessId} businessId={businessId} />

        <CrossDomainPanelV2 businessId={businessId} />
      </motion.div>
    </WorkspaceShell>
  );
}
