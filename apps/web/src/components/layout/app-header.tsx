"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Menu,
  Zap,
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
} from "lucide-react";
import { NewEntityMenu } from "./new-entity-menu";
import { MODE_LABELS, type DisclosureMode } from "@/lib/disclosure-mode";
import { getCachedUser } from "@/lib/workspace";
import { getNotificationIcon, getNotificationLink, relativeTime } from "@/lib/notifications";
import type { AppNotification } from "@/lib/notifications";

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
  return (
    <header
      className="h-12 border-b border-border px-3 md:px-5 flex items-center justify-between flex-shrink-0 z-40"
      style={{ background: "hsl(var(--kf-header-bg))" }}
    >
      <div className="flex items-center gap-2 md:gap-3 flex-1">
        <button
          onClick={() => setMobileDrawerOpen(true)}
          className="md:hidden p-2 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="md:hidden flex items-center gap-2 flex-1 min-w-0">
          <div
            className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: "hsl(var(--kf-accent1))" }}
          >
            <Zap className="w-3 h-3 text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight truncate">KEYFLOWOS</span>
        </div>

        <button
          onClick={() => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "chat" } }))}
          className="hidden md:flex flex-1 min-w-0 max-w-lg items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-sm text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground/70 transition-colors cursor-pointer"
        >
          <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
          <span className="truncate">Ask KEY anything…</span>
          <kbd className="ml-auto px-1 py-0.5 rounded bg-muted text-[10px] font-mono shrink-0">⌘J</kbd>
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } }))}
          className="hidden md:flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-muted-foreground/30 transition-colors shrink-0"
          title="Command palette (⌘K)"
        >
          <Search className="w-3.5 h-3.5" />
          <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">⌘K</kbd>
        </button>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("kf:open-key", { detail: { mode: "palette" } }))}
          className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Search"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Disclosure Mode Switcher */}
        <div className="relative" ref={modeMenuRef}>
          <button
            onClick={() => setModeMenuOpen((v) => !v)}
            className={cn(
              "hidden sm:flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0",
              disclosureMode === "startup"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15"
                : disclosureMode === "growth"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15"
                  : "border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/15"
            )}
            title={`Mode: ${MODE_LABELS[disclosureMode].title}`}
          >
            <span>{MODE_LABELS[disclosureMode].title}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {modeMenuOpen && (
            <>
              <div className="fixed inset-0 z-[55]" onClick={() => setModeMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-xl z-[56] p-1.5">
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
                    <div>
                      <p className="text-sm">{MODE_LABELS[mode].title}</p>
                      <p className="text-[11px] text-muted-foreground">{MODE_LABELS[mode].subtitle}</p>
                    </div>
                    {disclosureMode === mode && (
                      <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent1))]" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setAddMenuOpen((v) => !v)}
            className="kf-btn-primary inline-flex items-center gap-1.5 !px-2.5 !py-1.5 !text-xs !rounded-lg"
            title="New (⌘N)"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New</span>
            <kbd className="hidden sm:inline px-1 py-0.5 rounded bg-black/20 text-[9px] font-mono">⌘N</kbd>
          </button>
          {addMenuOpen && (
            <NewEntityMenu onClose={() => setAddMenuOpen(false)} />
          )}
        </div>

        {/* MissionsButton hidden — gamification module is dormant */}

        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setNotifOpen((v) => !v); }}
            className={cn(
              "relative min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
              unreadCount > 0 && "kf-notif-pulse"
            )}
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: "hsl(var(--kf-accent1))" }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-[55] md:hidden bg-black/40" onClick={() => setNotifOpen(false)} />
              <div className="fixed inset-x-0 bottom-0 top-auto md:absolute md:right-0 md:left-auto md:bottom-auto md:top-full mt-0 md:mt-2 w-full md:w-80 max-h-[70vh] md:max-h-96 overflow-y-auto rounded-t-2xl md:rounded-xl border border-border bg-card/95 backdrop-blur-xl shadow-xl z-[56]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
                  <span className="text-sm font-semibold">Notifications</span>
                  <div className="flex items-center gap-3">
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-xs hover:underline" style={{ color: "hsl(var(--kf-accent1))" }}>
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
                      !n.read && "bg-muted/30",
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
                              <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: "hsl(var(--kf-accent1))" }} />
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
              </div>
            </>
          )}
        </div>

        <div className="hidden sm:flex items-center relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 p-1 rounded-lg hover:bg-muted transition-colors min-h-[44px]"
            aria-label="User menu"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName || "User"}
                className="h-7 w-7 rounded-full object-cover"
               width={28} height={28} unoptimized />
            ) : (
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
                style={{ background: "hsl(var(--kf-accent1))" }}
              >
                {initials}
              </div>
            )}
            <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`} />
          </button>

          {userMenuOpen && (
            <div
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
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
