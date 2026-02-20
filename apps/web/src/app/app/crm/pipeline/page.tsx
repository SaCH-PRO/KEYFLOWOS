"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  Filter,
  Users,
  RefreshCw,
  ChevronDown,
  X,
  Send,
  Star,
  Clock,
  CheckSquare,
  ArrowUpDown,
  Tag,
  Flame,
  AlertTriangle,
  CalendarPlus,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  ContactCard,
  ContactCardData,
  ContactForm,
  ContactFormData,
  ContactDetail,
  ContactDetailData,
  ContactEvent,
  ContactNote,
  ContactTask,
  ContactImport,
  FlowIntelligence,
  NextActionQueue,
  AutopilotActions,
  PredictiveRevenue,
  ContactHealthScore,
  RelationshipTimeline,
  ConversationContext,
  AiCopilot,
  BroadcastDrawer,
} from "@/components/contacts";
import type { QuickActionType } from "@/components/contacts";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { NextAction as NextActionUI } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import type { HealthMetrics } from "@/components/contacts/contact-health-score";
import type { JourneyMilestone } from "@/components/contacts/relationship-timeline";
import type { ConversationContextData } from "@/components/contacts/conversation-context";
import type { AiInsight } from "@/components/contacts/ai-copilot";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { StatCards } from "@/components/ui/stat-cards";
import {
  Contact,
  ContactDetail as ContactDetailAPI,
  addContactNote,
  addContactTask,
  completeContactTask,
  createContact,
  deleteContact,
  fetchContactDetail,
  fetchContacts,
  fetchSegmentSummary,
  importContactsFromFile,
  importContactsFromLink,
  updateContact,
  fetchFlowIntelligence,
  fetchNextActions,
  completeNextAction,
  fetchAutopilotActionsForCrm,
  fetchPredictiveRevenue,
  fetchContactHealthMetrics,
  fetchContactJourney,
  fetchConversationContext,
  generateAiInsight,
  CrmNextAction,
} from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const STATUSES = ["ALL", "LEAD", "PROSPECT", "CLIENT", "LOST"] as const;
const PAGE_SIZE = 50;
const PINNED_KEY = "kf_pinned_contacts";
const RECENT_KEY = "kf_recent_contacts";
const MAX_RECENT = 8;

type SortOption = "name" | "newest" | "oldest" | "revenue" | "score";
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name", label: "Name A-Z" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "revenue", label: "Highest Revenue" },
  { value: "score", label: "Highest Score" },
];

type SmartSegment = "high-value" | "needs-followup" | "new-this-week" | "at-risk" | "stale";
const SMART_SEGMENTS: { key: SmartSegment; label: string; icon: typeof Flame; color: string }[] = [
  { key: "high-value", label: "High Value", icon: TrendingUp, color: "hsl(142 76% 36%)" },
  { key: "needs-followup", label: "Needs Follow-up", icon: AlertTriangle, color: "hsl(var(--kf-accent1))" },
  { key: "new-this-week", label: "New This Week", icon: CalendarPlus, color: "hsl(var(--kf-accent2))" },
  { key: "at-risk", label: "At Risk", icon: Flame, color: "hsl(0 70% 55%)" },
  { key: "stale", label: "No Activity 30d", icon: Clock, color: "hsl(var(--kf-muted-foreground))" },
];

type ContactWithTags = Omit<Contact, "tags"> & { tags?: string[]; source?: string | null; sourceDetail?: string | null; preferredChannel?: string | null; createdAt?: string | null };

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

export default function ContactsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [segments, setSegments] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextOffset, setNextOffset] = useState(0);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [contactDetail, setContactDetail] = useState<ContactDetailAPI | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactFormData | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [flowIntelligence, setFlowIntelligence] = useState<FlowIntelligenceData | null>(null);
  const [nextActions, setNextActions] = useState<NextActionUI[]>([]);
  const [autopilotActions, setAutopilotActions] = useState<AutopilotAction[]>([]);
  const [autopilotPaused, setAutopilotPaused] = useState(false);
  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [healthMetrics, setHealthMetrics] = useState<HealthMetrics | null>(null);
  const [journeyMilestones, setJourneyMilestones] = useState<JourneyMilestone[]>([]);
  const [conversationContext, setConversationContext] = useState<ConversationContextData | null>(null);
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(false);

  const [pinnedIds, setPinnedIdsState] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [activeListTab, setActiveListTab] = useState<"all" | "pinned" | "recent">("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [showSort, setShowSort] = useState(false);
  const [activeSegment, setActiveSegment] = useState<SmartSegment | null>(null);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [showBulkTag, setShowBulkTag] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setPinnedIdsState(getPinnedIds());
    setRecentIds(getRecentIds());
  }, []);

  useEffect(() => {
    const initWorkspace = async () => {
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
        setWorkspaceLoading(false);
        return;
      }
      const created = await ensureWorkspace();
      if (created) {
        setBusinessId(created);
        setWorkspaceLoading(false);
        return;
      }
      setWorkspaceError("We could not find your workspace. Please sign in again.");
      setWorkspaceLoading(false);
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const loadFlowData = useCallback(async () => {
    if (!businessId) return;
    const [flowRes, actionsRes, autopilotRes, revenueRes] = await Promise.all([
      fetchFlowIntelligence(businessId),
      fetchNextActions(businessId),
      fetchAutopilotActionsForCrm(businessId),
      fetchPredictiveRevenue(businessId),
    ]);
    if (flowRes.data) setFlowIntelligence(flowRes.data);
    if (actionsRes.data) {
      const mapped: NextActionUI[] = actionsRes.data.map((a) => ({
        id: a.id, type: a.type, contactId: a.contactId, contactName: a.contactName,
        description: a.description, aiDraft: a.aiDraft, estimatedTime: a.estimatedTime,
        priority: a.priority, dueDate: a.dueDate, value: a.value,
      }));
      setNextActions(mapped);
    }
    if (autopilotRes.data) setAutopilotActions(autopilotRes.data);
    if (revenueRes.data) setRevenueData(revenueRes.data);
  }, [businessId]);

  const loadContacts = useCallback(
    async (opts?: { append?: boolean }) => {
      if (!businessId) return;
      const append = opts?.append ?? false;
      setLoading(true);
      try {
        if (append) {
          const { data } = await fetchContacts(businessId, {
            take: PAGE_SIZE, skip: nextOffset,
            search: search || undefined,
            status: statusFilter !== "ALL" ? statusFilter : undefined,
            includeStats: true,
          });
          const mapped = (data ?? []).map((c) => ({ ...c, tags: c.tags ?? [] }));
          setContacts((prev) => [...prev, ...mapped]);
          setNextOffset((prev) => prev + mapped.length);
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
          setNextOffset(mapped.length);
          setHasMore(mapped.length === PAGE_SIZE);
        }
      } catch (error) {
        console.error("Failed to load contacts", error);
      } finally {
        setLoading(false);
      }
    },
    [businessId, search, statusFilter, nextOffset],
  );

  const loadContactEnhancements = useCallback(
    async (contactId: string) => {
      if (!businessId) return;
      const [healthRes, journeyRes, contextRes] = await Promise.all([
        fetchContactHealthMetrics(contactId, businessId),
        fetchContactJourney(contactId, businessId),
        fetchConversationContext(contactId, businessId),
      ]);
      if (healthRes.data) setHealthMetrics(healthRes.data);
      if (journeyRes.data) setJourneyMilestones(journeyRes.data);
      if (contextRes.data) setConversationContext(contextRes.data);
      setAiInsight(null);
    },
    [businessId],
  );

  const loadDetail = useCallback(
    async (contactId: string) => {
      if (!businessId) return;
      setDetailLoading(true);
      const { data } = await fetchContactDetail(contactId, businessId);
      setContactDetail(data ?? null);
      setDetailLoading(false);
      void loadContactEnhancements(contactId);
    },
    [businessId, loadContactEnhancements],
  );

  const selectContact = useCallback(
    (contactId: string) => {
      setSelectedContactId(contactId);
      addRecentId(contactId);
      setRecentIds(getRecentIds());
      void loadDetail(contactId);
      if (window.innerWidth < 1024) {
        setShowMobileDetail(true);
      }
    },
    [loadDetail],
  );

  const handleGenerateAiInsight = useCallback(async () => {
    if (!selectedContactId || !businessId) return;
    setAiInsightLoading(true);
    const { data } = await generateAiInsight(selectedContactId, businessId);
    if (data) setAiInsight(data);
    setAiInsightLoading(false);
  }, [selectedContactId, businessId]);

  useEffect(() => {
    if (businessId) {
      startTransition(() => {
        void loadContacts();
        void loadFlowData();
      });
    }
  }, [businessId, search, statusFilter, loadContacts, loadFlowData]);

  useEffect(() => {
    if (contacts.length > 0 && !selectedContactId) {
      setSelectedContactId(contacts[0].id);
      void loadDetail(contacts[0].id);
    }
  }, [contacts, selectedContactId, loadDetail]);

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
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  }, [contacts, selectedIds.size]);

  const handleSubmitContact = async (formData: ContactFormData) => {
    if (!businessId) return;
    const tagsArray = formData.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (editingContact && selectedContactId) {
      await updateContact({
        businessId, contactId: selectedContactId,
        firstName: formData.firstName, lastName: formData.lastName,
        email: formData.email || undefined, phone: formData.phone || undefined,
        status: formData.status, source: formData.source || undefined,
        companyName: formData.companyName || undefined, jobTitle: formData.jobTitle || undefined,
        preferredChannel: formData.preferredChannel || undefined,
        lifecycleStage: formData.lifecycleStage || undefined, tags: tagsArray,
        addressLine1: formData.addressLine1 || undefined, city: formData.city || undefined,
        country: formData.country || undefined,
      });
      setShowAddForm(false);
      setEditingContact(null);
      void loadContacts();
      void loadDetail(selectedContactId);
    } else {
      const { data } = await createContact({
        businessId, firstName: formData.firstName, lastName: formData.lastName,
        email: formData.email, phone: formData.phone, status: formData.status,
        source: formData.source || "manual",
        companyName: formData.companyName || undefined, jobTitle: formData.jobTitle || undefined,
        preferredChannel: formData.preferredChannel || undefined,
        lifecycleStage: formData.lifecycleStage || undefined, tags: tagsArray,
        addressLine1: formData.addressLine1 || undefined, city: formData.city || undefined,
        country: formData.country || undefined,
      });
      if (data) {
        if (formData.initialNote.trim()) {
          await addContactNote(data.id, formData.initialNote.trim(), businessId);
        }
        setShowAddForm(false);
        void loadContacts();
        void loadFlowData();
      }
    }
  };

  const handleAddNote = async (body: string) => {
    if (!selectedContactId || !businessId) return;
    await addContactNote(selectedContactId, body, businessId);
    void loadDetail(selectedContactId);
  };

  const handleAddTask = async (title: string, dueDate?: string) => {
    if (!selectedContactId || !businessId) return;
    await addContactTask(selectedContactId, title, { dueDate }, businessId);
    void loadDetail(selectedContactId);
  };

  const handleCompleteTask = async (taskId: string) => {
    if (!businessId) return;
    await completeContactTask(taskId, businessId);
    if (selectedContactId) void loadDetail(selectedContactId);
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedContactId || !businessId) return;
    await updateContact({ businessId, contactId: selectedContactId, status });
    setContacts((prev) => prev.map((c) => (c.id === selectedContactId ? { ...c, status } : c)));
    if (contactDetail) {
      setContactDetail({
        ...contactDetail,
        contact: contactDetail.contact ? { ...contactDetail.contact, status } : null,
      });
    }
    void loadFlowData();
  };

  const handleEditContact = (contact?: ContactCardData) => {
    const c = contact || contactDetail?.contact;
    if (!c) return;
    setSelectedContactId(c.id);
    const extendedContact = c as ContactCardData & { addressLine1?: string | null; city?: string | null; country?: string | null };
    setEditingContact({
      firstName: c.firstName || "", lastName: c.lastName || "",
      email: c.email || "", phone: c.phone || "",
      companyName: c.companyName || "", jobTitle: c.jobTitle || "",
      status: c.status || "LEAD", source: "",
      preferredChannel: "WhatsApp", lifecycleStage: "",
      tags: Array.isArray(c.tags) ? c.tags.join(", ") : "",
      initialNote: "",
      addressLine1: extendedContact.addressLine1 || "",
      city: extendedContact.city || "",
      country: extendedContact.country || "Trinidad",
    });
    setShowMobileDetail(false);
    setShowAddForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteContact = async (contact?: ContactCardData) => {
    const id = contact?.id || selectedContactId;
    if (!id || !businessId) return;
    if (!confirm("Are you sure you want to delete this contact?")) return;
    await deleteContact(id, businessId);
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (selectedContactId === id) {
      setSelectedContactId(null);
      setContactDetail(null);
    }
    setShowMobileDetail(false);
    void loadFlowData();
  };

  const handleImportFile = async (type: "csv" | "xlsx" | "vcf" | "image", file: File) => {
    if (!businessId) return;
    await importContactsFromFile({ businessId, type, file });
    void loadContacts();
    void loadFlowData();
  };

  const handleImportLink = async (url: string) => {
    if (!businessId) return;
    await importContactsFromLink(url, businessId);
    void loadContacts();
    void loadFlowData();
  };

  const handleCompleteNextAction = async (actionId: string) => {
    if (!businessId) return;
    await completeNextAction(actionId, businessId);
    setNextActions((prev) => prev.filter((a) => a.id !== actionId));
  };

  const handleDoAction = (action: NextActionUI) => {
    selectContact(action.contactId);
  };

  const handleQuickAction = useCallback((contactId: string, action: QuickActionType) => {
    switch (action) {
      case "create-invoice":
        router.push(`/app/commerce?tab=invoices&contactId=${contactId}`);
        break;
      case "book-appointment":
        router.push(`/app/bookings?contactId=${contactId}`);
        break;
      case "send-quote":
        router.push(`/app/commerce?tab=quotes&contactId=${contactId}`);
        break;
    }
  }, [router]);

  const handleBulkStatusChange = useCallback(async (newStatus: string) => {
    if (!businessId || selectedIds.size === 0) return;
    const promises = Array.from(selectedIds).map((id) =>
      updateContact({ businessId, contactId: id, status: newStatus })
    );
    await Promise.all(promises);
    setContacts((prev) => prev.map((c) => selectedIds.has(c.id) ? { ...c, status: newStatus } : c));
    setSelectedIds(new Set());
    setSelectMode(false);
    setBulkStatus(null);
  }, [businessId, selectedIds]);

  const handleBulkTag = useCallback(async (tag: string) => {
    if (!businessId || selectedIds.size === 0 || !tag.trim()) return;
    const tagTrimmed = tag.trim();
    const promises = Array.from(selectedIds).map((id) => {
      const contact = contacts.find((c) => c.id === id);
      const existingTags = contact?.tags ?? [];
      if (existingTags.includes(tagTrimmed)) return Promise.resolve();
      return updateContact({ businessId, contactId: id, tags: [...existingTags, tagTrimmed] });
    });
    await Promise.all(promises);
    setContacts((prev) => prev.map((c) => {
      if (!selectedIds.has(c.id)) return c;
      const tags = c.tags ?? [];
      return tags.includes(tagTrimmed) ? c : { ...c, tags: [...tags, tagTrimmed] };
    }));
    setBulkTagInput("");
    setShowBulkTag(false);
  }, [businessId, selectedIds, contacts]);

  const selectedContact = useMemo(() => {
    if (!contactDetail?.contact) return null;
    return { ...contactDetail.contact, tags: contactDetail.contact.tags ?? [] } as ContactDetailData;
  }, [contactDetail]);

  const detailEvents: ContactEvent[] = contactDetail?.events ?? [];
  const detailNotes: ContactNote[] = contactDetail?.notes ?? [];
  const detailTasks: ContactTask[] = (contactDetail?.tasks ?? []).map((t) => ({
    id: t.id, title: t.title, status: t.status, dueDate: t.dueDate,
  }));

  const contactName = selectedContact
    ? `${selectedContact.firstName ?? ""} ${selectedContact.lastName ?? ""}`.trim() || "Contact"
    : "Contact";

  const pinnedContacts = useMemo(() => contacts.filter((c) => pinnedIds.includes(c.id)), [contacts, pinnedIds]);
  const recentContacts = useMemo(() => {
    return recentIds.map((id) => contacts.find((c) => c.id === id)).filter(Boolean) as ContactWithTags[];
  }, [contacts, recentIds]);

  const segmentCounts = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const counts: Record<SmartSegment, number> = { "high-value": 0, "needs-followup": 0, "new-this-week": 0, "at-risk": 0, "stale": 0 };
    for (const c of contacts) {
      const meta = (c as any).meta;
      if (meta?.totalRevenue > 500 || meta?.invoiceCount > 3) counts["high-value"]++;
      if (meta?.overdueTasks > 0 || meta?.unpaidInvoices > 0) counts["needs-followup"]++;
      if (c.createdAt && new Date(c.createdAt) > weekAgo) counts["new-this-week"]++;
      if (c.status === "CLIENT" && meta?.lastInteractionAt && new Date(meta.lastInteractionAt) < thirtyDaysAgo) counts["at-risk"]++;
      if (meta?.lastInteractionAt && new Date(meta.lastInteractionAt) < thirtyDaysAgo) counts["stale"]++;
    }
    return counts;
  }, [contacts]);

  const displayContacts = useMemo(() => {
    let list: ContactWithTags[];
    if (activeListTab === "pinned") list = pinnedContacts;
    else if (activeListTab === "recent") list = recentContacts;
    else list = [...contacts];

    if (activeSegment) {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      list = list.filter((c) => {
        const meta = (c as any).meta;
        switch (activeSegment) {
          case "high-value": return meta?.totalRevenue > 500 || meta?.invoiceCount > 3;
          case "needs-followup": return meta?.overdueTasks > 0 || meta?.unpaidInvoices > 0;
          case "new-this-week": return c.createdAt && new Date(c.createdAt) > weekAgo;
          case "at-risk": return c.status === "CLIENT" && meta?.lastInteractionAt && new Date(meta.lastInteractionAt) < thirtyDaysAgo;
          case "stale": return meta?.lastInteractionAt && new Date(meta.lastInteractionAt) < thirtyDaysAgo;
          default: return true;
        }
      });
    }

    list.sort((a, b) => {
      const metaA = (a as any).meta;
      const metaB = (b as any).meta;
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
  }, [activeListTab, contacts, pinnedContacts, recentContacts, activeSegment, sortBy]);

  const selectedContactsForBroadcast = useMemo(
    () => contacts.filter((c) => selectedIds.has(c.id)) as ContactCardData[],
    [contacts, selectedIds],
  );

  if (workspaceLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Preparing your workspace...</p>
        </div>
      </div>
    );
  }

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
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Contacts"
        subtitle="Your AI-powered contact management hub"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {selectMode ? (
              <>
                <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
                <button onClick={handleSelectAll} className="kf-btn-secondary text-sm px-3 py-1.5">
                  {selectedIds.size === contacts.length ? "Deselect All" : "Select All"}
                </button>
                <div className="relative">
                  <button
                    onClick={() => setBulkStatus(bulkStatus ? null : "open")}
                    disabled={selectedIds.size === 0}
                    className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
                  >
                    <UserCheck className="w-4 h-4" />
                    Status
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {bulkStatus === "open" && (
                    <div className="absolute top-full mt-1 right-0 z-50 kf-card border border-border shadow-xl rounded-xl py-1 w-36">
                      {(["LEAD", "PROSPECT", "CLIENT", "LOST"] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => handleBulkStatusChange(s)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button
                    onClick={() => setShowBulkTag(!showBulkTag)}
                    disabled={selectedIds.size === 0}
                    className="kf-btn-secondary inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
                  >
                    <Tag className="w-4 h-4" />
                    Tag
                  </button>
                  {showBulkTag && (
                    <div className="absolute top-full mt-1 right-0 z-50 kf-card border border-border shadow-xl rounded-xl p-3 w-52">
                      <input
                        type="text"
                        placeholder="Enter tag name..."
                        value={bulkTagInput}
                        onChange={(e) => setBulkTagInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleBulkTag(bulkTagInput); }}
                        className="kf-input w-full text-sm mb-2"
                        autoFocus
                      />
                      <button
                        onClick={() => handleBulkTag(bulkTagInput)}
                        disabled={!bulkTagInput.trim()}
                        className="kf-btn-primary w-full text-sm disabled:opacity-50"
                      >
                        Apply Tag
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setShowBroadcast(true); }}
                  disabled={selectedIds.size === 0}
                  className="kf-btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  Broadcast
                </button>
                <button
                  onClick={() => { setSelectMode(false); setSelectedIds(new Set()); setBulkStatus(null); setShowBulkTag(false); }}
                  className="kf-btn-secondary text-sm px-3 py-1.5"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setSelectMode(true)}
                  className="kf-btn-secondary inline-flex items-center gap-2 text-sm"
                >
                  <CheckSquare className="w-4 h-4" />
                  <span className="hidden sm:inline">Select</span>
                </button>
                <button
                  onClick={() => setShowAddForm(true)}
                  className="kf-btn-primary inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Contact
                </button>
              </>
            )}
          </div>
        }
      />

      <StatCards
        items={[
          { label: "Total", value: contacts.length, icon: Users, color: "hsl(var(--kf-accent1))" },
          { label: "Leads", value: segments["LEAD"] ?? contacts.filter((c) => c.status === "LEAD").length, icon: Star, color: "hsl(var(--kf-accent2))" },
          { label: "Prospects", value: segments["PROSPECT"] ?? contacts.filter((c) => c.status === "PROSPECT").length, icon: Filter, color: "hsl(200 70% 50%)" },
          { label: "Clients", value: segments["CLIENT"] ?? contacts.filter((c) => c.status === "CLIENT").length, icon: CheckSquare, color: "hsl(150 60% 40%)" },
        ]}
      />

      {flowIntelligence && (
        <FlowIntelligence
          data={flowIntelligence}
          onViewCold={() => setStatusFilter("LEAD")}
          onViewReady={() => setStatusFilter("PROSPECT")}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <NextActionQueue
          actions={nextActions}
          onComplete={handleCompleteNextAction}
          onViewContact={selectContact}
          onDoAction={handleDoAction}
        />
        <AutopilotActions
          actions={autopilotActions}
          isPaused={autopilotPaused}
          onTogglePause={() => setAutopilotPaused(!autopilotPaused)}
          onApprove={async (id) => {
            setAutopilotActions((prev) => prev.map((a) => (a.id === id ? { ...a, status: "completed" as const } : a)));
          }}
          onDeny={async (id) => {
            setAutopilotActions((prev) => prev.filter((a) => a.id !== id));
          }}
          onViewContact={selectContact}
        />
      </div>

      {revenueData && (
        <PredictiveRevenue
          data={revenueData}
          onViewExpiringQuotes={() => {}}
          onViewOverdueInvoices={() => {}}
        />
      )}

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

      <ContactImport
        onImportFile={handleImportFile}
        onImportLink={handleImportLink}
        loading={isPending}
        businessId={businessId ?? undefined}
      />

      <div className="kf-card p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search contacts by name, email, phone, company..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="kf-input w-full pl-10"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`kf-btn-secondary inline-flex items-center gap-2 ${showFilters ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
          >
            <Filter className="w-4 h-4" />
            Filters
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowSort(!showSort)}
              className={`kf-btn-secondary inline-flex items-center gap-2 ${showSort ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
            >
              <ArrowUpDown className="w-4 h-4" />
              <span className="hidden sm:inline">Sort</span>
            </button>
            {showSort && (
              <div className="absolute top-full mt-1 right-0 z-50 kf-card border border-border shadow-xl rounded-xl py-1 w-44">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSortBy(opt.value); setShowSort(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${sortBy === opt.value ? "text-[hsl(var(--kf-accent1))] font-medium" : ""}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => { void loadContacts(); void loadFlowData(); }}
            disabled={loading}
            className="kf-btn-secondary inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {SMART_SEGMENTS.map(({ key, label, icon: SIcon, color }) => {
            const count = segmentCounts[key];
            const isActive = activeSegment === key;
            return (
              <button
                key={key}
                onClick={() => setActiveSegment(isActive ? null : key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all border ${
                  isActive
                    ? "border-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/10"
                    : "border-border hover:border-muted-foreground/30 bg-muted/30"
                }`}
                style={isActive ? { color } : undefined}
              >
                <SIcon className="w-3 h-3" style={{ color }} />
                {label}
                {count > 0 && (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ background: `${color}20`, color }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          {activeSegment && (
            <button
              onClick={() => setActiveSegment(null)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-2"
            >
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${statusFilter === s ? "kf-btn-primary" : "kf-btn-secondary"}`}
                >
                  {s}
                </button>
              ))}
              {statusFilter !== "ALL" && (
                <button
                  onClick={() => { setStatusFilter("ALL"); setSearchInput(""); }}
                  className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-1 border-b border-border">
          {[
            { key: "all", label: `All (${contacts.length})`, icon: Users },
            { key: "pinned", label: `Pinned (${pinnedContacts.length})`, icon: Star },
            { key: "recent", label: `Recent (${recentContacts.length})`, icon: Clock },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveListTab(key as typeof activeListTab)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
                activeListTab === key
                  ? "border-[hsl(var(--kf-accent1))] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,450px]">
        <div className="space-y-3">
          {loading && contacts.length === 0 ? (
            <div className="kf-card p-8 text-center">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Loading contacts...</p>
            </div>
          ) : displayContacts.length === 0 ? (
            <div className="kf-card p-8 text-center">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg font-medium mb-1">
                {activeListTab === "pinned" ? "No pinned contacts" : activeListTab === "recent" ? "No recent contacts" : "No contacts yet"}
              </p>
              <p className="text-muted-foreground mb-4">
                {activeListTab === "pinned"
                  ? "Pin your most important contacts for quick access"
                  : activeListTab === "recent"
                  ? "Your recently viewed contacts will appear here"
                  : "Add your first contact to get started"}
              </p>
              {activeListTab === "all" && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="kf-btn-primary inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Contact
                </button>
              )}
            </div>
          ) : (
            <>
              {displayContacts.map((contact, index) => (
                <ContactCard
                  key={contact.id}
                  contact={contact as ContactCardData}
                  isSelected={selectedContactId === contact.id}
                  selectable={selectMode}
                  selected={selectedIds.has(contact.id)}
                  onToggleSelect={handleToggleSelect}
                  isPinned={pinnedIds.includes(contact.id)}
                  onTogglePin={handleTogglePin}
                  onClick={() => selectContact(contact.id)}
                  onDelete={handleDeleteContact}
                  onQuickAction={handleQuickAction}
                  index={index}
                />
              ))}
              {activeListTab === "all" && hasMore && (
                <button
                  onClick={() => loadContacts({ append: true })}
                  disabled={loading}
                  className="w-full kf-btn-secondary py-3"
                >
                  {loading ? "Loading..." : "Load More"}
                </button>
              )}
            </>
          )}
        </div>

        <div className="hidden lg:block sticky top-4 h-fit space-y-4">
          <ContactDetail
            contact={selectedContact}
            events={detailEvents}
            notes={detailNotes}
            tasks={detailTasks}
            loading={detailLoading}
            isPinned={selectedContactId ? pinnedIds.includes(selectedContactId) : false}
            onTogglePin={handleTogglePin}
            onAddNote={handleAddNote}
            onAddTask={handleAddTask}
            onCompleteTask={handleCompleteTask}
            onUpdateStatus={handleUpdateStatus}
            onEdit={() => handleEditContact()}
            onDelete={() => handleDeleteContact()}
          />

          {selectedContact && (
            <>
              <AiCopilot
                contactName={contactName}
                insight={aiInsight}
                isLoading={aiInsightLoading}
                onGenerateInsight={handleGenerateAiInsight}
              />

              {healthMetrics && (
                <div className="kf-card p-5">
                  <ContactHealthScore
                    metrics={healthMetrics}
                    tip={
                      healthMetrics.relationship < 60
                        ? "Schedule a personal check-in call to strengthen this relationship"
                        : healthMetrics.engagement < 60
                        ? "Send a personalized offer to re-engage this contact"
                        : undefined
                    }
                  />
                </div>
              )}

              {journeyMilestones.length > 0 && (
                <div className="kf-card p-5">
                  <RelationshipTimeline contactName={contactName} milestones={journeyMilestones} />
                </div>
              )}

              {conversationContext && (
                <div className="kf-card p-5">
                  <ConversationContext
                    data={conversationContext}
                    contactName={contactName}
                    onRefresh={async () => {
                      if (selectedContactId && businessId) {
                        const { data } = await fetchConversationContext(selectedContactId, businessId);
                        if (data) setConversationContext(data);
                      }
                    }}
                  />
                </div>
              )}
            </>
          )}
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
              className="absolute bottom-0 left-0 right-0 max-h-[85vh] bg-background rounded-t-3xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-12 h-1 bg-muted rounded-full mx-auto mt-3 mb-2" />
              <div className="overflow-y-auto max-h-[calc(85vh-24px)] space-y-4 p-4">
                <ContactDetail
                  contact={selectedContact}
                  events={detailEvents}
                  notes={detailNotes}
                  tasks={detailTasks}
                  loading={detailLoading}
                  isPinned={selectedContactId ? pinnedIds.includes(selectedContactId) : false}
                  onTogglePin={handleTogglePin}
                  onClose={() => setShowMobileDetail(false)}
                  onAddNote={handleAddNote}
                  onAddTask={handleAddTask}
                  onCompleteTask={handleCompleteTask}
                  onUpdateStatus={handleUpdateStatus}
                  onEdit={() => handleEditContact()}
                  onDelete={() => handleDeleteContact()}
                />

                {selectedContact && (
                  <AiCopilot
                    contactName={contactName}
                    insight={aiInsight}
                    isLoading={aiInsightLoading}
                    onGenerateInsight={handleGenerateAiInsight}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BroadcastDrawer
        isOpen={showBroadcast}
        onClose={() => setShowBroadcast(false)}
        selectedContacts={selectedContactsForBroadcast}
        onDeselectAll={() => { setSelectedIds(new Set()); setSelectMode(false); }}
      />
    </div>
  );
}
