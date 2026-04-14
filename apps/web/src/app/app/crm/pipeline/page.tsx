"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  Users, BarChart3, Layers,
} from "lucide-react";
import {
  BroadcastDrawer,
} from "@/components/contacts";
import { KanbanSkeleton } from "@/components/ui/skeleton";
import { WorkspaceError } from "@/components/ui/workspace-error";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProgressivePrompts } from "../../profile/components/progressive-prompts";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { InfoBadge } from "@/components/ui/info-badge";
import { CRM_WALKTHROUGH } from "@/lib/walkthrough-definitions";
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

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const googleHandled = useRef(false);
  const state = useContactsPipeline();
  const crmAi = useCrmAiHub();
  const { checkLimit } = usePlan();
  const emitEvent = useModuleEmit();
  const [slideDirection, setSlideDirection] = useState(0);
  const { setCurrentMeta } = useNavigationContext();
  useReturnNavigation({ restoreScrollOnMount: true });

  const CRM_TABS = ["contacts"];

  const {
    workspaceLoading, workspaceError, businessId,
    crmViewTab, setCrmViewTab,
    showBroadcast, setShowBroadcast,
    confirmState, setConfirmState,
    selectedContactsForBroadcast,
    selectedIds, setSelectedIds, setSelectMode,
    contacts, loadContacts,
    activeListId, setActiveListId, setActiveListContactIds,
    setListsCount,
    flowIntelligence, flowDataLoading, revenueData, aiNextActions,
    setStatusFilter,
    nextActions, autopilotActions, autopilotPaused,
    setAutopilotPaused,
    handleCompleteNextAction, handleDoAction,
    handleViewExpiringQuotes, handleViewOverdueInvoices,
    handleApproveAutopilot, handleDenyAutopilot,
    selectContact, loadFlowData,
  } = state;

  useEffect(() => {
    if (businessId) {
      crmAi.updateCrmContext({
        businessId,
        activeView: crmViewTab,
        contactCount: contacts.length,
        selectedContactId: state.selectedContact?.id,
      });
    }
  }, [businessId, crmViewTab, contacts.length, state.selectedContact?.id, crmAi.updateCrmContext]);


  const crmShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "CRM Navigation",
      shortcuts: [
        { key: "n", description: "New client", action: () => state.setShowAddMenu(true) },
        { key: "f", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('input[aria-label="Search clients"]'); el?.focus(); } },
        { key: "1", description: "Clients tab", action: () => setCrmViewTab("contacts") },
        { key: "r", description: "Refresh clients", action: () => { void loadContacts(); void loadFlowData(); } },
        { key: "b", description: "Open broadcast", action: () => state.setShowBroadcast(true) },
      ],
    },
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
  }, [searchParams, router, loadContacts, loadFlowData, state.setShowAddMenu]);

  const confirmStateRef = useRef(confirmState);
  confirmStateRef.current = confirmState;

  const handleCloseBroadcast = useCallback(() => setShowBroadcast(false), [setShowBroadcast]);
  const handleDeselectAll = useCallback(() => { setSelectedIds(new Set()); setSelectMode(false); }, [setSelectedIds, setSelectMode]);
  const handleConfirmAction = useCallback(() => { confirmStateRef.current.action(); setConfirmState({ open: false, action: () => {} }); }, [setConfirmState]);
  const handleCancelConfirm = useCallback(() => setConfirmState({ open: false, action: () => {} }), [setConfirmState]);
  const handleRefreshContacts = useCallback(() => { void loadContacts(); }, [loadContacts]);
  const handleSelectList = useCallback((listId: string | null, contactIds?: string[] | null) => {
    setActiveListId(listId);
    setActiveListContactIds(contactIds || null);
    if (listId) setCrmViewTab("contacts");
  }, [setActiveListId, setActiveListContactIds, setCrmViewTab]);
  const handleSelectDbContact = useCallback((id: string) => { selectContact(id); setCrmViewTab("contacts"); }, [selectContact, setCrmViewTab]);
  const handleViewCold = useCallback(() => { setStatusFilter("LEAD"); setCrmViewTab("contacts"); }, [setStatusFilter, setCrmViewTab]);
  const handleViewReady = useCallback(() => { setStatusFilter("PROSPECT"); setCrmViewTab("contacts"); }, [setStatusFilter, setCrmViewTab]);
  const handleInsightsRefresh = useCallback(() => { void loadContacts(); void loadFlowData(); }, [loadContacts, loadFlowData]);
  const handleNavigatePipeline = useCallback((filter?: { status?: string; segment?: string }) => {
    if (filter?.status) setStatusFilter(filter.status);
    if (filter?.segment) state.setActiveSegment(filter.segment as any);
    setCrmViewTab("contacts");
  }, [setStatusFilter, setCrmViewTab, state.setActiveSegment]);
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

  const { swipeHandlers } = useSwipeTabs({
    tabs: CRM_TABS,
    activeTab: crmViewTab,
    onTabChange: handleTabChange,
  });

  const databaseContacts = useMemo(() => contacts.map((c) => ({
    id: c.id,
    firstName: c.firstName ?? null, lastName: c.lastName ?? null,
    email: c.email ?? null, phone: c.phone ?? null,
    status: c.status ?? "LEAD", source: c.source ?? null,
    tags: Array.isArray(c.tags) ? c.tags : [],
    companyName: c.companyName ?? null, jobTitle: c.jobTitle ?? null,
    city: c.city ?? null, country: c.country ?? null,
    preferredChannel: c.preferredChannel ?? null,
    createdAt: c.createdAt ?? null,
    addressLine1: c.addressLine1 ?? null, addressLine2: c.addressLine2 ?? null,
    whatsappNumber: c.whatsappNumber ?? null,
    department: c.department ?? null, industry: c.industry ?? null,
    lifecycleStage: c.lifecycleStage ?? null,
    sourceDetail: c.sourceDetail ?? null, notesInternal: c.notesInternal ?? null,
    updatedAt: c.updatedAt ?? null,
    secondaryEmail: c.secondaryEmail ?? null, secondaryPhone: c.secondaryPhone ?? null,
    displayName: c.displayName ?? null, segment: c.segment ?? null,
    language: c.language ?? null, timezone: c.timezone ?? null,
    state: c.state ?? null, postalCode: c.postalCode ?? null,
    marketingOptIn: c.marketingOptIn ?? null,
    doNotContact: c.doNotContact ?? null,
    custom: c.custom ?? null,
  })), [contacts]);

  if (workspaceLoading) return <KanbanSkeleton />;

  if (workspaceError) {
    return <WorkspaceError />;
  }

  return (
    <div className="space-y-4" aria-label="Clients Workspace">
      <ResumePrompt module="crm" />
      <PageHeader
        icon={Users}
        title="Clients"
        subtitle={<span className="inline-flex items-center gap-1.5">Manage relationships, follow-ups, health, and client activity across your pipeline <InfoBadge title="Client Workspace" body="Your client workspace centralizes relationship intelligence, communication history, and AI-powered insights. Use Smart Segments to triage clients by engagement and health." side="bottom" iconSize={12} /></span>}
        titleExtra={<PageGuideTrigger moduleKey="crm" />}
      />


      {(() => {
        const cl = checkLimit("contacts");
        return <PlanLimitBanner resourceKey="contacts" label="contacts" currentUsage={cl.current} limit={cl.limit} isUnlimited={cl.isUnlimited} nearLimit={cl.nearLimit} atLimit={cl.atLimit} upgradeTo={cl.upgradeTo} />;
      })()}

      <ClientsMetricsStrip
        totalClients={contacts.length}
        activeClients={state.flowIntelligence?.clients ?? contacts.filter((c) => c.status === "CLIENT").length}
        followUpsDue={state.segmentCounts["needs-followup"] ?? 0}
        atRisk={state.segmentCounts["at-risk"] ?? 0}
        newThisWeek={state.segmentCounts["new-this-week"] ?? 0}
        highValue={state.segmentCounts["high-value"] ?? 0}
        onSegmentClick={state.setActiveSegment}
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

      <PageGuide
        moduleKey="crm"
        walkthroughSteps={CRM_WALKTHROUGH}
      />

      <AiHubTrigger ai={crmAi.aiHook} moduleName="Clients" />
      <AnimatePresence>
        {crmAi.aiHook.panelOpen && (
          <AiCommandHub ai={crmAi.aiHook} moduleName="Clients" />
        )}
      </AnimatePresence>
    </div>
  );
}
