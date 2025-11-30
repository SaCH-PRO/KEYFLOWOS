"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge, Button, Input, Textarea } from "@keyflow/ui";
import {
  Contact,
  ContactEvent,
  ContactNote,
  ContactTask,
  addContactNote,
  addContactTask,
  completeContactTask,
  fetchContactDetail,
  deleteContact,
  mergeContacts,
  updateContact,
} from "@/lib/client";

type Detail = { contact: Contact | null; events: ContactEvent[]; notes: ContactNote[]; tasks: ContactTask[]; meta?: any };

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
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

  useEffect(() => {
    const load = async () => {
      const { data: detail } = await fetchContactDetail(contactId);
      setData(detail);
      setStatus(detail.contact?.status ?? "LEAD");
      setTags(detail.contact?.tags?.join(", ") ?? "");
    };
    if (contactId) void load();
  }, [contactId]);

  const addNoteAction = async () => {
    if (!noteBody.trim()) return;
    startTransition(async () => {
      await addContactNote(contactId, noteBody);
      setNoteBody("");
      const { data: detail } = await fetchContactDetail(contactId);
      setData(detail);
    });
  };

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
      const { data: detail } = await fetchContactDetail(contactId);
      setData(detail);
    });
  };

  const deleteAction = async () => {
    if (!confirm("Delete this contact?")) return;
    startTransition(async () => {
      await deleteContact(contactId);
      router.push("/app/crm/pipeline");
    });
  };

  const mergeAction = async () => {
    if (!mergeId.trim()) return;
    startTransition(async () => {
      await mergeContacts({ contactId, duplicateId: mergeId });
      setMergeId("");
      const { data: detail } = await fetchContactDetail(contactId);
      setData(detail);
    });
  };

  const addTaskAction = async () => {
    if (!taskTitle.trim()) return;
    startTransition(async () => {
      await addContactTask(contactId, taskTitle, { dueDate: taskDue || undefined, assigneeId: taskAssignee || undefined });
      setTaskTitle("");
      setTaskDue("");
      setTaskAssignee("");
      const { data: detail } = await fetchContactDetail(contactId);
      setData(detail);
    });
  };

  const completeTaskAction = async (taskId: string) => {
    startTransition(async () => {
      await completeContactTask(taskId);
      const { data: detail } = await fetchContactDetail(contactId);
      setData(detail);
    });
  };

  if (!data) return <div className="p-4 text-sm text-muted-foreground">Loading contact...</div>;
  if (!data.contact) return <div className="p-4 text-sm text-muted-foreground">Contact not found.</div>;

  const c = data.contact;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed"}</h1>
          <div className="text-sm text-muted-foreground">
            {c.email || c.phone || "No contact info"} • Status: {c.status ?? "LEAD"}
          </div>
          <div className="mt-2 flex gap-2 text-xs text-muted-foreground flex-wrap">
            {c.tags?.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
            {data.meta?.outstandingBalance > 0 && (
              <Badge variant="outline" className="border-amber-500/60 text-amber-300">
                Owed: {data.meta.outstandingBalance.toLocaleString()}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>
      </div>

      <div className="rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-2">
        <div className="text-sm font-semibold">Manage Contact</div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 flex-wrap">
            {["LEAD", "PROSPECT", "CLIENT", "LOST"].map((s) => (
              <Button key={s} size="xs" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
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
          <Button size="sm" onClick={updateStatusTags} disabled={isPending}>
            Save
          </Button>
          <Button size="sm" variant="destructive" onClick={deleteAction} disabled={isPending}>
            Delete
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Merge duplicate contact ID"
            value={mergeId}
            onChange={(e) => setMergeId(e.target.value)}
            className="min-w-[240px]"
          />
          <Button size="sm" variant="outline" onClick={mergeAction} disabled={isPending}>
            Merge into this contact
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={runAiAssist}>
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
          <Section title="Timeline">
            <div className="space-y-2">
              {data.events.length === 0 && <Empty text="No events yet." />}
              {data.events.map((e) => (
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
          </Section>
          <Section title="Notes">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Textarea
                  placeholder="Add a note"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  className="min-h-[80px]"
                />
                <Button onClick={addNoteAction} disabled={isPending}>
                  Add
                </Button>
              </div>
              {data.notes.length === 0 && <Empty text="No notes yet." />}
              {data.notes.map((n) => (
                <div key={n.id} className="rounded-xl border border-border/60 bg-slate-900/60 p-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{n.source ?? "manual"}</span>
                    <span>{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-sm mt-1">{highlightMentions(n.body)}</div>
                </div>
              ))}
            </div>
          </Section>
        </div>
        <div className="space-y-3">
          <Section title="Tasks">
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap">
                <Input
                  placeholder="Task title"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="min-w-[200px]"
                />
                <Input
                  type="datetime-local"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                />
                <Input
                  placeholder="Assignee ID or name"
                  value={taskAssignee}
                  onChange={(e) => setTaskAssignee(e.target.value)}
                />
                <Button onClick={addTaskAction} disabled={isPending}>
                  Add task
                </Button>
              </div>
              {data.tasks.length === 0 && <Empty text="No tasks yet." />}
              {data.tasks.map((t) => (
                <div key={t.id} className="rounded-xl border border-border/60 bg-slate-900/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        Due: {t.dueDate ? new Date(t.dueDate).toLocaleString() : "n/a"} • Status: {t.status}
                        {t.assigneeId && ` • Assignee: ${t.assigneeId}`}
                      </div>
                    </div>
                    {t.status !== "DONE" && (
                      <Button size="xs" variant="outline" onClick={() => void completeTaskAction(t.id)}>
                        Mark done
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
