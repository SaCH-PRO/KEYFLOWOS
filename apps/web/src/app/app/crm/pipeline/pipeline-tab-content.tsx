"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { X, List, Heart } from "lucide-react";
import { STATUS_COLORS } from "@/lib/crm-utils";
import {
  ContactCapture,
  ContactForm,
  ContactImport,
  type ContactCardData,
  type ContactFormData,
} from "@/components/contacts";
import type { QuickActionType } from "@/components/contacts";
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

function PipelineTabContentInner({ state }: PipelineTabContentProps) {
  const {
    businessId,
    displayContacts, loading, loadError, hasMore, activeListTab,
    selectedContactId, selectMode, selectedIds, pinnedIds,
    showAddMenu, setShowAddMenu,
    showAddForm, setShowAddForm,
    editingContact, setEditingContact,
    showMobileDetail, setShowMobileDetail,
    isPending,
    activeListId, setActiveListId, activeListContactIds, setActiveListContactIds,
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
    handleToggleSelectMode,
  } = state;

  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const [showImport, setShowImport] = useState(false);
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try { localStorage.setItem(PIPELINE_VIEW_KEY, mode); } catch {}
  }, []);
  const handleToggleImport = useCallback(() => setShowImport((prev) => !prev), []);

  const detailPanelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevSelectedRef = useRef<string | null>(null);

  const handleRefresh = useCallback(() => { void loadContacts(); void loadFlowData(); }, [loadContacts, loadFlowData]);
  const handleToggleAddMenu = useCallback(() => setShowAddMenu((prev: boolean) => !prev), [setShowAddMenu]);
  const handleCloseAddMenu = useCallback(() => setShowAddMenu(false), [setShowAddMenu]);
  const handleMergeComplete = useCallback(() => { void loadContacts(); }, [loadContacts]);
  const handleLoadMore = useCallback(() => loadContacts({ append: true }), [loadContacts]);
  const handleRetry = useCallback(() => { void loadContacts(); }, [loadContacts]);
  const handleOpenAddForm = useCallback(() => setShowAddForm(true), [setShowAddForm]);
  const handleOpenBroadcast = useCallback(() => setShowBroadcast(true), [setShowBroadcast]);
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
                <button
                  key={c.id}
                  onClick={() => selectContact(c.id)}
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
                </button>
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
          onCancel={handleToggleSelectMode}
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
              onDragEnd={(_: any, info: PanInfo) => {
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
