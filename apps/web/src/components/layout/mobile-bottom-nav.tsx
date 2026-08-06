"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import { mobileBottomNav } from "@/lib/nav-config";

interface MobileBottomNavProps {
  pathname: string;
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifOpen: boolean;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  unreadCount: number;
}

export function MobileBottomNav({
  pathname,
  mobileDrawerOpen,
  setMobileDrawerOpen,
  unreadCount,
}: MobileBottomNavProps) {
  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.2 }}
        className="flex items-center gap-1 px-2 py-2 rounded-full border border-border/60 shadow-2xl"
        style={{
          background: "hsl(var(--kf-card) / 0.92)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "0 8px 32px -4px rgb(0 0 0 / 0.4), 0 0 0 1px hsl(var(--kf-border) / 0.5)",
        }}
      >
        {mobileBottomNav.map((item, _index) => {
          const Icon = item.icon;

          // Center AI button
          if (item.href === "#key") {
            return (
              <motion.button
                key={item.href}
                whileTap={{ scale: 0.9 }}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("kf:open-key", { detail: { mode: "chat" } })
                  )
                }
                className="relative flex items-center justify-center w-12 h-12 -mt-4 rounded-full"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                  boxShadow: "0 4px 20px hsl(var(--kf-accent1) / 0.4), 0 0 0 4px hsl(var(--kf-card))",
                }}
                aria-label="Talk to AI"
              >
                <Sparkles className="w-6 h-6 text-white drop-shadow-lg" />
                <div className="absolute inset-0 rounded-full animate-ping bg-orange-500/20 opacity-0 hover:opacity-100" />
              </motion.button>
            );
          }

          // Drawer triggers: Flows, Me
          if (
            item.href === "#flows" ||
            item.href === "#me"
          ) {
            return (
              <button
                key={item.href}
                onClick={() => setMobileDrawerOpen(true)}
                className={cn(
                  "flex flex-col items-center justify-center min-w-[52px] min-h-[40px] py-1 transition-all active:scale-95 rounded-full",
                  mobileDrawerOpen
                    ? "text-[hsl(var(--kf-accent1))]"
                    : "text-muted-foreground"
                )}
                aria-label={item.label}
              >
                <Icon className="w-[18px] h-[18px]" />
                <span className="text-[9px] mt-0.5 font-medium">{item.label}</span>
              </button>
            );
          }

          // Regular links
          const active =
            pathname === item.href ||
            (item.href !== "/app" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center min-w-[52px] min-h-[40px] py-1 transition-all active:scale-95 rounded-full",
                active
                  ? "text-[hsl(var(--kf-accent1))]"
                  : "text-muted-foreground"
              )}
            >
              <div className="relative">
                <Icon className="w-[18px] h-[18px]" />
                {item.showUnreadBadge && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-2 h-3.5 min-w-[14px] px-0.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]">
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
  );
}
