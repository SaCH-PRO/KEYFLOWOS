"use client";

import { type ReactNode, useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Input } from "@keyflow/ui";
import {
  Contact,
  ContactImportJob,
  ContactTask,
  createContact,
  createContactFromOcr,
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

type ContactWithTags = Contact & { tags: string[] };

const importToneByStatus: Record<string, "default" | "info" | "success" | "warning" | "danger"> = {
  COMPLETED: "success",
  FAILED: "danger",
  PROCESSING: "info",
  PENDING: "warning",
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
  });
  const [savedViews, setSavedViews] = useState<{ name: string; search: string; status: string; tags: string }[]>([]);
  const [viewName, setViewName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [importType, setImportType] = useState<"csv" | "xlsx" | "pdf" | "image">("csv");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [cameraImage, setCameraImage] = useState<File | null>(null);
  const [importLink, setImportLink] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [isPending, startTransition] = useTransition();

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
      })),
    );
    setSegments(segmentData ?? {});
    setDueTasks(dueData ?? []);
    setImportJobs(importData ?? []);
  }, [search, statusFilter, tagFilter]);

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
                });
                setNewContact({ firstName: "", lastName: "", email: "", phone: "", status: "LEAD" });
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
                      className="rounded-xl border border-border/50 bg-slate-900/70 p-2 space-y-1"
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
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Link href={`/app/crm/contacts/${c.id}`} className="underline hover:text-foreground">
                          View detail
                        </Link>
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
  );
}
