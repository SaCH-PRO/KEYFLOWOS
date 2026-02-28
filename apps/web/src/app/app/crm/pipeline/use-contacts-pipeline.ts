"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { ContactFormData } from "@/components/contacts/contact-form";
import type { ContactCardData } from "@/components/contacts/contact-card";
import type { ContactDetailData, ContactEvent, ContactNote, ContactTask } from "@/components/contacts/contact-detail";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { NextAction as NextActionUI } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import type { HealthMetrics } from "@/components/contacts/contact-health-score";
import type { JourneyMilestone } from "@/components/contacts/relationship-timeline";
import type { ConversationContextData } from "@/components/contacts/conversation-context";
import type { AiInsight } from "@/components/contacts/ai-copilot";
import type { QuickActionType } from "@/components/contacts";
import type { SortOption, SmartSegment, ListTab } from "./pipeline-toolbar";
import type { PipelineDetailPanelProps } from "./pipeline-detail-panel";
import {
  type Contact,
  type ContactDetail as ContactDetailAPI,
  addContactNote, addContactTask, completeContactTask, reopenContactTask,
  createContact, deleteContact, fetchContactDetail, fetchContacts, fetchSegmentSummary,
  importContactsFromFile, importContactsFromLink, updateContact,
  fetchFlowIntelligence, fetchNextActions, completeNextAction,
  fetchAutopilotActionsForCrm, fetchPredictiveRevenue,
  fetchContactHealthMetrics, fetchContactJourney, fetchConversationContext,
  generateAiInsight, logContactEvent, bulkUpdateContacts, bulkDeleteContacts,
  deleteContactNote, deleteContactTask,
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

export function useContactsPipeline() {
  const searchParams = useSearchParams();
  const router = useRouter();

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
  const [activeListTab, setActiveListTab] = useState<ListTab>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [activeSegment, setActiveSegment] = useState<SmartSegment | null>(null);
  const [confirmState, setConfirmState] = useState<{ open: boolean; action: () => void }>({ open: false, action: () => {} });
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [activeListContactIds, setActiveListContactIds] = useState<string[] | null>(null);
  const [crmViewTab, setCrmViewTab] = useState<"pipeline" | "insights" | "engage" | "database">("pipeline");
  const [listsCount, setListsCount] = useState(0);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

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
      setNextActions(actionsRes.data.map((a) => ({
        id: a.id, type: a.type, contactId: a.contactId, contactName: a.contactName,
        description: a.description, aiDraft: a.aiDraft, estimatedTime: a.estimatedTime,
        priority: a.priority, dueDate: a.dueDate, value: a.value,
      })));
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
      if (window.innerWidth < 1024) setShowMobileDetail(true);
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
    if (selectedIds.size === contacts.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(contacts.map((c) => c.id)));
  }, [contacts, selectedIds.size]);

  const handleSubmitContact = async (formData: ContactFormData) => {
    if (!businessId) return;
    const tagsArray = formData.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const shared = {
      firstName: formData.firstName, lastName: formData.lastName,
      email: formData.email || undefined, phone: formData.phone || undefined,
      status: formData.status, source: formData.source || undefined,
      companyName: formData.companyName || undefined, jobTitle: formData.jobTitle || undefined,
      preferredChannel: formData.preferredChannel || undefined,
      lifecycleStage: formData.lifecycleStage || undefined, tags: tagsArray,
      addressLine1: formData.addressLine1 || undefined, city: formData.city || undefined,
      country: formData.country || undefined,
      department: formData.department || undefined, industry: formData.industry || undefined,
      segment: formData.segment || undefined, secondaryEmail: formData.secondaryEmail || undefined,
      secondaryPhone: formData.secondaryPhone || undefined, whatsappNumber: formData.whatsappNumber || undefined,
      displayName: formData.displayName || undefined, language: formData.language || undefined,
      addressLine2: formData.addressLine2 || undefined, state: formData.state || undefined,
      postalCode: formData.postalCode || undefined, timezone: formData.timezone || undefined,
      marketingOptIn: formData.marketingOptIn, doNotContact: formData.doNotContact,
      notesInternal: formData.notesInternal || undefined,
    };
    try {
      if (editingContact && selectedContactId) {
        await updateContact({ businessId, contactId: selectedContactId, ...shared });
        setShowAddForm(false);
        setEditingContact(null);
        void loadContacts();
        void loadDetail(selectedContactId);
        toast.success("Contact updated");
      } else {
        const { data } = await createContact({
          businessId, ...shared,
          source: formData.source || "manual",
        });
        if (data) {
          if (formData.initialNote.trim()) await addContactNote(data.id, formData.initialNote.trim(), businessId);
          setShowAddForm(false);
          void loadContacts();
          void loadFlowData();
          toast.success("Contact created");
        }
      }
    } catch {
      toast.error("Failed to save contact");
    }
  };

  const handleAddNote = async (body: string, source?: string) => {
    if (!selectedContactId || !businessId) return;
    await addContactNote(selectedContactId, body, businessId, source);
    void loadDetail(selectedContactId);
  };

  const handleAddTask = async (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => {
    if (!selectedContactId || !businessId) return;
    await addContactTask(selectedContactId, title, {
      dueDate: options?.dueDate,
      priority: options?.priority as "NORMAL" | "HIGH" | "LOW" | undefined,
      remindAt: options?.remindAt,
    }, businessId);
    void loadDetail(selectedContactId);
  };

  const handleCompleteTask = async (taskId: string, currentStatus?: string) => {
    if (!businessId) return;
    if (currentStatus === "DONE") await reopenContactTask(taskId, businessId);
    else await completeContactTask(taskId, businessId);
    if (selectedContactId) void loadDetail(selectedContactId);
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!businessId) return;
    try {
      await deleteContactNote(noteId, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
      toast.success("Note deleted");
    } catch { toast.error("Failed to delete note"); }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!businessId) return;
    try {
      await deleteContactTask(taskId, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
      toast.success("Task deleted");
    } catch { toast.error("Failed to delete task"); }
  };

  const handleUpdateStatus = async (status: string) => {
    if (!selectedContactId || !businessId) return;
    try {
      await updateContact({ businessId, contactId: selectedContactId, status });
      setContacts((prev) => prev.map((c) => (c.id === selectedContactId ? { ...c, status } : c)));
      if (contactDetail) {
        setContactDetail({
          ...contactDetail,
          contact: contactDetail.contact ? { ...contactDetail.contact, status } : null,
        });
      }
      void loadFlowData();
      toast.success("Status updated");
    } catch { toast.error("Failed to update status"); }
  };

  const handleLogEvent = async (type: string, description?: string) => {
    if (!selectedContactId || !businessId) return;
    try {
      await logContactEvent(selectedContactId, { type, description }, businessId);
      void loadDetail(selectedContactId);
    } catch { /* silent */ }
  };

  const handleEditContact = useCallback(() => {
    const c = contactDetail?.contact;
    if (!c) return;
    setSelectedContactId(c.id);
    setEditingContact({
      firstName: c.firstName || "", lastName: c.lastName || "",
      email: c.email || "", phone: c.phone || "",
      companyName: c.companyName || "", jobTitle: c.jobTitle || "",
      status: c.status || "LEAD", source: c.source || "",
      preferredChannel: c.preferredChannel || "WhatsApp",
      lifecycleStage: c.lifecycleStage || "",
      tags: Array.isArray(c.tags) ? c.tags.join(", ") : "",
      initialNote: "",
      addressLine1: c.addressLine1 || "", city: c.city || "",
      country: c.country || "Trinidad",
      department: c.department || "", industry: c.industry || "",
      segment: c.segment || "", secondaryEmail: c.secondaryEmail || "",
      secondaryPhone: c.secondaryPhone || "", whatsappNumber: c.whatsappNumber || "",
      displayName: c.displayName || "", language: c.language || "",
      addressLine2: c.addressLine2 || "", state: c.state || "",
      postalCode: c.postalCode || "", timezone: c.timezone || "",
      marketingOptIn: c.marketingOptIn ?? false,
      doNotContact: c.doNotContact ?? false,
      notesInternal: c.notesInternal || "",
    });
    setShowMobileDetail(false);
    setShowAddForm(true);
  }, [contactDetail]);

  const handleDeleteContact = useCallback(async (contact?: { id: string }) => {
    const id = contact?.id || selectedContactId;
    if (!id || !businessId) return;
    setConfirmState({
      open: true,
      action: async () => {
        try {
          await deleteContact(id, businessId);
          setContacts((prev) => prev.filter((c) => c.id !== id));
          if (selectedContactId === id) { setSelectedContactId(null); setContactDetail(null); }
          setShowMobileDetail(false);
          void loadFlowData();
          toast.success("Contact deleted");
        } catch { toast.error("Failed to delete contact"); }
      },
    });
  }, [businessId, selectedContactId, loadFlowData]);

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

  const handleDoAction = useCallback((action: NextActionUI) => {
    selectContact(action.contactId);
  }, [selectContact]);

  const handleQuickAction = useCallback((contactId: string, action: QuickActionType) => {
    switch (action) {
      case "create-invoice": router.push(`/app/commerce?tab=invoices&contactId=${contactId}`); break;
      case "book-appointment": router.push(`/app/bookings?contactId=${contactId}`); break;
      case "send-quote": router.push(`/app/commerce?tab=quotes&contactId=${contactId}`); break;
    }
  }, [router]);

  const handleBulkStatusChange = useCallback(async (newStatus: string) => {
    if (!businessId || selectedIds.size === 0) return;
    try {
      await bulkUpdateContacts({ businessId, contactIds: Array.from(selectedIds), status: newStatus });
      setContacts((prev) => prev.map((c) => selectedIds.has(c.id) ? { ...c, status: newStatus } : c));
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success(`Updated ${selectedIds.size} contact${selectedIds.size !== 1 ? "s" : ""}`);
    } catch { toast.error("Failed to update contacts"); }
  }, [businessId, selectedIds]);

  const handleBulkTag = useCallback(async (tag: string) => {
    if (!businessId || selectedIds.size === 0 || !tag.trim()) return;
    try {
      await bulkUpdateContacts({ businessId, contactIds: Array.from(selectedIds), addTags: [tag.trim()] });
      setContacts((prev) => prev.map((c) => {
        if (!selectedIds.has(c.id)) return c;
        const tags = c.tags ?? [];
        return tags.includes(tag.trim()) ? c : { ...c, tags: [...tags, tag.trim()] };
      }));
      toast.success(`Tagged ${selectedIds.size} contact${selectedIds.size !== 1 ? "s" : ""}`);
    } catch { toast.error("Failed to tag contacts"); }
  }, [businessId, selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    if (!businessId || selectedIds.size === 0) return;
    setConfirmState({
      open: true,
      action: async () => {
        try {
          await bulkDeleteContacts({ businessId, contactIds: Array.from(selectedIds) });
          setContacts((prev) => prev.filter((c) => !selectedIds.has(c.id)));
          if (selectedContactId && selectedIds.has(selectedContactId)) { setSelectedContactId(null); setContactDetail(null); }
          setSelectedIds(new Set());
          setSelectMode(false);
          void loadFlowData();
          toast.success(`Deleted ${selectedIds.size} contact${selectedIds.size !== 1 ? "s" : ""}`);
        } catch { toast.error("Failed to delete contacts"); }
      },
    });
  }, [businessId, selectedIds, selectedContactId, loadFlowData]);

  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => { if (prev) setSelectedIds(new Set()); return !prev; });
  }, []);

  const handleRefreshConversationContext = useCallback(async () => {
    if (selectedContactId && businessId) {
      const { data } = await fetchConversationContext(selectedContactId, businessId);
      if (data) setConversationContext(data);
    }
  }, [selectedContactId, businessId]);

  const selectedContact = useMemo<ContactDetailData | null>(() => {
    if (!contactDetail?.contact) return null;
    return { ...contactDetail.contact, tags: contactDetail.contact.tags ?? [] } as ContactDetailData;
  }, [contactDetail]);

  const detailEvents: ContactEvent[] = contactDetail?.events ?? [];
  const detailNotes: ContactNote[] = contactDetail?.notes ?? [];
  const detailTasks: ContactTask[] = (contactDetail?.tasks ?? []).map((t) => ({
    id: t.id, title: t.title, status: t.status ?? null, priority: t.priority ?? null,
    dueDate: t.dueDate ?? null, remindAt: t.remindAt ?? null,
    completedAt: t.completedAt ?? null, source: t.source ?? null, createdAt: t.createdAt ?? null,
  }));

  const contactName = selectedContact
    ? `${selectedContact.firstName ?? ""} ${selectedContact.lastName ?? ""}`.trim() || "Contact"
    : "Contact";

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

  const selectedContactsForBroadcast = useMemo(
    () => contacts.filter((c) => selectedIds.has(c.id)) as ContactCardData[],
    [contacts, selectedIds],
  );

  const detailPanelProps: Omit<PipelineDetailPanelProps, "onClose"> = {
    contact: selectedContact,
    events: detailEvents,
    notes: detailNotes,
    tasks: detailTasks,
    loading: detailLoading,
    isPinned: selectedContactId ? pinnedIds.includes(selectedContactId) : false,
    contactName,
    healthMetrics,
    journeyMilestones,
    conversationContext,
    aiInsight,
    aiInsightLoading,
    onTogglePin: handleTogglePin,
    onAddNote: handleAddNote,
    onAddTask: handleAddTask,
    onCompleteTask: handleCompleteTask,
    onDeleteNote: handleDeleteNote,
    onDeleteTask: handleDeleteTask,
    onUpdateStatus: handleUpdateStatus,
    onEdit: handleEditContact,
    onDelete: () => void handleDeleteContact(),
    onLogEvent: handleLogEvent,
    onGenerateAiInsight: handleGenerateAiInsight,
    onRefreshConversationContext: handleRefreshConversationContext,
  };

  return {
    businessId, workspaceLoading, workspaceError,
    contacts, loading, hasMore,
    searchInput, setSearchInput, statusFilter, setStatusFilter,
    sortBy, setSortBy, activeSegment, setActiveSegment,
    activeListTab, setActiveListTab,
    selectedContactId, selectedContact, detailLoading,
    detailEvents, detailNotes, detailTasks, contactName,
    showAddForm, setShowAddForm, editingContact, setEditingContact,
    showMobileDetail, setShowMobileDetail,
    showAddMenu, setShowAddMenu,
    showBroadcast, setShowBroadcast,
    showGuide, setShowGuide,
    selectMode, selectedIds, setSelectedIds, setSelectMode,
    isPending,
    crmViewTab, setCrmViewTab,
    activeListId, setActiveListId, activeListContactIds, setActiveListContactIds,
    listsCount, setListsCount,
    confirmState, setConfirmState,
    flowIntelligence, nextActions, autopilotActions, autopilotPaused,
    setAutopilotPaused, setAutopilotActions,
    revenueData, healthMetrics, journeyMilestones, conversationContext,
    aiInsight, aiInsightLoading,
    pinnedIds, pinnedContacts, recentContacts,
    displayContacts, segmentCounts, selectedContactsForBroadcast,
    detailPanelProps,
    loadContacts, loadFlowData, selectContact,
    handleSubmitContact, handleAddNote, handleAddTask, handleCompleteTask,
    handleDeleteNote, handleDeleteTask, handleUpdateStatus, handleLogEvent,
    handleEditContact, handleDeleteContact,
    handleImportFile, handleImportLink,
    handleCompleteNextAction, handleDoAction, handleQuickAction,
    handleBulkStatusChange, handleBulkTag, handleBulkDelete,
    handleToggleSelectMode, handleTogglePin, handleToggleSelect, handleSelectAll,
    handleGenerateAiInsight, handleRefreshConversationContext,
  };
}

export type PipelineState = ReturnType<typeof useContactsPipeline>;
