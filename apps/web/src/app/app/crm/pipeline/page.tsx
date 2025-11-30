"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Input } from "@keyflow/ui";
import {
  Contact,
  ContactTask,
  createContact,
  fetchContacts,
  fetchDueTasks,
  fetchSegmentSummary,
  updateContact,
} from "@/lib/client";

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"] as const;

export default function PipelinePage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [segments, setSegments] = useState<{ [key: string]: number }>({});
  const [dueTasks, setDueTasks] = useState<ContactTask[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState("");
  const [newContact, setNewContact] = useState({ firstName: "", lastName: "", email: "", phone: "", status: "LEAD" });
  const [savedViews, setSavedViews] = useState<{ name: string; search: string; status: string; tags: string }[]>([]);
  const [viewName, setViewName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("crm_saved_views");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setSavedViews(JSON.parse(stored));
    }
    const load = async () => {
      const [{ data: contactData }, { data: segmentData }, { data: dueData }] = await Promise.all([
        fetchContacts(undefined, {
          includeStats: true,
          take: 200,
          search: search || undefined,
          status: statusFilter !== "ALL" ? statusFilter : undefined,
          tags: tagFilter
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
        fetchSegmentSummary(),
        fetchDueTasks(),
      ]);
      setContacts(contactData ?? []);
      setSegments(segmentData ?? {});
      setDueTasks(dueData ?? []);
    };
    startTransition(() => {
      void load();
    });
  }, [search, statusFilter, tagFilter]);

  async function move(contactId: string, status: string) {
    await updateContact({ contactId, status });
    setContacts((prev) => prev.map((c) => (c.id === contactId ? { ...c, status } : c)));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">CRM Suite Pipeline</h1>
        <p className="text-sm text-muted-foreground">Quick view; click buttons to move stages. Live stats included.</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {["lead", "prospect", "client", "lost", "unpaid", "stale", "newThisWeek"].map((k) => (
            <span key={k} className="rounded-full border border-border/60 px-2 py-1">
              {k}: {segments?.[k] ?? 0}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            placeholder="Search name/email/phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Input
            placeholder="Filter by tags (comma-separated)"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="w-56"
          />
          <div className="flex gap-1 flex-wrap">
            {["ALL", ...STATUSES].map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? "default" : "outline"}
                onClick={() => setStatusFilter(s)}
                disabled={isPending}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Saved view name"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            className="w-48"
          />
          <Button
            size="sm"
            variant="outline"
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
          {savedViews.map((v) => (
            <Button
              key={v.name}
              size="xs"
              variant="outline"
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
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground">Bulk move selected:</span>
          {STATUSES.map((s) => (
            <Button
              key={s}
              size="xs"
              variant="outline"
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
        <div className="mt-3 rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-2">
          <div className="text-sm font-semibold">Add Contact</div>
          <div className="grid gap-2 md:grid-cols-5">
            <Input
              placeholder="First name"
              value={newContact.firstName}
              onChange={(e) => setNewContact((p) => ({ ...p, firstName: e.target.value }))}
            />
            <Input
              placeholder="Last name"
              value={newContact.lastName}
              onChange={(e) => setNewContact((p) => ({ ...p, lastName: e.target.value }))}
            />
            <Input
              placeholder="Email"
              value={newContact.email}
              onChange={(e) => setNewContact((p) => ({ ...p, email: e.target.value }))}
            />
            <Input
              placeholder="Phone"
              value={newContact.phone}
              onChange={(e) => setNewContact((p) => ({ ...p, phone: e.target.value }))}
            />
            <div className="flex gap-1 flex-wrap items-center">
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="xs"
                  variant={newContact.status === s ? "default" : "outline"}
                  onClick={() => setNewContact((p) => ({ ...p, status: s }))}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              await createContact({
                firstName: newContact.firstName,
                lastName: newContact.lastName,
                email: newContact.email,
                phone: newContact.phone,
                status: newContact.status,
              });
              setNewContact({ firstName: "", lastName: "", email: "", phone: "", status: "LEAD" });
              startTransition(async () => {
                const { data } = await fetchContacts(undefined, { includeStats: true, take: 200 });
                setContacts(data ?? []);
                const { data: segs } = await fetchSegmentSummary();
                setSegments(segs ?? {});
              });
            }}
            disabled={isPending}
          >
            Add Contact
          </Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
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
              <Badge variant="outline">{contacts.filter((c) => (c.status ?? "LEAD") === status).length}</Badge>
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
                    <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                      {c.meta?.leadScore !== undefined && (
                        <span className="rounded-full border border-border/50 px-2 py-0.5">Score: {c.meta.leadScore}</span>
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
                          <Button key={s} size="xs" variant="outline" onClick={() => void move(c.id, s)}>
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
      {dueTasks.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-slate-950/70 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Due / Overdue Tasks</div>
            <Badge variant="outline">{dueTasks.length}</Badge>
          </div>
          <div className="space-y-1">
            {dueTasks.slice(0, 10).map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-slate-900/60 px-3 py-2">
                <div>
                  <div className="text-sm font-semibold">{t.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.contact ? `${t.contact.firstName ?? ""} ${t.contact.lastName ?? ""}`.trim() || t.contact.email || t.contact.phone : ""}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Due {t.dueDate ? new Date(t.dueDate).toLocaleString() : "soon"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
