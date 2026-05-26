"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { useThemeColors } from "@/lib/theme-context";
import { usePlanLimitHandler } from "./use-plan";
import {
  clearStoredBusinessId,
  getStoredBusinessId,
  getCachedUser,
  getUserDisplayName,
  getUserInitials,
  refreshWorkspace,
  getCachedBusiness,
  isSuperAdmin,
} from "@/lib/workspace";
import { apiGet, apiPatch } from "@/lib/api";
import {
  getDisclosureMode,
  setDisclosureMode as persistDisclosureMode,
  MODE_OPERATE_ITEMS,
  MODE_BUILD_ITEMS,
  type DisclosureMode,
} from "@/lib/disclosure-mode";
import { featureFlags as dormantFeatureFlags } from "@/lib/feature-flags";
import type { AppNotification } from "@/lib/notifications";
import type { ResolvedFeatureFlag } from "@/lib/nav-config";
import {
  operateSections,
  buildSections,
  moreNav,
  meNav,
  type NavItem,
  type NavSection,
  type PrimaryNavItem,
  type DrawerSurface,
} from "@/lib/nav-config";
import type { CopilotModule } from "@/components/ai/copilot-panel";

export interface AppLayoutState {
  pathname: string;
  searchParams: URLSearchParams;
  copilotModule: CopilotModule;

  drawerSurface: DrawerSurface;
  setDrawerSurface: React.Dispatch<React.SetStateAction<DrawerSurface>>;

  notifications: AppNotification[];
  unreadCount: number;
  notifOpen: boolean;
  setNotifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  notifRef: React.RefObject<HTMLDivElement | null>;
  markAllRead: () => Promise<void>;

  connectorAlertCount: number;

  displayName: string;
  initials: string;
  avatarUrl: string | null;
  isAdminUser: boolean;

  featureFlags: Record<string, ResolvedFeatureFlag>;
  isFeatureLocked: (item: NavItem) => boolean;
  isItemHiddenByDormantFlag: (item: NavItem) => boolean;

  disclosureMode: DisclosureMode;
  setDisclosureMode: (mode: DisclosureMode) => void;

  visibleOperateSections: NavSection[];
  visibleBuildSections: NavSection[];
  visibleMoreNav: NavItem[];
  meNav: NavItem[];

  isSecondaryActive: (item: NavItem) => boolean;
  isPrimaryActive: (item: PrimaryNavItem) => boolean;

  addMenuOpen: boolean;
  setAddMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;

  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;

  userMenuOpen: boolean;
  setUserMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userMenuRef: React.RefObject<HTMLDivElement | null>;

  modeMenuOpen: boolean;
  setModeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modeMenuRef: React.RefObject<HTMLDivElement | null>;

  kfStoreOpen: boolean;
  setKfStoreOpen: React.Dispatch<React.SetStateAction<boolean>>;

  planLimitHit: ReturnType<typeof usePlanLimitHandler>["planLimitHit"];
  clearPlanLimit: () => void;

  handleLogout: () => void;
}

export function useAppLayout(): AppLayoutState {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  useNavigationContext();

  const copilotModule = useMemo((): CopilotModule => {
    if (pathname === "/app") return "cockpit";
    if (pathname.startsWith("/app/crm") || pathname.startsWith("/app/people")) return "crm";
    if (pathname.startsWith("/app/commerce") || pathname.startsWith("/app/money")) return "revenue";
    if (pathname.startsWith("/app/payments")) return "revenue";
    if (pathname.startsWith("/app/bookings") || pathname.startsWith("/app/schedule")) return "calendar";
    if (pathname.startsWith("/app/social") || pathname.startsWith("/app/marketing") || pathname.startsWith("/app/communicate")) return "content";
    if (pathname.startsWith("/app/projects") || pathname.startsWith("/app/work")) return "projects";
    if (pathname.startsWith("/app/expenses")) return "expenses";
    if (pathname.startsWith("/app/automations") || pathname.startsWith("/app/build/automate")) return "flows";
    if (pathname.startsWith("/app/settings") || pathname.startsWith("/app/build/system")) return "settings";
    if (pathname.startsWith("/app/store") || pathname.startsWith("/app/build/business/store")) return "store";
    if (pathname.startsWith("/app/profile")) return "profile";
    if (pathname.startsWith("/app/structure")) return "flows";
    return "cockpit";
  }, [pathname]);

  const [drawerSurface, setDrawerSurface] = useState<DrawerSurface>(null);

  useEffect(() => {
    setDrawerSurface(null);
  }, [pathname]);

  const isSecondaryActive = useCallback((item: NavItem) => {
    const basePath = item.href.split("?")[0];
    if (item.matchTab) {
      return pathname === basePath && searchParams.get("tab") === item.matchTab;
    }
    if (item.exactMatch) {
      return pathname === basePath && !searchParams.get("tab");
    }
    return pathname === basePath || pathname.startsWith(basePath + "/");
  }, [pathname, searchParams]);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { setAccent1, setAccent2 } = useThemeColors();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [connectorAlertCount, setConnectorAlertCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [initials, setInitials] = useState("KF");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [, setOnboardingChecked] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [, setUserEmail] = useState<string | null>(null);
  const [featureFlags, setFeatureFlags] = useState<Record<string, ResolvedFeatureFlag>>({});

  const isFeatureLocked = useCallback(
    (item: NavItem) => {
      if (!item.featureKey) return false;
      const flag = featureFlags[item.featureKey];
      if (!flag) return false;
      return flag.comingSoon && !flag.bypass;
    },
    [featureFlags],
  );

  const isItemHiddenByDormantFlag = useCallback((item: NavItem) => {
    if (!item.dormantFlag) return false;
    return !dormantFeatureFlags[item.dormantFlag];
  }, []);

  const [disclosureMode, setDisclosureModeState] = useState<DisclosureMode>(getDisclosureMode);

  const visibleOperateSections = useMemo(
    () => operateSections.map((section) => ({
      ...section,
      items: section.items.filter((i) => {
        if (isItemHiddenByDormantFlag(i)) return false;
        if (disclosureMode === "enterprise") return true;
        return MODE_OPERATE_ITEMS[disclosureMode].includes(i.label);
      }),
    })).filter((s) => s.items.length > 0),
    [isItemHiddenByDormantFlag, disclosureMode],
  );

  const visibleBuildSections = useMemo(
    () => buildSections.map((section) => ({
      ...section,
      items: section.items.filter((i) => {
        if (isItemHiddenByDormantFlag(i)) return false;
        if (disclosureMode === "enterprise") return true;
        return MODE_BUILD_ITEMS[disclosureMode].includes(i.label);
      }),
    })).filter((s) => s.items.length > 0),
    [isItemHiddenByDormantFlag, disclosureMode],
  );

  const visibleMoreNav = useMemo(
    () => moreNav.filter((i) => !isItemHiddenByDormantFlag(i)),
    [isItemHiddenByDormantFlag],
  );

  const { planLimitHit, clearPlanLimit } = usePlanLimitHandler();
  const [kfStoreOpen, setKfStoreOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: CustomEvent<{ mode: DisclosureMode }>) => {
      setDisclosureModeState(e.detail.mode);
    };
    window.addEventListener("kf:disclosure-mode-changed", handler as EventListener);
    return () => window.removeEventListener("kf:disclosure-mode-changed", handler as EventListener);
  }, []);

  useEffect(() => {
    setMobileDrawerOpen(false);
    if (pathname && pathname !== "/app/onboarding") {
      try {
        const segments = pathname.split("/").filter(Boolean);
        const last = segments[segments.length - 1];
        const isUuid = /^[0-9a-f-]{20,}$/i.test(last || "");
        const labelSegment = isUuid && segments.length > 1 ? segments[segments.length - 2] : last;
        const labelMap: Record<string, string> = {
          app: "KEYFLOW",
          crm: "People", pipeline: "People", people: "People",
          commerce: "Money", money: "Money",
          bookings: "Schedule", schedule: "Schedule",
          marketing: "Communicate", communicate: "Communicate",
          expenses: "Money",
          projects: "Work", work: "Work",
          documents: "Documents",
          automations: "Automate", "build": "Build",
          reports: "Intelligence", intelligence: "Intelligence",
          store: "Storefront", settings: "System",
          learn: "Learn",
          community: "Community", marketplace: "Marketplace",
          "control-tower": "Cockpit",
          "keyflow-command": "Cockpit",
          structure: "Operations",
          inbox: "Inbox",
          calendar: "Schedule",
          presence: "Presence",
          connect: "Connect",
        };
        const label = labelMap[labelSegment || ""] || (labelSegment ? labelSegment.charAt(0).toUpperCase() + labelSegment.slice(1) : "");
        if (label) {
          const key = "kf-command-recent";
          const raw = localStorage.getItem(key);
          const items: { label: string; href: string; timestamp: number }[] = raw ? JSON.parse(raw) : [];
          const filtered = items.filter((r) => r.href !== pathname);
          filtered.unshift({ label, href: pathname, timestamp: Date.now() });
          localStorage.setItem(key, JSON.stringify(filtered.slice(0, 5)));
        }
      } catch {}
    }
  }, [pathname]);

  useEffect(() => {
    const init = async () => {
      await refreshWorkspace();
      const user = getCachedUser();
      void getCachedBusiness();

      if (user) {
        setDisplayName(getUserDisplayName());
        setInitials(getUserInitials());
        if (user.avatarUrl) setAvatarUrl(user.avatarUrl);
        setIsAdminUser(isSuperAdmin());
        setUserEmail(user.email ?? null);
      }

      const businessId = getStoredBusinessId();
      if (businessId) {
        const res = await apiGet(`/identity/businesses/${businessId}`);
        if (res.data) {
          const data = res.data as { primaryColor?: string; secondaryColor?: string; onboardingComplete?: boolean };
          if (data.primaryColor) setAccent1(data.primaryColor);
          if (data.secondaryColor) setAccent2(data.secondaryColor);
          void data.onboardingComplete;
        }
      }
      const flagsRes = await apiGet<{ flags: ResolvedFeatureFlag[] }>(`/api/feature-flags`);
      if (flagsRes.data?.flags) {
        const map: Record<string, ResolvedFeatureFlag> = {};
        for (const f of flagsRes.data.flags) map[f.key] = f;
        setFeatureFlags(map);
      }

      setOnboardingChecked(true);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router]);

  const fetchNotifications = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const [listRes, countRes] = await Promise.all([
      apiGet(`/notifications/businesses/${businessId}?unreadOnly=false`),
      apiGet(`/notifications/businesses/${businessId}/unread-count`),
    ]);
    if (listRes.data) setNotifications(listRes.data as AppNotification[]);
    if (countRes.data) setUnreadCount((countRes.data as { count?: number }).count ?? 0);
  }, []);

  const fetchConnectorAlerts = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await apiGet(`/connectors/businesses/${businessId}/needs-attention`);
    if (res.data) {
      setConnectorAlertCount((res.data as { count?: number }).count ?? 0);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchConnectorAlerts();
    const interval = setInterval(() => {
      fetchNotifications();
      fetchConnectorAlerts();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications, fetchConnectorAlerts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (notifOpen || userMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifOpen, userMenuOpen]);

  useEffect(() => {
    if (mobileDrawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileDrawerOpen]);

  const markAllRead = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    await apiPatch(`/notifications/businesses/${businessId}/read-all`, {});
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  const handleLogout = useCallback(() => {
    clearStoredBusinessId();
    router.push("/auth/login");
  }, [router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setAddMenuOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setAddMenuOpen(false);
        setMobileDrawerOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const isPrimaryActive = useCallback(
    (item: PrimaryNavItem) => {
      if (!item.href) return false;
      const basePath = item.href.split("?")[0];
      return pathname === basePath || pathname.startsWith(basePath + "/");
    },
    [pathname],
  );

  const setDisclosureMode = useCallback((mode: DisclosureMode) => {
    setDisclosureModeState(mode);
    persistDisclosureMode(mode);
  }, []);

  return {
    pathname,
    searchParams,
    copilotModule,
    drawerSurface,
    setDrawerSurface,
    notifications,
    unreadCount,
    notifOpen,
    setNotifOpen,
    notifRef,
    markAllRead,
    connectorAlertCount,
    displayName,
    initials,
    avatarUrl,
    isAdminUser,
    featureFlags,
    isFeatureLocked,
    isItemHiddenByDormantFlag,
    disclosureMode,
    setDisclosureMode,
    visibleOperateSections,
    visibleBuildSections,
    visibleMoreNav,
    meNav,
    isSecondaryActive,
    isPrimaryActive,
    addMenuOpen,
    setAddMenuOpen,
    mobileDrawerOpen,
    setMobileDrawerOpen,
    userMenuOpen,
    setUserMenuOpen,
    userMenuRef,
    modeMenuOpen,
    setModeMenuOpen,
    modeMenuRef,
    kfStoreOpen,
    setKfStoreOpen,
    planLimitHit,
    clearPlanLimit,
    handleLogout,
  };
}
