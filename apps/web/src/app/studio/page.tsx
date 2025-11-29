'use client';

import { Card, Shell } from "@keyflow/ui";

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
    <Shell
      sidebar={
        <div className="p-4 space-y-3 text-sm text-slate-200">
          <div className="uppercase text-xs tracking-[0.08em] text-slate-400 mb-2">Studio</div>
          <p className="text-[var(--kf-text-muted)] text-xs">Build mode. Select a module to edit.</p>
        </div>
      }
      topbar={
        <div className="rounded-2xl border border-[var(--kf-border)] bg-[rgba(0,0,0,0.25)] px-4 py-3 text-sm text-[var(--kf-text-muted)] shadow-glass">
          Modular, futuristic editing environment. Cards expand into workspace mode (settings / editor / preview).
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => (
          <Card key={m.name} title={m.name} badge="Flow Card">
            <p className="text-sm text-[var(--kf-text-muted)]">{m.desc}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.08em] text-[var(--kf-electric)]">Hover to pulse. Click to expand.</p>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
