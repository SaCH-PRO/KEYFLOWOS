"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { mobileBottomNav } from "@/lib/nav-config";
import {
  ModuleLauncherSheet,
  type ModuleLauncherSection,
  type ModuleLauncherItem,
} from "@/components/ui/module-launcher-sheet";
import type { NavItem, NavSection } from "@/lib/nav-config";

interface MobileBottomNavV2Props {
  pathname: string;
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifOpen: boolean;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  unreadCount: number;
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

export function MobileBottomNavV2({
  pathname,
  mobileDrawerOpen,
  setMobileDrawerOpen,
  unreadCount,
  visibleOperateSections = [],
  visibleBuildSections = [],
  visibleMoreNav = [],
}: MobileBottomNavV2Props) {
  const [launcherOpen, setLauncherOpen] = useState(false);

  const openLauncher = () => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(12);
    }
    setLauncherOpen(true);
  };

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

  return (
    <>
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-50"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.2 }}
          className="surface-glass flex items-center gap-1 px-2 py-2 rounded-full shadow-2xl border border-border/60"
        >
          {mobileBottomNav.map((item) => {
            const Icon = item.icon;

            if (item.href === "#key") {
              return (
                <motion.button
                  key={item.href}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(12);
                    window.dispatchEvent(
                      new CustomEvent("kf:open-key", { detail: { mode: "chat" } }),
                    );
                  }}
                  className="relative flex items-center justify-center w-13 h-13 -mt-4 rounded-full focus-ring"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    boxShadow: "0 4px 20px hsl(var(--kf-accent1) / 0.4), 0 0 0 4px hsl(var(--kf-card))",
                  }}
                  aria-label="Talk to AI"
                >
                  {/* Orbiting ring */}
                  <div
                    className="absolute inset-[-4px] rounded-full animate-spin"
                    style={{
                      background:
                        "conic-gradient(from 0deg, transparent 0%, hsl(var(--kf-accent1) / 0.6) 25%, transparent 50%, hsl(var(--kf-accent2) / 0.6) 75%, transparent 100%)",
                      mask: "radial-gradient(circle, transparent 62%, black 63%)",
                      WebkitMask: "radial-gradient(circle, transparent 62%, black 63%)",
                      animationDuration: "4s",
                    }}
                  />
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background:
                        "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    }}
                  />
                  <Sparkles className="w-6 h-6 text-white drop-shadow-lg relative z-10" />
                  <div className="absolute inset-0 rounded-full animate-ping bg-primary/20 opacity-0 hover:opacity-100" />
                </motion.button>
              );
            }

            if (item.href === "#flows") {
              return (
                <button
                  key={item.href}
                  onClick={openLauncher}
                  className={cn(
                    "flex flex-col items-center justify-center min-w-[52px] min-h-[44px] py-1 transition-all active:scale-95 rounded-xl focus-ring",
                    launcherOpen ? "text-primary" : "text-muted-foreground hover:bg-muted",
                  )}
                  aria-label={item.label}
                >
                  <Icon className="w-[18px] h-[18px]" />
                  <span className="text-[9px] mt-0.5 font-medium">{item.label}</span>
                </button>
              );
            }

            if (item.href === "#me") {
              return (
                <button
                  key={item.href}
                  onClick={() => {
                    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(12);
                    setMobileDrawerOpen(true);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center min-w-[52px] min-h-[44px] py-1 transition-all active:scale-95 rounded-xl focus-ring",
                    mobileDrawerOpen ? "text-primary" : "text-muted-foreground hover:bg-muted",
                  )}
                  aria-label={item.label}
                >
                  <Icon className="w-[18px] h-[18px]" />
                  <span className="text-[9px] mt-0.5 font-medium">{item.label}</span>
                </button>
              );
            }

            const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(8);
                }}
                className={cn(
                  "flex flex-col items-center justify-center min-w-[52px] min-h-[44px] py-1 transition-all active:scale-95 rounded-xl focus-ring",
                  active ? "text-primary bg-primary/5" : "text-muted-foreground hover:bg-muted",
                )}
              >
                <div className="relative">
                  <Icon className="w-[18px] h-[18px]" />
                  {item.showUnreadBadge && unreadCount > 0 && (
                    <span className="absolute -top-1 -right-2 h-3.5 min-w-[14px] px-0.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white bg-gradient-to-r from-primary to-secondary">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </div>
                <span className="text-[9px] mt-0.5 font-medium">{item.label}</span>
              </Link>
            );
          })}
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
