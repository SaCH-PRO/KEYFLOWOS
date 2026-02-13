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
} from "lucide-react";
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
} from "@/components/contacts";
import type { FlowIntelligenceData } from "@/components/contacts/flow-intelligence";
import type { NextAction as NextActionUI } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";
import type { RevenueData } from "@/components/contacts/predictive-revenue";
import type { HealthMetrics } from "@/components/contacts/contact-health-score";
import type { JourneyMilestone } from "@/components/contacts/relationship-timeline";
import type { ConversationContextData } from "@/components/contacts/conversation-context";
import type { AiInsight } from "@/components/contacts/ai-copilot";
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

type ContactWithTags = Omit<Contact, "tags"> & { tags?: string[] };

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
        id: a.id,
        type: a.type,
        contactId: a.contactId,
        contactName: a.contactName,
        description: a.description,
        aiDraft: a.aiDraft,
        estimatedTime: a.estimatedTime,
        priority: a.priority,
        dueDate: a.dueDate,
        value: a.value,
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

      if (append) setLoading(true);
      else setLoading(true);

      try {
        if (append) {
          const { data } = await fetchContacts(businessId, {
            take: PAGE_SIZE,
            skip: nextOffset,
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
              take: PAGE_SIZE,
              skip: 0,
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

  const handleSubmitContact = async (formData: ContactFormData) => {
    if (!businessId) return;

    const tagsArray = formData.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (editingContact && selectedContactId) {
      await updateContact({
        businessId,
        contactId: selectedContactId,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        status: formData.status,
        source: formData.source || undefined,
        companyName: formData.companyName || undefined,
        jobTitle: formData.jobTitle || undefined,
        preferredChannel: formData.preferredChannel || undefined,
        lifecycleStage: formData.lifecycleStage || undefined,
        tags: tagsArray,
        addressLine1: formData.addressLine1 || undefined,
        city: formData.city || undefined,
        country: formData.country || undefined,
      });
      setShowAddForm(false);
      setEditingContact(null);
      void loadContacts();
      void loadDetail(selectedContactId);
    } else {
      const { data } = await createContact({
        businessId,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        status: formData.status,
        source: formData.source || undefined,
        companyName: formData.companyName || undefined,
        jobTitle: formData.jobTitle || undefined,
        preferredChannel: formData.preferredChannel || undefined,
        lifecycleStage: formData.lifecycleStage || undefined,
        tags: tagsArray,
        addressLine1: formData.addressLine1 || undefined,
        city: formData.city || undefined,
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
    setContacts((prev) =>
      prev.map((c) => (c.id === selectedContactId ? { ...c, status } : c)),
    );
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
      firstName: c.firstName || "",
      lastName: c.lastName || "",
      email: c.email || "",
      phone: c.phone || "",
      companyName: c.companyName || "",
      jobTitle: c.jobTitle || "",
      status: c.status || "LEAD",
      source: "",
      preferredChannel: "WhatsApp",
      lifecycleStage: "",
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

  const handleDoAction = (action: NextAction) => {
    selectContact(action.contactId);
  };

  const selectedContact = useMemo(() => {
    if (!contactDetail?.contact) return null;
    return {
      ...contactDetail.contact,
      tags: contactDetail.contact.tags ?? [],
    } as ContactDetailData;
  }, [contactDetail]);

  const detailEvents: ContactEvent[] = contactDetail?.events ?? [];
  const detailNotes: ContactNote[] = contactDetail?.notes ?? [];
  const detailTasks: ContactTask[] = (contactDetail?.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueDate: t.dueDate,
  }));

  const contactName = selectedContact
    ? `${selectedContact.firstName ?? ""} ${selectedContact.lastName ?? ""}`.trim() || "Contact"
    : "Contact";

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
          <p className="text-lg font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
            {workspaceError}
          </p>
          <p className="text-muted-foreground">Try logging in again to create your workspace.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Contacts</h1>
          <p className="text-muted-foreground mt-1">Your AI-powered contact management system</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="kf-btn-primary inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {[
          { label: "Total", value: contacts.length, color: "hsl(var(--kf-accent1))" },
          { label: "Leads", value: segments["LEAD"] ?? contacts.filter(c => c.status === "LEAD").length, color: "hsl(var(--kf-accent2))" },
          { label: "Prospects", value: segments["PROSPECT"] ?? contacts.filter(c => c.status === "PROSPECT").length, color: "hsl(200 70% 50%)" },
          { label: "Clients", value: segments["CLIENT"] ?? contacts.filter(c => c.status === "CLIENT").length, color: "hsl(150 60% 40%)" },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.05, type: "spring" as const, stiffness: 300, damping: 24 }}
            className="kf-card p-4 text-center"
            style={{ borderColor: `${kpi.color.replace(")", " / 0.2)")}` }}
          >
            <p className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{kpi.label}</p>
          </motion.div>
        ))}
      </motion.div>

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
            setAutopilotActions((prev) =>
              prev.map((a) => (a.id === id ? { ...a, status: "completed" as const } : a)),
            );
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
          onViewExpiringQuotes={() => console.log("View expiring quotes")}
          onViewOverdueInvoices={() => console.log("View overdue invoices")}
        />
      )}

      <AnimatePresence>
        {showAddForm && (
          <ContactForm
            onSubmit={handleSubmitContact}
            onCancel={() => {
              setShowAddForm(false);
              setEditingContact(null);
            }}
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
              placeholder="Search contacts..."
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
          <button
            onClick={() => {
              void loadContacts();
              void loadFlowData();
            }}
            disabled={loading}
            className="kf-btn-secondary inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
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
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                    statusFilter === s ? "kf-btn-primary" : "kf-btn-secondary"
                  }`}
                >
                  {s}
                </button>
              ))}
              {statusFilter !== "ALL" && (
                <button
                  onClick={() => {
                    setStatusFilter("ALL");
                    setSearchInput("");
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,450px]">
        <div className="space-y-3">
          {loading && contacts.length === 0 ? (
            <div className="kf-card p-8 text-center">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Loading contacts...</p>
            </div>
          ) : contacts.length === 0 ? (
            <div className="kf-card p-8 text-center">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg font-medium mb-1">No contacts yet</p>
              <p className="text-muted-foreground mb-4">
                Add your first contact to get started
              </p>
              <button
                onClick={() => setShowAddForm(true)}
                className="kf-btn-primary inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Contact
              </button>
            </div>
          ) : (
            <>
              {contacts.map((contact, index) => (
                <ContactCard
                  key={contact.id}
                  contact={contact as ContactCardData}
                  isSelected={selectedContactId === contact.id}
                  onClick={() => selectContact(contact.id)}
                  onDelete={handleDeleteContact}
                  index={index}
                />
              ))}
              {hasMore && (
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
                  <RelationshipTimeline
                    contactName={contactName}
                    milestones={journeyMilestones}
                  />
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
                  onClose={() => setShowMobileDetail(false)}
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
                              : undefined
                          }
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
