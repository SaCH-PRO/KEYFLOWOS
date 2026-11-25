"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { ModuleLevels } from "@/lib/nav-config";
import { useBusinessSettings } from "@/lib/business-settings";
import { NewFromWhatsAppSheet, mayCaptureFromWhatsApp } from "@/components/whatsapp/new-from-whatsapp";

type MenuItem = {
  label: string;
  icon: typeof Users;
  shortcut?: string;
} & ({ href: string; action?: undefined } | { href?: undefined; action: "whatsapp" });

/**
 * The New menu: the header's New button, the phone bottom bar's New and ⌘N all open it (use-app-layout.ts addMenuOpen).
 *
 * WEDGE-WA-INBOUND-CAPTURE (D-263): From WhatsApp opens the New from WhatsApp sheet in place of the menu (the menu
 * stays mounted under it, so closing the sheet closes the menu). It is offered only to a member who may write
 * customers; their access unknown hides nothing (the server refuses a capture without crm write). The access is the
 * shell's own answer (useAppLayout's moduleLevels, handed down by AppHeader): opening the menu asks no my-access read,
 * and a member known to hold crm read never sees the door, not even while the menu opens (review COR-4).
 */
export function NewEntityMenu({ onClose, levels = null }: { onClose: () => void; levels?: ModuleLevels }) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
  const businessSettings = useBusinessSettings();
  const sells = businessSettings.status === "ready" ? businessSettings.sells : null;
  const offerWhatsApp = mayCaptureFromWhatsApp(levels);
  const items = useMemo<MenuItem[]>(() => {
    const base: MenuItem[] = [
      // ?action=new opens the contacts page's quick-add form; the bare list
      // route made "+ Contact" a link to a list.
      { label: "Contact", icon: Users, href: "/app/crm/contacts?action=new", shortcut: "⌘⇧C" },
      { label: "Invoice", icon: Receipt, href: "/app/commerce/invoices/new", shortcut: "⌘⇧I" },
      { label: "Quote", icon: FileText, href: "/app/commerce?tab=quotes" },
      { label: "Event", icon: Calendar, href: "/app/events/new", shortcut: "⌘⇧E" },
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
    // Next to Contact: a customer who wrote on WhatsApp.
    if (offerWhatsApp) base.splice(1, 0, { label: "From WhatsApp", icon: MessageCircle, action: "whatsapp" });
    return base;
  }, [offerWhatsApp]);

  const choose = useCallback(
    (item: MenuItem) => {
      if (item.action === "whatsapp") {
        setWhatsAppOpen(true);
        return;
      }
      router.push(item.href);
      onClose();
    },
    [onClose, router],
  );

  useEffect(() => {
    // The sheet is a form: its keys (arrows, Enter in the message) are not the menu's.
    if (whatsAppOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && focusIdx >= 0 && items[focusIdx]) {
        e.preventDefault();
        choose(items[focusIdx]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusIdx, items, choose, whatsAppOpen]);

  useEffect(() => {
    if (focusIdx >= 0) {
      const el = menuRef.current?.querySelector(`[data-menu-idx="${focusIdx}"]`) as HTMLElement | null;
      el?.focus();
    }
  }, [focusIdx]);

  // Mounted with the menu, closed, so it is laid out for this screen's width before it opens (new-from-whatsapp.tsx).
  const whatsAppSheet =
    offerWhatsApp || whatsAppOpen ? (
      <NewFromWhatsAppSheet open={whatsAppOpen} onClose={onClose} levels={levels} sells={sells} />
    ) : null;

  const rowClass = (idx: number) =>
    cn(
      "flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-muted transition-colors",
      focusIdx === idx && "bg-muted",
    );

  // The sheet keeps its place in the tree as it opens (a remount would lose its laid-out width); the menu gives way.
  return (
    <>
      {whatsAppSheet}
      {!whatsAppOpen && <div className="fixed inset-0 z-40" onClick={onClose} />}
      {!whatsAppOpen && (
        <div ref={menuRef} className="absolute right-0 mt-1.5 w-56 kf-glass-surface p-1.5 z-50 max-h-[70vh] overflow-y-auto" role="menu">
          {items.map((action, idx) => {
            const ActionIcon = action.icon;
            if (action.action === "whatsapp") {
              return (
                <button
                  key={action.label}
                  type="button"
                  data-menu-idx={idx}
                  onClick={() => choose(action)}
                  role="menuitem"
                  className={cn(rowClass(idx), "w-full text-left")}
                >
                  <div className="flex items-center gap-2.5">
                    <ActionIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span className="text-[13px]">{action.label}</span>
                  </div>
                </button>
              );
            }
            return (
              <Link
                key={action.label}
                href={action.href}
                data-menu-idx={idx}
                onClick={onClose}
                role="menuitem"
                className={rowClass(idx)}
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
      )}
    </>
  );
}
