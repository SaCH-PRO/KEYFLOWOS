"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Users,
  Receipt,
  FileText,
  Calendar,
  FolderKanban,
  Zap,
  Megaphone,
  MessageCircle,
} from "lucide-react";
import { featureFlags as dormantFeatureFlags } from "@/lib/feature-flags";

export function NewEntityMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const items = useMemo(() => {
    const base = [
      { label: "Contact", icon: Users, href: "/app/crm/pipeline", shortcut: "⌘⇧C" },
      { label: "Invoice", icon: Receipt, href: "/app/commerce/invoices/new", shortcut: "⌘⇧I" },
      { label: "Quote", icon: FileText, href: "/app/commerce?tab=quotes" },
      { label: "Booking", icon: Calendar, href: "/app/bookings", shortcut: "⌘⇧B" },
      { label: "Expense", icon: Receipt, href: "/app/expenses" },
      { label: "Project", icon: FolderKanban, href: "/app/projects" },
      { label: "Flow", icon: Zap, href: "/app/automations" },
    ];
    if (dormantFeatureFlags.contentScheduler) {
      base.splice(6, 0,
        { label: "Campaign", icon: Megaphone, href: "/app/marketing" },
        { label: "Post", icon: MessageCircle, href: "/app/marketing?tab=social" },
      );
    }
    return base;
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusIdx >= 0) {
        e.preventDefault();
        router.push(items[focusIdx].href);
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusIdx, items, onClose, router]);

  useEffect(() => {
    if (focusIdx >= 0) {
      const el = menuRef.current?.querySelector(`[data-menu-idx="${focusIdx}"]`) as HTMLElement | null;
      el?.focus();
    }
  }, [focusIdx]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={menuRef} className="absolute right-0 mt-1.5 w-56 kf-glass-surface p-1.5 z-50 max-h-[70vh] overflow-y-auto" role="menu">
        {items.map((action, idx) => {
          const ActionIcon = action.icon;
          return (
            <Link
              key={action.label}
              href={action.href}
              data-menu-idx={idx}
              onClick={onClose}
              role="menuitem"
              className={cn(
                "flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-muted transition-colors",
                focusIdx === idx && "bg-muted"
              )}
            >
              <div className="flex items-center gap-2.5">
                <ActionIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-[13px]">{action.label}</span>
              </div>
              {action.shortcut && (
                <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono text-muted-foreground">{action.shortcut}</kbd>
              )}
            </Link>
          );
        })}
      </div>
    </>
  );
}
