"use client";

import { Card } from "@keyflow/ui";

const modules = [
  { name: "Identity", desc: "Manage business identities and owners." },
  { name: "CRM", desc: "Contacts, segments, and relationship intelligence." },
  { name: "Commerce", desc: "Quotes, invoices, and payments." },
  { name: "Bookings", desc: "Services, staff, and public booking links." },
  { name: "Social", desc: "Posts and channel connections." },
  { name: "Automation", desc: "Flows and triggers." },
  { name: "Presence", desc: "Sites and public pages." },
  { name: "Projects", desc: "Templates and tasks." },
];

export default function StudioPage() {
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Studio</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Modular, futuristic editing environment. Cards expand into workspace mode.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => (
          <Card key={m.name} title={m.name} badge="Flow Card">
            <p className="text-sm text-[var(--kf-text-muted)]">{m.desc}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.08em] text-[var(--kf-electric)]">
              Hover to pulse. Click to expand.
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
