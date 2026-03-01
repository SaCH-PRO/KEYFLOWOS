"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import type { Contact } from "@/lib/client";
import type { SmartSegment, ListTab, SortOption } from "../pipeline-toolbar";
import {
  fetchContacts,
} from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const PAGE_SIZE = 25;
const PINNED_KEY = "kf_pinned_contacts";
const RECENT_KEY = "kf_recent_contacts";
const MAX_RECENT = 8;

export const SEGMENT_THRESHOLDS = {
  highValueRevenue: 500,
  highValueInvoiceCount: 3,
  newThisWeekDays: 7,
  staleDays: 30,
  atRiskDays: 30,
} as const;

function getPinnedIds(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) || "[]"); } catch { return []; }
}
function setPinnedIds(ids: string[]) {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}
function getRecentIds(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
function addRecentId(id: string) {
  const ids = getRecentIds().filter((i) => i !== id);
  ids.unshift(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
}

interface FilterState {
  searchInput: string;
  statusFilter: string;
  sortBy: SortOption;
  activeSegment: SmartSegment | null;
  activeListTab: ListTab;
  activeListId: string | null;
  activeListContactIds: string[] | null;
  listsCount: number;
  crmViewTab: "pipeline" | "insights" | "engage" | "database";
  selectMode: boolean;
  selectedIds: Set<string>;
}

type FilterAction =
  | { type: "SET_SEARCH_INPUT"; payload: string }
  | { type: "SET_STATUS_FILTER"; payload: string }
  | { type: "SET_SORT_BY"; payload: SortOption }
  | { type: "SET_ACTIVE_SEGMENT"; payload: SmartSegment | null }
  | { type: "SET_ACTIVE_LIST_TAB"; payload: ListTab }
  | { type: "SET_ACTIVE_LIST_ID"; payload: string | null }
  | { type: "SET_ACTIVE_LIST_CONTACT_IDS"; payload: string[] | null }
  | { type: "SET_LISTS_COUNT"; payload: number }
  | { type: "SET_CRM_VIEW_TAB"; payload: "pipeline" | "insights" | "engage" | "database" }
  | { type: "SET_SELECT_MODE"; payload: boolean }
  | { type: "SET_SELECTED_IDS"; payload: Set<string> }
  | { type: "TOGGLE_SELECT_MODE" }
  | { type: "TOGGLE_SELECT"; payload: string };

const initialFilterState: FilterState = {
  searchInput: "",
  statusFilter: "ALL",
  sortBy: "newest",
  activeSegment: null,
  activeListTab: "all",
  activeListId: null,
  activeListContactIds: null,
  listsCount: 0,
  crmViewTab: "pipeline",
  selectMode: false,
  selectedIds: new Set(),
};

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case "SET_SEARCH_INPUT": return { ...state, searchInput: action.payload };
    case "SET_STATUS_FILTER": return { ...state, statusFilter: action.payload };
    case "SET_SORT_BY": return { ...state, sortBy: action.payload };
    case "SET_ACTIVE_SEGMENT": return { ...state, activeSegment: action.payload };
    case "SET_ACTIVE_LIST_TAB": return { ...state, activeListTab: action.payload };
    case "SET_ACTIVE_LIST_ID": return { ...state, activeListId: action.payload };
    case "SET_ACTIVE_LIST_CONTACT_IDS": return { ...state, activeListContactIds: action.payload };
    case "SET_LISTS_COUNT": return { ...state, listsCount: action.payload };
    case "SET_CRM_VIEW_TAB": return { ...state, crmViewTab: action.payload };
    case "SET_SELECT_MODE": return { ...state, selectMode: action.payload };
    case "SET_SELECTED_IDS": return { ...state, selectedIds: action.payload };
    case "TOGGLE_SELECT_MODE": return state.selectMode
      ? { ...state, selectMode: false, selectedIds: new Set() }
      : { ...state, selectMode: true };
    case "TOGGLE_SELECT": {
      const next = new Set(state.selectedIds);
      if (next.has(action.payload)) next.delete(action.payload); else next.add(action.payload);
      return { ...state, selectedIds: next };
    }
    default: return state;
  }
}

export function useContactsData() {
  const [filters, dispatch] = useReducer(filterReducer, initialFilterState);

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const nextOffsetRef = useRef(0);

  const [search, setSearch] = useState("");

  const [isPending, startTransition] = useTransition();

  const [pinnedIds, setPinnedIdsState] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const setSearchInput = useCallback((v: string) => dispatch({ type: "SET_SEARCH_INPUT", payload: v }), []);
  const setStatusFilter = useCallback((v: string) => dispatch({ type: "SET_STATUS_FILTER", payload: v }), []);
  const setSortBy = useCallback((v: SortOption) => dispatch({ type: "SET_SORT_BY", payload: v }), []);
  const setActiveSegment = useCallback((v: SmartSegment | null) => dispatch({ type: "SET_ACTIVE_SEGMENT", payload: v }), []);
  const setActiveListTab = useCallback((v: ListTab) => dispatch({ type: "SET_ACTIVE_LIST_TAB", payload: v }), []);
  const setActiveListId = useCallback((v: string | null) => dispatch({ type: "SET_ACTIVE_LIST_ID", payload: v }), []);
  const setActiveListContactIds = useCallback((v: string[] | null) => dispatch({ type: "SET_ACTIVE_LIST_CONTACT_IDS", payload: v }), []);
  const setListsCount = useCallback((v: number) => dispatch({ type: "SET_LISTS_COUNT", payload: v }), []);
  const setCrmViewTab = useCallback((v: "pipeline" | "insights" | "engage" | "database") => dispatch({ type: "SET_CRM_VIEW_TAB", payload: v }), []);
  const setSelectMode = useCallback((v: boolean) => {
    dispatch({ type: "SET_SELECT_MODE", payload: v });
  }, []);
  const selectedIdsRef = useRef(filters.selectedIds);
  selectedIdsRef.current = filters.selectedIds;
  const setSelectedIds = useCallback((v: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    if (typeof v === "function") {
      dispatch({ type: "SET_SELECTED_IDS", payload: v(selectedIdsRef.current) });
    } else {
      dispatch({ type: "SET_SELECTED_IDS", payload: v });
    }
  }, []);

  useEffect(() => {
    setPinnedIdsState(getPinnedIds());
    setRecentIds(getRecentIds());
  }, []);

  useEffect(() => {
    const initWorkspace = async () => {
      const stored = getStoredBusinessId();
      if (stored) { setBusinessId(stored); setWorkspaceLoading(false); return; }
      const created = await ensureWorkspace();
      if (created) { setBusinessId(created); setWorkspaceLoading(false); return; }
      setWorkspaceError("We could not find your workspace. Please sign in again.");
      setWorkspaceLoading(false);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(filters.searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [filters.searchInput]);

  const contactsAbortRef = useRef<AbortController | null>(null);

  const loadContacts = useCallback(
    async (opts?: { append?: boolean }) => {
      if (!businessId) return;
      const append = opts?.append ?? false;

      if (contactsAbortRef.current) {
        contactsAbortRef.current.abort();
      }
      const controller = new AbortController();
      contactsAbortRef.current = controller;
      const { signal } = controller;

      const sortOpts = {
        sortBy: filters.sortBy !== "newest" ? filters.sortBy : undefined,
        sortOrder: (filters.sortBy === "name" || filters.sortBy === "oldest") ? "asc" as const : "desc" as const,
      };

      setLoading(true);
      setLoadError(null);
      try {
        if (append) {
          const { data } = await fetchContacts(businessId, {
            take: PAGE_SIZE, skip: nextOffsetRef.current,
            search: search || undefined,
            status: filters.statusFilter !== "ALL" ? filters.statusFilter : undefined,
            includeStats: true,
            ...sortOpts,
            signal,
          });
          if (signal.aborted) return;
          const mapped = (data ?? []).map((c) => ({ ...c, tags: c.tags ?? [] }));
          setContacts((prev) => [...prev, ...mapped]);
          nextOffsetRef.current += mapped.length;
          setHasMore(mapped.length === PAGE_SIZE);
        } else {
          const { data: contactData } = await fetchContacts(businessId, {
              take: PAGE_SIZE, skip: 0,
              search: search || undefined,
              status: filters.statusFilter !== "ALL" ? filters.statusFilter : undefined,
              includeStats: true,
              ...sortOpts,
              signal,
            });
          if (signal.aborted) return;
          const mapped = (contactData ?? []).map((c) => ({ ...c, tags: c.tags ?? [] }));
          setContacts(mapped);
          nextOffsetRef.current = mapped.length;
          setHasMore(mapped.length === PAGE_SIZE);
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load contacts", error);
        setLoadError("Failed to load contacts. Please try again.");
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    },
    [businessId, search, filters.statusFilter, filters.sortBy],
  );

  const handleTogglePin = useCallback((id: string) => {
    setPinnedIdsState((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      setPinnedIds(next);
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    dispatch({ type: "TOGGLE_SELECT", payload: id });
  }, []);

  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  const handleSelectAll = useCallback(() => {
    const currentContacts = contactsRef.current;
    const currentSelected = selectedIdsRef.current;
    if (currentSelected.size === currentContacts.length) dispatch({ type: "SET_SELECTED_IDS", payload: new Set() });
    else dispatch({ type: "SET_SELECTED_IDS", payload: new Set(currentContacts.map((c) => c.id)) });
  }, []);

  const handleToggleSelectMode = useCallback(() => {
    dispatch({ type: "TOGGLE_SELECT_MODE" });
  }, []);

  const trackRecent = useCallback((id: string) => {
    addRecentId(id);
    setRecentIds(getRecentIds());
  }, []);

  const pinnedContacts = useMemo(() => contacts.filter((c) => pinnedIds.includes(c.id)), [contacts, pinnedIds]);
  const recentContacts = useMemo(() => {
    return recentIds.map((id) => contacts.find((c) => c.id === id)).filter(Boolean) as Contact[];
  }, [contacts, recentIds]);

  const segmentCutoffs = useMemo(() => {
    const now = Date.now();
    return {
      newCutoff: now - SEGMENT_THRESHOLDS.newThisWeekDays * 86_400_000,
      staleCutoff: now - SEGMENT_THRESHOLDS.staleDays * 86_400_000,
      atRiskCutoff: now - SEGMENT_THRESHOLDS.atRiskDays * 86_400_000,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.length]);

  const segmentCounts = useMemo(() => {
    const { newCutoff, staleCutoff, atRiskCutoff } = segmentCutoffs;
    const counts: Record<SmartSegment, number> = { "high-value": 0, "needs-followup": 0, "new-this-week": 0, "at-risk": 0, "stale": 0 };
    for (const c of contacts) {
      const meta = c.meta;
      if ((meta?.totalRevenue && meta.totalRevenue > SEGMENT_THRESHOLDS.highValueRevenue) || (meta?.invoiceCount && meta.invoiceCount > SEGMENT_THRESHOLDS.highValueInvoiceCount)) counts["high-value"]++;
      if ((meta?.overdueTasks && meta.overdueTasks > 0) || (meta?.unpaidInvoices && meta.unpaidInvoices > 0)) counts["needs-followup"]++;
      if (c.createdAt && new Date(c.createdAt).getTime() > newCutoff) counts["new-this-week"]++;
      if (c.status === "CLIENT" && meta?.lastInteractionAt && new Date(meta.lastInteractionAt).getTime() < atRiskCutoff) counts["at-risk"]++;
      if (meta?.lastInteractionAt && new Date(meta.lastInteractionAt).getTime() < staleCutoff) counts["stale"]++;
    }
    return counts;
  }, [contacts, segmentCutoffs]);

  const displayContacts = useMemo(() => {
    let list: Contact[];
    if (filters.activeListTab === "pinned") list = [...pinnedContacts];
    else if (filters.activeListTab === "recent") list = [...recentContacts];
    else list = [...contacts];

    if (filters.activeListContactIds && filters.activeListContactIds.length > 0) {
      const idSet = new Set(filters.activeListContactIds);
      list = list.filter((c) => idSet.has(c.id));
    }

    if (filters.activeSegment) {
      const { newCutoff, staleCutoff, atRiskCutoff } = segmentCutoffs;
      list = list.filter((c) => {
        const meta = c.meta;
        switch (filters.activeSegment) {
          case "high-value": return (meta?.totalRevenue && meta.totalRevenue > SEGMENT_THRESHOLDS.highValueRevenue) || (meta?.invoiceCount && meta.invoiceCount > SEGMENT_THRESHOLDS.highValueInvoiceCount);
          case "needs-followup": return (meta?.overdueTasks && meta.overdueTasks > 0) || (meta?.unpaidInvoices && meta.unpaidInvoices > 0);
          case "new-this-week": return c.createdAt && new Date(c.createdAt).getTime() > newCutoff;
          case "at-risk": return c.status === "CLIENT" && meta?.lastInteractionAt && new Date(meta.lastInteractionAt).getTime() < atRiskCutoff;
          case "stale": return meta?.lastInteractionAt && new Date(meta.lastInteractionAt).getTime() < staleCutoff;
          default: return true;
        }
      });
    }

    list.sort((a, b) => {
      const metaA = a.meta;
      const metaB = b.meta;
      switch (filters.sortBy) {
        case "name": {
          const nameA = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim().toLowerCase();
          const nameB = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim().toLowerCase();
          return nameA.localeCompare(nameB);
        }
        case "newest": return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
        case "oldest": return new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime();
        case "revenue": return (metaB?.totalRevenue ?? 0) - (metaA?.totalRevenue ?? 0);
        case "score": return (metaB?.leadScore ?? 0) - (metaA?.leadScore ?? 0);
        default: return 0;
      }
    });

    return list;
  }, [filters.activeListTab, contacts, pinnedContacts, recentContacts, filters.activeSegment, filters.sortBy, filters.activeListContactIds, segmentCutoffs]);

  return {
    businessId, workspaceLoading, workspaceError,
    contacts, setContacts, loading, loadError, hasMore,
    searchInput: filters.searchInput, setSearchInput, search,
    statusFilter: filters.statusFilter, setStatusFilter,
    sortBy: filters.sortBy, setSortBy,
    activeSegment: filters.activeSegment, setActiveSegment,
    activeListTab: filters.activeListTab, setActiveListTab,
    selectMode: filters.selectMode, setSelectMode,
    selectedIds: filters.selectedIds, setSelectedIds,
    activeListId: filters.activeListId, setActiveListId,
    activeListContactIds: filters.activeListContactIds, setActiveListContactIds,
    listsCount: filters.listsCount, setListsCount,
    crmViewTab: filters.crmViewTab, setCrmViewTab,
    isPending, startTransition,
    pinnedIds, pinnedContacts, recentContacts,
    displayContacts, segmentCounts,
    loadContacts, handleTogglePin, handleToggleSelect, handleSelectAll, handleToggleSelectMode,
    trackRecent,
  };
}
