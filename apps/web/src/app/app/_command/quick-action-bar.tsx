"use client";

import Link from "next/link";
import { FileText, Calendar, UserPlus, Send, Share2 } from "lucide-react";

const actions: { label: string; icon: React.ComponentType<{ className?: string }>; href: string; accent?: boolean }[] = [
  { label: "New Invoice", icon: FileText, href: "/app/commerce?action=new-invoice" },
  { label: "New Booking", icon: Calendar, href: "/app/bookings?action=new" },
  { label: "New Contact", icon: UserPlus, href: "/app/crm/pipeline?action=new" },
  { label: "New Campaign", icon: Send, href: "/app/marketing?tab=campaigns&action=new" },
  { label: "Share Link", icon: Share2, href: "/app/bookings?action=share", accent: true },
];

export function QuickActionBar() {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {actions.map((a) => (
        <Link
          key={a.label}
          href={a.href}
          className="flex items-center gap-1.5 px-3 min-h-[44px] kf-radius-md text-xs font-medium transition-all hover:scale-[1.03]"
          style={{
            background: a.accent
              ? "hsl(var(--kf-accent2) / 0.1)"
              : "hsl(var(--kf-accent1) / 0.08)",
            border: a.accent
              ? "1px solid hsl(var(--kf-accent2) / 0.2)"
              : "1px solid hsl(var(--kf-accent1) / 0.15)",
            color: a.accent
              ? "hsl(var(--kf-accent2))"
              : "hsl(var(--kf-accent1))",
          }}
        >
          <a.icon className="w-3 h-3" />
          <span className="hidden sm:inline">{a.label}</span>
          <span className="sm:hidden">{a.accent ? <a.icon className="w-3 h-3" /> : "+"}</span>
        </Link>
      ))}
    </div>
  );
}
