"use client";

import { Table, Drawer, Button } from "@keyflow/ui";
import { useState } from "react";

const contacts = [
  ["Sarah Smith", "sarah@example.com", "Customer"],
  ["John Doe", "john@example.com", "Lead"],
  ["Amira Khan", "amira@example.com", "Customer"],
  ["Luis Ortega", "luis@example.com", "Lead"],
];

export default function CrmPage() {
  const [selected, setSelected] = useState<string[] | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">CRM</h1>
        <p className="text-sm text-muted-foreground">Contacts, segments, and relationship intelligence.</p>
      </div>
      <div className="rounded-2xl border border-border/60 bg-slate-950/50 p-3 space-y-2 text-xs text-muted-foreground">
        Select a row to open the drawer. Actions: create follow-up, view timeline.
      </div>
      <Table
        headers={["Name", "Email", "Status", "Actions"]}
        rows={contacts.map((row) => [
          row[0],
          row[1],
          row[2],
          <Button key={row[0]} variant="outline" onClick={() => setSelected(row)}>
            View
          </Button>,
        ])}
      />
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected[0] : ""}
      >
        {selected && (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Email: {selected[1]}</div>
            <div className="text-sm text-muted-foreground">Status: {selected[2]}</div>
            <div className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-xs text-muted-foreground">
              Timeline (placeholder): bookings, invoices, messages will appear here.
            </div>
            <div className="flex gap-2">
              <Button variant="secondary">Create Follow-up</Button>
              <Button>Open Profile</Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
