"use client";

import Link from "next/link";
import { FileText, Calendar, UserPlus, Send } from "lucide-react";

const actions = [
  { label: "New Invoice", icon: FileText, href: "/app/commerce?action=new-invoice" },
  { label: "New Booking", icon: Calendar, href: "/app/bookings?action=new" },
  { label: "New Contact", icon: UserPlus, href: "/app/crm/pipeline?action=new" },
  { label: "New Campaign", icon: Send, href: "/app/marketing?tab=campaigns&action=new" },
];

export function QuickActionBar() {
  return (
    <div className="flex items-center gap-2">
      {actions.map((a) => (
        <Link
          key={a.label}
          href={a.href}
          className="flex items-center gap-1.5 px-3 min-h-[44px] kf-radius-md text-xs font-medium transition-all hover:scale-[1.03]"
          style={{
            background: "hsl(var(--kf-accent1) / 0.08)",
            border: "1px solid hsl(var(--kf-accent1) / 0.15)",
            color: "hsl(var(--kf-accent1))",
          }}
        >
          <a.icon className="w-3 h-3" />
          <span className="hidden sm:inline">{a.label}</span>
          <span className="sm:hidden">+</span>
        </Link>
      ))}
    </div>
  );
}
