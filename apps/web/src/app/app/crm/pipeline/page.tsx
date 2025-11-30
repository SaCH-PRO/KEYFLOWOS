"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "@keyflow/ui";
import { Contact, fetchContacts, updateContact } from "@/lib/client";

const STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"] as const;

export default function PipelinePage() {
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await fetchContacts();
      setContacts(data ?? []);
    };
    void load();
  }, []);

  async function move(contactId: string, status: string) {
    await updateContact({ contactId, status });
    setContacts((prev) => prev.map((c) => (c.id === contactId ? { ...c, status } : c)));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">CRM Pipeline</h1>
        <p className="text-sm text-muted-foreground">Drag-free quick view; click buttons to move stages.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {STATUSES.map((status) => (
          <div key={status} className="rounded-2xl border border-border/60 bg-slate-950/60 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{status}</div>
              <Badge variant="outline">{contacts.filter((c) => (c.status ?? "LEAD") === status).length}</Badge>
            </div>
            <div className="space-y-2">
              {contacts
                .filter((c) => (c.status ?? "LEAD") === status)
                .map((c) => (
                  <div key={c.id} className="rounded-xl border border-border/50 bg-slate-900/70 p-2 space-y-1">
                    <div className="text-sm font-semibold">
                      {`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unnamed"}
                    </div>
                    <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                    <div className="flex flex-wrap gap-1">
                      {STATUSES.map((s) =>
                        s === status ? null : (
                          <Button key={s} size="xs" variant="outline" onClick={() => void move(c.id, s)}>
                            → {s}
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
    </div>
  );
}
