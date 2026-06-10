"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, List, Heart, ChevronDown, Zap, Bot } from "lucide-react";
import { toast } from "sonner";
import { createContact, fetchContactLists, fetchContacts } from "@/lib/client";
import { STATUS_COLORS } from "@/lib/crm-utils";
import {
  ContactForm,
  ContactImport,
  type ContactCardData,
  type ContactFormData,
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
import { ContactsDatabase } from "./contacts-database";
import { DuplicateDetector } from "./duplicate-detector";
import { FocusView } from "./focus-view";
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

const PIPELINE_VIEW_KEY = "kf_pipeline_view";

function getStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "focus";
  try {
    const params = new URLSearchParams(window.location.search);
    const queryView = params.get("view");
    if (queryView === "focus" || queryView === "list" || queryView === "kanban" || queryView === "table" || queryView === "data-quality") return queryView;
    const stored = localStorage.getItem(PIPELINE_VIEW_KEY);
    if (stored === "focus" || stored === "list" || stored === "kanban" || stored === "table" || stored === "data-quality") return stored;
    return "focus";
  } catch {
    return "focus";
  }
}

function PipelineTabContentInner({ state, nextActions, autopilotActions, autopilotPaused, onCompleteNextAction, onViewEngageContact, onDoAction, onToggleAutopilotPause, onApproveAutopilot, onDenyAutopilot }: PipelineTabContentProps) {
  const {
    businessId,
    displayContacts, loading, loadError, hasMore, activeListTab,
    selectedContactId, selectMode, selectedIds, pinnedIds,
    showAddForm, setShowAddForm,
    editingContact, setEditingContact,
    editingCustomFieldValues,
    isPending,
    activeListId, setActiveListId,  setActiveListContactIds,
    searchInput, setSearchInput,
    statusFilter, setStatusFilter,
    sortBy, setSortBy,
    activeSegment, setActiveSegment,
    smartFilter, setSmartFilter,
    segmentCounts, pinnedContacts, recentContacts, contacts,
    favoriteIds, favoriteContacts, handleToggleFavorite,
    setShowBroadcast,
    detailPanelProps,
    loadContacts, loadFlowData, selectContact, toggleContact, clearSelectedContact,
    handleSubmitContact, handleImportFile, handleImportLink, handleDeviceImport,
    handleToggleSelect, handleTogglePin,
    handleDeleteContact, handleQuickAction,
    handleSelectAll, handleBulkStatusChange, handleBulkTag, handleBulkDelete,
    handleBulkAddToList, bulkLoading,
    handleToggleSelectMode,
  } = state;

  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const [showImport, setShowImport] = useState(false);
  const [showEngageSection, setShowEngageSection] = useState(false);
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
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        if (mode === "list") url.searchParams.delete("view");
        else url.searchParams.set("view", mode);
        window.history.replaceState({}, "", url.toString());
      } catch {}
    }
  }, []);
  const handleToggleImport = useCallback(() => setShowImport((prev) => !prev), []);

  const listRef = useRef<HTMLDivElement>(null);

  const handleQuickCreate = useCallback(async (data: { firstName: string; lastName?: string; email?: string; phone?: string; status?: string; source?: string; ageGroup?: string }) => {
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
        ageGroup: data.ageGroup,
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
  const handleCheckDuplicates = useCallback(async (formData: ContactFormData) => {
    if (!businessId) return [];
    const q = formData.email.trim() || formData.phone.trim();
    if (!q) return [];
    const { data } = await fetchContacts(businessId, {
      search: q,
      take: 10,
    });
    if (!data?.contacts) return [];
    const emailNorm = formData.email.trim().toLowerCase();
    const phoneNorm = formData.phone.trim().replace(/\D/g, "");
    return data.contacts
      .filter((c) => {
        if (editingContact && (c.id === (editingContact as unknown as { id?: string }).id)) return false;
        const cEmail = c.email?.toLowerCase();
        const cPhone = c.phone?.replace(/\D/g, "");
        return (emailNorm && cEmail === emailNorm) || (phoneNorm && cPhone === phoneNorm);
      })
      .map((c) => ({
        id: c.id,
        name: c.displayName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Unnamed",
        email: c.email,
        phone: c.phone,
      }));
  }, [businessId, editingContact]);
  const handleClearListFilter = useCallback(() => { setActiveListId(null); setActiveListContactIds(null); }, [setActiveListId, setActiveListContactIds]);

  const handleDetailClose = useCallback(() => {
    clearSelectedContact();
    if (listRef.current) {
      const focused = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]');
      (focused ?? listRef.current).focus({ preventScroll: true });
    }
  }, [clearSelectedContact]);

  const expandedPanel = useMemo(
    () => (selectedContactId && detailPanelProps.contact
      ? <PipelineDetailPanel {...detailPanelProps} onClose={handleDetailClose} />
      : null),
    [selectedContactId, detailPanelProps, handleDetailClose],
  );

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
        {showImport && (
          <ContactImport
            onImportFile={handleImportFile}
            onImportLink={handleImportLink}
            onDeviceImport={handleDeviceImport}
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
            initialCustomFieldValues={editingCustomFieldValues}
            checkDuplicates={handleCheckDuplicates}
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
        onAddContact={handleOpenAddForm}
        onQuickCreate={handleQuickCreate}
        onImport={handleToggleImport}
        onScanSuccess={handleScanSuccess}
        businessId={businessId ?? undefined}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        savedViewState={{
          search: searchInput,
          status: statusFilter,
          sortBy,
          activeSegment,
          activeListTab,
          viewMode,
        }}
        onApplySavedView={(view) => {
          const fs = view.filterState as Record<string, unknown>;
          if (typeof fs.search === "string") setSearchInput(fs.search);
          if (typeof fs.status === "string") setStatusFilter(fs.status);
          if (typeof fs.sortBy === "string") setSortBy(fs.sortBy as typeof sortBy);
          if (fs.activeSegment === null || typeof fs.activeSegment === "string") {
            setActiveSegment(fs.activeSegment as typeof activeSegment);
          }
          if (typeof fs.activeListTab === "string") {
            state.setActiveListTab(fs.activeListTab as typeof activeListTab);
          }
          if (fs.viewMode === "list" || fs.viewMode === "kanban" || fs.viewMode === "table") {
            handleViewModeChange(fs.viewMode);
          }
          // Visible columns are applied by ContactsDatabase via its own
          // `savedColumnsOverride` prop (kept in sync via the picker payload).
        }}
        onClearSavedView={() => {
          setSearchInput("");
          setStatusFilter("ALL");
          setSmartFilter(null);
          setActiveSegment(null);
        }}
      />

      {/* Smart Filter Chips */}
      <div className="flex flex-wrap gap-1.5 px-1 pb-1">
        {[
          { key: "unpaid", label: "Unpaid Invoices", icon: "💰" },
          { key: "bookings", label: "Upcoming Bookings", icon: "📅" },
          { key: "deals", label: "Open Deals", icon: "🤝" },
          { key: "stale", label: "Stale 14+ days", icon: "⏰" },
          { key: "atrisk", label: "At Risk", icon: "⚠️" },
          { key: "highvalue", label: "High Value", icon: "💎" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setSmartFilter(smartFilter === f.key ? null : f.key)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-all ${
              smartFilter === f.key
                ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                : "border-border/30 text-muted-foreground hover:text-foreground hover:border-border/60"
            }`}
          >
            <span>{f.icon}</span>
            {f.label}
          </button>
        ))}
      </div>

      {viewMode === "focus" ? (
        <FocusView
          contacts={displayContacts as ContactCardData[]}
          nextActions={nextActions ?? []}
          onViewContact={onViewEngageContact ?? (() => {})}
          onDoAction={onDoAction ?? (() => {})}
          onCompleteNextAction={onCompleteNextAction ?? (() => Promise.resolve())}
          loading={loading}
        />
      ) : viewMode === "kanban" ? (
        <PipelineKanban state={state} />
      ) : viewMode === "table" && businessId ? (
        <ContactsDatabase
          businessId={businessId}
          contacts={contacts as unknown as import("@/lib/contacts-db").LocalContact[]}
          onRefresh={handleRefresh}
          activeListId={activeListId}
          onSelectList={(listId, contactIds) => { setActiveListId(listId); setActiveListContactIds(contactIds ?? null); }}
          onSelectContact={selectContact}
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
        />
      ) : viewMode === "data-quality" && businessId ? (
        <DuplicateDetector
          businessId={businessId}
          onMergeComplete={handleMergeComplete}
        />
      ) : (
        <div ref={listRef}>
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
            onSelectContact={toggleContact}
            onToggleSelect={handleToggleSelect}
            onTogglePin={handleTogglePin}
            onToggleFavorite={handleToggleFavorite}
            onDelete={handleDeleteContact}
            onQuickAction={handleQuickAction}
            onLoadMore={handleLoadMore}
            onRetry={handleRetry}
            onAddContact={handleOpenAddForm}
            expandedPanel={expandedPanel}
            onCollapse={handleDetailClose}
          />
        </div>
      )}
    </div>
  );
}

export const PipelineTabContent = memo(PipelineTabContentInner);
