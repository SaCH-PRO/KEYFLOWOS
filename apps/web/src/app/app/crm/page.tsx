"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Table, Drawer, Button, Input } from "@keyflow/ui";
import { Contact, createContact, fetchContacts } from "@/lib/client";

const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  email: z.string().email("Email is invalid").optional(),
  phone: z.string().optional(),
});

export default function CrmPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
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
        <Button
          key={contact.id}
          variant="outline"
          onClick={() => {
            setSelected(contact);
            setDrawerOpen(true);
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
    });
    if (error) setFormError(error);
    if (data) {
      setContacts((prev) => [data, ...prev]);
      setDrawerOpen(false);
      setForm({ firstName: "", lastName: "", email: "", phone: "" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">CRM</h1>
          <p className="text-sm text-muted-foreground">Contacts, segments, and relationship intelligence.</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setSelected(null);
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

      <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-3 space-y-2 text-xs text-muted-foreground">
        Click a row to open details. Actions: create follow-up, view timeline.
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-4 text-sm text-muted-foreground">
          {loading ? "Loading contacts..." : "No contacts yet. Add one to get started."}
        </div>
      ) : (
        <Table headers={["Name", "Email", "Phone", "Actions"]} rows={rows} />
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelected(null);
          setFormError(null);
        }}
        title={selected ? selected.firstName ?? "Contact" : "New contact"}
      >
        {selected ? (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Email: {selected.email ?? "—"}</div>
            <div className="text-sm text-muted-foreground">Phone: {selected.phone ?? "—"}</div>
            <div className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-xs text-muted-foreground">
              Timeline (placeholder): bookings, invoices, messages will appear here.
            </div>
            <div className="flex gap-2">
              <Button variant="secondary">Create Follow-up</Button>
              <Button>Open Profile</Button>
            </div>
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
