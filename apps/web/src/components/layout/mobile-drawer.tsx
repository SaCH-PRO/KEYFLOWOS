"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  X,
  ChevronDown,
  Lock,
  Shield,
  Sparkles,
  LogOut,
} from "lucide-react";
import type { NavItem, NavSection } from "@/lib/nav-config";

interface MobileDrawerProps {
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pathname: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  visibleOperateSections: NavSection[];
  visibleBuildSections: NavSection[];
  visibleMoreNav: NavItem[];
  meNav: NavItem[];
  isSecondaryActive: (item: NavItem) => boolean;
  isFeatureLocked: (item: NavItem) => boolean;
  connectorAlertCount: number;
  isAdminUser: boolean;
  setKfStoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleLogout: () => void;
}

function MobileSection({
  section,
  isSecondaryActive,
  isFeatureLocked,
  connectorAlertCount,
  onNavigate,
}: {
  section: NavSection;
  isSecondaryActive: (item: NavItem) => boolean;
  isFeatureLocked: (item: NavItem) => boolean;
  connectorAlertCount: number;
  onNavigate: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mt-2"
    >
      <div className="flex items-center gap-2 px-2 mb-1">
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
            item.href === "/app/build/connect" && connectorAlertCount > 0;
          const isLocked = isFeatureLocked(item);
          if (isLocked) {
            return (
              <button
                key={item.href + item.label}
                type="button"
                aria-disabled="true"
                title="Unlock with upgrade"
                onClick={(e) => e.preventDefault()}
                className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] text-muted-foreground/40 cursor-not-allowed opacity-50"
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                <span>{item.label}</span>
                <Lock className="w-3 h-3 ml-auto text-muted-foreground/40" />
              </button>
            );
          }
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] transition-all relative active:scale-[0.98]",
                active
                  ? "bg-gradient-to-r from-[hsl(var(--kf-accent1))]/8 to-[hsl(var(--kf-accent2))]/4 text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              {active && (
                <div
                  className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full"
                  style={{
                    background: "linear-gradient(180deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                  }}
                />
              )}
              <Icon className={cn("w-[18px] h-[18px] flex-shrink-0", active && "text-[hsl(var(--kf-accent1))]")} />
              <span>{item.label}</span>
              {showConnectorBadge && (
                <span
                  className="ml-auto h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white animate-slow-pulse"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                  aria-label={`${connectorAlertCount} connectors need attention`}
                >
                  {connectorAlertCount > 9 ? "9+" : connectorAlertCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </motion.div>
  );
}

export function MobileDrawer({
  mobileDrawerOpen,
  setMobileDrawerOpen,
  pathname,
  displayName,
  initials,
  avatarUrl,
  visibleOperateSections,
  visibleBuildSections,
  visibleMoreNav,
  meNav,
  isSecondaryActive,
  isFeatureLocked,
  connectorAlertCount,
  isAdminUser,
  setKfStoreOpen,
  handleLogout,
}: MobileDrawerProps) {
  const [moreExpanded, setMoreExpanded] = useState(false);

  if (!mobileDrawerOpen) return null;

  const closeDrawer = () => setMobileDrawerOpen(false);

  return (
    <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Navigation menu">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeDrawer}
      />
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="absolute left-0 top-0 bottom-0 w-72 border-r border-border flex flex-col overflow-y-auto"
        role="navigation"
        aria-label="Main navigation"
        style={{ background: "hsl(var(--kf-sidebar-bg) / 0.95)" }}
      >
        {/* Header with KEY branding */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div
              className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                boxShadow: "0 2px 8px hsl(var(--kf-accent1) / 0.3)",
              }}
            >
              <Sparkles className="w-[18px] h-[18px] text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">KEYFLOWOS</h1>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Command Center</p>
            </div>
          </div>
          <button
            onClick={closeDrawer}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {displayName && (
          <Link
            href="/app/profile"
            onClick={closeDrawer}
            className="px-3 py-2.5 border-b border-border flex items-center gap-2.5 hover:bg-muted transition-colors min-h-[44px]"
          >
            {avatarUrl ? (
              <Image src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" width={28} height={28} unoptimized />
            ) : (
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0"
                style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
              >
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{displayName}</p>
              <p className="text-[10px] text-muted-foreground truncate">View profile</p>
            </div>
            <ChevronDown className="w-3 h-3 text-muted-foreground -rotate-90" />
          </Link>
        )}

        <div className="flex-1 py-2 px-2">
          {/* Cockpit link */}
          <Link
            href="/app/keyflow-command"
            onClick={closeDrawer}
            className={cn(
              "flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[13px] transition-all relative active:scale-[0.98] mb-2",
              (pathname === "/app" ||
                pathname.startsWith("/app/keyflow-command") ||
                pathname.startsWith("/app/control-tower")) &&
                "bg-gradient-to-r from-[hsl(var(--kf-accent1))]/8 to-[hsl(var(--kf-accent2))]/4 text-foreground font-medium"
            )}
          >
            {(pathname === "/app" ||
              pathname.startsWith("/app/keyflow-command") ||
              pathname.startsWith("/app/control-tower")) && (
              <div
                className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full"
                style={{
                  background: "linear-gradient(180deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                }}
              />
            )}
            <Sparkles className="w-[18px] h-[18px] text-white flex-shrink-0" />
            <span>Cockpit</span>
          </Link>

          {/* OPERATE */}
          <AnimatePresence>
            {visibleOperateSections.map((section, i) => (
              <motion.div
                key={section.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <MobileSection
                  section={section}
                  isSecondaryActive={isSecondaryActive}
                  isFeatureLocked={isFeatureLocked}
                  connectorAlertCount={connectorAlertCount}
                  onNavigate={closeDrawer}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* BUILD */}
          <AnimatePresence>
            {visibleBuildSections.map((section, i) => (
              <motion.div
                key={section.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: (visibleOperateSections.length + i) * 0.05 }}
              >
                <MobileSection
                  section={section}
                  isSecondaryActive={isSecondaryActive}
                  isFeatureLocked={isFeatureLocked}
                  connectorAlertCount={connectorAlertCount}
                  onNavigate={closeDrawer}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* MORE — dormant modules */}
          {visibleMoreNav.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setMoreExpanded((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-muted-foreground transition-colors w-full"
              >
                <div className="w-3 h-[2px] rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent2))] to-transparent" />
                <span>More</span>
                <ChevronDown
                  className={cn(
                    "w-3 h-3 ml-auto transition-transform",
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
                            onClick={closeDrawer}
                            className={cn(
                              "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all opacity-70 hover:opacity-100 active:scale-[0.98]",
                              active && "opacity-100 bg-gradient-to-r from-[hsl(var(--kf-accent1))]/8 to-[hsl(var(--kf-accent2))]/4 text-foreground font-medium"
                            )}
                          >
                            <Icon className="w-[18px] h-[18px] flex-shrink-0" />
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

          <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent my-2" />

          <button
            onClick={() => { closeDrawer(); setKfStoreOpen(true); }}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all active:scale-[0.98] w-full"
          >
            <div
              className="w-[18px] h-[18px] rounded flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #F97316, #14B8A6)" }}
            >
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <span>KF Store</span>
          </button>

          {isAdminUser && (
            <Link
              href="/admin"
              onClick={closeDrawer}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all active:scale-[0.98]"
            >
              <Shield className="w-[18px] h-[18px] flex-shrink-0" />
              <span>Owner Console</span>
            </Link>
          )}
        </div>

        <div className="mt-auto px-2 pb-4 space-y-1 border-t border-border pt-2">
          <div className="flex items-center justify-between px-2">
            <ThemeToggle />
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all w-full active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </div>
      </motion.div>
    </div>
  );
}
