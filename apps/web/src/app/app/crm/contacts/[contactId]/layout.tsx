"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  User,
  Clock,
  DollarSign,
  Calendar,
  FileText,
  CheckSquare,
  StickyNote,
  Sparkles,
  Lightbulb,
} from "lucide-react";

const TABS = [
  { id: "overview", label: "Overview", icon: User },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "money", label: "Money", icon: DollarSign },
  { id: "bookings", label: "Bookings", icon: Calendar },
  { id: "quotes-invoices", label: "Quotes & Invoices", icon: FileText },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "ai-insights", label: "AI Insights", icon: Sparkles },
  { id: "recommendations", label: "Recommendations", icon: Lightbulb },
];

export default function ContactDetailLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const contactId = params.contactId as string;
  const base = `/app/crm/contacts/${contactId}`;

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto border-b pb-1">
        {TABS.map((tab) => {
          const href = `${base}/${tab.id}`;
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.id}
              href={href}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
