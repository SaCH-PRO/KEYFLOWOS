"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Shield,
  Sparkles,
  X,
  Lock,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { primaryNav } from "@/lib/nav-config";
import type { NavItem, NavSection, PrimaryNavItem, DrawerSurface } from "@/lib/nav-config";

interface DesktopSidebarProps {
  drawerSurface: DrawerSurface;
  setDrawerSurface: React.Dispatch<React.SetStateAction<DrawerSurface>>;
  isPrimaryActive: (item: PrimaryNavItem) => boolean;
  visibleOperateSections: NavSection[];
  visibleBuildSections: NavSection[];
  visibleMoreNav: NavItem[];
  meNav: NavItem[];
  isSecondaryActive: (item: NavItem) => boolean;
  isFeatureLocked: (item: NavItem) => boolean;
  connectorAlertCount: number;
  isAdminUser: boolean;
  setKfStoreOpen: (v: boolean) => void;
}

/* ─── Flow Connector SVG ─── */
function FlowConnector({ active }: { active: boolean }) {
  return (
    <svg
      className={cn("absolute -right-[1px] top-1/2 -translate-y-1/2 w-3 h-8 transition-opacity duration-300", active ? "opacity-100" : "opacity-0")}
      viewBox="0 0 12 32"
      fill="none"
    >
      <path
        d="M0 16 Q6 12, 12 8"
        stroke="url(#flowLine)"
        strokeWidth="1.5"
        fill="none"
        className={active ? "animate-flow-line" : ""}
      />
      <path
        d="M0 16 Q6 20, 12 24"
        stroke="url(#flowLine)"
        strokeWidth="1.5"
        fill="none"
        className={active ? "animate-flow-line" : ""}
        style={{ animationDelay: "0.5s" }}
      />
      <defs>
        <linearGradient id="flowLine" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--kf-accent1))" />
          <stop offset="100%" stopColor="hsl(var(--kf-accent2))" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ─── Rail Active Indicator ─── */
function RailIndicator({ active }: { active: boolean }) {
  return (
    <motion.div
      layoutId="rail-indicator"
      className={cn(
        "absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full",
        active ? "opacity-100" : "opacity-0"
      )}
      style={{
        background: "linear-gradient(180deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
        boxShadow: "0 0 8px hsl(var(--kf-accent1) / 0.5)",
      }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    />
  );
}

function DrawerSection({
  section,
  isSecondaryActive,
  isFeatureLocked,
  connectorAlertCount,
}: {
  section: NavSection;
  isSecondaryActive: (item: NavItem) => boolean;
  isFeatureLocked: (item: NavItem) => boolean;
  connectorAlertCount: number;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 px-2 mb-1.5">
        <div className="w-3 h-[2px] rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent2))] to-transparent" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {section.label}
        </span>
      </div>
      <div className="flex flex-col gap-px">
        {section.items.map((item) => {
          const Icon = item.icon;
          const active = isSecondaryActive(item);
          const showConnectorBadge =
            item.href === "/app/key-connect" && connectorAlertCount > 0;
          const isLocked = isFeatureLocked(item);
          if (isLocked) {
            return (
              <button
                key={item.href + item.label}
                type="button"
                aria-disabled="true"
                title="Unlock with upgrade"
                onClick={(e) => e.preventDefault()}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground/40 cursor-not-allowed opacity-50 hover:opacity-70 transition-opacity group"
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.label}</span>
                <Lock className="w-3 h-3 ml-auto text-muted-foreground/40" />
              </button>
            );
          }
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all relative group",
                active
                  ? "bg-gradient-to-r from-[hsl(var(--kf-accent1))]/8 to-[hsl(var(--kf-accent2))]/4 text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              {active && (
                <div
                  className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-r-full"
                  style={{
                    background: "linear-gradient(180deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    boxShadow: "0 0 6px hsl(var(--kf-accent1) / 0.4)",
                  }}
                />
              )}
              <Icon className={cn("w-4 h-4 flex-shrink-0 transition-transform group-hover:scale-110", active && "text-[hsl(var(--kf-accent1))]")} />
              <span>{item.label}</span>
              {showConnectorBadge && (
                <span
                  className="ml-auto h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white animate-slow-pulse"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                  title={`${connectorAlertCount} connector${connectorAlertCount === 1 ? "" : "s"} need${connectorAlertCount === 1 ? "s" : ""} attention`}
                  aria-label={`${connectorAlertCount} connectors need attention`}
                >
                  {connectorAlertCount > 9 ? "9+" : connectorAlertCount}
                </span>
              )}
              {active && !showConnectorBadge && (
                <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground/40" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function MeDrawer({
  meNav,
  isSecondaryActive,
  onClose,
}: {
  meNav: NavItem[];
  isSecondaryActive: (item: NavItem) => boolean;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -20, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="w-[220px] border-r border-border h-full flex flex-col overflow-hidden"
      style={{ background: "hsl(var(--kf-sidebar-bg) / 0.85)" }}
    >
      <div className="px-3 py-3 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent1))]" />
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Me
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Close menu"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        <div className="flex flex-col gap-px">
          {meNav.map((item) => {
            const Icon = item.icon;
            const active = isSecondaryActive(item);
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all relative",
                  active
                    ? "bg-gradient-to-r from-[hsl(var(--kf-accent1))]/8 to-[hsl(var(--kf-accent2))]/4 text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                {active && (
                  <div
                    className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-r-full"
                    style={{
                      background: "linear-gradient(180deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    }}
                  />
                )}
                <Icon className={cn("w-4 h-4 flex-shrink-0", active && "text-[hsl(var(--kf-accent1))]")} />
                <span>{item.label}</span>
                {active && (
                  <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground/40" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

export function DesktopSidebar({
  drawerSurface,
  setDrawerSurface,
  isPrimaryActive,
  visibleOperateSections,
  visibleBuildSections,
  visibleMoreNav,
  meNav,
  isSecondaryActive,
  isFeatureLocked,
  connectorAlertCount,
  isAdminUser,
  setKfStoreOpen,
}: DesktopSidebarProps) {
  const [moreExpanded, setMoreExpanded] = useState(false);

  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      className="hidden md:flex h-full"
    >
      {/* ─── Primary Rail ─── */}
      <div
        className="w-14 flex flex-col items-center border-r border-border h-full py-3 gap-1 flex-shrink-0 relative"
        style={{ background: "hsl(var(--kf-sidebar-bg))" }}
      >
        {/* KEY Home Button */}
        <Link
          href="/app/keyflow-command"
          className="h-11 w-11 min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center flex-shrink-0 mb-3 relative group"
          style={{
            background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
            boxShadow: "0 4px 16px hsl(var(--kf-accent1) / 0.3)",
          }}
          title="KEYFLOW — Command Center"
        >
          <Sparkles className="w-5 h-5 text-white drop-shadow-md" />
          <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/10 transition-colors" />
        </Link>

        {/* Divider with flow accent */}
        <div className="w-8 h-[1px] bg-gradient-to-r from-transparent via-border to-transparent mb-1" />

        {primaryNav.map((item) => {
          const Icon = item.icon;
          const isActive = isPrimaryActive(item);
          const isSurface = !item.href;
          const surfaceId = item.id as string;
          const isSurfaceOpen = drawerSurface === surfaceId;

          if (isSurface) {
            return (
              <button
                key={item.label}
                onClick={() => setDrawerSurface(prev => (prev === surfaceId ? null : surfaceId as DrawerSurface))}
                className={cn(
                  "w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center transition-all relative group",
                  isSurfaceOpen
                    ? "text-foreground bg-gradient-to-br from-muted/60 to-muted/30 shadow-inner"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
                title={item.label}
                aria-label={item.label}
                aria-expanded={isSurfaceOpen}
              >
                <RailIndicator active={isSurfaceOpen} />
                <FlowConnector active={isSurfaceOpen} />
                <Icon className="w-[18px] h-[18px] transition-transform group-hover:scale-110" />
              </button>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href ?? "#"}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all relative group",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
              title={item.label}
              aria-label={item.label}
              onClick={() => setDrawerSurface(null)}
            >
              <RailIndicator active={isActive} />
              <Icon className="w-[18px] h-[18px] transition-transform group-hover:scale-110" />
            </Link>
          );
        })}

        <div className="mt-auto flex flex-col items-center gap-1 pt-2">
          {/* Divider */}
          <div className="w-8 h-[1px] bg-gradient-to-r from-transparent via-border to-transparent mb-1" />
          
          {isAdminUser && (
            <Link
              href="/admin"
              className="w-10 h-10 min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all relative group"
              title="Owner Console"
            >
              <Shield className="w-[18px] h-[18px] transition-transform group-hover:scale-110" />
            </Link>
          )}
          <button
            onClick={() => setKfStoreOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all relative group"
            title="KF Store"
          >
            <div
              className="w-[20px] h-[20px] rounded-md flex items-center justify-center transition-transform group-hover:scale-110"
              style={{ background: "linear-gradient(135deg, #F97316, #14B8A6)" }}
            >
              <Sparkles className="w-2.5 h-2.5 text-white" />
            </div>
          </button>
          <ThemeToggle />
        </div>
      </div>

      {/* ─── ME DRAWER ─── */}
      <AnimatePresence>
        {drawerSurface === "me" && (
          <MeDrawer
            meNav={meNav}
            isSecondaryActive={isSecondaryActive}
            onClose={() => setDrawerSurface(null)}
          />
        )}
      </AnimatePresence>

      {/* ─── OPERATE / BUILD DRAWER ─── */}
      <AnimatePresence>
        {(drawerSurface === "operate" || drawerSurface === "build") && (
          <motion.div
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="w-[220px] border-r border-border h-full flex flex-col overflow-hidden"
            style={{ background: "hsl(var(--kf-sidebar-bg) / 0.85)" }}
          >
            {/* Header with flow line */}
            <div className="px-3 py-3 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent1))]" />
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {drawerSurface === "operate" ? "Operate" : "Build"}
                </h2>
              </div>
              <button
                onClick={() => setDrawerSurface(null)}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto py-2 px-1.5">
              {drawerSurface === "operate" && visibleOperateSections.map((section) => (
                <DrawerSection
                  key={section.id}
                  section={section}
                  isSecondaryActive={isSecondaryActive}
                  isFeatureLocked={isFeatureLocked}
                  connectorAlertCount={connectorAlertCount}
                />
              ))}

              {drawerSurface === "build" && (
                <>
                  {visibleBuildSections.map((section) => (
                    <DrawerSection
                      key={section.id}
                      section={section}
                      isSecondaryActive={isSecondaryActive}
                      isFeatureLocked={isFeatureLocked}
                      connectorAlertCount={connectorAlertCount}
                    />
                  ))}

                  {/* More — collapsible dormant modules */}
                  {visibleMoreNav.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/40">
                      <button
                        onClick={() => setMoreExpanded((v) => !v)}
                        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                      >
                        <span>More</span>
                        <ChevronDown
                          className={cn(
                            "w-3 h-3 transition-transform",
                            moreExpanded && "rotate-180"
                          )}
                        />
                      </button>
                      <AnimatePresence>
                        {moreExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="flex flex-col gap-px mt-1">
                              {visibleMoreNav.map((item) => {
                                const Icon = item.icon;
                                const active = isSecondaryActive(item);
                                return (
                                  <Link
                                    key={item.href + item.label}
                                    href={item.href}
                                    className={cn(
                                      "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all opacity-70 hover:opacity-100",
                                      active
                                        ? "bg-gradient-to-r from-[hsl(var(--kf-accent1))]/8 to-[hsl(var(--kf-accent2))]/4 text-foreground font-medium opacity-100"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                    )}
                                  >
                                    <Icon className="w-4 h-4 flex-shrink-0" />
                                    <span>{item.label}</span>
                                  </Link>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}
