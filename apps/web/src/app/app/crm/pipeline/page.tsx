"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Users, X, BarChart3, Sparkles, Database, Lightbulb,
} from "lucide-react";
import {
  ContactCardData,
  BroadcastDrawer,
} from "@/components/contacts";
import { KanbanSkeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { ContactsDatabase } from "./contacts-database";
import { InsightsTab } from "./insights-tab";
import { EngageTab } from "./engage-tab";
import { PipelineTabContent } from "./pipeline-tab-content";
import { useContactsPipeline } from "./use-contacts-pipeline";

export default function ContactsPage() {
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
    flowIntelligence, revenueData,
    setStatusFilter,
    nextActions, autopilotActions, autopilotPaused,
    setAutopilotPaused, setAutopilotActions,
    handleCompleteNextAction, handleDoAction,
    selectContact,
  } = state;

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
          <div className="relative">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                showGuide
                  ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
                  : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
              }`}
              aria-label="Getting started guide"
              title="Getting started guide"
            >
              <Lightbulb className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showGuide && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 rounded-lg bg-amber-400/10">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Getting Started</h4>
                        <p className="text-[11px] text-muted-foreground">Your quick-start guide</p>
                      </div>
                      <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { step: "1", title: "Add Contacts", desc: "Create contacts manually, or they auto-appear from bookings, store orders, and lead forms." },
                        { step: "2", title: "Segment & Filter", desc: "Use smart segments (High Value, New This Week, At Risk) to focus on key contacts." },
                        { step: "3", title: "Track Revenue", desc: "See total revenue, invoice count, and booking history for each contact." },
                        { step: "4", title: "Communicate", desc: "Reach out via WhatsApp, email, or phone directly from any contact card." },
                        { step: "5", title: "Broadcast Messages", desc: "Select multiple contacts and send bulk WhatsApp or email messages." },
                        { step: "6", title: "Quick Actions", desc: "Create invoices, send quotes, or book appointments directly from a contact." },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                            {item.step}
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        }
      />

      <TabNav
        tabs={[
          { key: "pipeline", label: "Pipeline", icon: Users },
          { key: "database", label: "Database", icon: Database },
          { key: "insights", label: "Insights", icon: BarChart3 },
          { key: "engage", label: "Engage", icon: Sparkles },
        ]}
        activeTab={crmViewTab}
        onTabChange={(t) => setCrmViewTab(t as "pipeline" | "insights" | "engage" | "database")}
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
              contacts={contacts.map((c) => ({
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
              }))}
              onRefresh={() => { void loadContacts(); }}
              activeListId={activeListId}
              onSelectList={(listId, contactIds) => {
                setActiveListId(listId);
                setActiveListContactIds(contactIds || null);
                if (listId) setCrmViewTab("pipeline");
              }}
              onListsLoaded={(count) => setListsCount(count)}
              onSelectContact={(id) => { selectContact(id); setCrmViewTab("pipeline"); }}
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
              onViewCold={() => { setStatusFilter("LEAD"); setCrmViewTab("pipeline"); }}
              onViewReady={() => { setStatusFilter("PROSPECT"); setCrmViewTab("pipeline"); }}
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
              onComplete={handleCompleteNextAction}
              onViewContact={(id) => { selectContact(id); setCrmViewTab("pipeline"); }}
              onDoAction={handleDoAction}
              onTogglePause={() => setAutopilotPaused(!autopilotPaused)}
              onApprove={async (id) => {
                setAutopilotActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: "completed" as const } : a)));
              }}
              onDeny={async (id) => {
                setAutopilotActions((prev) => prev.filter((a) => a.id !== id));
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <BroadcastDrawer
        isOpen={showBroadcast}
        onClose={() => setShowBroadcast(false)}
        selectedContacts={selectedContactsForBroadcast}
        onDeselectAll={() => { setSelectedIds(new Set()); setSelectMode(false); }}
      />
      <ConfirmDialog
        open={confirmState.open}
        title="Delete Contact"
        message="Are you sure you want to delete this contact? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { confirmState.action(); setConfirmState({ open: false, action: () => {} }); }}
        onCancel={() => setConfirmState({ open: false, action: () => {} })}
      />
    </div>
  );
}
