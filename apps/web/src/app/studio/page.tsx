"use client";

import Link from "next/link";
import { Sparkles, Users, CreditCard, Calendar, Share2, Workflow, Activity, Settings } from "lucide-react";

const modules = [
  { label: "Identity", icon: Activity, href: "/app/identity", description: "Business profile, members, permissions" },
  { label: "CRM", icon: Users, href: "/app/crm", description: "Contacts, timelines, soft-delete safety" },
  { label: "Commerce", icon: CreditCard, href: "/app/commerce", description: "Products, invoices, payments" },
  { label: "Bookings", icon: Calendar, href: "/app/bookings", description: "Services, staff, public bookings" },
  { label: "Social", icon: Share2, href: "/app/social", description: "Posts, channels, scheduling" },
  { label: "Automations", icon: Workflow, href: "/app/automations", description: "Event-driven playbooks" },
  { label: "Studio Settings", icon: Settings, href: "/app/settings", description: "Billing, branding, domains" },
];

export default function StudioPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-3xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Studio</h1>
          <p className="text-sm text-muted-foreground">
            Build mode for KeyFlowOS. Jump into each module’s workspace to configure data and previews.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <Link
              key={mod.label}
              href={mod.href}
              className="group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-4 hover:border-primary/60 transition-colors shadow-[var(--kf-shadow)]"
            >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-gradient-to-br from-primary/10 via-transparent to-emerald-500/5 blur-3xl transition-opacity" />
          <div className="relative flex items-center gap-3">
            <span className="h-10 w-10 rounded-2xl bg-background border border-border/60 flex items-center justify-center text-primary">
              <Icon className="w-5 h-5" />
            </span>
                <div>
                  <div className="text-sm font-semibold">{mod.label}</div>
                  <div className="text-xs text-muted-foreground">{mod.description}</div>
                </div>
              </div>
              <div className="relative mt-4 rounded-2xl border border-border/60 bg-background p-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-primary">
                  <Sparkles className="w-3 h-3" /> Workspace
                </div>
                <p className="mt-2">
                  Configure data sources, preview UI, and connect automations. Click to open the module workspace.
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="rounded-3xl border border-border/60 bg-card p-4 space-y-3 shadow-[var(--kf-shadow)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Blueprint Mode</div>
            <p className="text-sm text-muted-foreground">Prisma graph preview of your business objects.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/60 bg-primary/10 px-3 py-1 text-[11px] text-primary">
            Coming Soon
          </span>
        </div>
        <div className="rounded-2xl border border-dashed border-border/60 bg-background p-4">
          <div className="text-xs text-muted-foreground mb-2">Graph: Business → Contacts → Invoices → Bookings</div>
          <div className="grid grid-cols-4 gap-3 text-[11px] text-muted-foreground">
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <div className="text-primary font-semibold">Business</div>
              <div>Contacts, Products, Invoices</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <div className="text-primary font-semibold">Contacts</div>
              <div>Invoices, Bookings</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <div className="text-primary font-semibold">Invoices</div>
              <div>Items, Payments, Booking</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-3">
              <div className="text-primary font-semibold">Bookings</div>
              <div>Service, Staff, Contact</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
