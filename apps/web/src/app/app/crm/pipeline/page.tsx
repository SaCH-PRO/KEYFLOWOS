"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  Users, BarChart3, Sparkles, Database,
} from "lucide-react";
import {
  ContactCardData,
  BroadcastDrawer,
} from "@/components/contacts";
import { KanbanSkeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { AiSearchBar, type CrmCommand } from "@/components/contacts/ai-search-bar";
import { aiExecuteCommand } from "@/lib/client";
import { AiCommandHub, AiHubTrigger } from "@/components/ai/ai-command-hub";
import type { SmartSegment } from "./pipeline-toolbar";
import { ContactsDatabase } from "./contacts-database";
import { InsightsTab } from "./insights-tab";
import { EngageTab } from "./engage-tab";
import { PipelineTabContent } from "./pipeline-tab-content";
import { GettingStartedGuide } from "./getting-started-guide";
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

  const CRM_TABS = ["pipeline", "database", "insights", "engage"];

  const {
    workspaceLoading, workspaceError, businessId,
    crmViewTab, setCrmViewTab,
    showGuide, setShowGuide,
    showBroadcast, setShowBroadcast,
    confirmState, setConfirmState,
    selectedContactsForBroadcast,
    selectedIds, setSelectedIds, setSelectMode,
    contacts, loadContacts,
    activeListId, setActiveListId, setActiveListContactIds,
    setListsCount,
    flowIntelligence, flowDataLoading, revenueData, financialGrowth,
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
      setCrmViewTab("pipeline");
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
        { key: "f", description: "Focus search", action: () => { const el = document.querySelector<HTMLInputElement>('[data-ai-search]'); el?.focus(); } },
        { key: "1", description: "Pipeline tab", action: () => setCrmViewTab("pipeline") },
        { key: "2", description: "Database tab", action: () => setCrmViewTab("database") },
        { key: "3", description: "Insights tab", action: () => setCrmViewTab("insights") },
        { key: "4", description: "Engage tab", action: () => setCrmViewTab("engage") },
        { key: "r", description: "Refresh contacts", action: () => { void loadContacts(); void loadFlowData(); } },
        { key: "b", description: "Open broadcast", action: () => state.setShowBroadcast(true) },
        { key: "g", description: "Toggle guide", action: () => setShowGuide((p: boolean) => !p) },
        { key: "a", shift: true, description: "Toggle AI Hub", action: () => crmAi.togglePanel() },
        { key: "Escape", description: "Close panels", action: () => { if (crmAi.hubMode === "tool-result") crmAi.clearToolResult(); else if (crmAi.panelOpen) crmAi.setOpen(false); } },
      ],
    },
  ], [setCrmViewTab, loadContacts, loadFlowData, state.setShowAddMenu, state.setShowBroadcast, setShowGuide, crmAi.panelOpen, crmAi.setOpen, crmAi.togglePanel, crmAi.hubMode, crmAi.clearToolResult]);

  useKeyboardShortcuts(crmShortcuts, !workspaceLoading);

  useEffect(() => {
    if (googleHandled.current) return;
    const googleSuccess = searchParams.get("google_success");
    const googleError = searchParams.get("google_error");
    const imported = searchParams.get("imported");
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
    }
  }, [searchParams, router, loadContacts, loadFlowData]);

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
    if (listId) setCrmViewTab("pipeline");
  }, [setActiveListId, setActiveListContactIds, setCrmViewTab]);
  const handleSelectDbContact = useCallback((id: string) => { selectContact(id); setCrmViewTab("pipeline"); }, [selectContact, setCrmViewTab]);
  const handleViewCold = useCallback(() => { setStatusFilter("LEAD"); setCrmViewTab("pipeline"); }, [setStatusFilter, setCrmViewTab]);
  const handleViewReady = useCallback(() => { setStatusFilter("PROSPECT"); setCrmViewTab("pipeline"); }, [setStatusFilter, setCrmViewTab]);
  const handleInsightsRefresh = useCallback(() => { void loadContacts(); void loadFlowData(); }, [loadContacts, loadFlowData]);
  const handleNavigatePipeline = useCallback((filter?: { status?: string; segment?: string }) => {
    if (filter?.status) setStatusFilter(filter.status);
    if (filter?.segment) state.setActiveSegment(filter.segment as any);
    setCrmViewTab("pipeline");
  }, [setStatusFilter, setCrmViewTab, state.setActiveSegment]);
  const handleViewEngageContact = useCallback((id: string) => { selectContact(id); setCrmViewTab("pipeline"); }, [selectContact, setCrmViewTab]);
  const handleToggleAutopilotPause = useCallback(() => setAutopilotPaused((prev: boolean) => !prev), [setAutopilotPaused]);
  const handleToggleGuide = useCallback(() => setShowGuide((prev: boolean) => !prev), [setShowGuide]);
  const handleGuideAddContact = useCallback(() => state.setShowAddMenu(true), [state.setShowAddMenu]);
  const handleGuideSegment = useCallback((segment: string) => { state.setActiveSegment(segment as SmartSegment); setCrmViewTab("pipeline"); }, [state.setActiveSegment, setCrmViewTab]);
  const handleGuideSelectMode = useCallback(() => { state.handleToggleSelectMode(); setCrmViewTab("pipeline"); }, [state.handleToggleSelectMode, setCrmViewTab]);
  const handleTabChange = useCallback((t: string) => {
    if (t === crmViewTab) return;
    const oldIndex = CRM_TABS.indexOf(crmViewTab);
    const newIndex = CRM_TABS.indexOf(t);
    setSlideDirection(newIndex > oldIndex ? 1 : -1);
    setCrmViewTab(t as "pipeline" | "insights" | "engage" | "database");
    emitEvent("module:tab_changed", "crm", { tab: t });
  }, [crmViewTab, setCrmViewTab, emitEvent]);

  const { swipeHandlers } = useSwipeTabs({
    tabs: CRM_TABS,
    activeTab: crmViewTab,
    onTabChange: handleTabChange,
  });

  const handleAiCommand = useCallback((cmd: CrmCommand) => {
    switch (cmd.type) {
      case "add_contact":
        state.setShowAddForm(true);
        toast.success("Opening add contact form...");
        break;
      case "edit_contact":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        setTimeout(() => state.handleEditContact(), 300);
        toast.success("Opening contact for editing...");
        break;
      case "delete_contact":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        setTimeout(() => state.handleDeleteContact(), 300);
        break;
      case "view_contact":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        toast.success("Navigating to contact...");
        break;
      case "change_status":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        state.handleUpdateStatus(cmd.status);
        toast.success(`Status updated to ${cmd.status}`);
        break;
      case "add_note":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        if (cmd.body) {
          setTimeout(() => {
            state.handleAddNote(cmd.body!);
            toast.success("Note added");
          }, 400);
        } else {
          toast.success("Opening contact — add your note in the Notes tab");
        }
        break;
      case "add_task":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        if (cmd.title) {
          setTimeout(() => {
            state.handleAddTask(cmd.title!);
            toast.success("Task created");
          }, 400);
        } else {
          toast.success("Opening contact — add your task in the Tasks tab");
        }
        break;
      case "log_communication":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        toast.success("Opening contact — use the Log Interaction button");
        break;
      case "switch_tab":
        setCrmViewTab(cmd.tab as "pipeline" | "database" | "insights" | "engage");
        toast.success(`Switched to ${cmd.tab} view`);
        break;
      case "filter_status":
        if (cmd.status === "all") {
          setStatusFilter("");
        } else {
          setStatusFilter(cmd.status);
        }
        setCrmViewTab("pipeline");
        toast.success(cmd.status === "all" ? "Showing all contacts" : `Filtered to ${cmd.status} contacts`);
        break;
      case "open_broadcast":
        state.setShowBroadcast(true);
        toast.success("Opening broadcast tool...");
        break;
      case "import_contacts":
        state.setShowAddMenu(true);
        toast.success("Opening contact import...");
        break;
      case "show_favorites":
        state.setActiveSegment("favorites" as any);
        setCrmViewTab("pipeline");
        toast.success("Showing favorite contacts");
        break;
      case "toggle_favorite":
        state.handleToggleFavorite(cmd.contactId);
        break;
      case "bulk_tag":
        if (state.selectedIds.size > 0) {
          cmd.tags.forEach(tag => state.handleBulkTag(tag));
          toast.success(`Tags applied to ${state.selectedIds.size} contacts`);
        } else {
          toast.info("Select contacts first, then try again");
        }
        break;
      case "generate_ai_summary":
      case "generate_ai_score":
      case "generate_prep_brief":
      case "suggest_tags":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        toast.success("Opening contact — use the AI tools in the detail panel");
        break;
      case "search_contacts":
        state.setSearchInput(cmd.query);
        setCrmViewTab("pipeline");
        break;
      case "find_duplicates":
        setCrmViewTab("insights");
        toast.success("Switching to Insights — use the Duplicate Finder AI tool");
        break;
      case "data_cleanup":
        setCrmViewTab("insights");
        toast.success("Switching to Insights — use the Data Quality AI tool");
        break;
      case "merge_contacts": {
        const sourceId = cmd.params?.sourceId as string;
        const targetId = cmd.params?.targetId as string;
        if (sourceId && targetId) {
          selectContact(targetId);
          setCrmViewTab("pipeline");
          toast.success("Opening target contact — use the merge option in the detail panel");
        } else {
          toast.info("Specify the two contacts to merge");
        }
        break;
      }
      case "bulk_delete":
        toast.warning("Bulk delete must be confirmed manually for safety");
        break;
      case "create_quote":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        toast.success("Opening contact — create a quote from the Quick Actions menu");
        break;
      case "create_invoice":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        toast.success("Opening contact — create an invoice from the Quick Actions menu");
        break;
      case "generate_follow_up":
        selectContact(cmd.contactId);
        setCrmViewTab("pipeline");
        toast.success("Opening contact — use the Follow-up Drafter AI tool");
        break;
      case "revenue_scan":
        setCrmViewTab("insights");
        toast.success("Switching to Insights — use the Revenue Opportunity AI tool");
        break;
      case "reengagement_scan":
        setCrmViewTab("engage");
        toast.success("Switching to Engage — use the Re-engagement AI tool");
        break;
      case "ai_execute": {
        const executing = toast.loading("Executing AI command...");
        aiExecuteCommand(cmd.action, cmd.params, cmd.contactId).then(result => {
          toast.dismiss(executing);
          if (result.data?.success) {
            toast.success(result.data.message);
            loadContacts();
          } else {
            toast.error(result.data?.message ?? result.error ?? "Command failed");
          }
        }).catch(() => {
          toast.dismiss(executing);
          toast.error("Command execution failed");
        });
        break;
      }
    }
  }, [selectContact, setCrmViewTab, setStatusFilter, state]);

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
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{workspaceError}</p>
          <p className="text-muted-foreground">Try logging in again to create your workspace.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" aria-label="CRM Pipeline">
      <PageHeader
        icon={Users}
        title="Contacts"
        subtitle="Your AI-powered contact management hub"
        titleExtra={
          <GettingStartedGuide
            isOpen={showGuide}
            onToggle={handleToggleGuide}
            onAddContact={handleGuideAddContact}
            onSegmentChange={handleGuideSegment}
            onToggleSelectMode={handleGuideSelectMode}
            onTabChange={handleTabChange}
          />
        }
      />

      <AiSearchBar
        onSelectContact={(id) => { selectContact(id); setCrmViewTab("pipeline"); }}
        onExecuteCommand={handleAiCommand}
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
          { key: "pipeline", label: "Pipeline", icon: Users },
          { key: "database", label: "Database", icon: Database },
          { key: "insights", label: "Insights", icon: BarChart3 },
          { key: "engage", label: "Engage", icon: Sparkles },
        ]}
        activeTab={crmViewTab}
        onTabChange={handleTabChange}
      />

      <div {...swipeHandlers} className="touch-pan-y">
        <AnimatePresence mode="wait" custom={slideDirection}>
          {crmViewTab === "pipeline" && (
            <motion.div
              key="pipeline"
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <PipelineTabContent state={state} />
            </motion.div>
          )}

          {crmViewTab === "database" && businessId && (
            <motion.div
              key="database"
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
                financialGrowth={financialGrowth}
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

          {crmViewTab === "engage" && (
            <motion.div
              key="engage"
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <EngageTab
                nextActions={nextActions}
                autopilotActions={autopilotActions}
                autopilotPaused={autopilotPaused}
                loading={flowDataLoading}
                businessId={businessId ?? undefined}
                onComplete={handleCompleteNextAction}
                onViewContact={handleViewEngageContact}
                onDoAction={handleDoAction}
                onTogglePause={handleToggleAutopilotPause}
                onApprove={handleApproveAutopilot}
                onDeny={handleDenyAutopilot}
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
