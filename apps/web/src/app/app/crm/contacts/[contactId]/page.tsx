"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { TaskContinuityHeader } from "@/components/ui/task-continuity-header";
import { Badge, Button, Input } from "@keyflow/ui";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Contact,
  ContactPlaybook,
  ContactEvent,
  ContactNote,
  ContactTask,
  addContactNote,
  addContactTask,
  completeContactTask,
  fetchContactDetail,
  fetchContactDossier,
  deleteContact,
  mergeContacts,
  updateContact,
  fetchContactPlaybook,
  updateContactPlaybook,
} from "@/lib/client";
import { loadInterruptedTasks, markSourceChanged } from "@/lib/resume-task-registry";

type ContactWithTags = Omit<Contact, "tags"> & { tags?: string[] };
type TaskWithContactTags = Omit<ContactTask, "contact"> & { contact?: ContactWithTags | null };
type Detail = {
  contact: ContactWithTags | null;
  events: ContactEvent[];
  notes: ContactNote[];
  tasks: TaskWithContactTags[];
  meta?: Contact["meta"];
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

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { setCurrentMeta, getOriginContext } = useNavigationContext();
  const contactId = params?.contactId as string;
  const [data, setData] = useState<Detail | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string>("LEAD");
  const [tags, setTags] = useState<string>("");
  const [mergeId, setMergeId] = useState("");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiNext, setAiNext] = useState<string | null>(null);
  const [playbook, setPlaybook] = useState<ContactPlaybook | null>(null);
  const [playbookText, setPlaybookText] = useState("");
  const [playbookSaving, setPlaybookSaving] = useState(false);
  const [playbookError, setPlaybookError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string>("ALL");
  const [notesQuery, setNotesQuery] = useState("");
  const [playbookEdit, setPlaybookEdit] = useState(false);
  const [confirmState, setConfirmState] = useState<{open: boolean; action: () => void}>({open: false, action: () => {}});

  const normalizeContact = useCallback(
    (contact?: Contact | null): ContactWithTags | null => (contact ? { ...contact, tags: contact.tags ?? [] } : null),
    [],
  );

  const refreshDetail = useCallback(async () => {
    if (!contactId) return null;
    const { data: detail } = await fetchContactDetail(contactId);
    const normalizedTasks: TaskWithContactTags[] = (detail?.tasks ?? []).map((task) => ({
      ...task,
      contact: task.contact ? normalizeContact(task.contact) : null,
    }));
    const normalized: Detail | null = detail
      ? {
          contact: normalizeContact(detail.contact),
          events: detail.events ?? [],
          notes: detail.notes ?? [],
          tasks: normalizedTasks,
          meta: detail.meta ?? undefined,
        }
      : null;
    setData(normalized);
    return normalized;
  }, [contactId, normalizeContact]);

  const loadPlaybook = useCallback(async () => {
    if (!contactId) return;
    const { data } = await fetchContactPlaybook(contactId);
    if (data) {
      setPlaybook(data);
      setPlaybookText(JSON.stringify(data.data ?? {}, null, 2));
    }
  }, [contactId]);

  useEffect(() => {
    const load = async () => {
      const normalized = await refreshDetail();
      setStatus(normalized?.contact?.status ?? "LEAD");
      setTags(normalized?.contact?.tags?.join(", ") ?? "");
      await loadPlaybook();
      setEventFilter("ALL");
      setNotesQuery("");
      setPlaybookEdit(false);
      if (normalized?.contact) {
        const c = normalized.contact;
        const label = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Contact";
        setCurrentMeta({ selectedEntityId: contactId, selectedEntityLabel: label });
      }
    };
    if (contactId) void load();
  }, [contactId, refreshDetail, loadPlaybook, setCurrentMeta]);

  const addNoteAction = useCallback(() => {
    if (!noteBody.trim()) return;
    startTransition(async () => {
      try {
        await addContactNote(contactId, noteBody);
        setNoteBody("");
        await refreshDetail();
        toast.success("Note added");
      } catch {
        toast.error("Failed to add note");
      }
    });
  }, [contactId, noteBody, refreshDetail]);

  const runAiAssist = () => {
    if (!data?.contact) return;
    const c = data.contact;
    const score = c.meta?.leadScore ?? 50;
    const unpaid = c.meta?.outstandingBalance ?? 0;
    const last = c.meta?.lastInteractionAt ? new Date(c.meta.lastInteractionAt).toLocaleDateString() : "recently";
    const nextTask = c.meta?.nextDueTaskAt ? new Date(c.meta.nextDueTaskAt).toLocaleDateString() : "none";
    setAiSummary(
      `Contact ${c.firstName ?? ""} ${c.lastName ?? ""} is a ${c.status ?? "LEAD"} with score ${score}. Last touch ${last}, outstanding balance ${unpaid}. Next task ${nextTask}.`,
    );
    if (unpaid > 0) {
      setAiNext("Send payment reminder and schedule a follow-up call in 2 days.");
    } else if ((data.tasks ?? []).some((t) => t.status !== "DONE")) {
      setAiNext("Complete open tasks and confirm next meeting.");
    } else {
      setAiNext("Send a check-in message with a tailored offer based on their status.");
    }
  };

  const updateStatusTags = async () => {
    startTransition(async () => {
      await updateContact({
        contactId,
        status,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      const normalized = await refreshDetail();
      setStatus(normalized?.contact?.status ?? status);
      setTags(normalized?.contact?.tags?.join(", ") ?? tags);
      const relatedTasks = loadInterruptedTasks().filter(
        (t) => t.draftId === contactId || t.formData?.contactId === contactId
      );
      relatedTasks.forEach((t) => markSourceChanged(t.id));
    });
  };

  const deleteAction = async () => {
    setConfirmState({
      open: true,
      action: () => {
        startTransition(async () => {
          try {
            await deleteContact(contactId);
            toast.success("Contact deleted");
            router.push("/app/crm/pipeline");
          } catch {
            toast.error("Failed to delete contact");
          }
        });
      },
    });
  };

  const mergeAction = async () => {
    if (!mergeId.trim()) return;
    startTransition(async () => {
      try {
        await mergeContacts({ contactId, duplicateId: mergeId });
        setMergeId("");
        await refreshDetail();
        toast.success("Contacts merged");
      } catch {
        toast.error("Failed to merge contacts");
      }
    });
  };

  const savePlaybook = async () => {
    if (!contactId) return;
    setPlaybookSaving(true);
    setPlaybookError(null);
    try {
      const parsed = playbookText.trim() ? JSON.parse(playbookText) : {};
      await updateContactPlaybook({ contactId, data: parsed, type: playbook?.type });
      await loadPlaybook();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save playbook";
      setPlaybookError(message);
    } finally {
      setPlaybookSaving(false);
    }
  };

  const addTaskAction = useCallback(() => {
    if (!taskTitle.trim()) return;
    startTransition(async () => {
      try {
        await addContactTask(contactId, taskTitle, { dueDate: taskDue || undefined, assigneeId: taskAssignee || undefined });
        setTaskTitle("");
        setTaskDue("");
        setTaskAssignee("");
        await refreshDetail();
        toast.success("Task added");
      } catch {
        toast.error("Failed to add task");
      }
    });
  }, [contactId, refreshDetail, taskAssignee, taskDue, taskTitle]);

  const completeTaskAction = useCallback(
    (taskId: string) => {
      startTransition(async () => {
        try {
          await completeContactTask(taskId);
          await refreshDetail();
          toast.success("Task completed");
        } catch {
          toast.error("Failed to complete task");
        }
      });
    },
    [refreshDetail],
  );

  const contact = data?.contact ?? null;
  const meta = contact?.meta;
  const eventTypes = useMemo(() => Array.from(new Set((data?.events ?? []).map((e) => e.type))), [data]);
  const filteredEvents = useMemo(
    () => (eventFilter === "ALL" ? data?.events ?? [] : (data?.events ?? []).filter((e) => e.type === eventFilter)),
    [data, eventFilter],
  );
  const filteredNotes = useMemo(
    () =>
      notesQuery.trim()
        ? (data?.notes ?? []).filter((n) =>
            `${n.body} ${n.source ?? ""}`.toLowerCase().includes(notesQuery.trim().toLowerCase()),
          )
        : data?.notes ?? [],
    [data, notesQuery],
  );
  const parsedPlaybook = useMemo(() => {
    try {
      return playbook?.data ?? (playbookText.trim() ? JSON.parse(playbookText) : {});
    } catch {
      return null;
    }
  }, [playbook, playbookText]);

  const sections = useMemo(
    () => [
      {
        key: "timeline",
        title: "Timeline",
        content: (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Filter</span>
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="rounded border border-border/60 bg-background px-2 py-1 text-[11px]"
              >
                <option value="ALL">All types</option>
                {eventTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {filteredEvents.length === 0 && <Empty text="No events yet." />}
            {filteredEvents.map((e) => (
              <div key={e.id} className="rounded-xl border border-border/60 bg-slate-900/60 p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{e.type}</span>
                  <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-xs text-muted-foreground">Source: {e.source ?? "system"}</div>
                <pre className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap">
                  {JSON.stringify(e.data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        ),
      },
      {
        key: "notes",
        title: "Notes",
        content: (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <textarea
                  placeholder="Add a note"
                  value={noteBody}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNoteBody(e.target.value)}
                  className="min-h-[80px] w-full rounded-md border border-border/60 bg-background p-2 text-sm text-foreground"
                />
              </div>
              <div className="flex items-start gap-2">
                <Button onClick={addNoteAction} disabled={isPending}>
                  Add
                </Button>
                <Input
                  placeholder="Search notes"
                  value={notesQuery}
                  onChange={(e) => setNotesQuery(e.target.value)}
                  className="text-xs w-40"
                />
              </div>
            </div>
            {filteredNotes.length === 0 && <Empty text="No notes yet." />}
            {filteredNotes.map((n) => (
              <div key={n.id} className="rounded-xl border border-border/60 bg-slate-900/60 p-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{n.source ?? "manual"}</span>
                  <span>{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-sm mt-1">{highlightMentions(n.body)}</div>
              </div>
            ))}
          </div>
        ),
      },
      {
        key: "tasks",
        title: "Tasks",
        content: (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <Input
                placeholder="Task title"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                className="min-w-[200px]"
              />
              <Input type="datetime-local" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
              <Input
                placeholder="Assignee ID or name"
                value={taskAssignee}
                onChange={(e) => setTaskAssignee(e.target.value)}
              />
              <Button onClick={addTaskAction} disabled={isPending}>
                Add task
              </Button>
            </div>
            {(data?.tasks ?? []).length === 0 && <Empty text="No tasks yet." />}
            {(data?.tasks ?? []).map((t) => (
              <div key={t.id} className="rounded-xl border border-border/60 bg-slate-900/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span>{t.title}</span>
                      <Badge tone={t.status === "DONE" ? "success" : "info"}>{t.status ?? "OPEN"}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                      <span>Due: {t.dueDate ? new Date(t.dueDate).toLocaleString() : "n/a"}</span>
                      {t.assigneeId && <span>Assignee: {t.assigneeId}</span>}
                    </div>
                  </div>
                  {t.status !== "DONE" && (
                    <Button variant="outline" onClick={() => void completeTaskAction(t.id)}>
                      Mark done
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ),
      },
    ],
    [
      addNoteAction,
      addTaskAction,
      completeTaskAction,
      data,
      eventFilter,
      eventTypes,
      filteredEvents,
      filteredNotes,
      isPending,
      noteBody,
      notesQuery,
      taskAssignee,
      taskDue,
      taskTitle,
    ],
  );

  if (!data) return <div className="p-4 text-sm text-muted-foreground">Loading contact...</div>;

  if (!contact) {
    const origin = getOriginContext();
    return (
      <div className="p-4 space-y-4">
        {origin && (
          <TaskContinuityHeader
            taskLabel="Contact Detail"
            returnHref={origin.route}
            returnLabel={`Back to ${origin.workspace ?? "CRM"}${origin.tab ? ` › ${origin.tab}` : ""}`}
          />
        )}
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Contact not found</p>
          <p className="mt-1">This contact may have been deleted or you may not have access.</p>
          {origin && (
            <button
              onClick={() => router.push(origin.route)}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              ← Return to {origin.workspace ?? "CRM"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const c = contact;

  return (
    <div className="space-y-4">
      <TaskContinuityHeader
        taskLabel={`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Contact"}
        returnHref={getOriginContext()?.route ?? "/app/crm/pipeline"}
      />
      <div className="flex items-start justify-between gap-3 md:sticky md:top-0 md:bg-slate-950/80 md:backdrop-blur md:p-2 md:rounded-xl md:z-10">
        <div>
          <h1 className="text-xl font-semibold">{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed"}</h1>
          <div className="text-sm text-muted-foreground">
            {c.email || c.phone || "No contact info"} | Status: {c.status ?? "LEAD"}
          </div>
          <div className="mt-2 flex gap-2 text-xs text-muted-foreground flex-wrap">
            {c.tags?.map((t) => (
              <Badge key={t} className="border border-border/60 px-2 py-0.5">
                {t}
              </Badge>
            ))}
            {meta?.outstandingBalance && meta.outstandingBalance > 0 && (
              <Badge className="border border-amber-500/60 text-amber-300 px-2 py-0.5">
                Owed: {meta.outstandingBalance.toLocaleString()}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                toast.info("Generating dossier…");
                const res = await fetchContactDossier(contactId);
                if (res.error || !res.data) throw new Error(res.error ?? "Failed to fetch dossier");
                const dossier = res.data as {
                  generatedAt: string;
                  contact: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; companyName?: string | null; jobTitle?: string | null; status?: string | null; tags?: string[] | null } | null;
                  insight?: { summary?: string; nextStep?: string } | null;
                  health?: { score?: number; daysSinceLastInteraction?: number | null } | null;
                  summary?: { totalRevenue?: number; totalTouchpoints?: number; lastInteractionAt?: string | null } | null;
                  timeline?: Array<{ timestamp: string; title: string; description?: string; module?: string; type?: string }>;
                };
                const { default: JsPDFCtor } = await import("jspdf");
                await import("jspdf-autotable");
                const doc = new JsPDFCtor({ unit: "pt", format: "a4" });
                const name = `${dossier.contact?.firstName ?? ""} ${dossier.contact?.lastName ?? ""}`.trim() || dossier.contact?.email || "Contact";
                doc.setFontSize(20);
                doc.text(`Contact Dossier — ${name}`, 40, 50);
                doc.setFontSize(10);
                doc.setTextColor(120);
                doc.text(`Generated ${new Date(dossier.generatedAt).toLocaleString()}`, 40, 68);
                doc.setTextColor(0);
                let y = 100;
                doc.setFontSize(12);
                doc.text("Profile", 40, y); y += 16;
                doc.setFontSize(10);
                const lines = [
                  dossier.contact?.email && `Email: ${dossier.contact.email}`,
                  dossier.contact?.phone && `Phone: ${dossier.contact.phone}`,
                  dossier.contact?.companyName && `Company: ${dossier.contact.companyName}`,
                  dossier.contact?.jobTitle && `Title: ${dossier.contact.jobTitle}`,
                  dossier.contact?.status && `Status: ${dossier.contact.status}`,
                  dossier.contact?.tags?.length && `Tags: ${dossier.contact.tags.join(", ")}`,
                ].filter(Boolean) as string[];
                lines.forEach((l) => { doc.text(l, 40, y); y += 14; });
                y += 8;
                doc.setFontSize(12);
                doc.text("Health & Insight", 40, y); y += 16;
                doc.setFontSize(10);
                if (dossier.health?.score != null) { doc.text(`Health score: ${dossier.health.score}`, 40, y); y += 14; }
                if (dossier.health?.daysSinceLastInteraction != null) { doc.text(`Days since last interaction: ${dossier.health.daysSinceLastInteraction}`, 40, y); y += 14; }
                if (dossier.insight?.summary) { const wrapped = doc.splitTextToSize(`Summary: ${dossier.insight.summary}`, 515); doc.text(wrapped, 40, y); y += wrapped.length * 14; }
                if (dossier.insight?.nextStep) { const wrapped = doc.splitTextToSize(`Next step: ${dossier.insight.nextStep}`, 515); doc.text(wrapped, 40, y); y += wrapped.length * 14; }
                y += 8;
                if (dossier.summary) {
                  doc.setFontSize(12); doc.text("Engagement Summary", 40, y); y += 16;
                  doc.setFontSize(10);
                  if (dossier.summary.totalRevenue != null) { doc.text(`Total revenue: ${dossier.summary.totalRevenue.toLocaleString()}`, 40, y); y += 14; }
                  if (dossier.summary.totalTouchpoints != null) { doc.text(`Total touchpoints: ${dossier.summary.totalTouchpoints}`, 40, y); y += 14; }
                  if (dossier.summary.lastInteractionAt) { doc.text(`Last interaction: ${new Date(dossier.summary.lastInteractionAt).toLocaleString()}`, 40, y); y += 14; }
                  y += 8;
                }
                if (dossier.timeline?.length) {
                  doc.setFontSize(12); doc.text("Story (last 30 events)", 40, y); y += 8;
                  const rows = dossier.timeline.slice(0, 30).map((t) => [
                    new Date(t.timestamp).toLocaleDateString(),
                    t.module ?? "",
                    t.title,
                    (t.description ?? "").slice(0, 80),
                  ]);
                  // @ts-expect-error - jspdf-autotable augments doc
                  doc.autoTable({ startY: y + 8, head: [["Date", "Module", "Title", "Detail"]], body: rows, styles: { fontSize: 8 }, headStyles: { fillColor: [40, 40, 40] } });
                }
                doc.save(`${name.replace(/\s+/g, "_")}_dossier.pdf`);
                toast.success("Dossier downloaded");
              } catch (err) {
                console.error(err);
                toast.error("Failed to generate dossier");
              }
            }}
          >
            Export Dossier
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            Back
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-2">
        <div className="text-sm font-semibold">Manage Contact</div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 flex-wrap">
            {["LEAD", "PROSPECT", "CLIENT", "LOST"].map((s) => (
              <Button key={s} variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
                {s}
              </Button>
            ))}
          </div>
          <Input
            placeholder="Tags (comma-separated)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="min-w-[200px]"
          />
          <Button onClick={updateStatusTags} disabled={isPending}>
            Save
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Merge duplicate ID"
            value={mergeId}
            onChange={(e) => setMergeId(e.target.value)}
            className="min-w-[200px]"
          />
          <Button variant="outline" onClick={mergeAction} disabled={isPending}>
            Merge
          </Button>
          <Button variant="destructive" onClick={deleteAction} disabled={isPending}>
            Delete
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Playbook</div>
            {playbook && (
              <div className="text-xs text-muted-foreground">
                Type: {playbook.type} | Version: {playbook.schemaVersion}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setPlaybookEdit((prev) => !prev)} className="text-xs">
              {playbookEdit ? "Close edit" : "Edit JSON"}
            </Button>
            <Button variant="outline" onClick={loadPlaybook} disabled={isPending || playbookSaving} className="text-xs">
              Reload
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">View / run</div>
            {parsedPlaybook ? (
              Object.keys(parsedPlaybook).length === 0 ? (
                <Empty text="No playbook content yet." />
              ) : (
                Object.entries(parsedPlaybook).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-xl border border-border/50 bg-slate-900/60 p-2 text-xs text-muted-foreground"
                  >
                    <div className="text-white text-sm font-semibold">{key}</div>
                    <pre className="whitespace-pre-wrap text-[11px]">
                      {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
                    </pre>
                  </div>
                ))
              )
            ) : (
              <div className="text-xs text-rose-400">Playbook JSON is invalid. Fix it in edit mode.</div>
            )}
          </div>
          <div className="space-y-2">
            {playbookEdit ? (
              <>
                <textarea
                  className="w-full rounded-md border border-border/60 bg-background p-2 text-sm text-foreground min-h-[160px]"
                  value={playbookText}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setPlaybookText(e.target.value)}
                  placeholder='{ "notes": "Add structured client info here" }'
                />
                {playbookError && <div className="text-xs text-red-400">{playbookError}</div>}
                <div className="flex gap-2">
                  <Button onClick={savePlaybook} disabled={playbookSaving || isPending}>
                    {playbookSaving ? "Saving..." : "Save playbook"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted-foreground">
                Toggle edit to update JSON (e.g., onboarding steps, call scripts). Changes are versioned per contact.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-2">
        <div className="text-sm font-semibold">Quick Actions</div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/app/commerce?tab=invoices&contactId=${contactId}`)}
          >
            Create Invoice
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/app/commerce?tab=quotes&contactId=${contactId}`)}
          >
            Create Quote
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/app/bookings?contactId=${contactId}`)}
          >
            Book Appointment
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/app/projects?contactId=${contactId}`)}
          >
            Create Project
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/app/marketing?tab=campaigns&contactId=${contactId}`)}
          >
            Create Campaign
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" onClick={runAiAssist}>
              AI Summary & Next Step
            </Button>
          </div>
          {aiSummary && (
            <div className="rounded-xl border border-border/60 bg-slate-900/60 p-3 text-sm space-y-1">
              <div className="font-semibold">AI Summary</div>
              <div className="text-muted-foreground">{aiSummary}</div>
              {aiNext && <div className="text-primary">Next best action: {aiNext}</div>}
            </div>
          )}
          {sections.map((section) => (
            <Section key={section.key} title={section.title} isMobile={isMobile}>
              {section.content}
            </Section>
          ))}
        </div>
      </div>
      <ConfirmDialog
        open={confirmState.open}
        title="Delete Contact"
        message="Are you sure you want to delete this contact?"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => { confirmState.action(); setConfirmState({open: false, action: () => {}}); }}
        onCancel={() => setConfirmState({open: false, action: () => {}})}
      />
    </div>
  );
}

function Section({ title, children, isMobile }: { title: string; children: React.ReactNode; isMobile?: boolean }) {
  if (isMobile) {
    return (
      <details className="rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-2" open>
        <summary className="text-sm font-semibold cursor-pointer">{title}</summary>
        {children}
      </details>
    );
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-2">
      <div className="text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs text-muted-foreground">{text}</div>;
}

function highlightMentions(text: string) {
  const parts = text.split(/(@\w+)/g);
  return (
    <span>
      {parts.map((part, idx) =>
        part.startsWith("@") ? (
          <span key={idx} className="text-primary font-semibold">
            {part}
          </span>
        ) : (
          <span key={idx}>{part}</span>
        ),
      )}
    </span>
  );
}
