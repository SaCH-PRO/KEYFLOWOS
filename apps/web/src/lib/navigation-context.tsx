"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export interface NavigationEntry {
  route: string;
  workspace: string | null;
  tab: string | null;
  submode: string | null;
  selectedEntityId: string | null;
  selectedEntityLabel: string | null;
  filters: Record<string, string>;
  draftId: string | null;
  hasUnsavedChanges: boolean;
  taskIntent: string | null;
  timestamp: number;
  scrollY: number;
}

export interface NavigationContextValue {
  current: NavigationEntry | null;
  stack: NavigationEntry[];
  previous: NavigationEntry | null;
  getOriginContext: () => NavigationEntry | null;
  getTaskOrigin: () => NavigationEntry | null;
  setTaskOrigin: (entry: NavigationEntry | null) => void;
  setCurrentMeta: (meta: Partial<Omit<NavigationEntry, "route" | "timestamp" | "workspace">>) => void;
  pushContext: (entry: Partial<NavigationEntry>) => void;
  goBackTo: (route: string) => NavigationEntry | null;
  clearStack: () => void;
}

const DEFAULT_ENTRY: NavigationEntry = {
  route: "",
  workspace: null,
  tab: null,
  submode: null,
  selectedEntityId: null,
  selectedEntityLabel: null,
  filters: {},
  draftId: null,
  hasUnsavedChanges: false,
  taskIntent: null,
  timestamp: 0,
  scrollY: 0,
};

const WORKSPACE_MAP: Record<string, string> = {
  crm: "CRM",
  pipeline: "CRM",
  contacts: "CRM",
  commerce: "Revenue",
  invoices: "Revenue",
  quotes: "Revenue",
  payments: "Revenue",
  products: "Revenue",
  bookings: "Calendar",
  marketing: "Content",
  expenses: "Expenses",
  projects: "Projects",
  automations: "Flows",
  reports: "Reports",
  store: "Presence",
  settings: "Studio",
  studio: "Studio",
  learn: "Learn",
  community: "Community",
  profile: "Profile",
};

function getWorkspaceFromRoute(route: string): string | null {
  const segments = route.split("/").filter(Boolean);
  const appIdx = segments.indexOf("app");
  if (appIdx === -1) return null;
  const moduleSegment = segments[appIdx + 1];
  return moduleSegment ? (WORKSPACE_MAP[moduleSegment] ?? null) : null;
}

function buildFilters(searchParams: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (key !== "tab") filters[key] = value;
  });
  return filters;
}

const STACK_STORAGE_KEY = "kf-nav-stack";
const TASK_ORIGIN_KEY = "kf-task-origin";
const MAX_STACK_SIZE = 20;

function isClient(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function loadStack(): NavigationEntry[] {
  if (!isClient()) return [];
  try {
    const raw = sessionStorage.getItem(STACK_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NavigationEntry[];
  } catch {
    return [];
  }
}

function saveStack(stack: NavigationEntry[]) {
  if (!isClient()) return;
  try {
    sessionStorage.setItem(STACK_STORAGE_KEY, JSON.stringify(stack));
  } catch {}
}

function loadTaskOrigin(): NavigationEntry | null {
  if (!isClient()) return null;
  try {
    const raw = sessionStorage.getItem(TASK_ORIGIN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NavigationEntry;
  } catch {
    return null;
  }
}

function saveTaskOrigin(entry: NavigationEntry | null) {
  if (!isClient()) return;
  try {
    if (entry === null) {
      sessionStorage.removeItem(TASK_ORIGIN_KEY);
    } else {
      sessionStorage.setItem(TASK_ORIGIN_KEY, JSON.stringify(entry));
    }
  } catch {}
}

const NavigationContext = createContext<NavigationContextValue>({
  current: null,
  stack: [],
  previous: null,
  getOriginContext: () => null,
  getTaskOrigin: () => null,
  setTaskOrigin: () => {},
  setCurrentMeta: () => {},
  pushContext: () => {},
  goBackTo: () => null,
  clearStack: () => {},
});

export function NavigationContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stack, setStack] = useState<NavigationEntry[]>(() => loadStack());
  const [taskOrigin, setTaskOriginState] = useState<NavigationEntry | null>(() => loadTaskOrigin());
  const metaOverrideRef = useRef<Partial<NavigationEntry>>({});

  const prevRouteRef = useRef<string>("");
  const prevTabRef = useRef<string | null>(null);

  const buildEntry = useCallback(
    (route: string, overrides: Partial<NavigationEntry> = {}): NavigationEntry => {
      const tab = searchParams.get("tab");
      const workspace = getWorkspaceFromRoute(route);
      const filters = buildFilters(searchParams);

      return {
        ...DEFAULT_ENTRY,
        route,
        workspace,
        tab,
        filters: Object.keys(filters).length > 0 ? filters : {},
        timestamp: Date.now(),
        scrollY: 0,
        ...overrides,
      };
    },
    [searchParams]
  );

  useEffect(() => {
    if (!pathname) return;

    const currentTab = searchParams.get("tab");
    const isNewRoute = pathname !== prevRouteRef.current;
    const isNewTab = currentTab !== prevTabRef.current;

    if (!isNewRoute && !isNewTab) {
      setStack((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = updated[updated.length - 1];
        const newFilters = buildFilters(searchParams);
        updated[updated.length - 1] = {
          ...last,
          filters: newFilters,
          tab: currentTab,
        };
        saveStack(updated);
        return updated;
      });
      return;
    }

    setStack((prev) => {
      const updatedPrev = prev.length > 0
        ? prev.map((e, i) =>
            i === prev.length - 1 ? { ...e } : e
          )
        : prev;

      const newEntry = buildEntry(pathname, metaOverrideRef.current);
      metaOverrideRef.current = {};

      const filtered = updatedPrev.filter(
        (e) => !(e.route === pathname && e.tab === currentTab)
      );
      const next = [...filtered, newEntry].slice(-MAX_STACK_SIZE);
      saveStack(next);
      return next;
    });

    prevRouteRef.current = pathname;
    prevTabRef.current = currentTab;
  }, [pathname, searchParams, buildEntry]);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;
  const previous = stack.length > 1 ? stack[stack.length - 2] : null;

  const getOriginContext = useCallback((): NavigationEntry | null => {
    if (stack.length < 2) return null;
    return stack[stack.length - 2];
  }, [stack]);

  const getTaskOrigin = useCallback((): NavigationEntry | null => {
    return taskOrigin;
  }, [taskOrigin]);

  const setTaskOrigin = useCallback((entry: NavigationEntry | null) => {
    setTaskOriginState(entry);
    saveTaskOrigin(entry);
  }, []);

  const setCurrentMeta = useCallback(
    (meta: Partial<Omit<NavigationEntry, "route" | "timestamp" | "workspace">>) => {
      setStack((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], ...meta };
        saveStack(updated);
        return updated;
      });
    },
    []
  );

  const pushContext = useCallback((entry: Partial<NavigationEntry>) => {
    metaOverrideRef.current = { ...metaOverrideRef.current, ...entry };
  }, []);

  const goBackTo = useCallback(
    (route: string): NavigationEntry | null => {
      const found = [...stack]
        .reverse()
        .find((e) => e.route === route || e.route.startsWith(route));
      return found ?? null;
    },
    [stack]
  );

  const clearStack = useCallback(() => {
    setStack([]);
    setTaskOriginState(null);
    if (isClient()) {
      try {
        sessionStorage.removeItem(STACK_STORAGE_KEY);
        sessionStorage.removeItem(TASK_ORIGIN_KEY);
      } catch {}
    }
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        current,
        stack,
        previous,
        getOriginContext,
        getTaskOrigin,
        setTaskOrigin,
        setCurrentMeta,
        pushContext,
        goBackTo,
        clearStack,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigationContext() {
  return useContext(NavigationContext);
}
