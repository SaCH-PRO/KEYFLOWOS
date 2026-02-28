"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { Contact } from "@/lib/client";
import type { SmartSegment, ListTab, SortOption } from "../pipeline-toolbar";
import {
  fetchContacts, fetchSegmentSummary,
} from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const PAGE_SIZE = 25;
const PINNED_KEY = "kf_pinned_contacts";
const RECENT_KEY = "kf_recent_contacts";
const MAX_RECENT = 8;

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

export function useContactsData() {
  const searchParams = useSearchParams();

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [segments, setSegments] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const nextOffsetRef = useRef(0);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const [isPending, startTransition] = useTransition();

  const [pinnedIds, setPinnedIdsState] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeListTab, setActiveListTab] = useState<ListTab>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [activeSegment, setActiveSegment] = useState<SmartSegment | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [activeListContactIds, setActiveListContactIds] = useState<string[] | null>(null);
  const [listsCount, setListsCount] = useState(0);
  const [crmViewTab, setCrmViewTab] = useState<"pipeline" | "insights" | "engage" | "database">("pipeline");

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
    const googleSuccess = searchParams.get("google_success");
    const googleError = searchParams.get("google_error");
    const imported = searchParams.get("imported");
    if (googleSuccess === "true") {
      toast.success(`Google Contacts imported successfully${imported ? ` (${imported} contacts)` : ""}`);
      window.history.replaceState({}, "", window.location.pathname);
      loadContacts({});
    } else if (googleError) {
      toast.error(`Google import failed: ${decodeURIComponent(googleError)}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams]);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const loadContacts = useCallback(
    async (opts?: { append?: boolean }) => {
      if (!businessId) return;
      const append = opts?.append ?? false;
      setLoading(true);
      try {
        if (append) {
          const { data } = await fetchContacts(businessId, {
            take: PAGE_SIZE, skip: nextOffsetRef.current,
            search: search || undefined,
            status: statusFilter !== "ALL" ? statusFilter : undefined,
            includeStats: true,
          });
          const mapped = (data ?? []).map((c) => ({ ...c, tags: c.tags ?? [] }));
          setContacts((prev) => [...prev, ...mapped]);
          nextOffsetRef.current += mapped.length;
          setHasMore(mapped.length === PAGE_SIZE);
        } else {
          const [{ data: contactData }, { data: segmentData }] = await Promise.all([
            fetchContacts(businessId, {
              take: PAGE_SIZE, skip: 0,
              search: search || undefined,
              status: statusFilter !== "ALL" ? statusFilter : undefined,
              includeStats: true,
            }),
            fetchSegmentSummary(businessId),
          ]);
          const mapped = (contactData ?? []).map((c) => ({ ...c, tags: c.tags ?? [] }));
          setContacts(mapped);
          setSegments(segmentData ?? {});
          nextOffsetRef.current = mapped.length;
          setHasMore(mapped.length === PAGE_SIZE);
        }
      } catch (error) {
        console.error("Failed to load contacts", error);
        toast.error("Failed to load contacts");
      } finally {
        setLoading(false);
      }
    },
    [businessId, search, statusFilter],
  );

  const handleTogglePin = useCallback((id: string) => {
    setPinnedIdsState((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      setPinnedIds(next);
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === contacts.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(contacts.map((c) => c.id)));
  }, [contacts, selectedIds.size]);

  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => { if (prev) setSelectedIds(new Set()); return !prev; });
  }, []);

  const trackRecent = useCallback((id: string) => {
    addRecentId(id);
    setRecentIds(getRecentIds());
  }, []);

  const pinnedContacts = useMemo(() => contacts.filter((c) => pinnedIds.includes(c.id)), [contacts, pinnedIds]);
  const recentContacts = useMemo(() => {
    return recentIds.map((id) => contacts.find((c) => c.id === id)).filter(Boolean) as Contact[];
  }, [contacts, recentIds]);

  const segmentCounts = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const counts: Record<SmartSegment, number> = { "high-value": 0, "needs-followup": 0, "new-this-week": 0, "at-risk": 0, "stale": 0 };
    for (const c of contacts) {
      const meta = c.meta;
      if ((meta?.totalRevenue && meta.totalRevenue > 500) || (meta?.invoiceCount && meta.invoiceCount > 3)) counts["high-value"]++;
      if ((meta?.overdueTasks && meta.overdueTasks > 0) || (meta?.unpaidInvoices && meta.unpaidInvoices > 0)) counts["needs-followup"]++;
      if (c.createdAt && new Date(c.createdAt) > weekAgo) counts["new-this-week"]++;
      if (c.status === "CLIENT" && meta?.lastInteractionAt && new Date(meta.lastInteractionAt) < thirtyDaysAgo) counts["at-risk"]++;
      if (meta?.lastInteractionAt && new Date(meta.lastInteractionAt) < thirtyDaysAgo) counts["stale"]++;
    }
    return counts;
  }, [contacts]);

  const displayContacts = useMemo(() => {
    let list: Contact[];
    if (activeListTab === "pinned") list = pinnedContacts;
    else if (activeListTab === "recent") list = recentContacts;
    else list = [...contacts];

    if (activeListContactIds && activeListContactIds.length > 0) {
      const idSet = new Set(activeListContactIds);
      list = list.filter((c) => idSet.has(c.id));
    }

    if (activeSegment) {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      list = list.filter((c) => {
        const meta = c.meta;
        switch (activeSegment) {
          case "high-value": return (meta?.totalRevenue && meta.totalRevenue > 500) || (meta?.invoiceCount && meta.invoiceCount > 3);
          case "needs-followup": return (meta?.overdueTasks && meta.overdueTasks > 0) || (meta?.unpaidInvoices && meta.unpaidInvoices > 0);
          case "new-this-week": return c.createdAt && new Date(c.createdAt) > weekAgo;
          case "at-risk": return c.status === "CLIENT" && meta?.lastInteractionAt && new Date(meta.lastInteractionAt) < thirtyDaysAgo;
          case "stale": return meta?.lastInteractionAt && new Date(meta.lastInteractionAt) < thirtyDaysAgo;
          default: return true;
        }
      });
    }

    list.sort((a, b) => {
      const metaA = a.meta;
      const metaB = b.meta;
      switch (sortBy) {
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
  }, [activeListTab, contacts, pinnedContacts, recentContacts, activeSegment, sortBy, activeListContactIds]);

  return {
    businessId, workspaceLoading, workspaceError,
    contacts, setContacts, segments, loading, hasMore,
    searchInput, setSearchInput, search, statusFilter, setStatusFilter,
    sortBy, setSortBy, activeSegment, setActiveSegment,
    activeListTab, setActiveListTab,
    selectMode, setSelectMode, selectedIds, setSelectedIds,
    activeListId, setActiveListId, activeListContactIds, setActiveListContactIds,
    listsCount, setListsCount,
    crmViewTab, setCrmViewTab,
    isPending, startTransition,
    pinnedIds, pinnedContacts, recentContacts,
    displayContacts, segmentCounts,
    loadContacts, handleTogglePin, handleToggleSelect, handleSelectAll, handleToggleSelectMode,
    trackRecent,
  };
}
