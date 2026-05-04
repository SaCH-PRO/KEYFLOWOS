"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { LocalContact } from "@/lib/contacts-db";
import { cacheContacts, getCachedContacts, getLastSyncTime, setLastSyncTime } from "@/lib/contacts-db";
import { exportContacts, type ExportFormat } from "@/lib/contacts-export";
import { bulkUpdateContacts, bulkDeleteContacts, addContactsToList, fetchContacts } from "@/lib/client";
import { toast } from "sonner";

export type SortField = "firstName" | "lastName" | "email" | "phone" | "status" | "companyName" | "city" | "country" | "source" | "createdAt" | "lastActive" | "referredBy" | "linkedinUrl" | "instagramUrl" | "twitterUrl";
export type SortDir = "asc" | "desc";
export type BulkAction = "status" | "tags" | "addToList" | "relationshipType" | "priority" | null;

export interface ListSummary {
  id: string;
  name: string;
  color?: string | null;
  type: string;
  contactCount: number;
}

export type ColumnKey = SortField | "tags" | "jobTitle" | "referredBy" | "linkedinUrl" | "instagramUrl" | "twitterUrl" | "customFields" | "ageGroup";

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: string;
  mobileHidden?: boolean;
}

export const ALL_COLUMNS: ColumnDef[] = [
  { key: "firstName", label: "First Name", width: "w-[120px]" },
  { key: "lastName", label: "Last Name", width: "w-[120px]" },
  { key: "email", label: "Email", width: "w-[200px]" },
  { key: "phone", label: "Phone", width: "w-[130px]", mobileHidden: true },
  { key: "status", label: "Status", width: "w-[90px]" },
  { key: "companyName", label: "Company", width: "w-[160px]", mobileHidden: true },
  { key: "jobTitle", label: "Job Title", width: "w-[140px]", mobileHidden: true },
  { key: "ageGroup", label: "Age Group", width: "w-[120px]", mobileHidden: true },
  { key: "city", label: "City", width: "w-[110px]", mobileHidden: true },
  { key: "country", label: "Country", width: "w-[110px]", mobileHidden: true },
  { key: "source", label: "Source", width: "w-[100px]", mobileHidden: true },
  { key: "tags", label: "Tags", width: "w-[150px]", mobileHidden: true },
  { key: "createdAt", label: "Created", width: "w-[100px]", mobileHidden: true },
  { key: "lastActive", label: "Last Active", width: "w-[120px]", mobileHidden: true },
  { key: "referredBy", label: "Referred By", width: "w-[130px]", mobileHidden: true },
  { key: "linkedinUrl", label: "LinkedIn", width: "w-[130px]", mobileHidden: true },
  { key: "instagramUrl", label: "Instagram", width: "w-[130px]", mobileHidden: true },
  { key: "twitterUrl", label: "Twitter", width: "w-[130px]", mobileHidden: true },
  { key: "customFields", label: "Custom", width: "w-[150px]", mobileHidden: true },
];

const DEFAULT_VISIBLE_KEYS: ColumnKey[] = [
  "firstName", "lastName", "email", "phone", "status",
  "companyName", "jobTitle", "ageGroup", "city", "country", "source",
  "tags", "createdAt", "lastActive",
];

export interface SavedView {
  id: string;
  name: string;
  isDefault: boolean;
  config: {
    statusFilter: string;
    ageGroupFilter?: string[];
    relationshipTypeFilter?: string[];
    priorityFilter?: string[];
    relationshipHealthFilter?: string[];
    favoriteFilter?: boolean;
    includeArchived?: boolean;
    search: string;
    sortField: SortField;
    sortDir: SortDir;
    visibleColumns: ColumnKey[];
    pageSize: number;
  };
}

const VIEWS_STORAGE_KEY = "kf_db_saved_views";

const DEFAULT_VIEWS: SavedView[] = [
  {
    id: "view_all_contacts",
    name: "All Contacts",
    isDefault: true,
    config: { statusFilter: "ALL", search: "", sortField: "firstName", sortDir: "asc", visibleColumns: [...DEFAULT_VISIBLE_KEYS], pageSize: 25 },
  },
  {
    id: "view_active_leads",
    name: "Active Leads",
    isDefault: true,
    config: { statusFilter: "LEAD", search: "", sortField: "createdAt", sortDir: "desc", visibleColumns: [...DEFAULT_VISIBLE_KEYS], pageSize: 25 },
  },
  {
    id: "view_top_clients",
    name: "Top Clients",
    isDefault: true,
    config: { statusFilter: "CLIENT", search: "", sortField: "createdAt", sortDir: "desc", visibleColumns: [...DEFAULT_VISIBLE_KEYS], pageSize: 25 },
  },
  {
    id: "view_needs_attention",
    name: "Needs Attention",
    isDefault: true,
    config: { statusFilter: "LEAD", search: "", sortField: "createdAt", sortDir: "asc", visibleColumns: [...DEFAULT_VISIBLE_KEYS], pageSize: 25 },
  },
];

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [...DEFAULT_VIEWS];
  try {
    const saved = localStorage.getItem(VIEWS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as SavedView[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hasAllDefaults = DEFAULT_VIEWS.every((dv) => parsed.some((p) => p.id === dv.id));
        if (hasAllDefaults) return parsed;
        const custom = parsed.filter((p) => !p.isDefault);
        return [...DEFAULT_VIEWS, ...custom];
      }
    }
  } catch { /* ignore */ }
  return [...DEFAULT_VIEWS];
}

function persistSavedViews(views: SavedView[]) {
  try {
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch { /* ignore */ }
}

const STORAGE_KEY = "kf_db_visible_cols";

function loadVisibleColumns(): Set<ColumnKey> {
  if (typeof window === "undefined") return new Set(DEFAULT_VISIBLE_KEYS);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as ColumnKey[];
      if (Array.isArray(parsed) && parsed.length > 0) return new Set(parsed);
    }
  } catch { /* ignore */ }
  return new Set(DEFAULT_VISIBLE_KEYS);
}

function saveVisibleColumns(keys: Set<ColumnKey>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch { /* ignore */ }
}

const SORTABLE_FIELDS = new Set<string>([
  "firstName", "lastName", "email", "phone", "status",
  "companyName", "city", "country", "source", "createdAt", "lastActive",
  "referredBy", "linkedinUrl", "instagramUrl", "twitterUrl",
]);

function getCustomField(contact: LocalContact, key: string): string | null {
  const custom = contact.custom;
  if (!custom || typeof custom !== "object") return null;

  const val = (custom as Record<string, unknown>)[key];
  return val ? String(val) : null;
}

function getContactField(contact: LocalContact, field: SortField): string | null | undefined {
  switch (field) {
    case "firstName": return contact.firstName;
    case "lastName": return contact.lastName;
    case "email": return contact.email;
    case "phone": return contact.phone;
    case "status": return contact.status;
    case "companyName": return contact.companyName;
    case "city": return contact.city;
    case "country": return contact.country;
    case "source": return contact.source;
    case "createdAt": return contact.createdAt;
    case "lastActive": {
      return contact.updatedAt || contact.createdAt;
    }
    case "referredBy": return getCustomField(contact, "referredBy");
    case "linkedinUrl": return getCustomField(contact, "linkedinUrl");
    case "instagramUrl": return getCustomField(contact, "instagramUrl");
    case "twitterUrl": return getCustomField(contact, "twitterUrl");
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

interface UseDatabaseStateOptions {
  businessId: string;
  contacts: LocalContact[];
  onRefresh: () => void;
}

export function useDatabaseState({ businessId, contacts, onRefresh }: UseDatabaseStateOptions) {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const isMobilePrev = useRef(isMobile);

  const [showLists, setShowLists] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("firstName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [ageGroupFilter, setAgeGroupFilter] = useState<Set<string>>(new Set());
  const [relationshipTypeFilter, setRelationshipTypeFilter] = useState<Set<string>>(new Set());
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const [relationshipHealthFilter, setRelationshipHealthFilter] = useState<Set<string>>(new Set());
  const [favoriteFilter, setFavoriteFilter] = useState<boolean>(false);
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cachedContacts, setCachedLocal] = useState<LocalContact[]>([]);
  const [usingCache, setUsingCache] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allPagesSelected, setAllPagesSelected] = useState(false);
  const [bulkActing, setBulkActing] = useState(false);
  const [activeBulkAction, setActiveBulkAction] = useState<BulkAction>(null);
  const [bulkTagInput, setBulkTagInput] = useState("");

  const [availableLists, setAvailableLists] = useState<ListSummary[]>([]);
  const [listsRefreshToken, setListsRefreshToken] = useState(0);

  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => loadVisibleColumns());
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showViewsPicker, setShowViewsPicker] = useState(false);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    count: number;
    onConfirm: () => void;
  }>({ open: false, count: 0, onConfirm: () => {} });

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const cachedContactsRef = useRef(cachedContacts);
  cachedContactsRef.current = cachedContacts;

  const [serverContacts, setServerContacts] = useState<LocalContact[]>([]);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const serverAbortRef = useRef<AbortController | null>(null);

  const activeContacts = serverContacts.length > 0 ? serverContacts : contacts.length > 0 ? contacts : cachedContacts;

  const mapSortFieldToApi = useCallback((field: SortField): string | undefined => {
    switch (field) {
      case "firstName":
      case "lastName":
        return "name";
      case "createdAt":
        return "newest";
      case "lastActive":
        return "lastInteraction";
      default:
        return undefined;
    }
  }, []);

  const loadServerContacts = useCallback(async (opts?: { append?: boolean }) => {
    if (!businessId) return;
    const append = opts?.append ?? false;

    if (serverAbortRef.current) serverAbortRef.current.abort();
    const controller = new AbortController();
    serverAbortRef.current = controller;

    setServerLoading(true);
    try {
      const apiSortBy = mapSortFieldToApi(sortField);
      const { data } = await fetchContacts(businessId, {
        take: pageSize,
        cursor: append && nextCursor ? nextCursor : undefined,
        skip: append && !nextCursor ? serverContacts.length : undefined,
        search: search || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        ageGroups: ageGroupFilter.size > 0 ? Array.from(ageGroupFilter) : undefined,
        relationshipTypes: relationshipTypeFilter.size > 0 ? Array.from(relationshipTypeFilter) : undefined,
        priorities: priorityFilter.size > 0 ? Array.from(priorityFilter) : undefined,
        relationshipHealth: relationshipHealthFilter.size > 0 ? Array.from(relationshipHealthFilter) : undefined,
        favorite: favoriteFilter ? true : undefined,
        includeArchived,
        sortBy: apiSortBy,
        sortOrder: sortDir,
        includeStats: true,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const items = (data?.contacts ?? []) as LocalContact[];
      if (append) {
        setServerContacts((prev) => [...prev, ...items]);
      } else {
        setServerContacts(items);
      }
      setNextCursor(data?.nextCursor ?? null);
      setServerHasMore(data?.hasMore ?? false);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) setServerLoading(false);
    }
  }, [businessId, search, statusFilter, ageGroupFilter, relationshipTypeFilter, priorityFilter, relationshipHealthFilter, favoriteFilter, includeArchived, sortField, sortDir, pageSize, nextCursor, serverContacts.length, mapSortFieldToApi]);

  useEffect(() => {
    if (isMobilePrev.current !== isMobile) {
      isMobilePrev.current = isMobile;
      setPageSize(isMobile ? 15 : 25);
      setPage(1);
    }
  }, [isMobile]);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
    setNextCursor(null);
    void loadServerContacts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, ageGroupFilter, relationshipTypeFilter, priorityFilter, relationshipHealthFilter, favoriteFilter, includeArchived, sortField, sortDir, pageSize, businessId]);

  useEffect(() => {
    getLastSyncTime().then(setLastSync);
    getCachedContacts().then((cached) => {
      if (cached.length > 0) setCachedLocal(cached);
    });
  }, []);

  useEffect(() => {
    if (contacts.length > 0) {
      setUsingCache(false);
      setCachedLocal([]);
      cacheContacts(contacts as LocalContact[]).then(() => {
        setLastSyncTime();
        getLastSyncTime().then(setLastSync);
      });
    } else if (cachedContactsRef.current.length > 0) {
      setUsingCache(true);
    }
  }, [contacts]);

  const filteredContacts = serverContacts.length > 0 ? serverContacts : (() => {
    let list = [...activeContacts] as LocalContact[];

    if (statusFilter !== "ALL") {
      list = list.filter((c) => c.status === statusFilter);
    }

    if (ageGroupFilter.size > 0) {
      list = list.filter((c) => c.ageGroup && ageGroupFilter.has(c.ageGroup));
    }

    if (search) {
      const terms = search.split(/\s+/).filter(Boolean);
      list = list.filter((c) => {
        const searchable = [
          c.firstName, c.lastName, c.email, c.phone,
          c.companyName, c.jobTitle, c.city, c.country,
          c.source, ...(c.tags || []),
        ].filter(Boolean).join(" ").toLowerCase();
        return terms.every((term) => searchable.includes(term));
      });
    }

    list.sort((a, b) => {
      const rawA = getContactField(a, sortField) ?? "";
      const rawB = getContactField(b, sortField) ?? "";
      if (sortField === "createdAt" || sortField === "lastActive") {
        const valA = rawA ? new Date(rawA).getTime() : 0;
        const valB = rawB ? new Date(rawB).getTime() : 0;
        return sortDir === "asc" ? valA - valB : valB - valA;
      }
      const cmp = String(rawA).toLowerCase().localeCompare(String(rawB).toLowerCase());
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  })();

  const filteredContactsRef = useRef(filteredContacts);
  filteredContactsRef.current = filteredContacts;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: activeContacts.length };
    for (const c of activeContacts) {
      const s = c.status || "UNKNOWN";
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  }, [activeContacts]);

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / pageSize));

  const paginatedContacts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredContacts.slice(start, start + pageSize);
  }, [filteredContacts, page, pageSize]);

  const allPageSelected = paginatedContacts.length > 0 && paginatedContacts.every((c) => selectedIds.has(c.id));
  const somePageSelected = paginatedContacts.some((c) => selectedIds.has(c.id));

  const effectiveSelectedCount = allPagesSelected ? filteredContacts.length : selectedIds.size;

  const visibleColumnDefs = useMemo(() => {
    return ALL_COLUMNS.filter((col) => visibleColumns.has(col.key));
  }, [visibleColumns]);

  useEffect(() => {
    if (allPagesSelected) {
      setSelectedIds(new Set(filteredContacts.map((c) => c.id)));
    }
  }, [allPagesSelected, filteredContacts]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await Promise.resolve(onRefresh());
      toast.success("Contacts synced to local database");
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [onRefresh]);

  const handleExport = useCallback(async (format: ExportFormat) => {
    setExporting(true);
    try {
      const snapshot = filteredContactsRef.current;
      await exportContacts(snapshot, format);
      toast.success(`Exported ${snapshot.length} contacts as ${format.toUpperCase()}`);
      setShowExport(false);
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("Export failed — please try again");
    } finally {
      setExporting(false);
    }
  }, []);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setAllPagesSelected(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const pageIds = paginatedContacts.map((c) => c.id);
    setSelectedIds((prev) => {
      const allSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
        setAllPagesSelected(false);
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [paginatedContacts]);

  const handleSelectAllPages = useCallback(() => {
    setAllPagesSelected(true);
    setSelectedIds(new Set(filteredContacts.map((c) => c.id)));
  }, [filteredContacts]);

  const handleBulkStatusChange = useCallback(async (status: string) => {
    setBulkActing(true);
    try {
      const ids = Array.from(selectedIdsRef.current);
      const res = await bulkUpdateContacts({ businessId, contactIds: ids, status });
      if (res.error) throw new Error(res.error);
      toast.success(`Updated ${ids.length} contacts to ${status}`);
      setSelectedIds(new Set());
      setAllPagesSelected(false);
      setActiveBulkAction(null);
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Bulk update failed";
      toast.error(message);
    } finally {
      setBulkActing(false);
    }
  }, [businessId, onRefresh]);

  const handleBulkAddTags = useCallback(async (tagInput: string) => {
    const tags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return;
    setBulkActing(true);
    try {
      const ids = Array.from(selectedIdsRef.current);
      const res = await bulkUpdateContacts({ businessId, contactIds: ids, addTags: tags });
      if (res.error) throw new Error(res.error);
      toast.success(`Added tags to ${ids.length} contacts`);
      setSelectedIds(new Set());
      setAllPagesSelected(false);
      setActiveBulkAction(null);
      setBulkTagInput("");
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Bulk tag update failed";
      toast.error(message);
    } finally {
      setBulkActing(false);
    }
  }, [businessId, onRefresh]);

  const handleBulkAddToList = useCallback(async (listId: string) => {
    setBulkActing(true);
    try {
      const ids = Array.from(selectedIdsRef.current);
      const res = await addContactsToList(businessId, listId, ids);
      if (res.error) throw new Error(res.error);
      const listName = availableLists.find((l) => l.id === listId)?.name || "list";
      toast.success(`Added ${ids.length} contacts to "${listName}"`);
      setSelectedIds(new Set());
      setAllPagesSelected(false);
      setActiveBulkAction(null);
      setListsRefreshToken((t) => t + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add contacts to list";
      toast.error(message);
    } finally {
      setBulkActing(false);
    }
  }, [businessId, availableLists]);

  const handleBulkRelationshipTypeChange = useCallback(async (relationshipType: string | null) => {
    setBulkActing(true);
    try {
      const ids = Array.from(selectedIdsRef.current);
      const res = await bulkUpdateContacts({ businessId, contactIds: ids, relationshipType });
      if (res.error) throw new Error(res.error);
      toast.success(
        relationshipType
          ? `Updated ${ids.length} contacts to ${relationshipType}`
          : `Cleared relationship type on ${ids.length} contacts`,
      );
      setSelectedIds(new Set());
      setAllPagesSelected(false);
      setActiveBulkAction(null);
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Bulk update failed";
      toast.error(message);
    } finally {
      setBulkActing(false);
    }
  }, [businessId, onRefresh]);

  const handleBulkPriorityChange = useCallback(async (priority: string | null) => {
    setBulkActing(true);
    try {
      const ids = Array.from(selectedIdsRef.current);
      const res = await bulkUpdateContacts({ businessId, contactIds: ids, priority });
      if (res.error) throw new Error(res.error);
      toast.success(
        priority
          ? `Set priority to ${priority} on ${ids.length} contacts`
          : `Cleared priority on ${ids.length} contacts`,
      );
      setSelectedIds(new Set());
      setAllPagesSelected(false);
      setActiveBulkAction(null);
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Bulk update failed";
      toast.error(message);
    } finally {
      setBulkActing(false);
    }
  }, [businessId, onRefresh]);

  const handleBulkToggleFavorite = useCallback(async (favorite: boolean) => {
    setBulkActing(true);
    try {
      const ids = Array.from(selectedIdsRef.current);
      const res = await bulkUpdateContacts({ businessId, contactIds: ids, favorite });
      if (res.error) throw new Error(res.error);
      toast.success(
        favorite
          ? `Marked ${ids.length} contacts as favorite`
          : `Removed favorite from ${ids.length} contacts`,
      );
      setSelectedIds(new Set());
      setAllPagesSelected(false);
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Bulk update failed";
      toast.error(message);
    } finally {
      setBulkActing(false);
    }
  }, [businessId, onRefresh]);

  const handleBulkArchive = useCallback(async (archived: boolean) => {
    setBulkActing(true);
    try {
      const ids = Array.from(selectedIdsRef.current);
      const res = await bulkUpdateContacts({ businessId, contactIds: ids, archived });
      if (res.error) throw new Error(res.error);
      toast.success(
        archived
          ? `Archived ${ids.length} contacts`
          : `Unarchived ${ids.length} contacts`,
      );
      setSelectedIds(new Set());
      setAllPagesSelected(false);
      onRefresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Bulk update failed";
      toast.error(message);
    } finally {
      setBulkActing(false);
    }
  }, [businessId, onRefresh]);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIdsRef.current);
    setConfirmState({
      open: true,
      count: ids.length,
      onConfirm: async () => {
        setBulkActing(true);
        try {
          const res = await bulkDeleteContacts({ businessId, contactIds: ids });
          if (res.error) throw new Error(res.error);
          toast.success(`Deleted ${ids.length} contacts`);
          setSelectedIds(new Set());
          setAllPagesSelected(false);
          onRefresh();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Bulk delete failed";
          toast.error(message);
        } finally {
          setBulkActing(false);
        }
      },
    });
  }, [businessId, onRefresh]);

  const handleConfirmClose = useCallback(() => {
    setConfirmState({ open: false, count: 0, onConfirm: () => {} });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAllPagesSelected(false);
    setActiveBulkAction(null);
  }, []);

  const toggleExport = useCallback(() => setShowExport((p) => !p), []);
  const closeExport = useCallback(() => setShowExport(false), []);
  const toggleFilters = useCallback(() => setShowFilters((p) => !p), []);
  const toggleLists = useCallback(() => setShowLists((p) => !p), []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(1);
  }, []);

  const handlePrevPage = useCallback(() => setPage((p) => p - 1), []);
  const handleNextPage = useCallback(() => setPage((p) => p + 1), []);

  const isSortable = useCallback((key: string) => SORTABLE_FIELDS.has(key), []);

  const handleListsChanged = useCallback((lists: ListSummary[]) => {
    setAvailableLists(lists);
  }, []);

  const toggleColumn = useCallback((key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 2) {
          toast.error("At least 2 columns must remain visible");
          return prev;
        }
        next.delete(key);
      } else {
        next.add(key);
      }
      saveVisibleColumns(next);
      return next;
    });
  }, []);

  const toggleColumnPicker = useCallback(() => setShowColumnPicker((p) => !p), []);
  const closeColumnPicker = useCallback(() => setShowColumnPicker(false), []);

  const toggleViewsPicker = useCallback(() => setShowViewsPicker((p) => !p), []);
  const closeViewsPicker = useCallback(() => setShowViewsPicker(false), []);

  const applyView = useCallback((viewId: string) => {
    const view = savedViews.find((v) => v.id === viewId);
    if (!view) return;
    setStatusFilter(view.config.statusFilter);
    setAgeGroupFilter(new Set(view.config.ageGroupFilter ?? []));
    setRelationshipTypeFilter(new Set(view.config.relationshipTypeFilter ?? []));
    setPriorityFilter(new Set(view.config.priorityFilter ?? []));
    setRelationshipHealthFilter(new Set(view.config.relationshipHealthFilter ?? []));
    setFavoriteFilter(!!view.config.favoriteFilter);
    setIncludeArchived(!!view.config.includeArchived);
    setSearchInput(view.config.search);
    setSortField(view.config.sortField);
    setSortDir(view.config.sortDir);
    setPageSize(view.config.pageSize);
    const newCols = new Set<ColumnKey>(view.config.visibleColumns);
    setVisibleColumns(newCols);
    saveVisibleColumns(newCols);
    setActiveViewId(viewId);
    setShowViewsPicker(false);
    setPage(1);
    toast.success(`View "${view.name}" applied`);
  }, [savedViews]);

  const saveCurrentView = useCallback((name: string) => {
    if (!name.trim()) {
      toast.error("Please enter a view name");
      return;
    }
    const newView: SavedView = {
      id: `view_custom_${Date.now()}`,
      name: name.trim(),
      isDefault: false,
      config: {
        statusFilter,
        ageGroupFilter: [...ageGroupFilter],
        relationshipTypeFilter: [...relationshipTypeFilter],
        priorityFilter: [...priorityFilter],
        relationshipHealthFilter: [...relationshipHealthFilter],
        favoriteFilter,
        includeArchived,
        search: searchInput,
        sortField,
        sortDir,
        visibleColumns: [...visibleColumns],
        pageSize,
      },
    };
    setSavedViews((prev) => {
      const next = [...prev, newView];
      persistSavedViews(next);
      return next;
    });
    setActiveViewId(newView.id);
    setShowViewsPicker(false);
    toast.success(`View "${newView.name}" saved`);
  }, [statusFilter, ageGroupFilter, relationshipTypeFilter, priorityFilter, relationshipHealthFilter, favoriteFilter, includeArchived, searchInput, sortField, sortDir, visibleColumns, pageSize]);

  const deleteView = useCallback((viewId: string) => {
    setSavedViews((prev) => {
      const view = prev.find((v) => v.id === viewId);
      if (view?.isDefault) {
        toast.error("Cannot delete default views");
        return prev;
      }
      const next = prev.filter((v) => v.id !== viewId);
      persistSavedViews(next);
      return next;
    });
    if (activeViewId === viewId) setActiveViewId(null);
    toast.success("View deleted");
  }, [activeViewId]);

  return {
    isMobile,
    showLists,
    searchInput,
    setSearchInput,
    sortField,
    sortDir,
    statusFilter,
    setStatusFilter,
    ageGroupFilter,
    setAgeGroupFilter,
    relationshipTypeFilter,
    setRelationshipTypeFilter,
    priorityFilter,
    setPriorityFilter,
    relationshipHealthFilter,
    setRelationshipHealthFilter,
    favoriteFilter,
    setFavoriteFilter,
    includeArchived,
    setIncludeArchived,
    showExport,
    exporting,
    showFilters,
    page,
    pageSize,
    lastSync,
    syncing,
    usingCache,
    activeContacts,
    filteredContacts,
    paginatedContacts,
    totalPages,

    selectedIds,
    allPagesSelected,
    bulkActing,
    activeBulkAction,
    setActiveBulkAction,
    bulkTagInput,
    setBulkTagInput,
    allPageSelected,
    somePageSelected,
    effectiveSelectedCount,

    availableLists,
    listsRefreshToken,
    handleListsChanged,

    statusCounts,

    visibleColumns,
    visibleColumnDefs,
    showColumnPicker,
    toggleColumn,
    toggleColumnPicker,
    closeColumnPicker,

    savedViews,
    activeViewId,
    showViewsPicker,
    toggleViewsPicker,
    closeViewsPicker,
    applyView,
    saveCurrentView,
    deleteView,

    confirmState,
    handleConfirmClose,

    serverLoading,
    serverHasMore,
    loadServerContacts,

    handleSync,
    handleExport,
    handleSort,
    toggleSelect,
    toggleSelectAll,
    handleSelectAllPages,
    handleBulkStatusChange,
    handleBulkAddTags,
    handleBulkAddToList,
    handleBulkRelationshipTypeChange,
    handleBulkPriorityChange,
    handleBulkToggleFavorite,
    handleBulkArchive,
    handleBulkDelete,
    clearSelection,
    toggleExport,
    closeExport,
    toggleFilters,
    toggleLists,
    handlePageSizeChange,
    handlePrevPage,
    handleNextPage,
    isSortable,
  };
}
