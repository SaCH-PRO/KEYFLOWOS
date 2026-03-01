"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { AiSearchBar } from "@/components/contacts/ai-search-bar";
import { AiChurnDetectionPanel } from "@/components/contacts/ai-churn-detection";
import type { SmartSegment } from "./pipeline-toolbar";
import { ContactsDatabase } from "./contacts-database";
import { InsightsTab } from "./insights-tab";
import { EngageTab } from "./engage-tab";
import { PipelineTabContent } from "./pipeline-tab-content";
import { GettingStartedGuide } from "./getting-started-guide";
import { useContactsPipeline } from "./use-contacts-pipeline";

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const googleHandled = useRef(false);
  const state = useContactsPipeline();

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
    flowIntelligence, flowDataLoading, revenueData,
    setStatusFilter,
    nextActions, autopilotActions, autopilotPaused,
    setAutopilotPaused,
    handleCompleteNextAction, handleDoAction,
    handleViewExpiringQuotes, handleViewOverdueInvoices,
    handleApproveAutopilot, handleDenyAutopilot,
    selectContact, loadFlowData,
  } = state;

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
        : decodeURIComponent(googleError);
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
  const handleTabChange = useCallback((t: string) => setCrmViewTab(t as "pipeline" | "insights" | "engage" | "database"), [setCrmViewTab]);

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
      />

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

      <AnimatePresence mode="wait">
        {crmViewTab === "pipeline" && (
          <motion.div
            key="pipeline"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <PipelineTabContent state={state} />
          </motion.div>
        )}

        {crmViewTab === "database" && businessId && (
          <motion.div
            key="database"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <ContactsDatabase
              businessId={businessId}
              contacts={databaseContacts}
              onRefresh={handleRefreshContacts}
              activeListId={activeListId}
              onSelectList={handleSelectList}
              onListsLoaded={setListsCount}
              onSelectContact={handleSelectDbContact}
            />
          </motion.div>
        )}

        {crmViewTab === "insights" && (
          <motion.div
            key="insights"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
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

        {crmViewTab === "engage" && (
          <motion.div
            key="engage"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
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
