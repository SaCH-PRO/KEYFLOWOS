"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, List, Heart, ChevronDown, Zap, Bot, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createContact, fetchContactLists, fetchContacts } from "@/lib/client";
import { answerFromThrown, refusalMessage, showRefusal } from "@/lib/failure-kit";
import { clearCachedContacts } from "@/lib/contacts-db";
import { STATUS_COLORS } from "@/lib/crm-utils";
import { getCachedUser } from "@/lib/workspace";
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
import { CONTACTS_INSIGHTS_PANEL_ID, PipelineToolbar } from "./pipeline-toolbar";
import type { ViewMode } from "./pipeline-toolbar";
import { PipelineContactList } from "./pipeline-contact-list";
import { PipelineDetailPanel } from "./pipeline-detail-panel";
import { PipelineKanban } from "./pipeline-kanban";
import { ContactsDatabase } from "./contacts-database";
import { DuplicateDetector } from "./duplicate-detector";
import { FocusView } from "./focus-view";
import { CONTACTS_DENIED_MESSAGE } from "./hooks/use-contacts-data";
import { ContactsTableDenialContext } from "./hooks/use-database-state";
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
  /**
   * CONTACTS-LIST-FIRST (D-289): the screen's own cards (the contacts page's Relationship Pulse and Action Center),
   * drawn in the collapsible "Insights and filters" panel with the Priority Queue and the smart chips.
   */
  insights?: ReactNode;
}

const PIPELINE_VIEW_KEY = "kf_pipeline_view";

/** The fewest digits read as a phone number of its own (a national number). */
const MIN_PHONE_DIGITS = 7;

/**
 * ITU-T E.164 country calling codes (1 to 3 digits), the set the server's samePhoneNumber reads
 * (apps/server/src/modules/structure/position-holders.ts, COUNTRY_CALLING_CODES; keep the two in
 * step). Used only to accept that digits in front of a national number are a country code.
 */
const COUNTRY_CALLING_CODES: ReadonlySet<string> = new Set(
  (
    "1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 "
    + "90 91 92 93 94 95 98 "
    + "211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 "
    + "243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 "
    + "297 298 299 "
    + "350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 379 380 381 382 383 385 386 387 389 "
    + "420 421 423 "
    + "500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 "
    + "670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 "
    + "800 808 850 852 853 855 856 870 878 880 881 882 883 886 888 "
    + "960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 979 992 993 994 995 996 998"
  ).split(" "),
);

/**
 * Whether two phone spellings are one number for the add-contact duplicate check (SWP-CRM-SEARCH,
 * BUG-083): the same digits, or one written without '+' as a number of 7+ digits that the other's
 * digits end with behind exactly a country calling code ('868-555-0102' and '+1 868 555 0102').
 * Digits in front that are no country calling code are not one ('555-0102' is not
 * '868-555-0102'; review F1). This is the server's rule (samePhoneNumber, which
 * POST .../contacts/check-duplicates applies) without its trunk-prefix readings, so the screen
 * never warns about a pair the server reads as two numbers. The server's search returns the
 * contact for either spelling; this keeps it as a duplicate.
 */
function samePhoneSpelling(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  const nationalBehindCode = (written: string, national: string, other: string) =>
    !written.includes("+")
    && national.length >= MIN_PHONE_DIGITS
    && other.length > national.length
    && other.endsWith(national)
    && COUNTRY_CALLING_CODES.has(other.slice(0, other.length - national.length));
  return nationalBehindCode(a ?? "", da, db) || nationalBehindCode(b ?? "", db, da);
}

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

/**
 * The contacts read failed or was refused and there are no rows to show. Same
 * copy and shape as the list view's state (pipeline-contact-list.tsx), so the
 * focus, kanban and table views say the same thing the list does.
 */
function ContactsLoadErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-10 text-center" role="alert">
      <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-3">
        <AlertTriangle className="w-5 h-5 text-red-400/70" />
      </div>
      <p className="text-sm font-semibold tracking-tight mb-1">Could not load contacts</p>
      <p className="text-xs text-muted-foreground/60 mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-gradient-to-r from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5 text-[hsl(var(--kf-accent1))] hover:from-[hsl(var(--kf-accent1))]/25 hover:to-[hsl(var(--kf-accent1))]/10 transition-all"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Try Again
      </button>
    </div>
  );
}

function PipelineTabContentInner({ state, nextActions, autopilotActions, autopilotPaused, onCompleteNextAction, onViewEngageContact, onDoAction, onToggleAutopilotPause, onApproveAutopilot, onDenyAutopilot, insights }: PipelineTabContentProps) {
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
    offerQuote,
  } = state;

  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const [showImport, setShowImport] = useState(false);
  const [showEngageSection, setShowEngageSection] = useState(false);
  // CONTACTS-LIST-FIRST (D-289): the list comes first, so the panel of insights and filters starts closed at every
  // width and is not remembered (a desktop user who opened it once must still land on the list).
  const [showInsights, setShowInsights] = useState(false);
  const handleToggleInsights = useCallback(() => setShowInsights((open) => !open), []);
  const [pipelineLists, setPipelineLists] = useState<{ id: string; name: string }[]>([]);
  // Review CR-1: the business whose table read was refused (the table reports
  // it through ContactsTableDenialContext). Cleared by Try Again and by a view
  // change, so the next table read decides afresh.
  const [tableDeniedFor, setTableDeniedFor] = useState<string | null>(null);
  const tableReadDenied = tableDeniedFor !== null && tableDeniedFor === businessId;
  const reportTableDenial = useCallback(() => {
    if (businessId) setTableDeniedFor(businessId);
  }, [businessId]);

  // Review ST-R015b-1: a refusal of the screen's read, in any view, drops this
  // user's and business's rows from the device cache, so a later read that
  // merely fails (offline, a 5xx) cannot let the table fall back to rows the
  // server refused. The table's own refusal drops them in use-database-state.
  useEffect(() => {
    if (loadError !== CONTACTS_DENIED_MESSAGE || !businessId) return;
    void clearCachedContacts({ userId: getCachedUser()?.id ?? null, businessId }).catch(() => {});
  }, [loadError, businessId]);

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
    setTableDeniedFor(null);
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

  // SWP-CONTACT-QUICKADD (BUG-009, BUG-034): answers the refusal's reason (also shown as the one refusal toast), or
  // null when the customer was saved; the dialog stays open with what was typed on a refusal. createContact answers
  // { data: null, error } rather than throwing, so the answer is read, not only a thrown error.
  const handleQuickCreate = useCallback(async (data: { firstName: string; lastName?: string; email?: string; phone?: string; companyName?: string; status?: string; source?: string; ageGroup?: string }): Promise<string | null> => {
    const ctx = { what: "add customers" };
    if (!businessId) return "Choose a business first.";
    let res: Awaited<ReturnType<typeof createContact>> | { data: null; error: string };
    try {
      res = await createContact({
        businessId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        companyName: data.companyName,
        source: data.source ?? "manual",
        status: data.status ?? "LEAD",
        ageGroup: data.ageGroup,
      });
    } catch (err) {
      res = answerFromThrown(err);
    }
    const reason = refusalMessage(res, ctx);
    if (reason !== null || !res.data) {
      const said = reason ?? "Couldn't add customers.";
      if (!showRefusal(res, ctx)) toast.error(said);
      return said;
    }
    toast.success(`${data.firstName} added`);
    void loadContacts();
    void loadFlowData();
    return null;
  }, [businessId, loadContacts, loadFlowData]);

  const handleRefresh = useCallback(() => { setTableDeniedFor(null); void loadContacts(); void loadFlowData(); }, [loadContacts, loadFlowData]);
  const handleMergeComplete = useCallback(() => { void loadContacts(); }, [loadContacts]);
  const handleLoadMore = useCallback(() => loadContacts({ append: true }), [loadContacts]);
  const handleRetry = useCallback(() => { setTableDeniedFor(null); void loadContacts(); }, [loadContacts]);
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
    const phone = formData.phone.trim();
    return data.contacts
      .filter((c) => {
        if (editingContact && (c.id === (editingContact as unknown as { id?: string }).id)) return false;
        const cEmail = c.email?.toLowerCase();
        return (emailNorm && cEmail === emailNorm) || (phone && samePhoneSpelling(phone, c.phone));
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

  // CONTACTS-v1 section 5: a refused or failed read is never empty data. The
  // list view handles loadError itself; focus and kanban would show their empty
  // copy and the table its empty copy or the device cache, so they show the
  // load failure instead. The table keeps its offline cache for a failed (not
  // refused) read, which use-database-state limits to this user and business.
  // The table's own read can be refused while the screen's was allowed (CR-1):
  // the table then shows the denial too, never the screen's rows.
  const loadErrorView =
    viewMode === "table" && tableReadDenied
      ? CONTACTS_DENIED_MESSAGE
      : loadError && contacts.length === 0 &&
        (viewMode === "focus" || viewMode === "kanban" || (viewMode === "table" && loadError === CONTACTS_DENIED_MESSAGE))
        ? loadError
        : null;

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
            // SEC-R015c-1 (R0-15d): the form shows the custom fields of the
            // business its submit writes to (handleSubmitContact), not whatever
            // kf_business_id says after a switch in another tab.
            businessId={businessId}
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
        insightsOpen={showInsights}
        onToggleInsights={handleToggleInsights}
        insightsActiveCount={(smartFilter ? 1 : 0) + (activeSegment ? 1 : 0) + (activeListTab !== "all" ? 1 : 0)}
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

      {/* CONTACTS-LIST-FIRST (D-289): the cards that stood above the list, collapsed behind the toolbar's toggle. */}
      {showInsights && (
        <section id={CONTACTS_INSIGHTS_PANEL_ID} aria-label="Insights and filters" className="space-y-5">
          {insights}
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
              aria-pressed={smartFilter === f.key}
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

        </section>
      )}

      {loadErrorView ? (
        <ContactsLoadErrorNotice message={loadErrorView} onRetry={handleRetry} />
      ) : viewMode === "focus" ? (
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
        <ContactsTableDenialContext.Provider value={reportTableDenial}>
          <ContactsDatabase
            businessId={businessId}
            contacts={contacts as unknown as import("@/lib/contacts-db").LocalContact[]}
            onRefresh={handleRefresh}
            activeListId={activeListId}
            onSelectList={(listId, contactIds) => { setActiveListId(listId); setActiveListContactIds(contactIds ?? null); }}
            onSelectContact={selectContact}
            favoriteIds={favoriteIds}
            onToggleFavorite={handleToggleFavorite}
            search={searchInput}
            onSearchChange={setSearchInput}
          />
        </ContactsTableDenialContext.Provider>
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
            offerQuote={offerQuote}
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
