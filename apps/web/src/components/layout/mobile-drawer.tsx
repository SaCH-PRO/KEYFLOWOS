"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Zap,
  X,
  ChevronDown,
  LayoutGrid,
  Wrench,
  Globe,
  Lock,
  Shield,
  Sparkles,
  LogOut,
} from "lucide-react";
import type { NavItem } from "@/lib/nav-config";

interface MobileDrawerProps {
  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pathname: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  visibleWorkspacesNav: NavItem[];
  visibleStudioNav: NavItem[];
  visiblePublicNav: NavItem[];
  visibleComingSoonNav: NavItem[];
  isSecondaryActive: (item: NavItem) => boolean;
  isFeatureLocked: (item: NavItem) => boolean;
  connectorAlertCount: number;
  isAdminUser: boolean;
  setKfStoreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleLogout: () => void;
}

export function MobileDrawer({
  mobileDrawerOpen,
  setMobileDrawerOpen,
  pathname,
  displayName,
  initials,
  avatarUrl,
  visibleWorkspacesNav,
  visibleStudioNav,
  visiblePublicNav,
  visibleComingSoonNav,
  isSecondaryActive,
  isFeatureLocked,
  connectorAlertCount,
  isAdminUser,
  setKfStoreOpen,
  handleLogout,
}: MobileDrawerProps) {
  if (!mobileDrawerOpen) return null;

  return (
    <div className="md:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Navigation menu">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileDrawerOpen(false)} />
      <div
        className="absolute left-0 top-0 bottom-0 w-72 border-r border-border flex flex-col overflow-y-auto"
        role="navigation"
        aria-label="Main navigation"
        style={{ background: "hsl(var(--kf-sidebar-bg))" }}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div
              className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-sm font-bold tracking-tight">KEYFLOWOS</h1>
          </div>
          <button
            onClick={() => setMobileDrawerOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {displayName && (
          <Link
            href="/app/profile"
            onClick={() => setMobileDrawerOpen(false)}
            className="px-3 py-2.5 border-b border-border flex items-center gap-2.5 hover:bg-muted transition-colors min-h-[44px]"
          >
            {avatarUrl ? (
              <Image src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" width={28} height={28} unoptimized />
            ) : (
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0"
                style={{ background: "hsl(var(--kf-accent1))" }}
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
          <Link
            href="/app/keyflow-command"
            onClick={() => setMobileDrawerOpen(false)}
            className={cn(
              "kf-nav-item py-2.5 active:scale-[0.98] mb-2",
              (pathname === "/app" ||
                pathname.startsWith("/app/keyflow-command") ||
                pathname.startsWith("/app/control-tower")) &&
                "active"
            )}
          >
            <Zap className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
            <span>Cockpit</span>
          </Link>

          {/* WORKSPACES */}
          <div className="mt-2">
            <div className="kf-section-label flex items-center gap-1.5">
              <LayoutGrid className="w-3 h-3" />
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
                      className="kf-nav-item py-2.5 w-full text-left opacity-60 cursor-not-allowed"
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                      <span>{item.label}</span>
                      <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                    </button>
                  );
                }
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={cn("kf-nav-item py-2.5 active:scale-[0.98]", active && "active")}
                  >
                    <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* STUDIO */}
          <div className="mt-2">
            <div className="kf-section-label flex items-center gap-1.5">
              <Wrench className="w-3 h-3" />
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
                      className="kf-nav-item py-2.5 w-full text-left opacity-60 cursor-not-allowed"
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                      <span>{item.label}</span>
                      <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                    </button>
                  );
                }
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={cn("kf-nav-item py-2.5 active:scale-[0.98]", active && "active")}
                  >
                    <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                    <span>{item.label}</span>
                    {showConnectorBadge && (
                      <span
                        className="ml-auto h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                        style={{ background: "hsl(var(--kf-accent1))" }}
                        aria-label={`${connectorAlertCount} connectors need attention`}
                      >
                        {connectorAlertCount > 9 ? "9+" : connectorAlertCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* PUBLIC */}
          <div className="mt-2">
            <div className="kf-section-label flex items-center gap-1.5">
              <Globe className="w-3 h-3" />
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
                      className="kf-nav-item py-2.5 w-full text-left opacity-60 cursor-not-allowed"
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                      <span>{item.label}</span>
                      <Lock className="w-3 h-3 ml-auto text-muted-foreground/60" />
                    </button>
                  );
                }
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={cn("kf-nav-item py-2.5 active:scale-[0.98]", active && "active")}
                  >
                    <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          {visibleComingSoonNav.length > 0 && (
            <div className="mt-2">
              <div className="kf-section-label flex items-center gap-1.5">
                <Lock className="w-3 h-3" />
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
                      onClick={() => setMobileDrawerOpen(false)}
                      className={cn("kf-nav-item py-2.5 active:scale-[0.98] opacity-70", active && "active")}
                    >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <div className="kf-divider my-2" />

          <button
            onClick={() => { setMobileDrawerOpen(false); setKfStoreOpen(true); }}
            className="kf-nav-item py-2.5 active:scale-[0.98] w-full"
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
              onClick={() => setMobileDrawerOpen(false)}
              className="kf-nav-item py-2.5 active:scale-[0.98]"
            >
              <Shield className="w-[18px] h-[18px] flex-shrink-0 kf-nav-icon" />
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
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all w-full active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
