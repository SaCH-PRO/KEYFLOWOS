"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Table, Drawer, Button, Input, Badge } from "@keyflow/ui";
import {
  Contact,
  ContactEvent,
  ContactNote,
  ContactTask,
  addContactNote,
  addContactTask,
  createContact,
  fetchContactDetail,
  fetchContacts,
} from "@/lib/client";

const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  email: z.string().email("Email is invalid").optional(),
  phone: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
});

const STATUS_COLORS: Record<string, "outline" | "secondary"> = {
  LEAD: "outline",
  PROSPECT: "outline",
  CLIENT: "secondary",
  LOST: "outline",
};

export default function CrmPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [detail, setDetail] = useState<{ events: ContactEvent[]; notes: ContactNote[]; tasks: ContactTask[] }>({
    events: [],
    notes: [],
    tasks: [],
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", status: "LEAD", source: "" });
  const [noteDraft, setNoteDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await fetchContacts();
      setContacts(data ?? []);
      setError(error);
      setLoading(false);
    };
    void load();
  }, []);

  const rows = useMemo(
    () =>
      contacts.map((contact) => [
        `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unnamed",
        contact.email ?? "—",
        contact.phone ?? "—",
        <Badge key={`${contact.id}-status`} variant={STATUS_COLORS[contact.status ?? "LEAD"] ?? "outline"}>
          {contact.status ?? "LEAD"}
        </Badge>,
        <Button
          key={contact.id}
          variant="outline"
          onClick={() => {
            setSelected(contact);
            setDrawerOpen(true);
            void loadDetail(contact.id);
          }}
        >
          View
        </Button>,
      ]),
    [contacts],
  );

  async function handleCreate() {
    setFormError(null);
    const parsed = contactSchema.safeParse(form);
    if (!parsed.success) {
      setFormError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    const { data, error } = await createContact({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      status: form.status,
    });
    if (error) setFormError(error);
    if (data) {
      setContacts((prev) => [data, ...prev]);
      setDrawerOpen(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "", status: "LEAD", source: "" });
    }
  }

  async function loadDetail(contactId: string) {
    const res = await fetchContactDetail(contactId);
    if (res.data) {
      setDetail({
        events: res.data.events ?? [],
        notes: res.data.notes ?? [],
        tasks: res.data.tasks ?? [],
      });
    } else {
      setDetail({ events: [], notes: [], tasks: [] });
    }
  }

  async function handleAddNote() {
    if (!selected || !noteDraft.trim()) return;
    const res = await addContactNote(selected.id, noteDraft.trim());
    if (res.data) {
      setDetail((d) => ({ ...d, notes: [res.data!, ...d.notes] }));
      setNoteDraft("");
    }
  }

  async function handleAddTask() {
    if (!selected || !taskDraft.trim()) return;
    const res = await addContactTask(selected.id, taskDraft.trim());
    if (res.data) {
      setDetail((d) => ({ ...d, tasks: [res.data!, ...d.tasks] }));
      setTaskDraft("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">CRM</h1>
          <p className="text-sm text-muted-foreground">Contacts, timelines, notes, tasks, and flow intelligence.</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setSelected(null);
              setDetail({ events: [], notes: [], tasks: [] });
              setDrawerOpen(true);
            }}
          >
            Add contact
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Live API unreachable — showing demo data.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
          {loading ? "Loading contacts..." : "No contacts yet. Add one to get started."}
        </div>
      ) : (
        <Table headers={["Name", "Email", "Phone", "Status", "Actions"]} rows={rows} />
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelected(null);
          setFormError(null);
          setDetail({ events: [], notes: [], tasks: [] });
        }}
        title={selected ? selected.firstName ?? "Contact" : "New contact"}
      >
        {selected ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground space-y-1">
              <div>Name: {`${selected.firstName ?? ""} ${selected.lastName ?? ""}`.trim() || "Unnamed"}</div>
              <div>Email: {selected.email ?? "—"}</div>
              <div>Phone: {selected.phone ?? "—"}</div>
              <div>Status: {selected.status ?? "LEAD"}</div>
              <div>Source: {selected.source ?? "—"}</div>
              <div className="flex flex-wrap gap-2 mt-2">
                {(selected.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>

            <section className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-xs text-muted-foreground space-y-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Timeline</div>
              {detail.events.length === 0 ? (
                <div className="text-muted-foreground">No events yet.</div>
              ) : (
                <div className="space-y-2">
                  {detail.events.map((evt) => (
                    <div key={evt.id} className="rounded-lg border border-border/50 bg-slate-950/60 px-3 py-2">
                      <div className="flex justify-between text-[11px] text-slate-300">
                        <span>{evt.type}</span>
                        <span>{new Date(evt.createdAt).toLocaleString()}</span>
                      </div>
                      <pre className="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap">
                        {JSON.stringify(evt.data, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-xs text-muted-foreground space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Notes</div>
                <Button size="sm" variant="secondary" onClick={() => void handleAddNote()}>
                  Add
                </Button>
              </div>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                className="w-full rounded-lg bg-slate-950/70 border border-border/60 px-2 py-2 text-foreground text-xs"
                placeholder="Add a note..."
              />
              <div className="space-y-2">
                {detail.notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-border/50 bg-slate-950/60 px-3 py-2">
                    <div className="text-[11px] text-slate-400">{new Date(n.createdAt).toLocaleString()}</div>
                    <div className="text-slate-200">{n.body}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-xs text-muted-foreground space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Tasks</div>
                <Button size="sm" variant="secondary" onClick={() => void handleAddTask()}>
                  Add
                </Button>
              </div>
              <input
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                className="w-full rounded-lg bg-slate-950/70 border border-border/60 px-2 py-2 text-foreground text-xs"
                placeholder="Follow up tomorrow..."
              />
              <div className="space-y-2">
                {detail.tasks.map((t) => (
                  <div key={t.id} className="rounded-lg border border-border/50 bg-slate-950/60 px-3 py-2">
                    <div className="flex items-center justify-between text-slate-200">
                      <span>{t.title}</span>
                      <Badge variant="outline">{t.status ?? "OPEN"}</Badge>
                    </div>
                    {t.dueDate ? (
                      <div className="text-[11px] text-slate-400">Due: {new Date(t.dueDate).toLocaleDateString()}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              label="First name"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
            <Input
              label="Last name"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
            <Input
              label="Email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <Input
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <Input
              label="Source"
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
            />
            <Input
              label="Status"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value.toUpperCase() }))}
            />
            {formError && <div className="text-xs text-amber-400">{formError}</div>}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate}>Save contact</Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
