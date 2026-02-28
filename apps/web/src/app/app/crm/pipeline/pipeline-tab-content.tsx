"use client";

import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { X, List } from "lucide-react";
import {
  ContactCapture,
  ContactForm,
  type ContactCardData,
  type ContactFormData,
} from "@/components/contacts";
import type { QuickActionType } from "@/components/contacts";
import { BulkActionBar } from "./bulk-action-bar";
import { PipelineToolbar } from "./pipeline-toolbar";
import { PipelineContactList } from "./pipeline-contact-list";
import { PipelineDetailPanel } from "./pipeline-detail-panel";
import { DuplicateDetector } from "./duplicate-detector";
import type { PipelineState } from "./use-contacts-pipeline";

interface PipelineTabContentProps {
  state: PipelineState;
}

export function PipelineTabContent({ state }: PipelineTabContentProps) {
  const {
    businessId,
    displayContacts, loading, hasMore, activeListTab,
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
    setShowBroadcast,
    detailPanelProps,
    loadContacts, loadFlowData, selectContact,
    handleSubmitContact, handleImportFile, handleImportLink,
    handleToggleSelect, handleTogglePin,
    handleDeleteContact, handleQuickAction,
    handleSelectAll, handleBulkStatusChange, handleBulkTag, handleBulkDelete,
    handleToggleSelectMode,
  } = state;

  return (
    <div className="space-y-6">
      {businessId && (
        <DuplicateDetector businessId={businessId} onMergeComplete={() => { void loadContacts(); }} />
      )}

      {activeListId && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/30 text-sm">
          <List className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span>Filtered by list</span>
          <button
            onClick={() => { setActiveListId(null); setActiveListContactIds(null); }}
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
            onManualAdd={() => setShowAddForm(true)}
            onImportFile={handleImportFile}
            onImportLink={handleImportLink}
            onClose={() => setShowAddMenu(false)}
            onScanSuccess={() => { void loadContacts(); void loadFlowData(); }}
            loading={isPending}
            businessId={businessId ?? undefined}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddForm && (
          <ContactForm
            onSubmit={handleSubmitContact}
            onCancel={() => { setShowAddForm(false); setEditingContact(null); }}
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
          onBroadcast={() => setShowBroadcast(true)}
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
        onRefresh={() => { void loadContacts(); void loadFlowData(); }}
        onAddContact={() => setShowAddMenu(!showAddMenu)}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr,450px]">
        <PipelineContactList
          contacts={displayContacts as ContactCardData[]}
          loading={loading}
          hasMore={hasMore}
          activeListTab={activeListTab}
          selectedContactId={selectedContactId}
          selectMode={selectMode}
          selectedIds={selectedIds}
          pinnedIds={pinnedIds}
          onSelectContact={selectContact}
          onToggleSelect={handleToggleSelect}
          onTogglePin={handleTogglePin}
          onDelete={handleDeleteContact}
          onQuickAction={handleQuickAction}
          onLoadMore={() => loadContacts({ append: true })}
          onAddContact={() => setShowAddForm(true)}
        />

        <div className="hidden lg:block sticky top-4 max-h-[calc(100vh-2rem)]">
          <PipelineDetailPanel {...detailPanelProps} />
        </div>
      </div>

      <AnimatePresence>
        {showMobileDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 lg:hidden"
            onClick={() => setShowMobileDetail(false)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_: any, info: PanInfo) => {
                if (info.offset.y > 100 || info.velocity.y > 500) setShowMobileDetail(false);
              }}
              className="absolute bottom-0 left-0 right-0 max-h-[85vh] bg-background rounded-t-3xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowMobileDetail(false)}
                className="w-full flex items-center justify-center py-3 cursor-pointer active:bg-muted/30 transition-colors"
                aria-label="Close panel"
              >
                <div className="w-12 h-1 bg-muted-foreground/40 rounded-full" />
              </button>
              <div className="overflow-y-auto max-h-[calc(85vh-24px)] p-4">
                <PipelineDetailPanel {...detailPanelProps} onClose={() => setShowMobileDetail(false)} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
