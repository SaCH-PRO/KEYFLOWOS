"use client";

/**
 * Today (/app/command-center; label 'Today', D-151). TODAY-4BLOCK (v1 step 5; BUG-069, BUG-010, FCP-COR-1): the page
 * is the four blocks of today/today-blocks.tsx, read from one server read, GET .../today (TODAY-AGGREGATE). The
 * mission-control hero, the health strip, the genome cards and readiness grid, the cockpit tiles and the KEY
 * briefing cards are gone: nothing here scores the business (journeys A8, I5).
 *
 * Kept, inside the blocks: the command queue with its operations gating (W7-WEB-OPS-SCOPE, D-40; WOS-C01..C07) and
 * the approved KEY actions panel with Run (D-72) in Needs you, and what is due this week in Today. Under
 * KEY_DISABLED (keyDisabled on GET /identity/me) no KEY UI renders here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  CalendarClock,
  RefreshCw,
  Clock,
  Inbox,
  TrendingUp,
  ShieldCheck,
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
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { NAV_ROUTE_LABELS } from "@/lib/semantic-routes";
import { getStoredBusinessId, ensureWorkspace, getCachedBusiness } from "@/lib/workspace";
import { fetchToday, fetchKeyDisabled, type TodayAggregate } from "@/lib/api/today";
import {
  fetchCommandItems,
  completeCommandItem,
  approveCommandItem,
  executeCommandItem,
  assignCommandItem,
  dismissCommandItem,
  snoozeCommandItem,
  reopenCommandItem,
  dischargeObligation,
  type CommandItem,
} from "@/lib/api/command";
import { DueObligationsPanel } from "./components/due-obligations-panel";
import { ApprovedActionsPanel } from "../control-tower/components/approved-actions-queue";
import { CommandQueueV2 } from "@/components/command/command-queue-v2";
import { commandActionsDisabledReason, operationsLevelFromAnswer, type OperationsLevel } from "@/lib/module-access";
import { CommandSection } from "./components/command-section";
import { TodayBlocks } from "./today/today-blocks";
import {
  ModuleLauncherSheet,
  type ModuleLauncherSection,
} from "@/components/ui/module-launcher-sheet";

function CommandQuickLauncher({ keyDisabled }: { keyDisabled: boolean }) {
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
        // KEY_DISABLED: no KEY door on Today.
        ...(keyDisabled ? [] : [{ id: "key-chat", label: "KEY Chat", icon: MessageSquare, href: "/app/key/chat", tone: "primary" as const }]),
        { id: "commerce", label: "Commerce", icon: TrendingUp, href: "/app/commerce", tone: "orange" },
        { id: "events", label: "Events", icon: Calendar, href: "/app/events", tone: "teal" },
        // NAV-A3 (BUG-108): the store, not the Sales hub.
        { id: "storefront", label: "Storefront", icon: Store, href: "/app/store", tone: "violet" },
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
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [today, setToday] = useState<{ businessId: string; data: TodayAggregate } | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayError, setTodayError] = useState<string | null>(null);
  /** null until GET /identity/me answers; true only when it says KEY is switched off. */
  const [keyDisabled, setKeyDisabled] = useState<boolean | null>(null);
  const [keyRead, setKeyRead] = useState(false);
  const todayRequest = useRef(0);

  const [commandItems, setCommandItems] = useState<CommandItem[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueLoading, setQueueLoading] = useState(false);
  /**
   * W7-WEB-OPS-SCOPE (D-40): the member's operations level as the server's refusals name it; the
   * queue disables the item actions below write. Today itself is every member's (D-96).
   */
  const [operationsLevel, setOperationsLevel] = useState<OperationsLevel>("unknown");
  /** An item action's answer: a refusal names the level, and every item action needs write. */
  const noteActionAnswer = (res: { error?: string | null; status?: number }) => {
    const refused = operationsLevelFromAnswer(res);
    if (refused) setOperationsLevel(refused);
  };

  useEffect(() => {
    let cancelled = false;
    const resolveBusinessId = async () => {
      const stored = getStoredBusinessId() ?? null;
      const resolved = stored ?? (await ensureWorkspace());
      if (cancelled) return;
      setBusinessId(resolved);
      const cached = getCachedBusiness();
      setBusinessName(cached && cached.id === resolved ? cached.name : null);
      if (!resolved) setTodayLoading(false);
    };
    void resolveBusinessId();
    void fetchKeyDisabled().then((disabled) => {
      if (cancelled) return;
      setKeyDisabled(disabled);
      setKeyRead(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadToday = useCallback(async () => {
    if (!businessId) return;
    const request = ++todayRequest.current;
    setTodayLoading(true);
    const { data, error } = await fetchToday(businessId);
    if (request !== todayRequest.current) return;
    if (data) {
      setToday({ businessId, data });
      setTodayError(null);
    } else {
      setTodayError(error || "the server did not answer");
    }
    setTodayLoading(false);
  }, [businessId]);

  const loadQueue = useCallback(async () => {
    if (!businessId) return;
    setQueueLoading(true);
    try {
      const res = await fetchCommandItems(businessId, { status: "OPEN", limit: 50 });
      const { data } = res;
      setCommandItems(data?.items ?? []);
      setQueueTotal(data?.total ?? 0);
      // A refused read names the level (none); a read that succeeds means at least read.
      const refused = operationsLevelFromAnswer(res);
      if (refused) setOperationsLevel(refused);
      else if (data) setOperationsLevel((prev) => (prev === "none" ? "unknown" : prev));
    } finally {
      setQueueLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void loadToday();
    void loadQueue();
  }, [loadToday, loadQueue]);

  const handleComplete = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(await completeCommandItem(businessId, id));
    await loadQueue();
  };

  const handleApprove = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(await approveCommandItem(businessId, id));
    await loadQueue();
  };

  const handleExecute = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(await executeCommandItem(businessId, id));
    await loadQueue();
  };

  const handleAssign = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(await assignCommandItem(businessId, id, "USER", "me"));
    await loadQueue();
  };

  const handleDismiss = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(await dismissCommandItem(businessId, id));
    await loadQueue();
  };

  const handleSnooze = async (id: string) => {
    if (!businessId) return;
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    noteActionAnswer(await snoozeCommandItem(businessId, id, until));
    await loadQueue();
  };

  const handleReopen = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(await reopenCommandItem(businessId, id));
    await loadQueue();
  };

  const handleDischarge = async (id: string) => {
    if (!businessId) return;
    // W7-WEB-OPS-SCOPE review SEC-WOS-2 (D-40): discharge is an item action too (operations write);
    // its refusal names the level like the queue's actions do.
    noteActionAnswer(await dischargeObligation(businessId, id, "manual"));
    // The queue reads the same table, so a discharged obligation has to leave both lists.
    await loadQueue();
  };

  const refreshAll = () => {
    void loadToday();
    void loadQueue();
  };

  // KEY UI waits for GET /identity/me: nothing KEY shows before it answers, and none once it says KEY is off.
  const keyOff = !keyRead || keyDisabled === true;
  const current = today && today.businessId === businessId ? today.data : null;

  return (
    <WorkspaceShell
      icon={LayoutDashboard}
      title={NAV_ROUTE_LABELS["/app/command-center"]}
      subtitle={businessName ?? "What needs you, what is on today, and how the money stands"}
      actionLabel="Refresh"
      actionIcon={RefreshCw}
      onAction={refreshAll}
      headerRight={<CommandQuickLauncher keyDisabled={keyOff} />}
    >
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {!businessId && !todayLoading ? (
          <p data-testid="today-unavailable" role="alert" className="text-sm text-destructive">
            No business selected.
          </p>
        ) : (
          businessId && (
            <TodayBlocks
              businessId={businessId}
              data={current}
              loading={todayLoading}
              error={todayError}
              keyDisabled={keyOff}
              onRefresh={loadToday}
              needsYouExtra={
                <>
                  {/* D-72 (KEY-R3c-APPROVED-QUEUE-MOUNT): the approved KEY action steps this member may run,
                      each with its D-70 Run action. /app/control-tower redirects here. Not under KEY_DISABLED. */}
                  {!keyOff && <ApprovedActionsPanel key={`approved-actions:${businessId}`} businessId={businessId} />}
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
                      operationsLevel={operationsLevel}
                    />
                  </CommandSection>
                </>
              }
              todayExtra={
                /* What is OWED, by date: the queue above sorts by priority; this answers "what do I owe". */
                <CommandSection icon={CalendarClock} title="Due this week">
                  <DueObligationsPanel
                    businessId={businessId}
                    onDischarge={handleDischarge}
                    dischargeDisabledReason={commandActionsDisabledReason(operationsLevel)}
                  />
                </CommandSection>
              }
            />
          )
        )}
      </motion.div>
    </WorkspaceShell>
  );
}
