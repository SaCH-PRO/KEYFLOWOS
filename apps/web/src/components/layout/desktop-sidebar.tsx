"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Zap,
  Shield,
  Sparkles,
  X,
  Lock,
  ChevronRight,
} from "lucide-react";
import { primaryNav } from "@/lib/nav-config";
import type { NavItem, PrimaryNavItem } from "@/lib/nav-config";

interface DesktopSidebarProps {
  drawerSurface: "workspaces" | "studio" | "public" | null;
  setDrawerSurface: React.Dispatch<React.SetStateAction<"workspaces" | "studio" | "public" | null>>;
  isPrimaryActive: (item: PrimaryNavItem) => boolean;
  visibleWorkspacesNav: NavItem[];
  visibleStudioNav: NavItem[];
  visiblePublicNav: NavItem[];
  visibleComingSoonNav: NavItem[];
  isSecondaryActive: (item: NavItem) => boolean;
  isFeatureLocked: (item: NavItem) => boolean;
  connectorAlertCount: number;
  isAdminUser: boolean;
  setKfStoreOpen: (v: boolean) => void;
}

export function DesktopSidebar({
  drawerSurface,
  setDrawerSurface,
  isPrimaryActive,
  visibleWorkspacesNav,
  visibleStudioNav,
  visiblePublicNav,
  visibleComingSoonNav,
  isSecondaryActive,
  isFeatureLocked,
  connectorAlertCount,
  isAdminUser,
  setKfStoreOpen,
}: DesktopSidebarProps) {
  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      className="hidden md:flex h-full"
    >
      <div
        className="w-[52px] flex flex-col items-center border-r border-border h-full py-3 gap-1 flex-shrink-0"
        style={{ background: "hsl(var(--kf-sidebar-bg))" }}
      >
        <Link
          href="/app/keyflow-command"
          className="h-10 w-10 min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center flex-shrink-0 mb-3"
          style={{ background: "hsl(var(--kf-accent1))" }}
          title="KEYFLOW — home"
        >
          <Zap className="w-4 h-4 text-white" />
        </Link>

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
                onClick={() => setDrawerSurface(prev => (prev === surfaceId ? null : surfaceId as "workspaces" | "studio" | "public"))}
                className={cn(
                  "w-11 h-11 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center transition-all relative group",
                  isSurfaceOpen
                    ? "text-foreground bg-muted/50"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
                title={item.label}
                aria-label={item.label}
                aria-expanded={isSurfaceOpen}
              >
                {isSurfaceOpen && (
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[14px] w-[3px] h-5 rounded-r-full"
                    style={{ background: "hsl(var(--kf-accent1))" }}
                  />
                )}
                <Icon className="w-[18px] h-[18px]" />
              </button>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href ?? "#"}
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center transition-all relative group",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
              title={item.label}
              aria-label={item.label}
              onClick={() => setDrawerSurface(null)}
            >
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[14px] w-[3px] h-5 rounded-r-full"
                  style={{ background: "hsl(var(--kf-accent1))" }}
                />
              )}
              <Icon className="w-[18px] h-[18px]" />
            </Link>
          );
        })}

        <div className="mt-auto flex flex-col items-center gap-1">
          {isAdminUser && (
            <Link
              href="/admin"
              className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
              title="Owner Console"
            >
              <Shield className="w-[18px] h-[18px]" />
            </Link>
          )}
          <button
            onClick={() => setKfStoreOpen(true)}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all"
            title="KF Store"
          >
            <div
              className="w-[18px] h-[18px] rounded flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #F97316, #14B8A6)" }}
            >
              <Sparkles className="w-2.5 h-2.5 text-white" />
            </div>
          </button>
          <ThemeToggle />
        </div>
      </div>

      {drawerSurface !== null && (
        <div
          className="w-[208px] border-r border-border h-full flex flex-col overflow-hidden"
          style={{ background: "hsl(var(--kf-sidebar-bg) / 0.7)" }}
        >
          <div className="px-3 py-3 border-b border-border/50 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {drawerSurface === "workspaces" ? "Workspaces" : drawerSurface === "studio" ? "Studio" : "Public"}
            </h2>
            <button
              onClick={() => setDrawerSurface(null)}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground"
              aria-label="Close menu"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
            {/* WORKSPACES */}
            <div className="mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
                Workspaces
              </div>
              <div className="flex flex-col gap-px">
                {visibleWorkspacesNav.map((item) => {
                  const Icon = item.icon;
                  const active = isSecondaryActive(item);
                  const isLocked = isFeatureLocked(item);
                  if (isLocked) {
                    return (
                      <button
                        key={item.href + item.label}
                        type="button"
                        aria-disabled="true"
                        title="future keyflow"
                        onClick={(e) => e.preventDefault()}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground/50 cursor-not-allowed opacity-60"
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{item.label}</span>
                        <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                      </button>
                    );
                  }
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all",
                        active
                          ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
                      {active && (
                        <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground/50" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* STUDIO */}
            <div className="mb-3 pt-3 border-t border-border/40">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
                Studio
              </div>
              <div className="flex flex-col gap-px">
                {visibleStudioNav.map((item) => {
                  const Icon = item.icon;
                  const active = isSecondaryActive(item);
                  const showConnectorBadge =
                    item.href === "/app/connect" && connectorAlertCount > 0;
                  const isLocked = isFeatureLocked(item);
                  if (isLocked) {
                    return (
                      <button
                        key={item.href + item.label}
                        type="button"
                        aria-disabled="true"
                        title="future keyflow"
                        onClick={(e) => e.preventDefault()}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground/50 cursor-not-allowed opacity-60"
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{item.label}</span>
                        <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                      </button>
                    );
                  }
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all",
                        active
                          ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
                      {showConnectorBadge && (
                        <span
                          className="ml-auto h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                          style={{ background: "hsl(var(--kf-accent1))" }}
                          title={`${connectorAlertCount} connector${connectorAlertCount === 1 ? "" : "s"} need${connectorAlertCount === 1 ? "s" : ""} attention`}
                          aria-label={`${connectorAlertCount} connectors need attention`}
                        >
                          {connectorAlertCount > 9 ? "9+" : connectorAlertCount}
                        </span>
                      )}
                      {active && !showConnectorBadge && (
                        <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground/50" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* PUBLIC */}
            <div className="mb-3 pt-3 border-t border-border/40">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
                Public
              </div>
              <div className="flex flex-col gap-px">
                {visiblePublicNav.map((item) => {
                  const Icon = item.icon;
                  const active = isSecondaryActive(item);
                  const isLocked = isFeatureLocked(item);
                  if (isLocked) {
                    return (
                      <button
                        key={item.href + item.label}
                        type="button"
                        aria-disabled="true"
                        title="future keyflow"
                        onClick={(e) => e.preventDefault()}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground/50 cursor-not-allowed opacity-60"
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{item.label}</span>
                        <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                      </button>
                    );
                  }
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all",
                        active
                          ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span>{item.label}</span>
                      {active && (
                        <ChevronRight className="w-3 h-3 ml-auto text-muted-foreground/50" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>

            {visibleComingSoonNav.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/40">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 px-2 mb-1">
                  Coming soon
                </div>
                <div className="flex flex-col gap-px">
                  {visibleComingSoonNav.map((item) => {
                    const Icon = item.icon;
                    const active = isSecondaryActive(item);
                    return (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all opacity-70",
                          active
                            ? "bg-[hsl(var(--kf-accent1))]/10 text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                        )}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
