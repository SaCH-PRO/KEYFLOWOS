"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Plus, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { bottomBarFor, hubNav, isHubActive, isHubPage, type HubNavItem } from "@/lib/nav-config";
import {
  ModuleLauncherSheet,
  type ModuleLauncherSection,
  type ModuleLauncherItem,
} from "@/components/ui/module-launcher-sheet";
import type { NavItem, NavSection } from "@/lib/nav-config";
import { navItemsForOperationsAccess, sectionsForOperationsAccess, useOperationsAccess } from "./operations-nav";

interface MobileBottomNavV2Props {
  pathname: string;
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifOpen: boolean;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  unreadCount: number;
  /** The header's New menu (the bar's New opens it). */
  addMenuOpen?: boolean;
  setAddMenuOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  /** The two hub slots (NAV-A1: use-app-layout's bottomBarFor, by what the business sells and what the member may open). */
  bottomBarHubs?: HubNavItem[];
  visibleOperateSections?: NavSection[];
  visibleBuildSections?: NavSection[];
  visibleMoreNav?: NavItem[];
}

function sectionToLauncher(
  section: NavSection,
  tone: ModuleLauncherItem["tone"],
): ModuleLauncherSection {
  return {
    id: section.id,
    label: section.label,
    items: section.items.map((item) => ({
      id: `${section.id}-${item.label}`,
      label: item.label,
      icon: item.icon,
      href: item.href,
      tone,
    })),
  };
}

/** Every hub, as for a business that sells both, when the shell passes no slots (an unknown answer hides nothing). */
const DEFAULT_SLOTS = bottomBarFor("both", null);

const TODAY = hubNav.find((h) => h.id === "today")!;

function haptic(ms: number) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
}

const SLOT = "flex flex-col items-center justify-center min-w-[56px] min-h-[48px] px-1 py-1 transition-all active:scale-95 rounded-xl focus-ring";

/**
 * The phone's bottom bar (NAV-A1, D-150; intuitiveness principle 'The app fits what you sell'): Today, a hub, New,
 * a hub, More. services: Schedule and Customers; products: Sales and Customers; both: Schedule and Sales. A hub the
 * member may not open gives its slot to the next they may (bottomBarFor). New opens the header's New menu; More
 * opens the navigation drawer, which holds every hub and screen the member may open.
 */
export function MobileBottomNavV2({
  pathname,
  mobileDrawerOpen,
  setMobileDrawerOpen,
  addMenuOpen = false,
  setAddMenuOpen,
  bottomBarHubs = DEFAULT_SLOTS,
  visibleOperateSections: operateSectionsIn = [],
  visibleBuildSections: buildSectionsIn = [],
  visibleMoreNav: moreNavIn = [],
}: MobileBottomNavV2Props) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  // W7-WEB-OPS-SCOPE (D-40): the launcher lists no Purchasing entry for a member the server refuses operations.
  const operationsAccess = useOperationsAccess();
  const visibleOperateSections = sectionsForOperationsAccess(operateSectionsIn, operationsAccess);
  const visibleBuildSections = sectionsForOperationsAccess(buildSectionsIn, operationsAccess);
  const visibleMoreNav = navItemsForOperationsAccess(moreNavIn, operationsAccess);

  // The module launcher still opens from its gesture and its shortcut (kf:open-module-launcher).
  useEffect(() => {
    const handler = () => setLauncherOpen(true);
    window.addEventListener("kf:open-module-launcher", handler);
    return () => window.removeEventListener("kf:open-module-launcher", handler);
  }, []);

  const launcherSections = useMemo<ModuleLauncherSection[]>(() => {
    const more: ModuleLauncherSection | null =
      visibleMoreNav.length > 0
        ? {
            id: "more",
            label: "More",
            items: visibleMoreNav.map((item) => ({
              id: `more-${item.label}`,
              label: item.label,
              icon: item.icon,
              href: item.href,
              tone: "default" as const,
            })),
          }
        : null;

    return [
      ...visibleOperateSections.map((s) => sectionToLauncher(s, "primary")),
      ...visibleBuildSections.map((s) => sectionToLauncher(s, "teal")),
      ...(more ? [more] : []),
    ];
  }, [visibleOperateSections, visibleBuildSections, visibleMoreNav]);

  const hubLink = (hub: HubNavItem) => {
    const Icon = hub.icon;
    const active = isHubActive(hub, pathname);
    // "page" on the hub's own page; "true" anywhere else inside the hub (review COR-4).
    const current = active ? (isHubPage(hub, pathname) ? "page" : "true") : undefined;
    return (
      <Link
        key={hub.id}
        href={hub.href}
        aria-label={hub.label}
        aria-current={current}
        onClick={() => haptic(8)}
        className={cn(SLOT, active ? "text-primary bg-primary/5" : "text-muted-foreground hover:bg-muted")}
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
        <span className="text-[11px] leading-tight mt-0.5 font-medium whitespace-nowrap">{hub.label}</span>
      </Link>
    );
  };

  const [first, second] = bottomBarHubs;

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-[var(--kf-z-chrome)] max-w-[calc(100vw-16px)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.2 }}
          className="surface-glass flex items-center gap-1 px-2 py-1.5 rounded-full shadow-2xl border border-border/60"
        >
          {hubLink(TODAY)}
          {first && hubLink(first)}
          <button
            type="button"
            onClick={() => {
              haptic(12);
              setAddMenuOpen?.((open) => !open);
            }}
            aria-label="New"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            className="relative flex items-center justify-center w-12 h-12 rounded-full text-white focus-ring shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
              boxShadow: "0 4px 16px hsl(var(--kf-accent1) / 0.35)",
            }}
          >
            <Plus className="w-6 h-6" aria-hidden="true" />
          </button>
          {second && hubLink(second)}
          <button
            type="button"
            onClick={() => {
              haptic(12);
              setMobileDrawerOpen(true);
            }}
            aria-label="More"
            aria-haspopup="dialog"
            aria-expanded={mobileDrawerOpen}
            className={cn(SLOT, mobileDrawerOpen ? "text-primary" : "text-muted-foreground hover:bg-muted")}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] leading-tight mt-0.5 font-medium">More</span>
          </button>
        </motion.div>
      </nav>

      <ModuleLauncherSheet
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        title="Module Launcher"
        subtitle="Jump to any part of your business"
        sections={launcherSections}
      />
    </>
  );
}
