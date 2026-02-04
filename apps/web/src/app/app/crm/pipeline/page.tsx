"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  Filter,
  Users,
  TrendingUp,
  Clock,
  DollarSign,
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
} from "@/components/contacts";
import {
  Contact,
  ContactDetail as ContactDetailAPI,
  addContactNote,
  addContactTask,
  completeContactTask,
  createContact,
  fetchContactDetail,
  fetchContacts,
  fetchSegmentSummary,
  importContactsFromFile,
  importContactsFromLink,
  createContactFromOcr,
  updateContact,
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
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [isPending, startTransition] = useTransition();

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

  const loadDetail = useCallback(
    async (contactId: string) => {
      if (!businessId) return;
      setDetailLoading(true);
      const { data } = await fetchContactDetail(contactId, businessId);
      setContactDetail(data ?? null);
      setDetailLoading(false);
    },
    [businessId],
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

  useEffect(() => {
    if (businessId) {
      startTransition(() => {
        void loadContacts();
      });
    }
  }, [businessId, search, statusFilter, loadContacts]);

  useEffect(() => {
    if (contacts.length > 0 && !selectedContactId) {
      setSelectedContactId(contacts[0].id);
      void loadDetail(contacts[0].id);
    }
  }, [contacts, selectedContactId, loadDetail]);

  const handleCreateContact = async (formData: ContactFormData) => {
    if (!businessId) return;

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
      tags: formData.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    if (data) {
      if (formData.initialNote.trim()) {
        await addContactNote(data.id, formData.initialNote.trim(), businessId);
      }
      setShowAddForm(false);
      void loadContacts();
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
  };

  const handleImportFile = async (type: "csv" | "xlsx" | "image", file: File) => {
    if (!businessId) return;
    await importContactsFromFile({ businessId, type, file });
    void loadContacts();
  };

  const handleImportLink = async (url: string) => {
    if (!businessId) return;
    await importContactsFromLink(url, businessId);
    void loadContacts();
  };

  const handleImportOcr = async (text: string) => {
    if (!businessId) return;
    await createContactFromOcr({ businessId, ocrText: text });
    void loadContacts();
  };

  const stats = useMemo(
    () => [
      { label: "Total", value: contacts.length, icon: Users },
      { label: "Leads", value: segments.lead ?? 0, icon: TrendingUp },
      { label: "Clients", value: segments.client ?? 0, icon: DollarSign },
      { label: "This Week", value: segments.newThisWeek ?? 0, icon: Clock },
    ],
    [contacts.length, segments],
  );

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
          <p className="text-muted-foreground mt-1">Manage your leads, prospects, and clients</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="kf-btn-primary inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Contact
        </button>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(({ label, value, icon: Icon }, index) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="kf-stat-card p-4"
          >
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Icon className="w-4 h-4" />
              {label}
            </div>
            <div className="text-2xl font-bold">{value}</div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {showAddForm && (
          <ContactForm
            onSubmit={handleCreateContact}
            onCancel={() => setShowAddForm(false)}
            loading={isPending}
          />
        )}
      </AnimatePresence>

      <ContactImport
        onImportFile={handleImportFile}
        onImportLink={handleImportLink}
        onImportOcr={handleImportOcr}
        loading={isPending}
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
            onClick={() => loadContacts()}
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

      <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
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

        <div className="hidden lg:block sticky top-4 h-fit">
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
              <div className="overflow-y-auto max-h-[calc(85vh-24px)]">
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
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
