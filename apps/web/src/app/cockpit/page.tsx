'use client';

import { AchievementCapsule, Badge, Card, FlowFeed, FlowGraphPlaceholder, MomentumBar, Shell } from "@keyflow/ui";

const mockFeed = [
  { id: "1", icon: "💸", text: "Invoice #004 paid — confirming booking…", timestamp: "08:24", tone: "success" as const },
  { id: "2", icon: "🗓️", text: "Booking created for Sarah — 3:00 PM", timestamp: "08:21" },
  { id: "3", icon: "⚡", text: "Automation executed: Review Request Flow", timestamp: "08:18", tone: "info" as const },
];

export default function CockpitPage() {
  return (
    <Shell
      sidebar={
        <div className="p-4 space-y-3 text-sm text-slate-200">
          <div className="uppercase text-xs tracking-[0.08em] text-slate-400 mb-2">Keyflow Command</div>
          <div className="space-y-1">
            {["Flow Feed", "Live Graph", "Cmd+K", "Automations", "Billing"].map((item) => (
              <div
                key={item}
                className="cursor-pointer rounded-lg px-3 py-2 text-slate-100 hover:bg-[rgba(78,168,255,0.08)] hover:text-[var(--kf-electric)] transition-colors"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      }
      topbar={<MomentumBar value={0.62} streaks={["Follow-up streak 3d", "7 invoices confirmed"]} />}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <FlowGraphPlaceholder />
          <Card title="Kinetic Stats" badge="Dashboard">
            <div className="grid grid-cols-3 gap-3 text-sm text-[var(--kf-text)]">
              {[
                { label: "Leads", value: "32" },
                { label: "Bookings", value: "14" },
                { label: "Invoices Paid", value: "9" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-[rgba(78,168,255,0.2)] bg-[rgba(0,0,0,0.35)] p-3 shadow-[0_0_14px_rgba(78,168,255,0.12)]"
                >
                  <div className="text-xs uppercase tracking-[0.08em] text-[var(--kf-text-muted)]">{stat.label}</div>
                  <div className="text-2xl font-semibold text-[var(--kf-electric)]">{stat.value}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <FlowFeed items={mockFeed} />
          <Card title="Flow Momentum" badge="Achievements">
            <div className="space-y-2">
              <Badge tone="success">First Sale Completed</Badge>
              <Badge tone="info">Automation Executed</Badge>
              <AchievementCapsule
                title="🔥 Momentum Rising"
                description="10 bookings this week. Animations speed slightly increased."
              />
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
