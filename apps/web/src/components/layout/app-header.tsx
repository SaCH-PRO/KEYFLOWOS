"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { NewEntityMenu } from "./new-entity-menu";
import { MODE_LABELS, type DisclosureMode } from "@/lib/disclosure-mode";
import { getCachedUser } from "@/lib/workspace";
import { getNotificationIcon, getNotificationLink, relativeTime } from "@/lib/notifications";
import type { AppNotification } from "@/lib/notifications";
import {
  Menu,
  Brain,
  Search,
  ChevronDown,
  Plus,
  Bell,
  X,
  User,
  Settings,
  Shield,
  LogOut,
  Calculator,
  Radio,
} from "lucide-react";

interface AppHeaderProps {
  setMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  copilotModule: import("@/components/ai/copilot-panel").CopilotModule;
  disclosureMode: DisclosureMode;
  setDisclosureMode: (mode: DisclosureMode) => void;
  modeMenuOpen: boolean;
  setModeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modeMenuRef: React.RefObject<HTMLDivElement | null>;
  addMenuOpen: boolean;
  setAddMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifications: AppNotification[];
  unreadCount: number;
  notifOpen: boolean;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifRef: React.RefObject<HTMLDivElement | null>;
  markAllRead: () => Promise<void>;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  isAdminUser: boolean;
  userMenuOpen: boolean;
  setUserMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userMenuRef: React.RefObject<HTMLDivElement | null>;
  handleLogout: () => void;
}

/* ─── Typing placeholder for KEY search ─── */
function KEYSearchPlaceholder() {
  const phrases = [
    "Ask KEY anything...",
    "What should I focus on?",
    "Why is cash slow?",
    "Fill my calendar",
    "Draft a follow-up",
  ];
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = phrases[index];
    const speed = isDeleting ? 30 : 80;
    const timer = setTimeout(() => {
      if (!isDeleting) {
        if (text.length < current.length) {
          setText(current.slice(0, text.length + 1));
        } else {
          setTimeout(() => setIsDeleting(true), 2000);
        }
      } else {
        if (text.length > 0) {
          setText(text.slice(0, -1));
        } else {
          setIsDeleting(false);
          setIndex((i) => (i + 1) % phrases.length);
        }
      }
    }, speed);
    return () => clearTimeout(timer);
  }, [text, isDeleting, index]);

  return (
    <span className="truncate">
      {text}
      <span className="inline-block w-[1px] h-3.5 bg-[hsl(var(--kf-accent2))] ml-0.5 animate-pulse" />
    </span>
  );
}

export function AppHeader({
  setMobileDrawerOpen,
  disclosureMode,
  setDisclosureMode,
  modeMenuOpen,
  setModeMenuOpen,
  modeMenuRef,
  addMenuOpen,
  setAddMenuOpen,
  notifications,
  unreadCount,
  notifOpen,
  setNotifOpen,
  notifRef,
  markAllRead,
  displayName,
  initials,
  avatarUrl,
  isAdminUser,
  userMenuOpen,
  setUserMenuOpen,
  userMenuRef,
  handleLogout,
}: AppHeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);

  const modeColors = {
    startup: { border: "border-emerald-500/30", bg: "bg-emerald-500/10", text: "text-emerald-400", glow: "shadow-[0_0_12px_hsl(142,71%,45%,0.2)]" },
    growth: { border: "border-amber-500/30", bg: "bg-amber-500/10", text: "text-amber-400", glow: "shadow-[0_0_12px_hsl(38,92%,50%,0.2)]" },
    enterprise: { border: "border-violet-500/30", bg: "bg-violet-500/10", text: "text-violet-400", glow: "shadow-[0_0_12px_hsl(260,70%,60%,0.2)]" },
  };
  const mc = modeColors[disclosureMode];

  return (
    <header
      className="h-12 border-b border-border px-3 md:px-5 flex items-center justify-between flex-shrink-0 z-40 relative"
      style={{
        background: "hsl(var(--kf-header-bg))",
      }}
    >
      {/* Subtle top glow line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[hsl(var(--kf-accent1)/0.15)] to-transparent" />

      <div className="flex items-center gap-2 md:gap-3 flex-1">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileDrawerOpen(true)}
          className="md:hidden p-2 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Mobile logo */}
        <div className="md:hidden flex items-center gap-2 flex-1 min-w-0">
          <div
            className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
            }}
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight truncate">KEYFLOWOS</span>
        </div>

        {/* KEY Search Bar — Desktop */}
        <motion.button
          onClick={() =>
            window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "chat" } }))
          }
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className={cn(
            "hidden md:flex flex-1 min-w-0 max-w-xl items-center gap-2.5 rounded-xl border px-3.5 py-2 text-sm transition-all cursor-pointer relative overflow-hidden",
            searchFocused
              ? "border-[hsl(var(--kf-accent1)/0.4)] bg-muted/30 shadow-[0_0_20px_hsl(var(--kf-accent1)/0.08)]"
              : "border-border/50 bg-muted/15 hover:border-[hsl(var(--kf-accent1)/0.25)] hover:bg-muted/25"
          )}
        >
          {/* Subtle gradient border glow on focus */}
          {searchFocused && (
            <div className="absolute inset-0 rounded-xl opacity-20 bg-gradient-to-r from-[hsl(var(--kf-accent1))] via-transparent to-[hsl(var(--kf-accent2))]" />
          )}
          <Brain className="w-4 h-4 text-[hsl(var(--kf-accent2))] relative z-10 flex-shrink-0" />
          <span className="text-muted-foreground relative z-10 truncate text-left flex-1">
            <KEYSearchPlaceholder />
          </span>
          <kbd className="relative z-10 ml-auto px-1.5 py-0.5 rounded-md bg-muted border border-border/50 text-[10px] font-mono shrink-0 text-muted-foreground">
            ⌘J
          </kbd>
        </motion.button>

        {/* Command Palette Button */}
        <button
          onClick={() =>
            window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } }))
          }
          className="hidden md:flex items-center gap-1.5 rounded-xl border border-border/50 px-2.5 py-2 text-xs text-muted-foreground hover:border-[hsl(var(--kf-accent1)/0.2)] hover:text-foreground transition-all shrink-0"
          title="Command palette (⌘K)"
        >
          <Search className="w-3.5 h-3.5" />
          <kbd className="px-1 py-0.5 rounded-md bg-muted border border-border/50 text-[10px] font-mono">⌘K</kbd>
        </button>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Mobile search */}
        <button
          onClick={() =>
            window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } }))
          }
          className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Search"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Disclosure Mode Switcher — Mode Orbs */}
        <div className="relative" ref={modeMenuRef}>
          <button
            onClick={() => setModeMenuOpen((v) => !v)}
            className={cn(
              "hidden sm:flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all shrink-0",
              mc.border,
              mc.bg,
              mc.text,
              "hover:brightness-110"
            )}
            title={`Mode: ${MODE_LABELS[disclosureMode].title}`}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", disclosureMode === "startup" ? "bg-emerald-400" : disclosureMode === "growth" ? "bg-amber-400" : "bg-violet-400", mc.glow)} />
            <span>{MODE_LABELS[disclosureMode].title}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          <AnimatePresence>
            {modeMenuOpen && (
              <>
                <div className="fixed inset-0 z-[55]" onClick={() => setModeMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-xl z-[56] p-1.5"
                >
                  <div className="px-3 py-2">
                    <p className="text-xs font-semibold text-foreground">Workspace Mode</p>
                    <p className="text-[11px] text-muted-foreground">Show only what you need</p>
                  </div>
                  <div className="border-t border-border my-1" />
                  {(["startup", "growth", "enterprise"] as DisclosureMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setDisclosureMode(mode);
                        setModeMenuOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between",
                        disclosureMode === mode
                          ? "bg-muted font-medium"
                          : "hover:bg-muted/50 text-muted-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "w-2 h-2 rounded-full",
                          mode === "startup" ? "bg-emerald-400 shadow-[0_0_8px_hsl(142,71%,45%,0.4)]" :
                          mode === "growth" ? "bg-amber-400 shadow-[0_0_8px_hsl(38,92%,50%,0.4)]" :
                          "bg-violet-400 shadow-[0_0_8px_hsl(260,70%,60%,0.4)]"
                        )} />
                        <div>
                          <p className="text-sm">{MODE_LABELS[mode].title}</p>
                          <p className="text-[11px] text-muted-foreground">{MODE_LABELS[mode].subtitle}</p>
                        </div>
                      </div>
                      {disclosureMode === mode && (
                        <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent1))]" />
                      )}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* New Entity Button */}
        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setAddMenuOpen((v) => !v)}
            className="kf-btn-glow inline-flex items-center gap-1.5 !px-2.5 !py-1.5 !text-xs !rounded-xl"
            title="New (⌘N)"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New</span>
            <kbd className="hidden sm:inline px-1 py-0.5 rounded bg-black/20 text-[9px] font-mono">⌘N</kbd>
          </motion.button>
          <AnimatePresence>
            {addMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
              >
                <NewEntityMenu onClose={() => setAddMenuOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Notifications — Signal Wave Icon */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setNotifOpen((v) => !v); }}
            className={cn(
              "relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-all",
              unreadCount > 0 && "text-[hsl(var(--kf-accent1))]"
            )}
            aria-label="Notifications"
          >
            <Radio className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white animate-slow-pulse" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <AnimatePresence>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-[55] md:hidden bg-black/40" onClick={() => setNotifOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-x-0 bottom-0 top-auto md:absolute md:right-0 md:left-auto md:bottom-auto md:top-full mt-0 md:mt-2 w-full md:w-80 max-h-[70vh] md:max-h-96 overflow-y-auto rounded-t-2xl md:rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-xl z-[56]"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
                    <span className="text-sm font-semibold">Notifications</span>
                    <div className="flex items-center gap-3">
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs hover:underline text-gradient-key">
                          Mark all read
                        </button>
                      )}
                      <button onClick={() => setNotifOpen(false)} className="md:hidden p-1 text-muted-foreground">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet</div>
                  ) : (
                    notifications.slice(0, 20).map((n) => {
                      const notifLink = getNotificationLink(n);
                      const NotifIcon = getNotificationIcon(n);
                      const itemClass = cn(
                        "block px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50 transition-colors active:bg-muted/70",
                        !n.read && "bg-gradient-to-r from-[hsl(var(--kf-accent1)/0.03)] to-transparent",
                        notifLink && "cursor-pointer"
                      );
                      const content = (
                        <div className="flex items-start gap-2.5">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 bg-muted/50">
                            <NotifIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium">{n.title}</p>
                              {!n.read && (
                                <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }} />
                              )}
                            </div>
                            {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {relativeTime(n.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                      if (notifLink) {
                        return (
                          <Link key={n.id} href={notifLink} onClick={() => setNotifOpen(false)} className={itemClass}>
                            {content}
                          </Link>
                        );
                      }
                      return (
                        <div key={n.id} className={itemClass}>
                          {content}
                        </div>
                      );
                    })
                  )}
                  <div className="h-safe-area-inset-bottom md:hidden" />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* User Avatar with mode-colored ring */}
        <div className="hidden sm:flex items-center relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 p-1 rounded-xl hover:bg-muted transition-all min-h-[44px]",
              userMenuOpen && "bg-muted"
            )}
            aria-label="User menu"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            {avatarUrl ? (
              <div className={cn("relative rounded-full p-[2px]", disclosureMode === "startup" ? "bg-emerald-500/30" : disclosureMode === "growth" ? "bg-amber-500/30" : "bg-violet-500/30")}>
                <Image
                  src={avatarUrl}
                  alt={displayName || "User"}
                  className="h-7 w-7 rounded-full object-cover"
                  width={28} height={28} unoptimized />
              </div>
            ) : (
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
                style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
              >
                {initials}
              </div>
            )}
            <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform duration-200", userMenuOpen && "rotate-180")} />
          </button>

          <AnimatePresence>
            {userMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-border shadow-xl z-50 py-1 overflow-hidden"
                style={{ background: "hsl(var(--kf-card))" }}
                role="menu"
              >
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-medium text-foreground truncate">{displayName || "User"}</p>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{getCachedUser()?.email}</p>
                </div>
                <Link
                  href="/app/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors min-h-[44px]"
                  role="menuitem"
                >
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  My Profile
                </Link>
                <Link
                  href="/app/profile?tab=pricing"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors min-h-[44px]"
                  role="menuitem"
                >
                  <Calculator className="w-3.5 h-3.5 text-muted-foreground" />
                  Pricing Calculator
                </Link>
                <Link
                  href="/app/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors min-h-[44px]"
                  role="menuitem"
                >
                  <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                  Studio
                </Link>
                {isAdminUser && (
                  <Link
                    href="/admin"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors min-h-[44px]"
                    role="menuitem"
                  >
                    <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                    Owner Console
                  </Link>
                )}
                <div className="border-t border-border mt-1 pt-1">
                  <button
                    onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors w-full text-left min-h-[44px]"
                    role="menuitem"
                  >
                    <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
                    Log out
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
