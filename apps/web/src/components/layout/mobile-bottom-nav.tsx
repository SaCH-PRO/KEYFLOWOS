"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
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
  notifOpen,
  setNotifOpen,
  unreadCount,
}: MobileBottomNavProps) {
  return (
    <nav aria-label="Mobile navigation" className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-xl z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="flex items-center justify-around px-1" style={{ height: "56px" }}>
        {mobileBottomNav.map((item) => {
          const Icon = item.icon;
          if (item.href === "#workspaces") {
            return (
              <button
                key="workspaces"
                onClick={() => setMobileDrawerOpen(true)}
                className={cn(
                  "flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-all active:scale-95",
                  mobileDrawerOpen ? "" : "text-muted-foreground"
                )}
                style={mobileDrawerOpen ? { color: "hsl(var(--kf-accent1))" } : undefined}
                aria-label="Workspaces"
              >
                <Icon className="w-[20px] h-[20px]" />
                <span className="text-[10px] mt-0.5">{item.label}</span>
              </button>
            );
          }
          if (item.href === "#notifications") {
            return (
              <button
                key="notifications"
                onClick={() => setNotifOpen((v) => !v)}
                className={cn(
                  "flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-all active:scale-95 relative",
                  notifOpen ? "" : "text-muted-foreground"
                )}
                style={notifOpen ? { color: "hsl(var(--kf-accent1))" } : undefined}
                aria-label="Notifications"
              >
                <Icon className="w-[20px] h-[20px]" />
                <span className="text-[10px] mt-0.5">{item.label}</span>
                {unreadCount > 0 && (
                  <span className="absolute top-0 right-1 h-3.5 w-3.5 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background: "hsl(var(--kf-accent1))" }}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
            );
          }
          const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center min-w-[56px] min-h-[44px] py-1 transition-all active:scale-95",
                active ? "" : "text-muted-foreground"
              )}
              style={active ? { color: "hsl(var(--kf-accent1))" } : undefined}
            >
              <Icon className="w-[20px] h-[20px]" />
              <span className="text-[10px] mt-0.5">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
