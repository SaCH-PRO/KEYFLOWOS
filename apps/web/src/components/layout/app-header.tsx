"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { NewEntityMenu } from "./new-entity-menu";
import { openKey } from "@/components/key/key-agent";
import { useKeyEnabled } from "@/hooks/use-key-enabled";
import { getCachedUser } from "@/lib/workspace";
import { getNotificationIcon, getNotificationLink, relativeTime } from "@/lib/notifications";
import type { AppNotification } from "@/lib/notifications";
import type { CopilotModule } from "@/components/key/chat";
import type { ModuleLevels } from "@/lib/nav-config";
import {
  Menu,
  Brain,
  Search,
  ChevronDown,
  Plus,
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
  copilotModule: CopilotModule;
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
  /** The shell's answer to my-access (useAppLayout's moduleLevels), for the New menu's doors; null when unknown. */
  moduleLevels?: ModuleLevels;
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
  moduleLevels = null,
}: AppHeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const pathname = usePathname();
  // KEY's door (journey K: "KEY opens only from the header button, on phones
  // too, or Cmd/Ctrl+J"). app/app/layout.tsx mounts KeyAgent, which answers
  // it, everywhere but onboarding, so the door is not shown there. Nor under
  // the server's KEY_DISABLED, nor until /identity/me has said KEY is on
  // (SWP-KEY-SHELL-SMOKE: a KEY-disabled business never sees the door flash).
  const { enabled: keyEnabled } = useKeyEnabled();
  const showKeyDoor = keyEnabled && !pathname?.startsWith("/app/onboarding");


  return (
    <header
      // The header layer (app/globals.css): the header is the stacking context
      // of every menu it opens, so this layer is theirs: over the page and the
      // phone's bottom bar, under sheets, drawers and dialogs (BUG-041). A
      // page's own full-screen overlay at the z-40 literal (a dialog's
      // backdrop, a dropdown's click-catcher) comes later in the document and
      // so still covers it (LAY-CR-2).
      className="h-12 border-b border-border px-3 md:px-5 flex items-center justify-between flex-shrink-0 z-[var(--kf-z-header)] relative"
      style={{
        background: "hsl(var(--kf-header-bg))",
      }}
    >
      {/* Subtle top glow line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[hsl(var(--kf-accent1)/0.15)] to-transparent" />

      {/* The left group may shrink below its content (min-w-0): the header sits
          in the shell's overflow-hidden root, so a left group as wide as its
          content (the whole wordmark, Ask KEY, the KEY bar's typing text)
          would push Search, New and Notifications off a phone's screen, where
          nobody can reach them (LAY-CR-1). The logo gives way first. */}
      <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileDrawerOpen(true)}
          className="md:hidden p-2 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Mobile logo: the mark alone on a phone (the wordmark from sm), and
            nothing below 360px, where the header's controls take the width */}
        <div className="md:hidden flex max-[359px]:hidden items-center gap-2 flex-1 min-w-0 overflow-hidden">
          <div
            className="h-6 w-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
            }}
          >
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="hidden sm:block text-sm font-bold tracking-tight truncate">KEYFLOWOS</span>
        </div>

        {/* Ask KEY: KEY's one door in the shell (and Cmd/Ctrl+J). It opens
            KEY's chat drawer, as Cmd/Ctrl+J does; on a phone it is a compact
            "Ask KEY" button, on a desktop the wide bar with the ⌘J hint. */}
        {showKeyDoor && (
          <motion.button
            type="button"
            aria-label="Ask KEY"
            title="Ask KEY (⌘J)"
            onClick={() => openKey({ mode: "chat" })}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className={cn(
              "flex shrink-0 md:shrink md:flex-1 min-w-0 md:max-w-xl min-h-[44px] md:min-h-0 items-center gap-1.5 md:gap-2.5 rounded-xl border px-2.5 md:px-3.5 py-2 text-sm transition-all cursor-pointer relative overflow-hidden",
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
            <span className="md:hidden relative z-10 text-xs font-medium text-foreground whitespace-nowrap">Ask KEY</span>
            <span className="hidden md:block text-muted-foreground relative z-10 truncate text-left flex-1">
              <KEYSearchPlaceholder />
            </span>
            <kbd className="hidden md:inline relative z-10 ml-auto px-1.5 py-0.5 rounded-md bg-muted border border-border/50 text-[10px] font-mono shrink-0 text-muted-foreground">
              ⌘J
            </kbd>
          </motion.button>
        )}

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

        {/* New Entity Button */}
        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setAddMenuOpen((v) => !v)}
            className="kf-btn-glow inline-flex items-center gap-1.5 !px-2.5 !py-1.5 !text-xs !rounded-xl"
            title="New (⌘N)"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
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
                <NewEntityMenu onClose={() => setAddMenuOpen(false)} levels={moduleLevels} />
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

        {/* User avatar */}
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
              <div className="relative rounded-full p-[2px] bg-[hsl(var(--kf-accent1)/0.3)]">
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
                {/* NAV-A3 (BUG-118): the member's own account, not the business's profile (/app/profile). */}
                <Link
                  href="/app/settings/profile"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:bg-muted transition-colors min-h-[44px]"
                  role="menuitem"
                >
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  My account
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
                  Settings
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
