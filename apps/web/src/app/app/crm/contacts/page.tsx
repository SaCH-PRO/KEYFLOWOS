/**
 * The contacts list — one screen, one route.
 *
 * This page lived at /app/crm/pipeline and was reached through four doors:
 * /app/crm redirected here, /app/crm/contacts re-exported it, /app/people
 * re-exported /app/crm, and /app/network/contacts redirected here too. Thirteen
 * KEY tools named /app/crm/pipeline as their manual equivalent while every one
 * of the 39 in-app references used /app/crm/contacts, so the tools pointed at a
 * URL nothing else in the product used.
 *
 * It is /app/crm/contacts now, because that is what it is and what everything
 * already called it. The supporting components stay under ./pipeline — they are
 * an implementation detail of this screen, not a second destination.
 */
"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Users,
  Zap,
  TrendingUp,
  Lightbulb,
  ArrowRight,
  AlertTriangle,
  Flame,
  CalendarPlus,
} from "lucide-react";
import { BroadcastDrawer } from "@/components/contacts";
import { NextActionQueue } from "@/components/contacts/next-action-queue";
import { AutopilotActions } from "@/components/contacts/autopilot-actions";
import { KanbanSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";
import { PipelineTabContent } from "../pipeline/pipeline-tab-content";
import { useContactsPipeline } from "../pipeline/use-contacts-pipeline";
import { KeyflowUnifiedShell } from "@/components/guide/keyflow-unified-shell";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEmit } from "@/hooks/use-module-events";
import { usePlan } from "@/hooks/use-plan";
import { PlanLimitBanner } from "@/components/ui/upgrade-prompt";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { useNavigationContext } from "@/lib/navigation-context";

const CRM_TABS = ["contacts"];

export default function ContactsPage() {
  const router = useRouter();
  const googleHandled = useRef(false);
  const state = useContactsPipeline();
  const { checkLimit } = usePlan();
  const emitEvent = useModuleEmit();
  const [, setSlideDirection] = useState(0);
  const { setCurrentMeta } = useNavigationContext();
  useReturnNavigation({ restoreScrollOnMount: true });

  const {
    workspaceLoading, workspaceError,
    crmViewTab, setCrmViewTab,
    showBroadcast, setShowBroadcast,
    confirmState, setConfirmState,
    selectedContactsForBroadcast,
    setSelectedIds, setSelectMode,
    contacts, loadContacts,
    nextActions, autopilotActions, autopilotPaused,
    setAutopilotPaused,
    handleCompleteNextAction, handleDoAction,
    handleApproveAutopilot, handleDenyAutopilot,
    selectContact, loadFlowData,
  } = state;

  const crmShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "Contacts Navigation",
      shortcuts: [
        { key: "n", description: "New contact", action: () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("kf:open-quick-add-contact")); } },
        { key: "f", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('input[aria-label="Search contacts"]'); el?.focus(); } },
        { key: "1", description: "Contacts tab", action: () => setCrmViewTab("contacts") },
        { key: "r", description: "Refresh contacts", action: () => { void loadContacts(); void loadFlowData(); } },
        { key: "b", description: "Open broadcast", action: () => setShowBroadcast(true) },
      ],
    },
  ], [setCrmViewTab, loadContacts, loadFlowData, setShowBroadcast]);

  useKeyboardShortcuts(crmShortcuts, !workspaceLoading);

  useEffect(() => {
    if (googleHandled.current) return;
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const googleSuccess = params.get("google_success");
    const googleError = params.get("google_error");
    const imported = params.get("imported");
    const action = params.get("action");
    if (googleSuccess) {
      googleHandled.current = true;
      toast.success(`Google Contacts imported successfully${imported ? ` (${imported} contacts)` : ""}`);
      router.replace("/app/crm/contacts");
      loadContacts();
      loadFlowData();
    } else if (googleError) {
      googleHandled.current = true;
      const msg = googleError === "missing_params" ? "Missing OAuth parameters"
        : googleError === "invalid_state" ? "Invalid OAuth state — please try again"
        : googleError === "import_failed" ? "Google import failed — please try again"
        : "Something went wrong with Google import";
      toast.error(`Google import failed: ${msg}`);
      router.replace("/app/crm/contacts");
    } else if (action === "new") {
      googleHandled.current = true;
      if (typeof window !== "undefined") {
        setTimeout(() => window.dispatchEvent(new Event("kf:open-quick-add-contact")), 0);
      }
      router.replace("/app/crm/contacts");
    }
  }, [router, loadContacts, loadFlowData]);

  const confirmStateRef = useRef(confirmState);

  useEffect(() => {
    confirmStateRef.current = confirmState;
  }, [confirmState]);

  const handleCloseBroadcast = useCallback(() => setShowBroadcast(false), [setShowBroadcast]);
  const handleDeselectAll = useCallback(() => { setSelectedIds(new Set()); setSelectMode(false); }, [setSelectedIds, setSelectMode]);
  const handleConfirmAction = useCallback(() => { confirmStateRef.current.action(); setConfirmState({ open: false, action: () => {} }); }, [setConfirmState]);
  const handleCancelConfirm = useCallback(() => setConfirmState({ open: false, action: () => {} }), [setConfirmState]);
  const handleViewEngageContact = useCallback((id: string) => { selectContact(id); setCrmViewTab("contacts"); }, [selectContact, setCrmViewTab]);
  const handleToggleAutopilotPause = useCallback(() => setAutopilotPaused((prev: boolean) => !prev), [setAutopilotPaused]);
  const _handleTabChange = useCallback((t: string) => {
    if (t === crmViewTab) return;
    const oldIndex = CRM_TABS.indexOf(crmViewTab);
    const newIndex = CRM_TABS.indexOf(t);
    setSlideDirection(newIndex > oldIndex ? 1 : -1);
    setCrmViewTab(t as "contacts" | "insights" | "studio");
    setCurrentMeta({ tab: t });
    emitEvent("module:tab_changed", "crm", { tab: t });
  }, [crmViewTab, setCrmViewTab, emitEvent, setCurrentMeta]);

  /* Leverage insights */
  const leverageInsights = useMemo(() => {
    if (workspaceLoading || workspaceError) return [];
    const items: { icon: React.ElementType; label: string; detail: string; cta: string; href: string }[] = [];
    
    const staleCount = state.segmentCounts["needs-followup"] ?? 0;
    if (staleCount > 0) {
      items.push({
        icon: Lightbulb,
        label: `${staleCount} relationship${staleCount > 1 ? "s" : ""} need attention`,
        detail: "Re-engaging dormant contacts often yields the highest ROI",
        cta: "Review",
        href: "#followup",
      });
    }
    
    const atRiskCount = state.segmentCounts["at-risk"] ?? 0;
    if (atRiskCount > 0) {
      items.push({
        icon: TrendingUp,
        label: `${atRiskCount} contact${atRiskCount > 1 ? "s" : ""} at risk of churning`,
        detail: "Proactive outreach can save these relationships",
        cta: "Act now",
        href: "#atrisk",
      });
    }
    
    const highValueCount = state.segmentCounts["high-value"] ?? 0;
    if (highValueCount > 0) {
      items.push({
        icon: Zap,
        label: `${highValueCount} high-value contact${highValueCount > 1 ? "s" : ""} idle`,
        detail: "These people drive the most revenue — keep them close",
        cta: "Prioritize",
        href: "#highvalue",
      });
    }
    
    return items.slice(0, 3);
  }, [state.segmentCounts, workspaceLoading, workspaceError]);

  if (workspaceLoading) return <KanbanSkeleton />;
  if (workspaceError) return <WorkspaceError />;

  return (
    <KeyflowUnifiedShell
      module="crm"
      pageTitle="Contacts"
      availableActions={["Add contact", "Send broadcast", "Import contacts", "Move pipeline stage"]}
    >
    <div className="space-y-5" aria-label="Contacts Workspace">
      <ResumePrompt module="crm" />
      
      {/* Header */}
      <PageHeader
        icon={Users}
        title="Contacts"
        subtitle="Who matters, what changed, and what should I do next?"
        titleExtra={<NotesTrigger pageKey="crm" variant="header" />}
      />

      {(() => {
        const cl = checkLimit("contacts");
        return <PlanLimitBanner resourceKey="contacts" label="contacts" currentUsage={cl.current} limit={cl.limit} isUnlimited={cl.isUnlimited} nearLimit={cl.nearLimit} atLimit={cl.atLimit} upgradeTo={cl.upgradeTo} />;
      })()}

      {/* 1. Relationship Pulse */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Relationship Pulse
          </h2>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: "Follow-ups due", count: state.segmentCounts["needs-followup"] ?? 0, icon: AlertTriangle, color: "text-[hsl(var(--kf-accent1))]", bg: "bg-[hsl(var(--kf-accent1))]/10", onClick: () => state.setActiveSegment("needs-followup") },
            { label: "At risk", count: state.segmentCounts["at-risk"] ?? 0, icon: Flame, color: "text-red-400", bg: "bg-red-500/10", onClick: () => state.setActiveSegment("at-risk") },
            { label: "High value idle", count: state.segmentCounts["high-value"] ?? 0, icon: Zap, color: "text-emerald-400", bg: "bg-emerald-500/10", onClick: () => state.setActiveSegment("high-value") },
            { label: "Active clients", count: state.flowIntelligence?.clients ?? contacts.filter((c) => c.status === "CLIENT").length, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10", onClick: () => state.setStatusFilter("CLIENT") },
            { label: "New this week", count: state.segmentCounts["new-this-week"] ?? 0, icon: CalendarPlus, color: "text-[hsl(var(--kf-accent2))]", bg: "bg-[hsl(var(--kf-accent2))]/10", onClick: () => state.setActiveSegment("new-this-week") },
            { label: "Total contacts", count: contacts.length, icon: TrendingUp, color: "text-muted-foreground", bg: "bg-white/[0.04]", onClick: () => state.setActiveSegment(null) },
          ].map((metric) => (
            <button
              key={metric.label}
              onClick={metric.onClick}
              className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-border/30 bg-card/20 hover:bg-card/40 hover:border-border/50 transition-all text-left"
            >
              <div className={`p-1.5 rounded-lg ${metric.bg}`}>
                <metric.icon className={`w-3.5 h-3.5 ${metric.color}`} />
              </div>
              <div>
                <p className={`text-lg font-semibold leading-tight ${metric.color}`}>{metric.count}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{metric.label}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Action Center */}
      {(leverageInsights.length > 0 || nextActions.length > 0 || autopilotActions.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Action Center
            </h2>
          </div>
          
          <div className="grid gap-2">
            {/* Leverage insights */}
            {leverageInsights.map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  if (item.href === "#followup") state.setActiveSegment("needs-followup");
                  else if (item.href === "#atrisk") state.setActiveSegment("at-risk");
                  else if (item.href === "#highvalue") state.setActiveSegment("high-value");
                }}
                className="flex items-start gap-3 p-3.5 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 transition-all text-left"
              >
                <div className="p-2 rounded-lg bg-[hsl(var(--kf-accent1))]/10 shrink-0">
                  <item.icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
                <span className="text-xs font-medium text-[hsl(var(--kf-accent1))] flex items-center gap-1 shrink-0">
                  {item.cta} <ArrowRight className="w-3 h-3" />
                </span>
              </button>
            ))}

            {/* Next actions */}
            {nextActions.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
                <NextActionQueue
                  actions={nextActions}
                  onComplete={handleCompleteNextAction}
                  onViewContact={handleViewEngageContact}
                  onDoAction={handleDoAction}
                />
              </div>
            )}

            {/* Autopilot */}
            {autopilotActions.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
                <AutopilotActions
                  actions={autopilotActions}
                  isPaused={autopilotPaused}
                  onTogglePause={handleToggleAutopilotPause}
                  onApprove={handleApproveAutopilot}
                  onDeny={handleDenyAutopilot}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Contact Workspace */}
      <div className="space-y-2">
        <PipelineTabContent
          state={state}
          nextActions={nextActions}
          autopilotActions={autopilotActions}
          autopilotPaused={autopilotPaused}
          onCompleteNextAction={handleCompleteNextAction}
          onViewEngageContact={handleViewEngageContact}
          onDoAction={handleDoAction}
          onToggleAutopilotPause={handleToggleAutopilotPause}
          onApproveAutopilot={handleApproveAutopilot}
          onDenyAutopilot={handleDenyAutopilot}
        />
      </div>

      <BroadcastDrawer
        isOpen={showBroadcast}
        onClose={handleCloseBroadcast}
        selectedContacts={selectedContactsForBroadcast}
        onDeselectAll={handleDeselectAll}
      />
      <ConfirmDialog
        open={confirmState.open}
        title="Delete Contact"
        message="Are you sure you want to delete this contact? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmAction}
        onCancel={handleCancelConfirm}
      />
    </div>
    </KeyflowUnifiedShell>
  );
}
