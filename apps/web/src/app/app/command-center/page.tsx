"use client";

/**
 * Today (/app/command-center; label 'Today', D-151). TODAY-4BLOCK (v1 step 5; BUG-069, BUG-010, FCP-COR-1): the page
 * is the four blocks of today/today-blocks.tsx, read from one server read, GET .../today (TODAY-AGGREGATE). The
 * mission-control hero, the health strip, the genome cards and readiness grid, the cockpit tiles and the KEY
 * briefing cards are gone: nothing here scores the business (journeys A8, I5).
 *
 * Kept, inside the blocks: the command queue with its operations gating (W7-WEB-OPS-SCOPE, D-40; WOS-C01..C07) and
 * the approved KEY actions panel with Run (D-72) in Needs you, and what is due this week in Today. Under
 * KEY_DISABLED no KEY UI renders here: the one KEY switch reader is main's useKeyEnabled (hooks/use-key-enabled.ts,
 * fail closed), the same one the header and the KEY shell read.
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
import { getStoredBusinessId, ensureWorkspace, getCachedBusiness, BUSINESS_CHANGED_EVENT } from "@/lib/workspace";
import { fetchToday, type TodayAggregate } from "@/lib/api/today";
import { retryKeySwitch, useKeyEnabled, useKeySwitchFailed } from "@/hooks/use-key-enabled";
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
import { CommandKeyDisabledContext } from "@/components/command/command-card-v2";
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
  const [businessCurrency, setBusinessCurrency] = useState<string | null>(null);
  const [today, setToday] = useState<{ businessId: string; data: TodayAggregate } | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  /** A failed read, kept with the business it was for, so it never shows as another business's. */
  const [todayFailure, setTodayFailure] = useState<{ businessId: string; message: string } | null>(null);
  const todayRequest = useRef(0);
  // Repair round 2: one KEY_DISABLED reader for the whole app (FU-KEY-DISABLED-NAV-TODAY). KEY is on only once
  // GET /identity/me answered keyDisabled: false; while it is in flight or after it failed, KEY is off here.
  const keySwitch = useKeyEnabled();
  const keySwitchFailed = useKeySwitchFailed();

  /**
   * The command queue, kept with the business it was read for (repair round 3): after a switch nothing of the old
   * business shows, and a reply for an older request (the old business, or a refresh since) is dropped.
   */
  const [queue, setQueue] = useState<{ businessId: string; items: CommandItem[]; total: number } | null>(null);
  const [queueLoadingFor, setQueueLoadingFor] = useState<string | null>(null);
  const queueRequest = useRef(0);
  /**
   * W7-WEB-OPS-SCOPE (D-40): the member's operations level as the server's refusals name it; the
   * queue disables the item actions below write. Today itself is every member's (D-96). Kept with its business: a
   * level learned in one business is not applied in another (repair round 3).
   */
  const [ops, setOps] = useState<{ businessId: string; level: OperationsLevel } | null>(null);
  /** An item action's answer, for the business it was sent for: a refusal names the level, and every item action needs write. */
  const noteActionAnswer = (forBusiness: string, res: { error?: string | null; status?: number }) => {
    const refused = operationsLevelFromAnswer(res);
    if (refused) setOps({ businessId: forBusiness, level: refused });
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
      setBusinessCurrency(cached && cached.id === resolved ? (cached.currency ?? null) : null);
      if (!resolved) setTodayLoading(false);
    };
    void resolveBusinessId();
    // A switch of business in this tab (selectBusiness) moves Today to the new business; the reads below follow it.
    const onBusinessChanged = (event: Event) => {
      const next = (event as CustomEvent<{ businessId?: string }>).detail?.businessId ?? getStoredBusinessId();
      if (!next || cancelled) return;
      setBusinessId(next);
      const cached = getCachedBusiness();
      setBusinessName(cached && cached.id === next ? cached.name : null);
      setBusinessCurrency(cached && cached.id === next ? (cached.currency ?? null) : null);
    };
    window.addEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    };
  }, []);

  const loadToday = useCallback(async () => {
    if (!businessId) return;
    const request = ++todayRequest.current;
    setTodayLoading(true);
    const { data, error, status } = await fetchToday(businessId);
    // A reply for an older request (another business, or a refresh since) changes nothing: it neither clears the
    // current business's Today nor raises its alert (repair round 2, item 4).
    if (request !== todayRequest.current) return;
    if (data) {
      setToday({ businessId, data });
      setTodayFailure(null);
    } else {
      // SEC-T4B-2, narrowed in repair round 2: a refusal (401, 403) means this member may no longer see it, so what an
      // earlier read showed is cleared. A 5xx or no answer keeps the last good read of this same business under the
      // alert, with Retry.
      if (status === 401 || status === 403) setToday(null);
      setTodayFailure({ businessId, message: error || "the server did not answer" });
    }
    setTodayLoading(false);
  }, [businessId]);

  /** Retry and Refresh read Today again, and the KEY switch too when its read failed (item 6). */
  const refreshToday = useCallback(() => {
    retryKeySwitch();
    return loadToday();
  }, [loadToday]);

  const loadQueue = useCallback(async () => {
    if (!businessId) return;
    const request = ++queueRequest.current;
    setQueueLoadingFor(businessId);
    try {
      const res = await fetchCommandItems(businessId, { status: "OPEN", limit: 50 });
      if (request !== queueRequest.current) return;
      const { data } = res;
      setQueue({ businessId, items: data?.items ?? [], total: data?.total ?? 0 });
      // A refused read names the level (none); a read that succeeds means at least read.
      const refused = operationsLevelFromAnswer(res);
      if (refused) setOps({ businessId, level: refused });
      else if (data) setOps((prev) => (prev && prev.businessId === businessId && prev.level !== "none" ? prev : { businessId, level: "unknown" }));
    } finally {
      if (request === queueRequest.current) setQueueLoadingFor(null);
    }
  }, [businessId]);

  useEffect(() => {
    void loadToday();
    void loadQueue();
  }, [loadToday, loadQueue]);

  const handleComplete = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(businessId, await completeCommandItem(businessId, id));
    await loadQueue();
  };

  const handleApprove = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(businessId, await approveCommandItem(businessId, id));
    await loadQueue();
  };

  const handleExecute = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(businessId, await executeCommandItem(businessId, id));
    await loadQueue();
  };

  const handleAssign = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(businessId, await assignCommandItem(businessId, id, "USER", "me"));
    await loadQueue();
  };

  const handleDismiss = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(businessId, await dismissCommandItem(businessId, id));
    await loadQueue();
  };

  const handleSnooze = async (id: string) => {
    if (!businessId) return;
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    noteActionAnswer(businessId, await snoozeCommandItem(businessId, id, until));
    await loadQueue();
  };

  const handleReopen = async (id: string) => {
    if (!businessId) return;
    noteActionAnswer(businessId, await reopenCommandItem(businessId, id));
    await loadQueue();
  };

  const handleDischarge = async (id: string) => {
    if (!businessId) return;
    // W7-WEB-OPS-SCOPE review SEC-WOS-2 (D-40): discharge is an item action too (operations write);
    // its refusal names the level like the queue's actions do.
    noteActionAnswer(businessId, await dischargeObligation(businessId, id, "manual"));
    // The queue reads the same table, so a discharged obligation has to leave both lists.
    await loadQueue();
  };

  const refreshAll = () => {
    void refreshToday();
    void loadQueue();
  };

  // KEY UI shows only once GET /identity/me answered keyDisabled: false (SEC-T4B-1: fail closed). The read has settled
  // when it answered or failed; data-key-read says so (tests wait on it before checking that nothing KEY shows).
  const keyOff = !keySwitch.enabled;
  const keyReadSettled = keySwitch.known || keySwitchFailed;
  const current = today && today.businessId === businessId ? today.data : null;
  const commandItems = queue && queue.businessId === businessId ? queue.items : [];
  const queueTotal = queue && queue.businessId === businessId ? queue.total : 0;
  const queueLoading = queueLoadingFor !== null && queueLoadingFor === businessId;
  const operationsLevel: OperationsLevel = ops && ops.businessId === businessId ? ops.level : "unknown";
  const todayError = todayFailure && todayFailure.businessId === businessId ? todayFailure.message : null;

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
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-key-read={keyReadSettled ? "settled" : "pending"}>
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
              businessCurrency={businessCurrency}
              onRefresh={refreshToday}
              needsYouExtra={
                <>
                  {/* D-72 (KEY-R3c-APPROVED-QUEUE-MOUNT): the approved KEY action steps this member may run,
                      each with its D-70 Run action. /app/control-tower redirects here. Not under KEY_DISABLED. */}
                  {!keyOff && <ApprovedActionsPanel key={`approved-actions:${businessId}`} businessId={businessId} />}
                  <CommandSection icon={LayoutDashboard} title={`Command Queue (${queueTotal})`}>
                    {/* COR-1: under KEY_DISABLED no card shows "KEY can handle" or Execute, and no execute handler is given. */}
                    <CommandKeyDisabledContext.Provider value={keyOff}>
                    <CommandQueueV2
                      items={commandItems}
                      total={queueTotal}
                      loading={queueLoading}
                      onRefresh={loadQueue}
                      onComplete={handleComplete}
                      onApprove={handleApprove}
                      onExecute={keyOff ? undefined : handleExecute}
                      onAssign={handleAssign}
                      onDismiss={handleDismiss}
                      onSnooze={handleSnooze}
                      onReopen={handleReopen}
                      operationsLevel={operationsLevel}
                    />
                    </CommandKeyDisabledContext.Provider>
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
