"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { X, List, Heart, ChevronDown, Zap, Bot, Receipt, Calendar, StickyNote, CheckCircle2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { createContact, fetchContactLists } from "@/lib/client";
import { STATUS_COLORS } from "@/lib/crm-utils";
import {
  ContactCapture,
  ContactForm,
  ContactImport,
  type ContactCardData,
} from "@/components/contacts";
import { NextActionQueue } from "@/components/contacts";
import { AutopilotActions } from "@/components/contacts";
import type { NextAction } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";
import { useOpenComposer } from "@/hooks/use-open-composer";
import { BulkActionBar } from "./bulk-action-bar";
import { PipelineToolbar } from "./pipeline-toolbar";
import type { ViewMode } from "./pipeline-toolbar";
import { PipelineContactList } from "./pipeline-contact-list";
import { PipelineDetailPanel } from "./pipeline-detail-panel";
import { PipelineKanban } from "./pipeline-kanban";
import { DuplicateDetector } from "./duplicate-detector";
import type { PipelineState } from "./use-contacts-pipeline";

interface PipelineTabContentProps {
  state: PipelineState;
  nextActions?: NextAction[];
  autopilotActions?: AutopilotAction[];
  autopilotPaused?: boolean;
  onCompleteNextAction?: (id: string) => Promise<void>;
  onViewEngageContact?: (id: string) => void;
  onDoAction?: (action: NextAction) => void;
  onToggleAutopilotPause?: () => void;
  onApproveAutopilot?: (id: string) => Promise<void>;
  onDenyAutopilot?: (id: string) => Promise<void>;
}

function SelectedContextStrip({ contact, invoices, bookings, notes, tasks }: {
  contact: { firstName?: string | null; lastName?: string | null; preferredChannel?: string | null; meta?: { outstandingBalance?: number | null } | null };
  invoices?: Array<{ id: string; status: string; total?: number | null; currency?: string | null }>;
  bookings?: Array<{ id: string; startTime: string; status: string; service?: { name: string } | null }>;
  notes?: Array<{ id: string; body: string }>;
  tasks?: Array<{ id: string; status?: string | null }>;
}) {
  // eslint-disable-next-line react-hooks/purity -- audited: time-relative next booking lookup
  const latestBooking = bookings?.find(b => new Date(b.startTime).getTime() > Date.now());
  const pendingInvoice = invoices?.find(i => i.status === "SENT" || i.status === "OVERDUE");
  const latestNote = notes?.[0];
  const pendingTasks = tasks?.filter(t => t.status !== "COMPLETED" && t.status !== "CANCELLED") ?? [];
  const name = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Client";

  const items: Array<{ icon: typeof Receipt; text: string; color: string }> = [];

  if (latestBooking) {
    const date = new Date(latestBooking.startTime);
    items.push({ icon: Calendar, text: `${latestBooking.service?.name ?? "Booking"} ${date.toLocaleDateString("en-TT", { month: "short", day: "numeric" })}`, color: "text-blue-400" });
  }
  if (pendingInvoice) {
    items.push({ icon: Receipt, text: `${pendingInvoice.status === "OVERDUE" ? "Overdue" : "Pending"} invoice${pendingInvoice.total ? ` · TTD ${pendingInvoice.total.toLocaleString()}` : ""}`, color: pendingInvoice.status === "OVERDUE" ? "text-red-400" : "text-amber-400" });
  }
  if (pendingTasks.length > 0) {
    items.push({ icon: CheckCircle2, text: `${pendingTasks.length} open task${pendingTasks.length > 1 ? "s" : ""}`, color: "text-[hsl(var(--kf-accent1))]" });
  }
  if (latestNote) {
    items.push({ icon: StickyNote, text: latestNote.body.slice(0, 40) + (latestNote.body.length > 40 ? "…" : ""), color: "text-yellow-400" });
  }
  if (contact.preferredChannel) {
    items.push({ icon: MessageCircle, text: `Prefers ${contact.preferredChannel}`, color: "text-emerald-400" });
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-xl border border-border/30 bg-white/[0.02] overflow-x-auto scrollbar-hide">
      <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider flex-shrink-0">{name}</span>
      <div className="w-px h-4 bg-border/30 flex-shrink-0" />
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
          <item.icon className={`w-3 h-3 ${item.color}`} />
          <span className="text-[11px] text-muted-foreground">{item.text}</span>
          {i < items.length - 1 && <span className="text-muted-foreground/20 ml-1">·</span>}
        </div>
      ))}
    </div>
  );
}

const PIPELINE_VIEW_KEY = "kf_pipeline_view";

function getStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "list";
  try {
    const stored = localStorage.getItem(PIPELINE_VIEW_KEY);
    return stored === "kanban" ? "kanban" : "list";
  } catch {
    return "list";
  }
}

function PipelineTabContentInner({ state, nextActions, autopilotActions, autopilotPaused, onCompleteNextAction, onViewEngageContact, onDoAction, onToggleAutopilotPause, onApproveAutopilot, onDenyAutopilot }: PipelineTabContentProps) {
  const {
    businessId,
    displayContacts, loading, loadError, hasMore, activeListTab,
    selectedContactId, selectMode, selectedIds, pinnedIds,
    showAddMenu, setShowAddMenu,
    showAddForm, setShowAddForm,
    editingContact, setEditingContact,
    showMobileDetail, setShowMobileDetail,
    isPending,
    activeListId, setActiveListId,  setActiveListContactIds,
    searchInput, setSearchInput,
    statusFilter, setStatusFilter,
    sortBy, setSortBy,
    activeSegment, setActiveSegment,
    segmentCounts, pinnedContacts, recentContacts, contacts,
    favoriteIds, favoriteContacts, handleToggleFavorite,
    setShowBroadcast,
    detailPanelProps,
    loadContacts, loadFlowData, selectContact,
    handleSubmitContact, handleImportFile, handleImportLink, handleDeviceImport,
    handleToggleSelect, handleTogglePin,
    handleDeleteContact, handleQuickAction,
    handleSelectAll, handleBulkStatusChange, handleBulkTag, handleBulkDelete,
    handleBulkAddToList, bulkLoading,
    handleToggleSelectMode,
  } = state;

  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const [showImport, setShowImport] = useState(false);
  const [showEngageSection, setShowEngageSection] = useState(true);
  const [pipelineLists, setPipelineLists] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!businessId || !selectMode) return;
    let cancelled = false;
    fetchContactLists(businessId).then(({ data }) => {
      if (cancelled || !data) return;
      const manual = (data as { id: string; name: string; type?: string }[]).filter((l) => l.type === "MANUAL");
      setPipelineLists(manual.map((l) => ({ id: l.id, name: l.name })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [businessId, selectMode]);
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try { localStorage.setItem(PIPELINE_VIEW_KEY, mode); } catch {}
  }, []);
  const handleToggleImport = useCallback(() => setShowImport((prev) => !prev), []);

  const detailPanelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevSelectedRef = useRef<string | null>(null);

  const handleQuickCreate = useCallback(async (data: { firstName: string; lastName?: string; email?: string; phone?: string; status?: string; source?: string }) => {
    if (!businessId) return;
    try {
      const { data: result } = await createContact({
        businessId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        source: data.source ?? "manual",
        status: data.status ?? "LEAD",
      });
      if (result) {
        toast.success(`${data.firstName} added`);
        void loadContacts();
        void loadFlowData();
      }
    } catch {
      toast.error("Failed to create contact");
    }
  }, [businessId, loadContacts, loadFlowData]);

  const handleRefresh = useCallback(() => { void loadContacts(); void loadFlowData(); }, [loadContacts, loadFlowData]);
  const handleToggleAddMenu = useCallback(() => setShowAddMenu((prev: boolean) => !prev), [setShowAddMenu]);
  const handleCloseAddMenu = useCallback(() => setShowAddMenu(false), [setShowAddMenu]);
  const handleMergeComplete = useCallback(() => { void loadContacts(); }, [loadContacts]);
  const handleLoadMore = useCallback(() => loadContacts({ append: true }), [loadContacts]);
  const handleRetry = useCallback(() => { void loadContacts(); }, [loadContacts]);
  const handleOpenAddForm = useCallback(() => setShowAddForm(true), [setShowAddForm]);
  const handleOpenBroadcast = useCallback(() => setShowBroadcast(true), [setShowBroadcast]);
  const openComposer = useOpenComposer();
  const handleOpenComposer = useCallback(() => {
    const names = contacts.filter(c => selectedIds.has(c.id)).map(c => c.displayName || c.firstName || c.email).filter(Boolean);
    openComposer({ contentType: "email", subject: names.length ? `Message for ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}` : undefined });
  }, [openComposer, contacts, selectedIds]);
  const handleScanSuccess = useCallback(() => { void loadContacts(); void loadFlowData(); }, [loadContacts, loadFlowData]);
  const handleCancelForm = useCallback(() => { setShowAddForm(false); setEditingContact(null); }, [setShowAddForm, setEditingContact]);
  const handleClearListFilter = useCallback(() => { setActiveListId(null); setActiveListContactIds(null); }, [setActiveListId, setActiveListContactIds]);

  useEffect(() => {
    if (selectedContactId && selectedContactId !== prevSelectedRef.current) {
      if (window.innerWidth >= 1024 && detailPanelRef.current) {
        detailPanelRef.current.focus({ preventScroll: true });
      }
    }
    prevSelectedRef.current = selectedContactId;
  }, [selectedContactId]);

  const handleDetailClose = useCallback(() => {
    setShowMobileDetail(false);
    if (listRef.current) {
      const focused = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]');
      (focused ?? listRef.current).focus({ preventScroll: true });
    }
  }, [setShowMobileDetail]);

  return (
    <div className="space-y-6">
      {businessId && (
        <DuplicateDetector businessId={businessId} onMergeComplete={handleMergeComplete} />
      )}

      {((nextActions && nextActions.length > 0) || (autopilotActions && autopilotActions.length > 0)) && (
        <div className="rounded-xl border border-[hsl(var(--kf-accent1))]/20 bg-[hsl(var(--kf-accent1))]/[0.02] overflow-hidden" data-walkthrough="crm-ai">
          <button
            onClick={() => setShowEngageSection(!showEngageSection)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
          >
            <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-[hsl(var(--kf-accent1))]/10 flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
            </div>
            <span className="text-sm font-semibold">Priority Queue</span>
            {nextActions && nextActions.length > 0 && (
              <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]">
                {nextActions.length}
              </span>
            )}
            {autopilotActions && autopilotActions.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))] border border-[hsl(var(--kf-accent2))]/20">
                <Bot className="w-3 h-3" />
                {autopilotActions.length} autopilot
              </span>
            )}
            <ChevronDown className={`w-4 h-4 ml-auto text-muted-foreground transition-transform ${showEngageSection ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {showEngageSection && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-3">
                  {nextActions && nextActions.length > 0 && onCompleteNextAction && onViewEngageContact && onDoAction && (
                    <NextActionQueue
                      actions={nextActions}
                      onComplete={onCompleteNextAction}
                      onViewContact={onViewEngageContact}
                      onDoAction={onDoAction}
                    />
                  )}
                  {autopilotActions && autopilotActions.length > 0 && onApproveAutopilot && onDenyAutopilot && (
                    <AutopilotActions
                      actions={autopilotActions}
                      isPaused={autopilotPaused ?? false}
                      onApprove={onApproveAutopilot}
                      onDeny={onDenyAutopilot}
                      onTogglePause={onToggleAutopilotPause ?? (() => {})}
                    />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {favoriteContacts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Favorites</span>
            <span className="text-[10px] text-muted-foreground/60 ml-auto">{favoriteContacts.length}</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {favoriteContacts.map((c) => {
              const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed";
              const initials = `${c.firstName?.[0] ?? ""}${c.lastName?.[0] ?? ""}`.toUpperCase() || "?";
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectContact(c.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectContact(c.id); } }}
                  className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border transition-all hover:bg-white/[0.03] cursor-pointer ${
                    selectedContactId === c.id
                      ? "border-[hsl(var(--kf-accent1))]/50 bg-[hsl(var(--kf-accent1))]/[0.06]"
                      : "border-border/40 bg-card"
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                    style={{ background: STATUS_COLORS[c.status ?? ""] ?? STATUS_COLORS.LEAD }}
                  >
                    {initials}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-xs font-semibold truncate max-w-[100px]">{name}</p>
                    {c.companyName && (
                      <p className="text-[10px] text-muted-foreground/60 truncate max-w-[100px]">{c.companyName}</p>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(c.id); }}
                    className="ml-1 text-rose-400 hover:text-rose-300 flex-shrink-0"
                    title="Remove from favorites"
                    aria-label="Remove from favorites"
                  >
                    <Heart className="w-3 h-3 fill-current" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeListId && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30 text-sm">
          <List className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span>Filtered by list</span>
          <button
            onClick={handleClearListFilter}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Clear filter
          </button>
        </div>
      )}

      <AnimatePresence>
        {showAddMenu && (
          <ContactCapture
            onManualAdd={handleOpenAddForm}
            onImportFile={handleImportFile}
            onImportLink={handleImportLink}
            onDeviceImport={handleDeviceImport}
            onClose={handleCloseAddMenu}
            onScanSuccess={handleScanSuccess}
            loading={isPending}
            businessId={businessId ?? undefined}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImport && (
          <ContactImport
            onImportFile={handleImportFile}
            onImportLink={handleImportLink}
            loading={isPending}
            businessId={businessId ?? undefined}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddForm && (
          <ContactForm
            onSubmit={handleSubmitContact}
            onCancel={handleCancelForm}
            loading={isPending}
            initialValues={editingContact || undefined}
          />
        )}
      </AnimatePresence>

      {selectMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={contacts.length}
          onSelectAll={handleSelectAll}
          onStatusChange={handleBulkStatusChange}
          onAddTag={handleBulkTag}
          onBulkDelete={handleBulkDelete}
          onBroadcast={handleOpenBroadcast}
          onCompose={handleOpenComposer}
          onCancel={handleToggleSelectMode}
          onAddToList={handleBulkAddToList}
          lists={pipelineLists}
          loading={bulkLoading}
        />
      )}

      <PipelineToolbar
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        sortBy={sortBy}
        onSortChange={setSortBy}
        activeSegment={activeSegment}
        onSegmentChange={setActiveSegment}
        segmentCounts={segmentCounts}
        activeListTab={activeListTab}
        onListTabChange={state.setActiveListTab}
        allCount={contacts.length}
        pinnedCount={pinnedContacts.length}
        recentCount={recentContacts.length}
        loading={loading}
        selectMode={selectMode}
        onToggleSelectMode={handleToggleSelectMode}
        onRefresh={handleRefresh}
        onAddContact={handleToggleAddMenu}
        onImport={handleToggleImport}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />

      {viewMode === "kanban" ? (
        <PipelineKanban state={state} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr,450px]">
          <div ref={listRef}>
            {selectedContactId && detailPanelProps.contact && (
              <SelectedContextStrip contact={detailPanelProps.contact} invoices={detailPanelProps.invoices} bookings={detailPanelProps.bookings} notes={detailPanelProps.notes} tasks={detailPanelProps.tasks} />
            )}
            <PipelineContactList
              contacts={displayContacts as ContactCardData[]}
              loading={loading}
              loadError={loadError}
              hasMore={hasMore}
              activeListTab={activeListTab}
              selectedContactId={selectedContactId}
              selectMode={selectMode}
              selectedIds={selectedIds}
              pinnedIds={pinnedIds}
              favoriteIds={favoriteIds}
              onSelectContact={selectContact}
              onToggleSelect={handleToggleSelect}
              onTogglePin={handleTogglePin}
              onToggleFavorite={handleToggleFavorite}
              onDelete={handleDeleteContact}
              onQuickAction={handleQuickAction}
              onLoadMore={handleLoadMore}
              onRetry={handleRetry}
              onAddContact={handleOpenAddForm}
              onQuickCreate={handleQuickCreate}
            />
          </div>

          <div ref={detailPanelRef} className="hidden lg:block sticky top-4 max-h-[calc(100vh-2rem)]" tabIndex={-1}>
            <PipelineDetailPanel {...detailPanelProps} />
          </div>
        </div>
      )}

      <AnimatePresence>
        {showMobileDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 lg:hidden"
            onClick={handleDetailClose}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Contact details"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
                if (info.offset.y > 100 || info.velocity.y > 500) handleDetailClose();
              }}
              className="absolute bottom-0 left-0 right-0 max-h-[85vh] bg-background rounded-t-3xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={handleDetailClose}
                className="w-full flex items-center justify-center py-3 cursor-pointer active:bg-muted/30 transition-colors"
                aria-label="Close panel"
              >
                <div className="w-12 h-1 bg-muted-foreground/40 rounded-full" />
              </button>
              <div className="overflow-y-auto max-h-[calc(85vh-24px)] p-4">
                <PipelineDetailPanel {...detailPanelProps} onClose={handleDetailClose} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const PipelineTabContent = memo(PipelineTabContentInner);
