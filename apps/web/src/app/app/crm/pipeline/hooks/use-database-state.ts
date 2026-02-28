"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { LocalContact } from "@/lib/contacts-db";
import { cacheContacts, getCachedContacts, getLastSyncTime, setLastSyncTime } from "@/lib/contacts-db";
import { exportContacts, type ExportFormat } from "@/lib/contacts-export";
import { bulkUpdateContacts, bulkDeleteContacts } from "@/lib/client";
import { toast } from "sonner";

export type SortField = "firstName" | "lastName" | "email" | "phone" | "status" | "companyName" | "city" | "country" | "source" | "createdAt";
export type SortDir = "asc" | "desc";
export type BulkAction = "status" | "tags" | null;

const SORTABLE_FIELDS = new Set<string>([
  "firstName", "lastName", "email", "phone", "status",
  "companyName", "city", "country", "source", "createdAt",
]);

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
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
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
  const [bulkActing, setBulkActing] = useState(false);
  const [activeBulkAction, setActiveBulkAction] = useState<BulkAction>(null);
  const [bulkTagInput, setBulkTagInput] = useState("");

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    count: number;
    onConfirm: () => void;
  }>({ open: false, count: 0, onConfirm: () => {} });

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const cachedContactsRef = useRef(cachedContacts);
  cachedContactsRef.current = cachedContacts;

  const activeContacts = contacts.length > 0 ? contacts : cachedContacts;

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

  useEffect(() => { setPage(1); }, [search, statusFilter, sortField, sortDir, pageSize]);

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

  const filteredContacts = useMemo(() => {
    let list = [...activeContacts] as LocalContact[];

    if (statusFilter !== "ALL") {
      list = list.filter((c) => c.status === statusFilter);
    }

    if (search) {
      list = list.filter((c) => {
        const searchable = [
          c.firstName, c.lastName, c.email, c.phone,
          c.companyName, c.jobTitle, c.city, c.country,
          c.source, ...(c.tags || []),
        ].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(search);
      });
    }

    list.sort((a, b) => {
      const rawA = getContactField(a, sortField) ?? "";
      const rawB = getContactField(b, sortField) ?? "";
      if (sortField === "createdAt") {
        const valA = rawA ? new Date(rawA).getTime() : 0;
        const valB = rawB ? new Date(rawB).getTime() : 0;
        return sortDir === "asc" ? valA - valB : valB - valA;
      }
      const cmp = String(rawA).toLowerCase().localeCompare(String(rawB).toLowerCase());
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [activeContacts, search, statusFilter, sortField, sortDir]);

  const filteredContactsRef = useRef(filteredContacts);
  filteredContactsRef.current = filteredContacts;

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / pageSize));

  const paginatedContacts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredContacts.slice(start, start + pageSize);
  }, [filteredContacts, page, pageSize]);

  const allPageSelected = paginatedContacts.length > 0 && paginatedContacts.every((c) => selectedIds.has(c.id));
  const somePageSelected = paginatedContacts.some((c) => selectedIds.has(c.id));

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
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [paginatedContacts]);

  const handleBulkStatusChange = useCallback(async (status: string) => {
    setBulkActing(true);
    try {
      const ids = Array.from(selectedIdsRef.current);
      const res = await bulkUpdateContacts({ businessId, contactIds: ids, status });
      if (res.error) throw new Error(res.error);
      toast.success(`Updated ${ids.length} contacts to ${status}`);
      setSelectedIds(new Set());
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

  return {
    isMobile,
    showLists,
    searchInput,
    setSearchInput,
    sortField,
    sortDir,
    statusFilter,
    setStatusFilter,
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
    bulkActing,
    activeBulkAction,
    setActiveBulkAction,
    bulkTagInput,
    setBulkTagInput,
    allPageSelected,
    somePageSelected,

    confirmState,
    handleConfirmClose,

    handleSync,
    handleExport,
    handleSort,
    toggleSelect,
    toggleSelectAll,
    handleBulkStatusChange,
    handleBulkAddTags,
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
