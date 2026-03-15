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
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { ContactsDatabase } from "./contacts-database";
import { InsightsTab } from "./insights-tab";
import { PipelineTabContent } from "./pipeline-tab-content";
import { useContactsPipeline } from "./use-contacts-pipeline";
import { useCrmAiHub } from "./hooks/use-crm-ai-hub";
import { renderCrmToolResult } from "./components/crm-tool-results";
import { useKeyboardShortcuts, type ShortcutGroup } from "@/hooks/use-keyboard-shortcuts";
import { useModuleEmit } from "@/hooks/use-module-events";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const googleHandled = useRef(false);
  const state = useContactsPipeline();
  const crmAi = useCrmAiHub();
  const emitEvent = useModuleEmit();
  const [slideDirection, setSlideDirection] = useState(0);

  const CRM_TABS = ["contacts", "insights", "studio"];

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

  const handleAiAssistantAction = useCallback((actionKey: string) => {
    const { type, contactId } = crmAi.parseActionKey(actionKey);
    if (contactId) {
      selectContact(contactId);
      setCrmViewTab("contacts");
    }
    if (type === "follow_up" || type === "check_in" || type === "re_engage") {
      toast.success("Opening contact for follow-up...");
    } else if (type === "send_quote") {
      toast.success("Opening contact to create a quote...");
    }
  }, [crmAi.parseActionKey, selectContact, setCrmViewTab]);

  const crmShortcuts = useMemo<ShortcutGroup[]>(() => [
    {
      groupName: "CRM Navigation",
      shortcuts: [
        { key: "n", description: "New contact", action: () => state.setShowAddMenu(true) },
        { key: "f", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('input[aria-label="Search contacts"]'); el?.focus(); } },
        { key: "1", description: "Contacts tab", action: () => setCrmViewTab("contacts") },
        { key: "2", description: "Insights tab", action: () => setCrmViewTab("insights") },
        { key: "3", description: "Studio tab", action: () => setCrmViewTab("studio") },
        { key: "r", description: "Refresh contacts", action: () => { void loadContacts(); void loadFlowData(); } },
        { key: "b", description: "Open broadcast", action: () => state.setShowBroadcast(true) },
        { key: "a", shift: true, description: "Toggle AI Hub", action: () => crmAi.togglePanel() },
        { key: "Escape", description: "Close panels", action: () => { if (crmAi.hubMode === "tool-result") crmAi.clearToolResult(); else if (crmAi.panelOpen) crmAi.setOpen(false); } },
      ],
    },
  ], [setCrmViewTab, loadContacts, loadFlowData, state.setShowAddMenu, state.setShowBroadcast, crmAi.panelOpen, crmAi.setOpen, crmAi.togglePanel, crmAi.hubMode, crmAi.clearToolResult]);

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
    emitEvent("module:tab_changed", "crm", { tab: t });
  }, [crmViewTab, setCrmViewTab, emitEvent]);

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
    <div className="space-y-6" aria-label="CRM Pipeline">
      <PageHeader
        icon={Users}
        title="Contacts"
        subtitle="Your AI-powered contact management hub"
        titleExtra={
          <FeatureGuide
            featureKey="crm-pipeline"
            title="Getting Started with CRM"
            description="Manage your contacts, track relationships, and grow your business."
            steps={[
              { title: "Add Contacts", description: "Create manually, scan business cards, import CSV/VCF, or sync from Google Contacts." },
              { title: "Smart Segments", description: "Filter with one-tap segments like High Value, New This Week, and At Risk." },
              { title: "Communicate", description: "Reach out via WhatsApp, email, or phone directly from any contact card." },
              { title: "Bulk Actions", description: "Select multiple contacts for broadcast messages, tagging, or status updates." },
              { title: "Insights & AI", description: "Track pipeline health, revenue data, and use AI tools for summaries and scoring." },
              { title: "Studio", description: "Use the database view for bulk operations, smart lists, and data cleanup." },
            ]}
          />
        }
      />

      <AnimatePresence>
        {crmAi.panelOpen && (
          <AiCommandHub
            ai={crmAi}
            moduleName="CRM"
            onAction={handleAiAssistantAction}
            toolResultRenderer={renderCrmToolResult}
          />
        )}
      </AnimatePresence>
      <AiHubTrigger ai={crmAi} moduleName="CRM" />

      <TabNav
        tabs={[
          { key: "contacts", label: "Contacts", icon: Users },
          { key: "insights", label: "Insights", icon: BarChart3 },
          { key: "studio", label: "Studio", icon: Layers },
        ]}
        activeTab={crmViewTab}
        onTabChange={handleTabChange}
      />

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={slideDirection}>
          {crmViewTab === "contacts" && (
            <motion.div
              key="contacts"
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
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
            </motion.div>
          )}

          {crmViewTab === "insights" && (
            <motion.div
              key="insights"
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <InsightsTab
                flowIntelligence={flowIntelligence}
                revenueData={revenueData}
                contacts={contacts}
                loading={flowDataLoading}
                businessId={businessId}
                onViewCold={handleViewCold}
                onViewReady={handleViewReady}
                onViewExpiringQuotes={handleViewExpiringQuotes}
                onViewOverdueInvoices={handleViewOverdueInvoices}
                onRefresh={handleInsightsRefresh}
                onNavigatePipeline={handleNavigatePipeline}
              />
            </motion.div>
          )}

          {crmViewTab === "studio" && businessId && (
            <motion.div
              key="studio"
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <ContactsDatabase
                businessId={businessId}
                contacts={databaseContacts}
                onRefresh={handleRefreshContacts}
                activeListId={activeListId}
                onSelectList={handleSelectList}
                onListsLoaded={setListsCount}
                onSelectContact={handleSelectDbContact}
                favoriteIds={state.favoriteIds}
                onToggleFavorite={state.handleToggleFavorite}
              />
            </motion.div>
          )}
        </AnimatePresence>
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
  );
}
