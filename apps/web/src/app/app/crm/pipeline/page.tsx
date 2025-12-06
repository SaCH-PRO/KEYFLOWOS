"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Drawer, Input } from "@keyflow/ui";
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

type ContactWithTags = Omit<Contact, "tags"> & { tags?: string[] };
type NormalizedContactTask = Omit<ContactTask, "contact"> & { contact?: ContactWithTags | null };
type NormalizedContactDetail = Omit<ContactDetail, "contact" | "tasks"> & {
  contact: ContactWithTags | null;
  tasks: NormalizedContactTask[];
};
const formatDate = (value?: string | null) => {
  if (!value) return "—";
  return new Date(value).toLocaleString();
};

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
};

function SectionCard({ title, headerAction, children, className = "" }: SectionCardProps) {
  return (
    <section
      className={`space-y-3 rounded-2xl border border-border/60 bg-slate-950/60 p-4 shadow-[0_0_30px_rgba(0,0,0,0.35)] ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{title}</p>
        {headerAction}
      </div>
      {children}
    </section>
  );
}

export default function PipelinePage() {
  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [segments, setSegments] = useState<{ [key: string]: number }>({});
  const [dueTasks, setDueTasks] = useState<ContactTask[]>([]);
  const [importJobs, setImportJobs] = useState<ContactImportJob[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState("");
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

  const loadData = useCallback(async () => {
    const normalizedTags = tagFilter
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const [{ data: contactData }, { data: segmentData }, { data: dueData }, { data: importData }] = await Promise.all([
      fetchContacts(undefined, {
        includeStats: true,
        take: 200,
        search: search || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        tags: normalizedTags.length > 0 ? normalizedTags : undefined,
      }),
      fetchSegmentSummary(),
      fetchDueTasks(),
      fetchImportJobs(),
    ]);
    setContacts(
      (contactData ?? []).map((contact) => ({
        ...contact,
        tags: contact.tags ?? [],
      } as ContactWithTags)),
    );
    setSegments(segmentData ?? {});
    setDueTasks(dueData ?? []);
    setImportJobs(importData ?? []);
  }, [search, statusFilter, tagFilter]);

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

  const closeDrawer = useCallback(() => {
    setSelectedContactId(null);
    setContactDetail(null);
    setNewNote("");
    setNewTaskTitle("");
    setNewTaskDue("");
    setDetailError(null);
  }, []);

  const detailContact = contactDetail?.contact ?? null;
  const timelineEntries = contactDetail?.events ?? [];
  const notesEntries = contactDetail?.notes ?? [];
  const tasksEntries = contactDetail?.tasks ?? [];
  const outstandingBalance = detailContact ? contactDetail?.meta?.outstandingBalance ?? 0 : 0;
  const contactFullName =
    detailContact?.displayName?.trim() ||
    `${detailContact?.firstName ?? ""} ${detailContact?.lastName ?? ""}`.trim() ||
    "";
  const drawerOpen = Boolean(selectedContactId);
  const statusTone = CONTACT_STATUS_TONES[detailContact?.status ?? ""] ?? "info";

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

  const segmentSummaryKeys: Array<{ key: string; label: string }> = [
    { key: "lead", label: "Leads" },
    { key: "prospect", label: "Prospects" },
    { key: "client", label: "Clients" },
    { key: "lost", label: "Lost" },
    { key: "unpaid", label: "Unpaid" },
    { key: "stale", label: "Stale" },
    { key: "newThisWeek", label: "New This Week" },
  ];

  return (
    <>
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-4">
          <SectionCard title="Pipeline overview" headerAction={<Badge tone="info">{contacts.length} contacts</Badge>}>
            <p className="text-xs text-muted-foreground">
              Search, filter, and save views so the whole team can surface the right leads in seconds.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {segmentSummaryKeys.map((segment) => (
                <div key={segment.key} className="rounded-2xl border border-border/50 bg-slate-900/70 p-2 text-center text-[11px]">
                  <div className="text-muted-foreground uppercase">{segment.label}</div>
                  <div className="text-lg font-semibold">{segments[segment.key] ?? 0}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <Input
                placeholder="Search name/email/phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
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
                    { name: viewName.trim(), search, status: statusFilter, tags: tagFilter },
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
                    setStatusFilter(v.status);
                    setTagFilter(v.tags);
                  }}
                >
                  {v.name}
                </Button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Quick add">
            <p className="text-xs text-muted-foreground">
              Capture a contact with the essentials—status, source, tags, and role—without leaving the pipeline.
            </p>
            <div className="grid gap-2 md:grid-cols-5">
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
              <div className="flex flex-wrap gap-1 items-center">
                {STATUSES.map((s) => (
                  <Button
                    key={s}
                    variant={newContact.status === s ? "default" : "outline"}
                    className="px-2 py-1 text-[11px]"
                    onClick={() => setNewContact((prev) => ({ ...prev, status: s }))}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-5">
              <Input
                placeholder="Source (Instagram, Website, Referral...)"
                value={newContact.source}
                onChange={(e) => setNewContact((prev) => ({ ...prev, source: e.target.value }))}
              />
              <Input
                placeholder="Tags (comma-separated)"
                value={newContact.tags}
                onChange={(e) => setNewContact((prev) => ({ ...prev, tags: e.target.value }))}
              />
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
              <Input
                placeholder="Preferred channel (Email/WhatsApp/SMS)"
                value={newContact.preferredChannel}
                onChange={(e) => setNewContact((prev) => ({ ...prev, preferredChannel: e.target.value }))}
              />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                placeholder="Lifecycle stage (lead/prospect/client…)"
                value={newContact.lifecycleStage}
                onChange={(e) => setNewContact((prev) => ({ ...prev, lifecycleStage: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Tags accept comma-separated values. Fields are optional—use what’s relevant and stay quick.
              </p>
            </div>
            <Button
              variant="default"
              className="px-3 py-1 text-xs"
              onClick={async () => {
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
                startTransition(() => {
                  void loadData();
                });
              }}
              disabled={isPending}
            >
              Add Contact
            </Button>
          </SectionCard>
        </div>
        <div className="space-y-4">
          <SectionCard title="Import & capture" headerAction={<Badge tone="info">{importJobs.length} jobs</Badge>}>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Upload</span>
                <select
                  value={importType}
                  onChange={(e) => setImportType(e.target.value as "csv" | "xlsx" | "pdf" | "image")}
                  className="rounded border bg-background px-2 py-1 text-xs"
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
              <div className="space-y-2 rounded-2xl border border-border/60 bg-slate-900/60 p-3">
                <div className="text-xs font-semibold text-muted-foreground">Paste business card OCR text</div>
                <textarea
                  className="w-full rounded border bg-background p-2 text-xs text-foreground"
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
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-slate-900/60 px-3 py-2"
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-semibold">{job.originalName ?? job.sourceType}</div>
                          <div className="text-[11px] text-muted-foreground">
                            Rows: {job.processedRows ?? 0}/{job.totalRows ?? 0}
                          </div>
                          {job.error && (
                            <div className="text-[11px] text-rose-400">Error: {job.error}</div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 text-[11px] text-muted-foreground">
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

          <SectionCard title="Due / Overdue tasks" headerAction={<Badge tone="warning">{dueTasks.length}</Badge>}>
            <div className="space-y-2">
              {dueTasks.slice(0, 10).map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-slate-900/60 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-semibold">{t.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.contact
                        ? `${t.contact.firstName ?? ""} ${t.contact.lastName ?? ""}`.trim() ||
                          t.contact.email ||
                          t.contact.phone
                        : ""}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Due {t.dueDate ? new Date(t.dueDate).toLocaleString() : "soon"}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
  
      <SectionCard title="Recent activity" headerAction={<Badge tone="info">{eventsContactId ? "Latest contact" : "No contact"}</Badge>}>
        {eventsLoading ? (
          <p className="text-xs text-muted-foreground">Loading activity…</p>
        ) : recentEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent events yet.</p>
        ) : (
          <div className="space-y-2">
            {recentEvents.slice(0, 4).map((event) => (
              <div key={event.id} className="rounded-xl border border-border/50 bg-slate-900/60 p-2">
                <div className="text-xs font-semibold text-white">{event.type}</div>
                <div className="text-[11px] text-muted-foreground">
                  {event.data && typeof event.data === "object"
                    ? JSON.stringify(event.data).slice(0, 120)
                    : String(event.data)}
                </div>
                <div className="text-[11px] text-slate-400">{new Date(event.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

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
        <div className="grid gap-3 md:grid-cols-4 mt-4">
          {STATUSES.map((status) => (
            <div
              key={status}
              className="rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-2"
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
                            ? "border-emerald-500 bg-slate-900/90 shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                            : "border-border/50 bg-slate-900/70"
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
      </SectionCard>
    </div>
    <Drawer open={drawerOpen} onClose={closeDrawer} title={contactFullName || "Contact detail"}>
      <div className="space-y-4">
        {detailLoading ? (
          <p className="text-xs text-muted-foreground">Loading contact details…</p>
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
              <div className="rounded-xl border border-border/50 bg-slate-900/50 p-3 text-[12px] text-muted-foreground">
                <div>Outstanding balance: {outstandingBalance ? `$${outstandingBalance.toLocaleString()}` : "None"}</div>
                <div>Events captured: {timelineEntries.length}</div>
                <div>Notes logged: {notesEntries.length}</div>
                <div>Tasks tracked: {tasksEntries.length}</div>
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

            <SectionCard title="Timeline" className="bg-slate-900/70">
              <div className="space-y-2">
                {timelineEntries.slice(0, 4).map((event) => (
                  <div key={event.id} className="rounded-xl border border-border/50 bg-slate-950/60 p-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center justify-between text-white">
                      <span className="font-semibold">{event.type}</span>
                      <span className="text-[10px] text-slate-400">{formatDate(event.createdAt)}</span>
                    </div>
                    <p>
                      {event.data && typeof event.data === "object"
                        ? JSON.stringify(event.data).slice(0, 80)
                        : String(event.data)}
                    </p>
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
                    <div key={note.id} className="rounded-xl border border-border/40 bg-slate-900/50 p-2 text-[11px] text-muted-foreground">
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
                    <div key={task.id} className="rounded-xl border border-border/40 bg-slate-900/50 p-2 text-[11px] text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>{task.title}</span>
                        <span className="text-[10px] text-slate-400">{task.status ?? "OPEN"}</span>
                      </div>
                      <p className="text-[10px] text-slate-400">Due {formatDate(task.dueDate)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </Drawer>
    </>
  );
}
