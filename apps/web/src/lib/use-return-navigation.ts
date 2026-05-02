"use client";

import { useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { useLatestRef } from "@/hooks/use-latest-ref";

export type TargetStatus = "available" | "deleted" | "unavailable" | "unknown";

interface ReturnNavigationOptions {
  fallback?: string;
  restoreScrollOnMount?: boolean;
  skipScrollListener?: boolean;
}

const SCROLL_STORAGE_PREFIX = "kf-scroll-";

function getAppScrollContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>("[data-scroll-root='app']");
}

function readContainerScroll(): number {
  const el = getAppScrollContainer();
  if (el) return el.scrollTop;
  if (typeof window !== "undefined") return window.scrollY;
  return 0;
}

export function saveScrollPosition(route: string, scrollY: number) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SCROLL_STORAGE_PREFIX + route, String(scrollY));
  } catch {}
}

export function getScrollPosition(route: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(SCROLL_STORAGE_PREFIX + route);
    return v !== null ? Number(v) : null;
  } catch {
    return null;
  }
}

export function restoreScrollPosition(route: string, containerEl?: HTMLElement | null) {
  if (typeof window === "undefined") return;
  const y = getScrollPosition(route);
  if (y === null) return;
  const target = containerEl ?? getAppScrollContainer();
  try {
    if (target) {
      target.scrollTop = y;
    } else {
      window.scrollTo({ top: y, behavior: "auto" });
    }
  } catch {}
}

export function useReturnNavigation(options: ReturnNavigationOptions = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { getOriginContext, getTaskOrigin, stack, current } = useNavigationContext();
  const pathnameRef = useLatestRef(pathname);

  useEffect(() => {
    if (!options.restoreScrollOnMount) return;
    if (!pathname) return;
    const stored = getScrollPosition(pathname);
    if (stored !== null) {
      const t = requestAnimationFrame(() => {
        const target = getAppScrollContainer();
        if (target) {
          target.scrollTop = stored;
        } else {
          window.scrollTo({ top: stored, behavior: "auto" });
        }
      });
      return () => cancelAnimationFrame(t);
    }
  }, [pathname, options.restoreScrollOnMount]);

  useEffect(() => {
    if (!pathname || options.skipScrollListener) return;
    const el = getAppScrollContainer();
    const scrollTarget = el ?? window;

    const onScroll = () => {
      saveScrollPosition(pathnameRef.current ?? "", readContainerScroll());
    };

    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollTarget.removeEventListener("scroll", onScroll);
      saveScrollPosition(pathnameRef.current ?? "", readContainerScroll());
    };
  }, [pathname, options.skipScrollListener, pathnameRef]);

  const getReturnLabel = useCallback(
    (overrideLabel?: string): string => {
      if (overrideLabel) return overrideLabel;
      const origin = getTaskOrigin() ?? getOriginContext();
      if (!origin) return "Back";

      const parts: string[] = [];
      if (origin.workspace) parts.push(origin.workspace);
      if (origin.tab) parts.push(origin.tab.charAt(0).toUpperCase() + origin.tab.slice(1));
      if (origin.selectedEntityLabel) parts.push(origin.selectedEntityLabel);

      if (parts.length === 0) return "Back";
      return `Back to ${parts.join(" › ")}`;
    },
    [getOriginContext, getTaskOrigin]
  );

  const buildReturnHref = useCallback(
    (entry: NonNullable<ReturnType<typeof getOriginContext>>): string => {
      let href = entry.route;
      const params = new URLSearchParams();
      if (entry.tab) params.set("tab", entry.tab);
      Object.entries(entry.filters ?? {}).forEach(([k, v]) => params.set(k, v));
      const paramStr = params.toString();
      if (paramStr) href += `?${paramStr}`;
      return href;
    },
    []
  );

  const getReturnHref = useCallback((): string => {
    const origin = getTaskOrigin() ?? getOriginContext();
    if (origin) return buildReturnHref(origin);
    return options.fallback ?? "/app";
  }, [getOriginContext, getTaskOrigin, buildReturnHref, options.fallback]);

  const navigateBack = useCallback(
    (overrideHref?: string) => {
      saveScrollPosition(pathnameRef.current ?? "", readContainerScroll());
      const href = overrideHref ?? getReturnHref();
      router.push(href);
    },
    [getReturnHref, router, pathnameRef]
  );

  const navigateBackWithFallback = useCallback(
    (opts: { targetExists?: boolean; targetDeletedMessage?: string } = {}) => {
      if (opts.targetExists === false) {
        if (opts.targetDeletedMessage && typeof window !== "undefined") {
          sessionStorage.setItem("kf-deleted-target-msg", opts.targetDeletedMessage);
        }
        const fallbackChain = stack.slice().reverse();
        for (const entry of fallbackChain) {
          const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
          if (!entry.route.includes("[") && entry.route !== currentPath) {
            router.push(entry.route);
            return { navigated: true, reason: "target-deleted" as const };
          }
        }
        router.push(options.fallback ?? "/app");
        return { navigated: true, reason: "fallback-used" as const };
      }
      navigateBack();
      return { navigated: true, reason: "normal" as const };
    },
    [stack, navigateBack, router, options.fallback]
  );

  const getOriginWorkspace = useCallback((): string | null => {
    return (getTaskOrigin() ?? getOriginContext())?.workspace ?? null;
  }, [getOriginContext, getTaskOrigin]);

  return {
    getReturnLabel,
    getReturnHref,
    navigateBack,
    navigateBackWithFallback,
    getOriginWorkspace,
    hasOrigin: stack.length > 1,
    current,
    saveScrollPosition,
    getScrollPosition,
    restoreScrollPosition,
  };
}
