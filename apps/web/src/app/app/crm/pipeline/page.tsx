"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Users,
} from "lucide-react";
import {
  BroadcastDrawer,
} from "@/components/contacts";
import { KanbanSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProgressivePrompts } from "../../profile/components/progressive-prompts";
import { PageHeader } from "@/components/ui/page-header";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";
import { InfoBadge } from "@/components/ui/info-badge";
import { PipelineTabContent } from "./pipeline-tab-content";
import { ClientsMetricsStrip } from "./clients-metrics-strip";
import { useContactsPipeline } from "./use-contacts-pipeline";
import { useCrmAiHub } from "./hooks/use-crm-ai-hub";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEmit } from "@/hooks/use-module-events";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import { usePlan } from "@/hooks/use-plan";
import { PlanLimitBanner } from "@/components/ui/upgrade-prompt";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { AiHubTrigger, AiCommandHub } from "@/components/ai/ai-command-hub";
import { GraphInsightsPanel } from "@/components/ai/graph-insights-panel";
import { AutomationCoverageIndicator } from "@/components/ai/automation-coverage-indicator";
import { useGraphIntelligence } from "@/hooks/use-graph-intelligence";

const CRM_TABS = ["contacts"];

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const googleHandled = useRef(false);
  const state = useContactsPipeline();
  const crmAi = useCrmAiHub();
  const { checkLimit } = usePlan();
  const emitEvent = useModuleEmit();
  const [, setSlideDirection] = useState(0);
  const { setCurrentMeta } = useNavigationContext();
  useReturnNavigation({ restoreScrollOnMount: true });

  const {
    workspaceLoading, workspaceError, businessId,
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

  const intelligence = useGraphIntelligence({ businessId, module: "crm" });

  useEffect(() => {
    if (businessId) {
      crmAi.updateCrmContext({
        businessId,
        activeView: crmViewTab,
        contactCount: contacts.length,
        selectedContactId: state.selectedContact?.id,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'crmAi' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [businessId, crmViewTab, contacts.length, state.selectedContact?.id, crmAi.updateCrmContext]);

  const handleCrmAiAction = useCallback((actionKey: string) => {
    const { contactId } = crmAi.parseActionKey(actionKey);
    if (contactId) {
      selectContact(contactId);
      setCrmViewTab("contacts");
    }
  }, [crmAi, selectContact, setCrmViewTab]);

  const crmShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "CRM Navigation",
      shortcuts: [
        { key: "n", description: "New contact", action: () => state.setShowAddMenu(true) },
        { key: "f", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('input[aria-label="Search contacts"]'); el?.focus(); } },
        { key: "1", description: "Contacts tab", action: () => setCrmViewTab("contacts") },
        { key: "r", description: "Refresh contacts", action: () => { void loadContacts(); void loadFlowData(); } },
        { key: "b", description: "Open broadcast", action: () => state.setShowBroadcast(true) },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed deps to the specific setters used; including the full `state` bag would re-create shortcuts on every contact-pipeline state change and re-bind keyboard handlers.
  ], [setCrmViewTab, loadContacts, loadFlowData, state.setShowAddMenu, state.setShowBroadcast]);

  useKeyboardShortcuts(crmShortcuts, !workspaceLoading);

  useEffect(() => {
    if (googleHandled.current) return;
    const googleSuccess = searchParams.get("google_success");
    const googleError = searchParams.get("google_error");
    const imported = searchParams.get("imported");
    const action = searchParams.get("action");
    if (googleSuccess) {
      googleHandled.current = true;
      toast.success(`Google Contacts imported successfully${imported ? ` (${imported} contacts)` : ""}`);
      router.replace("/app/crm/pipeline");
      loadContacts();
      loadFlowData();
    } else if (googleError) {
      googleHandled.current = true;
      const msg = googleError === "missing_params" ? "Missing OAuth parameters"
        : googleError === "invalid_state" ? "Invalid OAuth state — please try again"
        : googleError === "import_failed" ? "Google import failed — please try again"
        : "Something went wrong with Google import";
      toast.error(`Google import failed: ${msg}`);
      router.replace("/app/crm/pipeline");
    } else if (action === "new") {
      googleHandled.current = true;
      state.setShowAddMenu(true);
      router.replace("/app/crm/pipeline");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally narrowed deps to the OAuth callback inputs; including the full `state` bag would re-fire this one-shot effect on unrelated pipeline state changes.
  }, [searchParams, router, loadContacts, loadFlowData, state.setShowAddMenu]);

  const confirmStateRef = useRef(confirmState);
  confirmStateRef.current = confirmState;

  const handleCloseBroadcast = useCallback(() => setShowBroadcast(false), [setShowBroadcast]);
  const handleDeselectAll = useCallback(() => { setSelectedIds(new Set()); setSelectMode(false); }, [setSelectedIds, setSelectMode]);
  const handleConfirmAction = useCallback(() => { confirmStateRef.current.action(); setConfirmState({ open: false, action: () => {} }); }, [setConfirmState]);
  const handleCancelConfirm = useCallback(() => setConfirmState({ open: false, action: () => {} }), [setConfirmState]);
  const handleViewEngageContact = useCallback((id: string) => { selectContact(id); setCrmViewTab("contacts"); }, [selectContact, setCrmViewTab]);
  const handleToggleAutopilotPause = useCallback(() => setAutopilotPaused((prev: boolean) => !prev), [setAutopilotPaused]);
  const handleTabChange = useCallback((t: string) => {
    if (t === crmViewTab) return;
    const oldIndex = CRM_TABS.indexOf(crmViewTab);
    const newIndex = CRM_TABS.indexOf(t);
    setSlideDirection(newIndex > oldIndex ? 1 : -1);
    setCrmViewTab(t as "contacts" | "insights" | "studio");
    setCurrentMeta({ tab: t });
    emitEvent("module:tab_changed", "crm", { tab: t });
  }, [crmViewTab, setCrmViewTab, emitEvent, setCurrentMeta]);

  const { swipeHandlers: _swipeHandlers } = useSwipeTabs({
    tabs: CRM_TABS,
    activeTab: crmViewTab,
    onTabChange: handleTabChange,
  });


  if (workspaceLoading) return <KanbanSkeleton />;

  if (workspaceError) {
    return <WorkspaceError />;
  }

  return (
    <div className="space-y-4" aria-label="Contacts Workspace">
      <ResumePrompt module="crm" />
      <PageHeader
        icon={Users}
        title="Contacts"
        subtitle={<span className="inline-flex items-center gap-1.5">Manage relationships, follow-ups, health, and contact activity across your pipeline <InfoBadge title="Contact Workspace" body="Your contact workspace centralizes relationship intelligence, communication history, and AI-powered insights. Use Smart Segments to triage contacts by engagement and health." side="bottom" iconSize={12} /></span>}
        titleExtra={<NotesTrigger pageKey="crm" variant="header" />}
      />


      {(() => {
        const cl = checkLimit("contacts");
        return <PlanLimitBanner resourceKey="contacts" label="contacts" currentUsage={cl.current} limit={cl.limit} isUnlimited={cl.isUnlimited} nearLimit={cl.nearLimit} atLimit={cl.atLimit} upgradeTo={cl.upgradeTo} />;
      })()}

      <div className="flex items-center justify-between gap-2">
        <ClientsMetricsStrip
          totalClients={contacts.length}
          activeClients={state.flowIntelligence?.clients ?? contacts.filter((c) => c.status === "CLIENT").length}
          followUpsDue={state.segmentCounts["needs-followup"] ?? 0}
          atRisk={state.segmentCounts["at-risk"] ?? 0}
          newThisWeek={state.segmentCounts["new-this-week"] ?? 0}
          highValue={state.segmentCounts["high-value"] ?? 0}
          onSegmentClick={state.setActiveSegment}
        />
        {intelligence.moduleCoverage && (
          <AutomationCoverageIndicator
            coveragePct={intelligence.moduleCoverage.coveragePct}
            automatedCount={intelligence.moduleCoverage.automatedCount}
            totalProcesses={intelligence.moduleCoverage.totalProcesses}
          />
        )}
      </div>

      <GraphInsightsPanel
        recommendations={intelligence.recommendations}
        loading={intelligence.loading}
        onDismiss={intelligence.dismiss}
        onNavigate={(route) => router.push(route)}
      />

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

      <ProgressivePrompts moduleFilter={["customer", "sales", "partnerships"]} />


      {!crmAi.aiHook.useGlobalCopilot && (
        <>
          <AiHubTrigger ai={crmAi.aiHook} moduleName="Contacts" />
          <AnimatePresence>
            {crmAi.aiHook.panelOpen && (
              <AiCommandHub ai={crmAi.aiHook} moduleName="Contacts" onAction={handleCrmAiAction} />
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
