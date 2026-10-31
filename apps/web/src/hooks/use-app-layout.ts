"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  BUSINESS_CHANGED_EVENT,
} from "@/lib/workspace";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
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
import type { CopilotModule } from "@/components/key/chat";

export interface AppLayoutState {
  pathname: string;
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
  const router = useRouter();
  useNavigationContext();

  const copilotModule = useMemo((): CopilotModule => {
    if (pathname === "/app") return "cockpit";
    if (pathname.startsWith("/app/crm") || pathname.startsWith("/app/network")) return "crm";
    if (pathname.startsWith("/app/commerce") || pathname.startsWith("/app/money")) return "revenue";
    if (pathname.startsWith("/app/payments")) return "revenue";
    if (pathname.startsWith("/app/bookings") || pathname.startsWith("/app/schedule")) return "calendar";
    if (pathname.startsWith("/app/social") || pathname.startsWith("/app/marketing") || pathname.startsWith("/app/communicate")) return "content";
    if (pathname.startsWith("/app/projects") || pathname.startsWith("/app/work")) return "projects";
    if (pathname.startsWith("/app/expenses")) return "expenses";
    if (pathname.startsWith("/app/automations")) return "flows";
    if (pathname.startsWith("/app/settings")) return "settings";
    if (pathname.startsWith("/app/store")) return "store";
    if (pathname.startsWith("/app/profile")) return "profile";
    if (pathname.startsWith("/app/structure")) return "flows";
    return "cockpit";
  }, [pathname]);

  const [queryTab, setQueryTab] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setQueryTab(new URLSearchParams(window.location.search).get("tab"));
  }, [pathname]);

  const [drawerSurface, setDrawerSurface] = useState<DrawerSurface>(null);

  useEffect(() => {
    setDrawerSurface(null);
  }, [pathname]);

  const isSecondaryActive = useCallback((item: NavItem) => {
    const basePath = item.href.split("?")[0];
    if (item.matchTab) {
      return pathname === basePath && queryTab === item.matchTab;
    }
    if (item.exactMatch) {
      return pathname === basePath && !queryTab;
    }
    return pathname === basePath || pathname.startsWith(basePath + "/");
  }, [pathname, queryTab]);

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
    if (pathname) {
      try {
        const segments = pathname.split("/").filter(Boolean);
        const last = segments[segments.length - 1];
        const isUuid = /^[0-9a-f-]{20,}$/i.test(last || "");
        const labelSegment = isUuid && segments.length > 1 ? segments[segments.length - 2] : last;
        const labelMap: Record<string, string> = {
          app: "KEYFLOW",
          crm: "Network", pipeline: "Network", people: "Network", network: "Network",
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

  // Header identity from the cached user. Network-free, so it still follows
  // every navigation as it did when the whole init ran per pathname: a profile
  // edit (setCachedUser) reaches the header on the next click, not only after
  // a reload.
  const applyCachedUser = useCallback(() => {
    const user = getCachedUser();
    if (!user) return;
    setDisplayName(getUserDisplayName());
    setInitials(getUserInitials());
    setAvatarUrl(user.avatarUrl ?? null);
    setIsAdminUser(isSuperAdmin());
    setUserEmail(user.email ?? null);
  }, []);

  useEffect(() => {
    applyCachedUser();
  }, [pathname, applyCachedUser]);

  useEffect(() => {
    let canceled = false;
    const init = async () => {
      try {
        await refreshWorkspace();
        if (canceled) return;
        void getCachedBusiness();
        applyCachedUser();

        const businessId = getStoredBusinessId();
        if (businessId) {
          const res = await apiGet(`/identity/businesses/${businessId}`);
          if (canceled) return;
          if (res.data) {
            const data = res.data as { primaryColor?: string; secondaryColor?: string; onboardingComplete?: boolean };
            if (data.primaryColor) setAccent1(data.primaryColor);
            if (data.secondaryColor) setAccent2(data.secondaryColor);
            void data.onboardingComplete;
          }
        }
        const flagsRes = await apiGet<{ flags: ResolvedFeatureFlag[] }>(`/api/feature-flags`);
        if (canceled) return;
        if (flagsRes.data?.flags) {
          const map: Record<string, ResolvedFeatureFlag> = {};
          for (const f of flagsRes.data.flags) map[f.key] = f;
          setFeatureFlags(map);
        }
      } finally {
        if (!canceled) setOnboardingChecked(true);
      }
    };
    init();
    // Once per mount, not per pathname: re-resolving on every navigation is
    // what used to put a chosen business back to the bootstrap default (M03).
    // A deliberate switch (selectBusiness) announces itself instead.
    const onBusinessChanged = () => {
      void init();
    };
    window.addEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    return () => {
      canceled = true;
      window.removeEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The business the notifications on screen belong to. markAllRead acts on
  // this one, never on whatever is stored by the time the click lands.
  const notificationsBusinessRef = useRef<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const [listRes, countRes] = await Promise.all([
      apiGet(`/notifications/businesses/${businessId}?unreadOnly=false`),
      apiGet(`/notifications/businesses/${businessId}/unread-count`),
    ]);
    // Switched while this was in flight: these rows belong to the previous business.
    if (getStoredBusinessId() !== businessId) return;
    if (listRes.data) setNotifications(listRes.data as AppNotification[]);
    if (countRes.data) setUnreadCount((countRes.data as { count?: number }).count ?? 0);
    notificationsBusinessRef.current = businessId;
  }, []);

  const fetchConnectorAlerts = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await apiGet(`/connectors/businesses/${businessId}/needs-attention`);
    if (getStoredBusinessId() !== businessId) return;
    if (res.data) {
      setConnectorAlertCount((res.data as { count?: number }).count ?? 0);
    }
  }, []);

  useEffect(() => {
    let canceled = false;
    fetchNotifications();
    fetchConnectorAlerts();
    const interval = setInterval(() => {
      if (document.hidden) return; // skip background-tab work
      fetchNotifications();
      fetchConnectorAlerts();
    }, 30000);
    // A switch: what is on screen describes the previous business, so drop it
    // at once, then load the new business's once its resolution has landed.
    const onBusinessChanged = () => {
      notificationsBusinessRef.current = null;
      setNotifications([]);
      setUnreadCount(0);
      setConnectorAlertCount(0);
      void refreshWorkspace()
        .catch(() => null)
        .then(() => {
          if (canceled) return;
          fetchNotifications();
          fetchConnectorAlerts();
        });
    };
    window.addEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    return () => {
      canceled = true;
      clearInterval(interval);
      window.removeEventListener(BUSINESS_CHANGED_EVENT, onBusinessChanged);
    };
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
    // The business whose notifications are displayed, and only while it is
    // still the selected one: one tenant's list is never marked read on another.
    const businessId = notificationsBusinessRef.current;
    if (!businessId || businessId !== getStoredBusinessId()) return;
    await apiPatch(`/notifications/businesses/${businessId}/read-all`, {});
    if (notificationsBusinessRef.current !== businessId) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      // apiPost takes ONE options object; apiPatch two lines up is positional.
      // That asymmetry is the whole bug — TS2554, which skipped every downstream
      // CI job and blocked the deploy.
      await apiPost({ path: "/identity/logout", body: {} });
    } catch {
      // Best-effort server-side revocation. Always clear local state so the
      // user is not trapped if the API is unreachable.
    }
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
