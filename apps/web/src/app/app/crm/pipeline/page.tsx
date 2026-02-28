"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Users,
  X,
  List,
  BarChart3,
  Sparkles,
  Database,
  Lightbulb,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ContactCardData,
  ContactForm,
  ContactFormData,
  ContactDetailData,
  ContactEvent,
  ContactNote,
  ContactTask,
  ContactCapture,
  FlowIntelligence,
  NextActionQueue,
  AutopilotActions,
  PredictiveRevenue,
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
import { toast } from "sonner";
import { KanbanSkeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { DuplicateDetector } from "./duplicate-detector";
import { ContactsDatabase } from "./contacts-database";
import { PipelineToolbar } from "./pipeline-toolbar";
import { PipelineContactList } from "./pipeline-contact-list";
import { PipelineDetailPanel } from "./pipeline-detail-panel";
import { BulkActionBar } from "./bulk-action-bar";
import type { SortOption, SmartSegment, ListTab } from "./pipeline-toolbar";
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
  logContactEvent,
  bulkUpdateContacts,
  bulkDeleteContacts,
  deleteContactNote,
  deleteContactTask,
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

export default function ContactsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [segments, setSegments] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextOffset, setNextOffset] = useState(0);

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
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void}>({open: false, action: () => {}});
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
    const googleSuccess = searchParams.get("google_success");
    const googleError = searchParams.get("google_error");
    const imported = searchParams.get("imported");

    if (googleSuccess === "true") {
      toast.success(`Google Contacts imported successfully${imported ? ` (${imported} contacts)` : ""}`);
      window.history.replaceState({}, "", window.location.pathname);
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
    try {
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
          department: formData.department || undefined, industry: formData.industry || undefined,
          segment: formData.segment || undefined, secondaryEmail: formData.secondaryEmail || undefined,
          secondaryPhone: formData.secondaryPhone || undefined, whatsappNumber: formData.whatsappNumber || undefined,
          displayName: formData.displayName || undefined, language: formData.language || undefined,
          addressLine2: formData.addressLine2 || undefined, state: formData.state || undefined,
          postalCode: formData.postalCode || undefined, timezone: formData.timezone || undefined,
          marketingOptIn: formData.marketingOptIn, doNotContact: formData.doNotContact,
          notesInternal: formData.notesInternal || undefined,
        });
        setShowAddForm(false);
        setEditingContact(null);
        void loadContacts();
        void loadDetail(selectedContactId);
        toast.success("Contact updated");
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
          department: formData.department || undefined, industry: formData.industry || undefined,
          segment: formData.segment || undefined, secondaryEmail: formData.secondaryEmail || undefined,
          secondaryPhone: formData.secondaryPhone || undefined, whatsappNumber: formData.whatsappNumber || undefined,
          displayName: formData.displayName || undefined, language: formData.language || undefined,
          addressLine2: formData.addressLine2 || undefined, state: formData.state || undefined,
          postalCode: formData.postalCode || undefined, timezone: formData.timezone || undefined,
          marketingOptIn: formData.marketingOptIn, doNotContact: formData.doNotContact,
          notesInternal: formData.notesInternal || undefined,
        });
        if (data) {
          if (formData.initialNote.trim()) {
            await addContactNote(data.id, formData.initialNote.trim(), businessId);
          }
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

  const handleCompleteTask = async (taskId: string) => {
    if (!businessId) return;
    await completeContactTask(taskId, businessId);
    if (selectedContactId) void loadDetail(selectedContactId);
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!businessId) return;
    try {
      await deleteContactNote(noteId, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
      toast.success("Note deleted");
    } catch {
      toast.error("Failed to delete note");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!businessId) return;
    try {
      await deleteContactTask(taskId, businessId);
      if (selectedContactId) void loadDetail(selectedContactId);
      toast.success("Task deleted");
    } catch {
      toast.error("Failed to delete task");
    }
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
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleLogEvent = async (type: string, description?: string) => {
    if (!selectedContactId || !businessId) return;
    try {
      await logContactEvent(selectedContactId, { type, description }, businessId);
      void loadDetail(selectedContactId);
    } catch {
    }
  };

  const handleEditContact = (contact?: ContactCardData) => {
    const c = contact || contactDetail?.contact;
    if (!c) return;
    setSelectedContactId(c.id);
    const ec = c as ContactCardData & Record<string, any>;
    setEditingContact({
      firstName: c.firstName || "", lastName: c.lastName || "",
      email: c.email || "", phone: c.phone || "",
      companyName: c.companyName || "", jobTitle: c.jobTitle || "",
      status: c.status || "LEAD", source: ec.source || "",
      preferredChannel: ec.preferredChannel || "WhatsApp",
      lifecycleStage: ec.lifecycleStage || "",
      tags: Array.isArray(c.tags) ? c.tags.join(", ") : "",
      initialNote: "",
      addressLine1: ec.addressLine1 || "",
      city: ec.city || "",
      country: ec.country || "Trinidad",
      department: ec.department || "",
      industry: ec.industry || "",
      segment: ec.segment || "",
      secondaryEmail: ec.secondaryEmail || "",
      secondaryPhone: ec.secondaryPhone || "",
      whatsappNumber: ec.whatsappNumber || "",
      displayName: ec.displayName || "",
      language: ec.language || "",
      addressLine2: ec.addressLine2 || "",
      state: ec.state || "",
      postalCode: ec.postalCode || "",
      timezone: ec.timezone || "",
      marketingOptIn: ec.marketingOptIn ?? false,
      doNotContact: ec.doNotContact ?? false,
      notesInternal: ec.notesInternal || "",
    });
    setShowMobileDetail(false);
    setShowAddForm(true);
  };

  const handleDeleteContact = async (contact?: ContactCardData) => {
    const id = contact?.id || selectedContactId;
    if (!id || !businessId) return;
    setConfirmState({
      open: true,
      action: async () => {
        try {
          await deleteContact(id, businessId);
          setContacts((prev) => prev.filter((c) => c.id !== id));
          if (selectedContactId === id) {
            setSelectedContactId(null);
            setContactDetail(null);
          }
          setShowMobileDetail(false);
          void loadFlowData();
          toast.success("Contact deleted");
        } catch {
          toast.error("Failed to delete contact");
        }
      },
    });
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
    try {
      await bulkUpdateContacts({ businessId, contactIds: Array.from(selectedIds), status: newStatus });
      setContacts((prev) => prev.map((c) => selectedIds.has(c.id) ? { ...c, status: newStatus } : c));
      setSelectedIds(new Set());
      setSelectMode(false);
      toast.success(`Updated ${selectedIds.size} contact${selectedIds.size !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to update contacts");
    }
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
    } catch {
      toast.error("Failed to tag contacts");
    }
  }, [businessId, selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    if (!businessId || selectedIds.size === 0) return;
    setConfirmState({
      open: true,
      action: async () => {
        try {
          await bulkDeleteContacts({ businessId, contactIds: Array.from(selectedIds) });
          setContacts((prev) => prev.filter((c) => !selectedIds.has(c.id)));
          if (selectedContactId && selectedIds.has(selectedContactId)) {
            setSelectedContactId(null);
            setContactDetail(null);
          }
          setSelectedIds(new Set());
          setSelectMode(false);
          void loadFlowData();
          toast.success(`Deleted ${selectedIds.size} contact${selectedIds.size !== 1 ? "s" : ""}`);
        } catch {
          toast.error("Failed to delete contacts");
        }
      },
    });
  }, [businessId, selectedIds, selectedContactId, loadFlowData]);

  const handleToggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) {
        setSelectedIds(new Set());
      }
      return !prev;
    });
  }, []);

  const handleRefreshConversationContext = useCallback(async () => {
    if (selectedContactId && businessId) {
      const { data } = await fetchConversationContext(selectedContactId, businessId);
      if (data) setConversationContext(data);
    }
  }, [selectedContactId, businessId]);

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
    return recentIds.map((id) => contacts.find((c) => c.id === id)).filter(Boolean) as Contact[];
  }, [contacts, recentIds]);

  const segmentCounts = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const counts: Record<SmartSegment, number> = { "high-value": 0, "needs-followup": 0, "new-this-week": 0, "at-risk": 0, "stale": 0 };
    for (const c of contacts) {
      const meta = c.meta;
      if (meta?.totalRevenue && meta.totalRevenue > 500 || meta?.invoiceCount && meta.invoiceCount > 3) counts["high-value"]++;
      if (meta?.overdueTasks && meta.overdueTasks > 0 || meta?.unpaidInvoices && meta.unpaidInvoices > 0) counts["needs-followup"]++;
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

  if (workspaceLoading) return <KanbanSkeleton />;

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
    <div className="space-y-6" aria-label="CRM Pipeline">
      <PageHeader
        icon={Users}
        title="Contacts"
        subtitle="Your AI-powered contact management hub"
        titleExtra={
          <div className="relative">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                showGuide
                  ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
                  : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
              }`}
              aria-label="Getting started guide"
              title="Getting started guide"
            >
              <Lightbulb className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showGuide && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 rounded-lg bg-amber-400/10">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Getting Started</h4>
                        <p className="text-[11px] text-muted-foreground">Your quick-start guide</p>
                      </div>
                      <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { step: "1", title: "Add Contacts", desc: "Create contacts manually, or they auto-appear from bookings, store orders, and lead forms." },
                        { step: "2", title: "Segment & Filter", desc: "Use smart segments (High Value, New This Week, At Risk) to focus on key contacts." },
                        { step: "3", title: "Track Revenue", desc: "See total revenue, invoice count, and booking history for each contact." },
                        { step: "4", title: "Communicate", desc: "Reach out via WhatsApp, email, or phone directly from any contact card." },
                        { step: "5", title: "Broadcast Messages", desc: "Select multiple contacts and send bulk WhatsApp or email messages." },
                        { step: "6", title: "Quick Actions", desc: "Create invoices, send quotes, or book appointments directly from a contact." },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                            {item.step}
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        }
      />

      <TabNav
        tabs={[
          { key: "pipeline", label: "Pipeline", icon: Users },
          { key: "database", label: "Database", icon: Database },
          { key: "insights", label: "Insights", icon: BarChart3 },
          { key: "engage", label: "Engage", icon: Sparkles },
        ]}
        activeTab={crmViewTab}
        onTabChange={(t) => setCrmViewTab(t as "pipeline" | "insights" | "engage" | "database")}
      />

      {crmViewTab === "pipeline" && businessId && (
        <DuplicateDetector businessId={businessId} onMergeComplete={() => { void loadContacts(); }} />
      )}

      {crmViewTab === "insights" && (
        <>
          {flowIntelligence && (
            <FlowIntelligence
              data={flowIntelligence}
              onViewCold={() => { setStatusFilter("LEAD"); setCrmViewTab("pipeline"); }}
              onViewReady={() => { setStatusFilter("PROSPECT"); setCrmViewTab("pipeline"); }}
            />
          )}
          {revenueData && (
            <PredictiveRevenue
              data={revenueData}
              onViewExpiringQuotes={() => {}}
              onViewOverdueInvoices={() => {}}
            />
          )}
          {!flowIntelligence && !revenueData && (
            <div className="kf-card p-8 text-center">
              <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg font-medium mb-1">Insights Coming Soon</p>
              <p className="text-muted-foreground text-sm">Add more contacts and activities to unlock AI-powered insights about your pipeline.</p>
            </div>
          )}
        </>
      )}

      {crmViewTab === "engage" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <NextActionQueue
              actions={nextActions}
              onComplete={handleCompleteNextAction}
              onViewContact={(id) => { selectContact(id); setCrmViewTab("pipeline"); }}
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
              onViewContact={(id) => { selectContact(id); setCrmViewTab("pipeline"); }}
            />
          </div>
          {nextActions.length === 0 && autopilotActions.length === 0 && (
            <div className="kf-card p-8 text-center">
              <Sparkles className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg font-medium mb-1">All Caught Up</p>
              <p className="text-muted-foreground text-sm">No pending actions right now. Keep building your pipeline and we'll surface smart next steps.</p>
            </div>
          )}
        </div>
      )}

      {crmViewTab === "database" && businessId && (
        <ContactsDatabase
          businessId={businessId}
          contacts={contacts.map((c) => ({
            id: c.id,
            firstName: c.firstName ?? null,
            lastName: c.lastName ?? null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            status: c.status ?? null,
            source: c.source ?? null,
            tags: Array.isArray(c.tags) ? c.tags : [],
            companyName: c.companyName ?? null,
            jobTitle: c.jobTitle ?? null,
            city: c.city ?? null,
            country: c.country ?? null,
            preferredChannel: c.preferredChannel ?? null,
            createdAt: c.createdAt ?? null,
            addressLine1: c.addressLine1 ?? null,
            addressLine2: c.addressLine2 ?? null,
            whatsappNumber: c.whatsappNumber ?? null,
            department: c.department ?? null,
            industry: c.industry ?? null,
            lifecycleStage: c.lifecycleStage ?? null,
            sourceDetail: c.sourceDetail ?? null,
            notesInternal: c.notesInternal ?? null,
            updatedAt: c.updatedAt ?? null,
            secondaryEmail: c.secondaryEmail ?? null,
            secondaryPhone: c.secondaryPhone ?? null,
            displayName: c.displayName ?? null,
            segment: c.segment ?? null,
            language: c.language ?? null,
            timezone: c.timezone ?? null,
            state: c.state ?? null,
            postalCode: c.postalCode ?? null,
            marketingOptIn: c.marketingOptIn ?? null,
            doNotContact: c.doNotContact ?? null,
            custom: c.custom ?? null,
          }))}
          onRefresh={() => { void loadContacts(); }}
          activeListId={activeListId}
          onSelectList={(listId, contactIds) => {
            setActiveListId(listId);
            setActiveListContactIds(contactIds || null);
            if (listId) setCrmViewTab("pipeline");
          }}
          onListsLoaded={(count) => setListsCount(count)}
        />
      )}

      {crmViewTab === "pipeline" && activeListId && (
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

      {crmViewTab === "pipeline" && (
      <>
      <AnimatePresence>
        {showAddMenu && (
          <ContactCapture
            onManualAdd={() => setShowAddForm(true)}
            onImportFile={handleImportFile}
            onImportLink={handleImportLink}
            onClose={() => setShowAddMenu(false)}
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
        onListTabChange={setActiveListTab}
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

        <div className="hidden lg:block sticky top-4 h-fit">
          <PipelineDetailPanel
            contact={selectedContact}
            events={detailEvents}
            notes={detailNotes}
            tasks={detailTasks}
            loading={detailLoading}
            isPinned={selectedContactId ? pinnedIds.includes(selectedContactId) : false}
            contactName={contactName}
            healthMetrics={healthMetrics}
            journeyMilestones={journeyMilestones}
            conversationContext={conversationContext}
            aiInsight={aiInsight}
            aiInsightLoading={aiInsightLoading}
            onTogglePin={handleTogglePin}
            onAddNote={handleAddNote}
            onAddTask={handleAddTask}
            onCompleteTask={handleCompleteTask}
            onDeleteNote={handleDeleteNote}
            onDeleteTask={handleDeleteTask}
            onUpdateStatus={handleUpdateStatus}
            onEdit={() => handleEditContact()}
            onDelete={() => handleDeleteContact()}
            onLogEvent={handleLogEvent}
            onGenerateAiInsight={handleGenerateAiInsight}
            onRefreshConversationContext={handleRefreshConversationContext}
          />
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
              <div className="overflow-y-auto max-h-[calc(85vh-24px)] p-4">
                <PipelineDetailPanel
                  contact={selectedContact}
                  events={detailEvents}
                  notes={detailNotes}
                  tasks={detailTasks}
                  loading={detailLoading}
                  isPinned={selectedContactId ? pinnedIds.includes(selectedContactId) : false}
                  contactName={contactName}
                  healthMetrics={healthMetrics}
                  journeyMilestones={journeyMilestones}
                  conversationContext={conversationContext}
                  aiInsight={aiInsight}
                  aiInsightLoading={aiInsightLoading}
                  onTogglePin={handleTogglePin}
                  onAddNote={handleAddNote}
                  onAddTask={handleAddTask}
                  onCompleteTask={handleCompleteTask}
                  onDeleteNote={handleDeleteNote}
                  onDeleteTask={handleDeleteTask}
                  onUpdateStatus={handleUpdateStatus}
                  onEdit={() => handleEditContact()}
                  onDelete={() => handleDeleteContact()}
                  onLogEvent={handleLogEvent}
                  onGenerateAiInsight={handleGenerateAiInsight}
                  onRefreshConversationContext={handleRefreshConversationContext}
                  onClose={() => setShowMobileDetail(false)}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </>
      )}

      <BroadcastDrawer
        isOpen={showBroadcast}
        onClose={() => setShowBroadcast(false)}
        selectedContacts={selectedContactsForBroadcast}
        onDeselectAll={() => { setSelectedIds(new Set()); setSelectMode(false); }}
      />
      <ConfirmDialog
        open={confirmState.open}
        title="Delete Contact"
        message="Are you sure you want to delete this contact? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { confirmState.action(); setConfirmState({open: false, action: () => {}}); }}
        onCancel={() => setConfirmState({open: false, action: () => {}})}
      />
    </div>
  );
}
