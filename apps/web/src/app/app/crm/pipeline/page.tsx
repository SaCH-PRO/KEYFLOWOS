"use client";

import { type MouseEventHandler, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardGrid, ContentContainer, Input } from "@keyflow/ui";
import {
  Contact,
  ContactDetail,
  ContactEvent,
  ContactImportJob,
  ContactTask,
  addContactNote,
  addContactTask,
  createContact,
  createContactFromOcr,
  fetchContactDetail,
  fetchContactEvents,
  fetchContacts,
  fetchDueTasks,
  fetchImportJobs,
  fetchSegmentSummary,
  importContactsFromFile,
  importContactsFromLink,
  updateContact,
} from "@/lib/client";

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"] as const;
const IMPORT_TYPES: Array<"csv" | "xlsx" | "pdf" | "image"> = ["csv", "xlsx", "pdf", "image"];
const PAGE_SIZE = 50;

type ContactWithTags = Omit<Contact, "tags"> & { tags?: string[] };
type NormalizedContactTask = Omit<ContactTask, "contact"> & { contact?: ContactWithTags | null };
type NormalizedContactDetail = Omit<ContactDetail, "contact" | "tasks"> & {
  contact: ContactWithTags | null;
  tasks: NormalizedContactTask[];
};
const formatDate = (value?: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleString();
};

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return isMobile;
}

const generateAiSuggestions = (detail: NormalizedContactDetail | null): string[] => {
  if (!detail?.contact) return [];
  const suggestions: string[] = [];
  if ((detail.meta?.outstandingBalance ?? 0) > 0) {
    suggestions.push("Reach out about the unpaid balance and offer flexible next steps.");
  }
  if (detail?.tasks?.some((task) => task.status === "OPEN")) {
    suggestions.push("Follow up on the outstanding task(s) to keep momentum.");
  }
  if (detail?.events?.length === 0) {
    suggestions.push("Introduce yourself with a short check-in to kickstart the relationship.");
  }
  if (!detail.meta?.outstandingBalance && detail.events?.some((event) => event.type === "booking.created")) {
    suggestions.push("Share a thank-you note after the new booking.");
  }
  return suggestions;
};

const importToneByStatus: Record<string, "default" | "info" | "success" | "warning" | "danger"> = {
  COMPLETED: "success",
  FAILED: "danger",
  PROCESSING: "info",
  PENDING: "warning",
};

const CONTACT_STATUS_TONES: Record<string, "default" | "info" | "success" | "warning" | "danger"> = {
  LEAD: "info",
  PROSPECT: "default",
  CLIENT: "success",
  LOST: "warning",
};

type SectionCardProps = {
  title: string;
  children: ReactNode;
  headerAction?: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
};

function SectionCard({ title, headerAction, children, className = "", onClick }: SectionCardProps) {
  return (
    <Card
      className={`space-y-3 rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow ${className}`}
      padding="lg"
      shadow="sm"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {headerAction}
      </div>
      {children}
    </Card>
  );
}

export default function PipelinePage() {
  const isMobile = useIsMobile();
  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [segments, setSegments] = useState<{ [key: string]: number }>({});
  const [dueTasks, setDueTasks] = useState<ContactTask[]>([]);
  const [importJobs, setImportJobs] = useState<ContactImportJob[]>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState("");
  const [showAddContact, setShowAddContact] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextOffset, setNextOffset] = useState(0);
  const [newContact, setNewContact] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    status: "LEAD",
    source: "",
    tags: "",
    companyName: "",
    jobTitle: "",
    preferredChannel: "",
    lifecycleStage: "",
  });
  const [savedViews, setSavedViews] = useState<{ name: string; search: string; status: string; tags: string }[]>([]);
  const [viewName, setViewName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [importType, setImportType] = useState<"csv" | "xlsx" | "pdf" | "image">("csv");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [cameraImage, setCameraImage] = useState<File | null>(null);
  const [importLink, setImportLink] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [contactDetail, setContactDetail] = useState<NormalizedContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [isPending, startTransition] = useTransition();
  const [recentEvents, setRecentEvents] = useState<ContactEvent[]>([]);
  const [eventsContactId, setEventsContactId] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const addContactRef = useRef<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLDivElement | null>(null);
  const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);
  const [timelineFilter, setTimelineFilter] = useState<string>("ALL");
  const [pipelineOpen, setPipelineOpen] = useState(true);
  const [dbOpen, setDbOpen] = useState(true);
  const [dbSearch, setDbSearch] = useState("");
  const [dbSortKey, setDbSortKey] = useState<"name" | "email" | "phone" | "status" | "company">("name");
  const [metricSlots, setMetricSlots] = useState<MetricKey[]>(["leads", "prospects", "clients"]);
  const [contactPhotoFile, setContactPhotoFile] = useState<File | null>(null);
  const [contactPhotoPreview, setContactPhotoPreview] = useState<string | null>(null);
  const setMetricSlot = useCallback((index: number, key: MetricKey) => {
    setMetricSlots((prev) => {
      const next = [...prev];
      next[index] = key;
      return next;
    });
  }, []);

  const activeFilters = useMemo(
    () => (statusFilter !== "ALL" ? 1 : 0) + (search ? 1 : 0) + (tagFilter ? 1 : 0),
    [search, statusFilter, tagFilter],
  );

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const loadData = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = opts?.append ?? false;
      const normalizedTags = tagFilter
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        if (append) {
          const { data: contactData } = await fetchContacts(undefined, {
            includeStats: true,
            take: PAGE_SIZE,
            skip: nextOffset,
            search: search || undefined,
            status: statusFilter !== "ALL" ? statusFilter : undefined,
            tags: normalizedTags.length > 0 ? normalizedTags : undefined,
          });
          const mapped = (contactData ?? []).map(
            (contact) =>
              ({
                ...contact,
                tags: contact.tags ?? [],
              }) as ContactWithTags,
          );
          setContacts((prev) => [...prev, ...mapped]);
          setNextOffset((prev) => prev + mapped.length);
          setHasMore(mapped.length === PAGE_SIZE);
        } else {
          const [{ data: contactData }, { data: segmentData }, { data: dueData }, { data: importData }] =
            await Promise.all([
              fetchContacts(undefined, {
                includeStats: true,
                take: PAGE_SIZE,
                skip: 0,
                search: search || undefined,
                status: statusFilter !== "ALL" ? statusFilter : undefined,
                tags: normalizedTags.length > 0 ? normalizedTags : undefined,
              }),
              fetchSegmentSummary(),
              fetchDueTasks(),
              fetchImportJobs(),
            ]);
          const mapped = (contactData ?? []).map(
            (contact) =>
              ({
                ...contact,
                tags: contact.tags ?? [],
              }) as ContactWithTags,
          );
          setContacts(mapped);
          setSegments(segmentData ?? {});
          setDueTasks(dueData ?? []);
          setImportJobs(importData ?? []);
          setNextOffset(mapped.length);
          setHasMore(mapped.length === PAGE_SIZE);
        }
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [search, statusFilter, tagFilter, nextOffset],
  );

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    startTransition(() => {
      void loadData({ append: true });
    });
  }, [hasMore, loadData, loadingMore, startTransition]);

  const loadContactDetail = useCallback(async (contactId: string) => {
    setDetailError(null);
    setDetailLoading(true);
    try {
      const { data, error } = await fetchContactDetail(contactId);
      if (error) {
        setDetailError(error);
      }
      const normalizeContact = (contact?: Contact | null): ContactWithTags | null =>
        contact
          ? {
              ...contact,
              tags: Array.isArray(contact.tags) ? contact.tags : [],
            }
          : null;
      const normalizedTasks: NormalizedContactTask[] = (data?.tasks ?? []).map((task) => ({
        ...task,
        contact: normalizeContact(task.contact) ?? null,
      }));
      const normalized: NormalizedContactDetail | null = data
        ? {
            contact: normalizeContact(data.contact),
            events: data.events ?? [],
            notes: data.notes ?? [],
            tasks: normalizedTasks,
            meta: data.meta,
          }
        : null;
      setContactDetail(normalized);
    } catch {
      setDetailError("Failed to load contact details.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const quickAddTask = useCallback(
    async (contactId: string) => {
      if (typeof window === "undefined") return;
      const title = window.prompt("Add a quick task title");
      if (!title || !title.trim()) return;
      setQuickActionLoading(contactId);
      try {
        await addContactTask(contactId, title.trim());
        startTransition(() => {
          void loadData();
          void loadContactDetail(contactId);
        });
      } finally {
        setQuickActionLoading(null);
      }
    },
    [loadContactDetail, loadData],
  );

  const selectContact = useCallback(
    (contactId: string) => {
      setSelectedContactId(contactId);
      setEventsContactId(contactId);
      void loadContactDetail(contactId);
    },
    [loadContactDetail],
  );

  const [noteLoading, setNoteLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);

  const handleAddNote = useCallback(async () => {
    if (!selectedContactId || !newNote.trim()) return;
    setNoteLoading(true);
    try {
      const result = await addContactNote(selectedContactId, newNote.trim());
      if (result.error) {
        throw new Error(result.error);
      }
      setNewNote("");
      await loadContactDetail(selectedContactId);
    } catch (error) {
      console.error("Failed to add note", error);
    } finally {
      setNoteLoading(false);
    }
  }, [selectedContactId, newNote, loadContactDetail]);

  const handleAddTask = useCallback(async () => {
    if (!selectedContactId || !newTaskTitle.trim()) return;
    setTaskLoading(true);
    try {
      const result = await addContactTask(selectedContactId, newTaskTitle.trim(), {
        dueDate: newTaskDue || undefined,
      });
      if (result.error) {
        throw new Error(result.error);
      }
      setNewTaskTitle("");
      setNewTaskDue("");
      await loadContactDetail(selectedContactId);
    } catch (error) {
      console.error("Failed to add task", error);
    } finally {
      setTaskLoading(false);
    }
  }, [selectedContactId, newTaskTitle, newTaskDue, loadContactDetail]);

  const aiSuggestions = useMemo(() => generateAiSuggestions(contactDetail), [contactDetail]);

  const scrollToSection = useCallback((ref: RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const detailContact = contactDetail?.contact ?? null;
  const timelineEntries = useMemo(() => contactDetail?.events ?? [], [contactDetail]);
  const filteredTimeline = useMemo(
    () =>
      timelineFilter === "ALL"
        ? timelineEntries
        : timelineEntries.filter((event) => event.type === timelineFilter),
    [timelineEntries, timelineFilter],
  );
  const notesEntries = contactDetail?.notes ?? [];
  const tasksEntries = contactDetail?.tasks ?? [];
  const detailMeta: Contact["meta"] | null = contactDetail?.meta ?? null;
  const outstandingBalance = detailContact ? detailMeta?.outstandingBalance ?? 0 : 0;
  const lastInteractionAt = detailContact ? detailMeta?.lastInteractionAt ?? null : null;
  const leadScore = detailContact ? detailMeta?.leadScore ?? null : null;
  const nextDueTaskAt = detailContact ? detailMeta?.nextDueTaskAt ?? null : null;
  const contactFullName =
    detailContact?.displayName?.trim() ||
    `${detailContact?.firstName ?? ""} ${detailContact?.lastName ?? ""}`.trim() ||
    "";
  const statusTone = CONTACT_STATUS_TONES[detailContact?.status ?? ""] ?? "info";
  const groupedTimeline = useMemo(() => {
    const groups: Array<{ date: string; events: ContactEvent[] }> = [];
    filteredTimeline.forEach((event) => {
      const dateLabel = new Date(event.createdAt).toLocaleDateString();
      const existing = groups.find((g) => g.date === dateLabel);
      if (existing) existing.events.push(event);
      else groups.push({ date: dateLabel, events: [event] });
    });
    return groups;
  }, [filteredTimeline]);

  const pipelineStats = useMemo(() => {
    const total = contacts.length;
    const totalOutstanding = contacts.reduce((sum, c) => sum + (c.meta?.outstandingBalance ?? 0), 0);
    const avgLeadScore =
      contacts.length > 0
        ? Math.round(
            contacts.reduce((sum, c) => sum + (c.meta?.leadScore ?? 0), 0) / contacts.length,
          )
        : 0;
    const overdueTasks = dueTasks.length;
    return { total, totalOutstanding, avgLeadScore, overdueTasks };
  }, [contacts, dueTasks]);
  const dbFiltered = useMemo(() => {
    const q = dbSearch.trim().toLowerCase();
    const base = q
      ? contacts.filter((c) =>
          [
            c.firstName,
            c.lastName,
            c.email,
            c.phone,
            c.companyName,
            c.jobTitle,
            c.status,
            ...(c.tags ?? []),
          ]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(q)),
        )
      : contacts;
    const sorted = [...base].sort((a, b) => {
      const field = (contact: ContactWithTags) => {
        switch (dbSortKey) {
          case "email":
            return contact.email ?? "";
          case "phone":
            return contact.phone ?? "";
          case "status":
            return contact.status ?? "";
          case "company":
            return contact.companyName ?? "";
          default:
            return `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim();
        }
      };
      return field(a).localeCompare(field(b));
    });
    return sorted;
  }, [contacts, dbSearch, dbSortKey]);

  type MetricKey =
    | "total"
    | "overdue"
    | "outstanding"
    | "avgLeadScore"
    | "withPhone"
    | "withEmail"
    | "withCompany"
    | "leads"
    | "prospects"
    | "clients"
    | "lost"
    | "unpaid"
    | "stale"
    | "newThisWeek";
  const metricOptions = useMemo(
    () =>
      [
        { key: "total", label: "Total contacts", value: contacts.length, hint: "All contacts currently in the database." },
        { key: "overdue", label: "Overdue tasks", value: pipelineStats.overdueTasks, hint: "Open tasks past their due date." },
        { key: "outstanding", label: "Outstanding balance", value: pipelineStats.totalOutstanding, hint: "Sum of outstanding balances across contacts." },
        { key: "avgLeadScore", label: "Avg lead score", value: pipelineStats.avgLeadScore, hint: "Average lead score across all contacts." },
        { key: "withPhone", label: "With phone", value: contacts.filter((c) => !!c.phone).length, hint: "Contacts that have a phone number." },
        { key: "withEmail", label: "With email", value: contacts.filter((c) => !!c.email).length, hint: "Contacts that have an email address." },
        { key: "withCompany", label: "With company", value: contacts.filter((c) => !!c.companyName).length, hint: "Contacts that have a company name set." },
        { key: "leads", label: "Leads", value: segments.lead ?? 0, hint: "Contacts marked as Lead." },
        { key: "prospects", label: "Prospects", value: segments.prospect ?? 0, hint: "Contacts marked as Prospect." },
        { key: "clients", label: "Clients", value: segments.client ?? 0, hint: "Contacts marked as Client." },
        { key: "lost", label: "Lost", value: segments.lost ?? 0, hint: "Contacts marked as Lost." },
        { key: "unpaid", label: "Unpaid", value: segments.unpaid ?? 0, hint: "Contacts flagged as unpaid." },
        { key: "stale", label: "Stale", value: segments.stale ?? 0, hint: "Contacts with stale/old activity." },
        { key: "newThisWeek", label: "New this week", value: segments.newThisWeek ?? 0, hint: "Contacts created this week." },
      ] satisfies Array<{ key: MetricKey; label: string; value: number; hint: string }>,
    [contacts, pipelineStats, segments],
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("crm_saved_views");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        startTransition(() => {
          setSavedViews(parsed);
        });
      } catch (error) {
        console.error("Failed to load saved views", error);
      }
    }
  }, [startTransition]);

  useEffect(() => {
    startTransition(() => {
      void loadData();
    });
  }, [loadData, startTransition]);

  useEffect(() => {
    if (!isMobile) {
      setShowAddContact(true);
    }
  }, [isMobile]);

  useEffect(() => {
    if (contacts.length === 0) {
      setSelectedContactId(null);
      setContactDetail(null);
      return;
    }
    if (!selectedContactId) {
      const firstId = contacts[0].id;
      setSelectedContactId(firstId);
      setEventsContactId(firstId);
      void loadContactDetail(firstId);
      return;
    }
    if (!contacts.some((contact) => contact.id === selectedContactId)) {
      setSelectedContactId(null);
      setContactDetail(null);
    }
  }, [contacts, selectedContactId, loadContactDetail]);

  useEffect(() => {
    const targetContact = selectedContactId ?? contacts[0]?.id;
    if (!targetContact) {
      startTransition(() => {
        setRecentEvents([]);
        setEventsContactId(null);
      });
      return;
    }
    startTransition(() => {
      setEventsContactId(targetContact);
      setEventsLoading(true);
    });
    void fetchContactEvents(targetContact)
      .then((result) => {
        setRecentEvents(result.data ?? []);
      })
      .catch(() => {
        setRecentEvents([]);
      })
      .finally(() => {
        setEventsLoading(false);
      });
  }, [contacts, selectedContactId]);

  useEffect(() => {
    setTimelineFilter("ALL");
  }, [selectedContactId]);

  async function move(contactId: string, status: string) {
    await updateContact({ contactId, status });
    setContacts((prev) => prev.map((c) => (c.id === contactId ? { ...c, status } : c)));
  }

  const fileAccept =
    importType === "csv"
      ? ".csv"
      : importType === "xlsx"
      ? ".xlsx,.xls"
      : importType === "pdf"
      ? ".pdf"
      : "image/*";

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const detailContent = (opts?: { padded?: boolean }) => (
    <div className={`space-y-4 ${opts?.padded ? "p-2" : ""}`}>
      {detailLoading ? (
        <p className="text-xs text-muted-foreground">Loading contact details...</p>
      ) : detailError ? (
        <p className="text-xs text-rose-400">{detailError}</p>
      ) : !detailContact ? (
        <p className="text-xs text-muted-foreground">Select a contact to explore its profile.</p>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold">{contactFullName || "Unnamed"}</p>
              <Badge tone={statusTone}>{detailContact.status ?? "Unknown"}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {detailContact.companyName && <span>{detailContact.companyName}</span>}
              {detailContact.jobTitle && <span className="ml-2">{detailContact.jobTitle}</span>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 text-[12px] text-muted-foreground">
              <div className="rounded-xl border border-border/50 bg-slate-900/50 p-3">
                <div className="text-xs uppercase">Outstanding</div>
                <div className="text-base font-semibold text-white">
                  {outstandingBalance ? `$${outstandingBalance.toLocaleString()}` : "None"}
                </div>
              </div>
              <div className="rounded-xl border border-border/50 bg-slate-900/50 p-3">
                <div className="text-xs uppercase">Lead score</div>
                <div className="text-base font-semibold text-white">{leadScore ?? "-"}</div>
              </div>
              <div className="rounded-xl border border-border/50 bg-slate-900/50 p-3">
                <div className="text-xs uppercase">Last activity</div>
                <div className="text-base font-semibold text-white">
                  {lastInteractionAt ? new Date(lastInteractionAt).toLocaleDateString() : "No activity"}
                </div>
              </div>
              <div className="rounded-xl border border-border/50 bg-slate-900/50 p-3">
                <div className="text-xs uppercase">Next due task</div>
                <div className="text-base font-semibold text-white">
                  {nextDueTaskAt ? new Date(nextDueTaskAt).toLocaleDateString() : "None"}
                </div>
              </div>
              <div className="rounded-xl border border-border/50 bg-slate-900/50 p-3">
                <div className="text-xs uppercase">Events</div>
                <div className="text-base font-semibold text-white">{timelineEntries.length}</div>
              </div>
              <div className="rounded-xl border border-border/50 bg-slate-900/50 p-3">
                <div className="text-xs uppercase">Tasks</div>
                <div className="text-base font-semibold text-white">{tasksEntries.length}</div>
              </div>
            </div>
          </div>

          <SectionCard title="AI summary" className="bg-slate-900/70">
            {aiSuggestions.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                More signals unlock adaptive suggestions; keep engaging to surface ideas.
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-[11px] text-muted-foreground">
                {aiSuggestions.map((suggestion, index) => (
                  <li key={`ai-${index}`}>{suggestion}</li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Timeline"
            className="bg-slate-900/70"
            headerAction={
              <div className="flex gap-2 items-center">
                <label className="text-[11px] text-muted-foreground">Filter:</label>
                <select
                  value={timelineFilter}
                  onChange={(e) => setTimelineFilter(e.target.value)}
                  className="rounded border border-border/50 bg-background px-2 py-1 text-[11px]"
                >
                  <option value="ALL">All</option>
                  {Array.from(new Set(timelineEntries.map((e) => e.type))).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            }
          >
            <div className="space-y-3 text-[11px] text-muted-foreground">
              {groupedTimeline.length === 0 && <p>No events yet.</p>}
              {groupedTimeline.map((group) => (
                <div key={group.date} className="space-y-2">
                  <div className="text-[10px] uppercase text-slate-400">{group.date}</div>
                  {group.events.slice(0, 6).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-xl border border-border/50 bg-slate-950/60 p-2"
                    >
                      <div className="flex items-center justify-between text-white">
                        <span className="font-semibold">{event.type}</span>
                        <span className="text-[10px] text-slate-400">{formatDate(event.createdAt)}</span>
                      </div>
                      <p className="line-clamp-2">
                        {event.data && typeof event.data === "object"
                          ? JSON.stringify(event.data).slice(0, 120)
                          : String(event.data)}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Notes" className="bg-slate-900/70">
            <div className="space-y-2">
              <textarea
                className="w-full rounded border border-border/50 bg-background p-2 text-xs text-foreground"
                rows={3}
                placeholder="Log a conversation or insight..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <Button
                variant="outline"
                className="px-3 py-1 text-xs"
                onClick={handleAddNote}
                disabled={!newNote.trim() || noteLoading}
              >
                Add note
              </Button>
              <div className="space-y-2">
                {notesEntries.slice(0, 4).map((note) => (
                  <div
                    key={note.id}
                    className="rounded-xl border border-border/40 bg-slate-900/50 p-2 text-[11px] text-muted-foreground"
                  >
                    <p>{note.body}</p>
                    <p className="text-[10px] text-slate-400">{formatDate(note.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Tasks" className="bg-slate-900/70">
            <div className="space-y-2">
              <Input
                placeholder="Task title"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                className="text-xs"
              />
              <Input
                type="datetime-local"
                placeholder="Optional due"
                value={newTaskDue}
                onChange={(e) => setNewTaskDue(e.target.value)}
                className="text-xs"
              />
              <Button
                variant="outline"
                className="px-3 py-1 text-xs"
                onClick={handleAddTask}
                disabled={!newTaskTitle.trim() || taskLoading}
              >
                Create task
              </Button>
              <div className="space-y-2">
                {tasksEntries.slice(0, 4).map((task) => (
                  <div
                    key={task.id}
                    className="rounded-xl border border-border/40 bg-slate-900/50 p-2 text-[11px] text-muted-foreground"
                  >
                    <p className="font-semibold text-white">{task.title}</p>
                    <p className="text-[10px] text-slate-400">Due {formatDate(task.dueDate)}</p>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );

  return (
    <ContentContainer>
      <Card
        className="sticky top-4 z-30 bg-white/90 backdrop-blur rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow"
        padding="sm"
        shadow="sm"
        onClick={() => {
          if (showOverview) setShowOverview(false);
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-slate-900">CRM SUITE</p>
          <div className="flex items-center gap-2">
            <Badge tone="info">{pipelineStats.total} contacts</Badge>
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                setShowOverview((prev) => !prev);
              }}
            >
              Overview
            </Button>
          </div>
        </div>
        {showOverview && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 text-[11px] text-slate-600">
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs uppercase text-slate-500">Total contacts</div>
              <div className="text-lg font-semibold text-slate-900">{contacts.length}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs uppercase text-slate-500">Overdue tasks</div>
              <div className="text-lg font-semibold text-slate-900">{pipelineStats.overdueTasks}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs uppercase text-slate-500">Leads</div>
              <div className="text-lg font-semibold text-slate-900">{segments.lead ?? 0}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs uppercase text-slate-500">Prospects</div>
              <div className="text-lg font-semibold text-slate-900">{segments.prospect ?? 0}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs uppercase text-slate-500">Clients</div>
              <div className="text-lg font-semibold text-slate-900">{segments.client ?? 0}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="text-xs uppercase text-slate-500">Lost</div>
              <div className="text-lg font-semibold text-slate-900">{segments.lost ?? 0}</div>
            </div>
          </div>
        )}
      </Card>
      <div className="space-y-6">
        <SectionCard
          title="KEY SEARCH"
          headerAction={
            <div className="flex items-center gap-2">
              <Badge tone="info">{contacts.length} contacts</Badge>
              {activeFilters > 0 && <Badge tone="warning">{activeFilters} filters</Badge>}
              <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setPipelineOpen((p) => !p)}>
                {pipelineOpen ? "Collapse" : "Expand"}
              </Button>
            </div>
          }
          className="bg-white h-fit"
        >
          {pipelineOpen && (
            <>
              <p className="text-xs text-muted-foreground">
                Search, filter, and save views so the whole team can surface the right leads in seconds.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {metricSlots.map((metricKey, index) => {
                  const current = metricOptions.find((m) => m.key === metricKey) ?? metricOptions[0];
                  return (
                    <div
                      key={`${metricKey}-${index}`}
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2"
                      title={current.hint}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs uppercase text-slate-500">{current.label}</div>
                        <select
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px]"
                          value={metricKey}
                          onChange={(e) => setMetricSlot(index, e.target.value as MetricKey)}
                        >
                          {metricOptions.map((opt) => (
                            <option key={opt.key} value={opt.key}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="text-lg font-semibold text-slate-900">{current.value}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <Input
                  placeholder="Search name/email/phone"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full"
                />
                <Input
                  placeholder="Filter by tags (comma-separated)"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {["ALL", ...STATUSES].map((s) => (
                  <Button
                    key={s}
                    variant={statusFilter === s ? "default" : "outline"}
                    className="px-3 py-1 text-xs"
                    onClick={() => setStatusFilter(s)}
                    disabled={isPending}
                  >
                    {s}
                  </Button>
                ))}
                {activeFilters > 0 && (
                  <Button
                    variant="outline"
                    className="px-3 py-1 text-xs"
                    onClick={() => {
                      setStatusFilter("ALL");
                      setSearch("");
                      setSearchInput("");
                      setTagFilter("");
                      startTransition(() => {
                        void loadData();
                      });
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Saved view name"
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  className="w-48"
                />
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    if (!viewName.trim()) return;
                      const next = [
                        ...savedViews.filter((v) => v.name !== viewName.trim()),
                        { name: viewName.trim(), search: searchInput, status: statusFilter, tags: tagFilter },
                      ];
                      setSavedViews(next);
                      if (typeof window !== "undefined") {
                        window.localStorage.setItem("crm_saved_views", JSON.stringify(next));
                      }
                    setViewName("");
                  }}
                >
                  Save view
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {savedViews.map((v) => (
                  <Button
                    key={v.name}
                    variant="outline"
                    className="px-2 py-1"
                      onClick={() => {
                        setSearch(v.search);
                        setSearchInput(v.search);
                        setStatusFilter(v.status);
                        setTagFilter(v.tags);
                      }}
                    >
                      {v.name}
                  </Button>
                ))}
              </div>
            </>
          )}
        </SectionCard>
        <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-4">
          <SectionCard
            title="ADD CONTACT"
            className="border-slate-200 bg-white"
            headerAction={
              <Button
                variant="outline"
                className="px-3 py-1 text-xs"
                onClick={() => setShowAddContact((prev) => !prev)}
              >
                {showAddContact ? "Hide" : "Show"}
              </Button>
            }
          >
            {showAddContact && (
              <>
                <p className="text-xs text-muted-foreground">
                  Capture a full profile with rich details. Everything can be edited later.
                </p>
                <div ref={addContactRef} className="space-y-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input
                      placeholder="First name"
                      value={newContact.firstName}
                      onChange={(e) => setNewContact((prev) => ({ ...prev, firstName: e.target.value }))}
                    />
                    <Input
                      placeholder="Last name"
                      value={newContact.lastName}
                      onChange={(e) => setNewContact((prev) => ({ ...prev, lastName: e.target.value }))}
                    />
                  </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input
                    placeholder="Email"
                    value={newContact.email}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, email: e.target.value }))}
                  />
                  <Input
                    placeholder="Phone"
                    value={newContact.phone}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input
                    placeholder="Company"
                    value={newContact.companyName}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, companyName: e.target.value }))}
                  />
                  <Input
                    placeholder="Job title / role"
                    value={newContact.jobTitle}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, jobTitle: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Input
                    placeholder="Source (Instagram, Website, Referral...)"
                    value={newContact.source}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, source: e.target.value }))}
                  />
                  <Input
                    placeholder="Preferred channel (Email/WhatsApp/SMS)"
                    value={newContact.preferredChannel}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, preferredChannel: e.target.value }))}
                  />
                </div>
                <Input
                  placeholder="Lifecycle stage (lead/prospect/client...)"
                  value={newContact.lifecycleStage}
                  onChange={(e) => setNewContact((prev) => ({ ...prev, lifecycleStage: e.target.value }))}
                />
                <Input
                  placeholder="Tags (comma-separated)"
                  value={newContact.tags}
                  onChange={(e) => setNewContact((prev) => ({ ...prev, tags: e.target.value }))}
                />
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
                    <span>Profile photo (optional)</span>
                    {contactPhotoPreview && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setContactPhotoFile(null);
                          setContactPhotoPreview(null);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-600 hover:border-slate-400">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setContactPhotoFile(file);
                          if (file) {
                            const url = URL.createObjectURL(file);
                            setContactPhotoPreview(url);
                          } else {
                            setContactPhotoPreview(null);
                          }
                        }}
                      />
                      Upload image
                    </label>
                    {contactPhotoPreview && (
                      <img
                        src={contactPhotoPreview}
                        alt="Preview"
                        className="h-12 w-12 rounded-full object-cover border border-slate-200"
                      />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">JPEG/PNG, up to ~5MB. Stored on the contact for quick visual ID.</p>
                </div>
                  <div className="flex flex-wrap gap-2">
                    {STATUSES.map((s) => (
                      <Button
                        key={s}
                        size="xs"
                        variant={newContact.status === s ? "default" : "outline"}
                        className="px-3 py-1 text-xs"
                        onClick={() => setNewContact((prev) => ({ ...prev, status: s }))}
                      >
                        {s}
                      </Button>
                    ))}
                </div>
                <div className="flex flex-col gap-2 md:flex-row">
                  <Button
                    className="flex-1"
                    onClick={async () => {
                      const photoDataUrl =
                        contactPhotoFile && contactPhotoFile.size > 0
                          ? await fileToDataUrl(contactPhotoFile)
                          : undefined;
                      await createContact({
                        firstName: newContact.firstName,
                        lastName: newContact.lastName,
                        email: newContact.email,
                        phone: newContact.phone,
                        status: newContact.status,
                        source: newContact.source || undefined,
                        tags: newContact.tags
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                        companyName: newContact.companyName || undefined,
                        jobTitle: newContact.jobTitle || undefined,
                        preferredChannel: newContact.preferredChannel || undefined,
                        lifecycleStage: newContact.lifecycleStage || undefined,
                        custom: photoDataUrl
                          ? {
                              profilePhotoDataUrl: photoDataUrl,
                              profilePhotoName: contactPhotoFile?.name ?? "photo",
                            }
                          : undefined,
                      });
                      setNewContact({
                        firstName: "",
                        lastName: "",
                        email: "",
                        phone: "",
                        status: "LEAD",
                        source: "",
                        tags: "",
                        companyName: "",
                        jobTitle: "",
                        preferredChannel: "",
                        lifecycleStage: "",
                      });
                      setContactPhotoFile(null);
                      setContactPhotoPreview(null);
                      setShowAddContact(false);
                      startTransition(() => {
                        void loadData();
                      });
                    }}
                  >
                    Save contact
                  </Button>
                  <Button variant="outline" onClick={() => setShowAddContact(false)}>
                    Cancel
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Add as much detail as you want now; you can always enrich the record later.
                </p>
              </div>
            </>
          )}
          </SectionCard>

        </div>
        <div className="space-y-4">
          <SectionCard title="Import & capture" headerAction={<Badge tone="info">{importJobs.length} jobs</Badge>}>
            <div ref={importRef} className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold text-slate-600">Upload</span>
                <select
                  value={importType}
                  onChange={(e) => setImportType(e.target.value as "csv" | "xlsx" | "pdf" | "image")}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  {IMPORT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.toUpperCase()}
                    </option>
                  ))}
                </select>
                <input
                  type="file"
                  accept={fileAccept}
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  className="text-xs"
                />
                {importFile && (
                  <span className="text-[11px] text-slate-500">Ready to upload: {importFile.name}</span>
                )}
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={async () => {
                    if (!importFile) return;
                    try {
                      await importContactsFromFile({ type: importType, file: importFile });
                      setImportFile(null);
                    } catch (error) {
                      console.error("File import failed", error);
                    }
                    startTransition(() => {
                      void loadData();
                    });
                  }}
                  disabled={!importFile || isPending}
                >
                  Upload
                </Button>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setCameraImage(e.target.files?.[0] ?? null)}
                  className="text-xs"
                />
                {cameraImage && (
                  <span className="text-[11px] text-slate-500">Captured: {cameraImage.name}</span>
                )}
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={async () => {
                    if (!cameraImage) return;
                    try {
                      await importContactsFromFile({ type: "image", file: cameraImage });
                      setCameraImage(null);
                    } catch (error) {
                      console.error("Camera import failed", error);
                    }
                    startTransition(() => {
                      void loadData();
                    });
                  }}
                  disabled={!cameraImage || isPending}
                >
                  Scan via camera
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  placeholder="Or import from link (URL)"
                  value={importLink}
                  onChange={(e) => setImportLink(e.target.value)}
                  className="w-64"
                />
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={async () => {
                    if (!importLink.trim()) return;
                    const result = await importContactsFromLink(importLink.trim());
                    if (result.error) {
                      console.error("Link import failed", result.error);
                    } else {
                      setImportLink("");
                    }
                    startTransition(() => {
                      void loadData();
                    });
                  }}
                  disabled={isPending}
                >
                  Save link source
                </Button>
              </div>
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-700">Paste business card OCR text</div>
                <textarea
                  className="w-full rounded border border-slate-200 bg-white p-2 text-xs text-slate-900"
                  rows={3}
                  placeholder="Paste text extracted from a business card here..."
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                />
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={async () => {
                    if (!ocrText.trim()) return;
                    const result = await createContactFromOcr({ ocrText: ocrText.trim() });
                    if (result.error) {
                      console.error("OCR import failed", result.error);
                    } else {
                      setOcrText("");
                    }
                    startTransition(() => {
                      void loadData();
                    });
                  }}
                  disabled={!ocrText.trim() || isPending}
                >
                  Create contact from OCR text
                </Button>
              </div>
              {importJobs.length > 0 && (
                <div className="space-y-2">
                  {importJobs.map((job) => {
                    const tone = importToneByStatus[job.status] ?? "default";
                    const timestamp = new Date(job.completedAt ?? job.updatedAt).toLocaleString();
                    return (
                      <div
                        key={job.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-semibold">{job.originalName ?? job.sourceType}</div>
                          <div className="text-[11px] text-slate-500">
                            Rows: {job.processedRows ?? 0}/{job.totalRows ?? 0}
                          </div>
                          {job.error && (
                            <div className="text-[11px] text-rose-500">Error: {job.error}</div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 text-[11px] text-slate-500">
                          <Badge tone={tone}>{job.status}</Badge>
                          <span>Updated {timestamp}</span>
                          {job.sourceUrl && (
                            <a
                              href={job.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] underline"
                            >
                              Source
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>

        </div>
      </div>

      <SectionCard title="Pipeline board">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Bulk move selected:</span>
          {STATUSES.map((s) => (
            <Button
              key={s}
              variant="outline"
              className="px-2 py-1 text-xs"
              onClick={async () => {
                await Promise.all(selected.map((id) => updateContact({ contactId: id, status: s })));
                setContacts((prev) => prev.map((c) => (selected.includes(c.id) ? { ...c, status: s } : c)));
                setSelected([]);
              }}
              disabled={selected.length === 0 || isPending}
            >
              {s}
            </Button>
          ))}
          {selected.length > 0 && (
            <span className="text-xs text-muted-foreground">{selected.length} selected</span>
          )}
        </div>
        {loading ? (
          <p className="text-xs text-muted-foreground mt-3">Loading contacts...</p>
        ) : contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-3">No contacts found for this view.</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4 mt-4">
              {STATUSES.map((status) => (
                <div
                  key={status}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const contactId = e.dataTransfer.getData("text/plain");
                    if (contactId) void move(contactId, status);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">{status}</div>
                    <Badge tone="info">{contacts.filter((c) => (c.status ?? "LEAD") === status).length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {contacts
                      .filter((c) => (c.status ?? "LEAD") === status)
                      .map((c) => (
                          <div
                            key={c.id}
                      className={`rounded-xl border p-2 space-y-1 transition ${
                      c.id === selectedContactId
                                ? "border-emerald-500 bg-white shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                                : "border-slate-200 bg-white"
                            }`}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                          >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected.includes(c.id)}
                              onChange={(e) => {
                                setSelected((prev) =>
                                  e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                                );
                              }}
                            />
                          <div className="text-sm font-semibold">
                            {`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed"}
                          </div>
                        </div>
                      <div className="text-xs text-muted-foreground">{c.email || c.phone || "No contact info"}</div>
                      {(c.companyName || c.jobTitle || c.segment || c.doNotContact) && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {c.companyName && (
                            <span className="rounded-full border border-border/50 px-2 py-0.5">
                              {c.companyName}
                                </span>
                              )}
                              {c.jobTitle && (
                                <span className="rounded-full border border-border/50 px-2 py-0.5">
                                  {c.jobTitle}
                                </span>
                              )}
                              {c.segment && (
                                <span className="rounded-full border border-border/50 px-2 py-0.5">
                                  Segment: {c.segment}
                                </span>
                              )}
                              {c.doNotContact && (
                                <span className="text-rose-300">Do not contact</span>
                              )}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                        {c.meta?.leadScore !== undefined && (
                          <span className="rounded-full border border-border/50 px-2 py-0.5">
                            Score: {c.meta.leadScore}
                          </span>
                        )}
                            {c.meta?.outstandingBalance !== undefined && c.meta.outstandingBalance > 0 && (
                              <span className="rounded-full border border-amber-500/60 text-amber-300 px-2 py-0.5">
                                Owed: {c.meta.outstandingBalance.toLocaleString()}
                              </span>
                            )}
                            {c.meta?.nextDueTaskAt && (
                              <span className="rounded-full border border-border/50 px-2 py-0.5">
                                Next task: {new Date(c.meta.nextDueTaskAt).toLocaleDateString()}
                              </span>
                            )}
                            {c.meta?.lastInteractionAt && (
                              <span className="rounded-full border border-border/50 px-2 py-0.5">
                                Last activity: {new Date(c.meta.lastInteractionAt).toLocaleDateString()}
                              </span>
                            )}
                            {c.meta?.predictedNextBookingAt && (
                              <span className="rounded-full border border-emerald-500/50 text-emerald-200 px-2 py-0.5">
                                Next booking est: {new Date(c.meta.predictedNextBookingAt).toLocaleDateString()}
                              </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Link href={`/app/crm/contacts/${c.id}`} className="underline hover:text-foreground">
                          View detail
                        </Link>
                        <Button
                          variant="outline"
                          className="px-2 py-1 text-[11px]"
                          onClick={() => selectContact(c.id)}
                        >
                          Overview
                        </Button>
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="rounded border border-border/50 px-2 py-1 hover:bg-border/20"
                          >
                            Call
                          </a>
                        )}
                        {c.email && (
                          <a
                            href={`mailto:${c.email}`}
                            className="rounded border border-border/50 px-2 py-1 hover:bg-border/20"
                          >
                            Email
                          </a>
                        )}
                        <Button
                          variant="outline"
                          className="px-2 py-1 text-[11px]"
                          disabled={quickActionLoading === c.id}
                          onClick={() => void quickAddTask(c.id)}
                        >
                          {quickActionLoading === c.id ? "Adding..." : "Quick task"}
                        </Button>
                      </div>
                          <div className="flex flex-wrap gap-1">
                            {STATUSES.map((s) =>
                              s === status ? null : (
                                <Button
                                  key={s}
                                  variant="outline"
                                  className="px-2 py-1 text-[11px]"
                                  onClick={() => void move(c.id, s)}
                                >
                                  Move to {s}
                                </Button>
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Button variant="outline" className="px-3 py-1 text-xs" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading more..." : "Load more contacts"}
                </Button>
                {loadingMore && <span>Fetching contacts...</span>}
              </div>
            )}
          </>
        )}
      </SectionCard>
      <SectionCard
        title="Database"
        className="bg-white"
        headerAction={
          <div className="flex items-center gap-2">
            <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setDbOpen((p) => !p)}>
              {dbOpen ? "Collapse" : "Expand"}
            </Button>
          </div>
        }
      >
        {dbOpen && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Search by any identifier"
                value={dbSearch}
                onChange={(e) => setDbSearch(e.target.value)}
                className="w-60"
              />
              <select
                value={dbSortKey}
                onChange={(e) => setDbSortKey(e.target.value as typeof dbSortKey)}
                className="rounded border border-border/60 bg-background px-2 py-1 text-xs"
              >
                <option value="name">Name</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="status">Status</option>
                <option value="company">Company</option>
              </select>
              <Badge tone="info">{dbFiltered.length} shown</Badge>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border/50">
              <table className="min-w-full text-xs text-left">
                <thead className="bg-slate-900/70 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {dbFiltered.slice(0, 50).map((c) => (
                    <tr key={c.id} className="border-t border-border/40 hover:bg-slate-900/60">
                      <td className="px-3 py-2 font-semibold text-white">
                        {`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{c.email || "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.phone || "-"}</td>
                      <td className="px-3 py-2">
                        <Badge tone={CONTACT_STATUS_TONES[c.status ?? ""] ?? "default"}>{c.status ?? "LEAD"}</Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{c.companyName || "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {(c.tags ?? []).slice(0, 3).join(", ") || "-"}
                      </td>
                    </tr>
                  ))}
                  {dbFiltered.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={6}>
                        No contacts match this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
    {isMobile && (
      <div className="fixed bottom-4 right-4 z-30 flex flex-col gap-2 md:hidden">
        <Button
          className="shadow-lg"
          onClick={() => {
            setShowAddContact(true);
            setTimeout(() => scrollToSection(addContactRef), 50);
          }}
        >
          Add contact
        </Button>
        <Button variant="outline" className="shadow-lg" onClick={() => scrollToSection(importRef)}>
          Import
        </Button>
      </div>
    )}
    </ContentContainer>
  );
}
