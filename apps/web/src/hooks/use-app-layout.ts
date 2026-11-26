"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { useThemeColors } from "@/lib/theme-context";
import { usePlanLimitHandler } from "./use-plan";
import {
  clearStoredBusinessId,
  dismissSessionToasts,
  getStoredBusinessId,
  getCachedUser,
  getUserDisplayName,
  getUserInitials,
  refreshWorkspace,
  getCachedBusiness,
  canOpenOwnerConsole,
  BUSINESS_CHANGED_EVENT,
} from "@/lib/workspace";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
// The nav's reader of what the business sells (BIZ-SETTINGS-WEB). Not the settings page's hook of the same name
// (app/app/settings/business/use-business-settings.ts).
import { BUSINESS_SETTINGS_FRESH_MS, actingMemberNow, useBusinessSettings } from "@/lib/business-settings";
import { featureFlags as dormantFeatureFlags } from "@/lib/feature-flags";
import type { AppNotification } from "@/lib/notifications";
import type { ResolvedFeatureFlag } from "@/lib/nav-config";
import {
  moreNav,
  meNavFor,
  isNavItemActive,
  isHubActive,
  hubsFor,
  bottomBarFor,
  menuSectionsFor,
  memberModuleLevelsOf,
  type HubNavItem,
  type ModuleLevels,
  type NavItem,
  type NavSection,
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

  /** The hubs this member is shown, for what the business sells (NAV-A1). */
  visibleHubs: HubNavItem[];
  /** The phone's two hub slots between Today, New and More. */
  bottomBarHubs: HubNavItem[];
  /** More's hub sections (each hub's screens), then everything else, as this member may open them. */
  visibleOperateSections: NavSection[];
  visibleBuildSections: NavSection[];
  visibleMoreNav: NavItem[];
  meNav: NavItem[];
  /**
   * The member's level per module in the selected business, as GET my-access answered (null: unknown). Handed to the
   * header's New menu (WEDGE-WA-INBOUND-CAPTURE review COR-4), so opening it never asks again.
   */
  moduleLevels: ModuleLevels;

  isSecondaryActive: (item: NavItem) => boolean;
  isPrimaryActive: (hub: HubNavItem) => boolean;

  addMenuOpen: boolean;
  setAddMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;

  mobileDrawerOpen: boolean;
  setMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;

  userMenuOpen: boolean;
  setUserMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  userMenuRef: React.RefObject<HTMLDivElement | null>;

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

  // The rail follows the search params as they change, not only on a pathname
  // change (W9-WEB-COMMERCE-NAV): a nav door that changes only ?tab or ?view
  // (Money > Quotes clicked from Money > Sales on /app/commerce) left the rail
  // lit for the tab read on the last pathname change.
  const searchParams = useSearchParams();

  const [drawerSurface, setDrawerSurface] = useState<DrawerSurface>(null);

  useEffect(() => {
    setDrawerSurface(null);
  }, [pathname]);

  const isSecondaryActive = useCallback(
    (item: NavItem) => isNavItemActive(item, pathname, searchParams),
    [pathname, searchParams],
  );

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

  // NAV-A1 (D-150, D-179): the hubs follow what the business sells and what this member may open.
  const businessSettings = useBusinessSettings();
  // Known only once the business's settings are ready (review COR-2; FU-NAV-A1-CODEX-224): idle (the hydration
  // render, before the stored business is read, or no business stored), loading and failed all hold the defaults,
  // not what the business sells, so no sells-dependent hub shows from them and no wrong bar flashes or stays.
  const sells = businessSettings.status === "ready" ? businessSettings.sells : null;
  const moduleLevels = useMemberModuleLevels();

  const visibleHubs = useMemo(() => hubsFor(sells, moduleLevels), [sells, moduleLevels]);
  const bottomBarHubs = useMemo(() => bottomBarFor(sells, moduleLevels), [sells, moduleLevels]);
  // FU-ME-NOTIFICATIONS-SCOPE (D-276): the Me menu offers Notifications only to settings readers.
  const meNav = useMemo(() => meNavFor(moduleLevels), [moduleLevels]);

  const { visibleOperateSections, visibleBuildSections } = useMemo(() => {
    const { hubSections, moreSections } = menuSectionsFor(sells, moduleLevels);
    const undormant = (sections: NavSection[]) =>
      sections
        .map((section) => ({ ...section, items: section.items.filter((i) => !isItemHiddenByDormantFlag(i)) }))
        .filter((s) => s.items.length > 0);
    return { visibleOperateSections: undormant(hubSections), visibleBuildSections: undormant(moreSections) };
  }, [sells, moduleLevels, isItemHiddenByDormantFlag]);

  const visibleMoreNav = useMemo(
    () => moreNav.filter((i) => !isItemHiddenByDormantFlag(i)),
    [isItemHiddenByDormantFlag],
  );

  const { planLimitHit, clearPlanLimit } = usePlanLimitHandler();
  const [kfStoreOpen, setKfStoreOpen] = useState(false);

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
          crm: "Customers", pipeline: "Customers", people: "Customers", network: "Customers",
          commerce: "Sales", money: "Money",
          bookings: "Schedule", schedule: "Schedule",
          marketing: "Communicate", communicate: "Communicate",
          expenses: "Money",
          projects: "Work", work: "Work",
          documents: "Documents",
          automations: "Automate", "build": "Build",
          reports: "Intelligence", intelligence: "Intelligence",
          store: "Your page", settings: "Settings",
          learn: "Learn",
          community: "Community", marketplace: "Marketplace",
          "command-center": "Today",
          "control-tower": "Today",
          "keyflow-command": "Today",
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
    // The Owner Console link (D-290): only where the admin shell would open (canOpenOwnerConsole, the admin layout's
    // own guard). A normally signed-in SUPER_ADMIN without the separate admin sign-in is never offered a link that
    // ends at /admin/login.
    setIsAdminUser(canOpenOwnerConsole());
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
    // FU-UNDO-TOAST-SIGNOUT (D-283): the member chose to leave, so the session's toasts (a pending Undo among them) go
    // now, not once the server answers; clearStoredBusinessId below dismisses any raised meanwhile.
    dismissSessionToasts();
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

  const isPrimaryActive = useCallback((hub: HubNavItem) => isHubActive(hub, pathname), [pathname]);

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
    visibleHubs,
    bottomBarHubs,
    visibleOperateSections,
    visibleBuildSections,
    visibleMoreNav,
    meNav,
    moduleLevels,
    isSecondaryActive,
    isPrimaryActive,
    addMenuOpen,
    setAddMenuOpen,
    mobileDrawerOpen,
    setMobileDrawerOpen,
    userMenuOpen,
    setUserMenuOpen,
    userMenuRef,
    kfStoreOpen,
    setKfStoreOpen,
    planLimitHit,
    clearPlanLimit,
    handleLogout,
  };
}

/* ───────────────────────── the member's module levels (NAV-A1) ───────────────────────── */

/** The selected business and the member acting, as one key: either changing is another answer to wait for. */
function subscribeToSelection(onChange: () => void) {
  window.addEventListener(BUSINESS_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(BUSINESS_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const selectionKey = () => {
  const businessId = getStoredBusinessId();
  return businessId ? `${actingMemberNow()}\n${businessId}` : null;
};

const NO_SELECTION_ON_SERVER = () => null;

/**
 * NAV-A1 (D-150, D-179; journey J5): the signed-in member's level on each module of the selected business, as the
 * server reads it (GET identity/businesses/:b/my-access), for the nav to offer only the hubs they may open. Null
 * (unknown) until this business's answer lands, and when the read fails: unknown hides nothing (WOS-R1), and the
 * server still refuses. An answer belongs to the member and the business it was asked for (review SEC-1): it is
 * applied only while both are still the ones selected, and a switch (selectBusiness, another tab's sign-in or
 * selection, refreshWorkspace's correction picked up on the next render) reads again. The tab looked at again reads
 * again too, so an owner's change to this member's scopes reaches their menu without a reload (SEC-2, COR-7).
 */
export function useMemberModuleLevels(): ModuleLevels {
  const key = useSyncExternalStore(subscribeToSelection, selectionKey, NO_SELECTION_ON_SERVER);
  const [answered, setAnswered] = useState<{ key: string; levels: ModuleLevels; at: number } | null>(null);
  const [lookedAgain, setLookedAgain] = useState(0);
  const answeredRef = useRef(answered);
  useEffect(() => {
    answeredRef.current = answered;
  }, [answered]);

  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "hidden") return;
      // Levels read within the freshness window: nothing to ask (review R2-COR-2). Only an answer with levels is
      // fresh, as only a ready entry is in business-settings: a failed read is asked again on the next look (round 3).
      // A clock stepped back past the answer counts it stale, never fresh for ever (round 4). A return to the tab fires
      // visibilitychange and focus together; lib/api joins the identical reads in flight into one request.
      const last = answeredRef.current;
      const age = last ? Date.now() - last.at : -1;
      if (last && last.levels !== null && age >= 0 && age < BUSINESS_SETTINGS_FRESH_MS) return;
      setLookedAgain((n) => n + 1);
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    const businessId = key.slice(key.indexOf("\n") + 1);
    let disposed = false;
    void apiGet(`/identity/businesses/${encodeURIComponent(businessId)}/my-access`)
      .then((res) => (res.error ? null : memberModuleLevelsOf(res.data)))
      .catch(() => null)
      .then((levels) => {
        // A later read (another look, another member or business) is already on its way: this one is not current.
        if (disposed) return;
        // A failed re-read says nothing new about this member: what is known for the same member and business stays
        // (review R2-COR-1). Unknown only for a selection never answered.
        setAnswered((prev) => (levels === null && prev?.key === key && prev.levels !== null ? prev : { key, levels, at: Date.now() }));
      });
    return () => {
      disposed = true;
    };
  }, [key, lookedAgain]);

  return answered !== null && answered.key === key ? answered.levels : null;
}
