"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { useNavigationContext } from "@/lib/navigation-context";
import {
  getLabel,
  getAlias,
  getParentOverride,
  isNoLinkSegment,
  isConfigSurface,
  isDetailSurface,
  SEMANTIC_TAB_MAP,
} from "@/lib/semantic-routes";

/* ────────────────────────────────────────────────────────────────
 * Breadcrumb rendering using the Semantic Route Registry.
 * See src/lib/semantic-routes.ts for the canonical definitions.
 * ──────────────────────────────────────────────────────────────── */

function isUuid(s: string) {
  return /^[0-9a-f-]{20,}$/i.test(s);
}

/* ─── Flow Connector between crumbs ─── */
function FlowConnector() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mx-0.5 opacity-40">
      <path
        d="M4 8h8M9 5l3 3-3 3"
        stroke="url(#crumbGradient)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="crumbGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--kf-accent1))" />
          <stop offset="100%" stopColor="hsl(var(--kf-accent2))" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function OriginAwareBreadcrumbs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { getOriginContext } = useNavigationContext();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return null;

  const appIndex = segments.indexOf("app");
  if (appIndex === -1) return null;

  const crumbs = segments.slice(appIndex + 1);
  if (crumbs.length === 0) return null;

  const topModule = crumbs[0];
  const configSurface = isConfigSurface(topModule);
  const detailSurface =
    crumbs.length > 1 && isDetailSurface(topModule) && crumbs.some(isUuid);

  const origin = isHydrated ? getOriginContext() : null;
  const showOriginContext =
    (configSurface || detailSurface) && origin && origin.route !== pathname;

  /* ── Build intermediate hrefs with alias resolution ── */
  const crumbMeta = crumbs.map((segment, idx) => {
    if (isUuid(segment)) return null;

    const rawHref = "/app/" + crumbs.slice(0, idx + 1).join("/");
    const aliasedHref = getAlias(rawHref) ?? rawHref;
    const hasAlias = aliasedHref !== rawHref;

    // Determine if this segment should be a link:
    // 1. Last crumb is always plain text
    // 2. UUID-preceding crumb is plain text
    // 3. Segments in NO_LINK_SEGMENTS are plain text (they're detail tabs)
    // 4. Segments with aliases are links (they redirect to a real page)
    const isLast =
      idx === crumbs.length - 1 ||
      (idx === crumbs.length - 2 && isUuid(crumbs[crumbs.length - 1]));

    const isNoLink = isNoLinkSegment(segment);
    const isLinkable = !isLast && !isNoLink;

    return {
      segment,
      href: isLinkable ? aliasedHref : undefined,
      label: getLabel(segment),
      isLast,
      hasAlias,
    };
  });

  /* ── Active tab label (if any) ── */
  const tabParam = searchParams.get("tab");
  const viewParam = searchParams.get("view");
  let tabLabel: string | null = null;
  if (tabParam) {
    // Find the deepest matching base path in TAB_MAP
    const tabMapKeys = Object.keys(SEMANTIC_TAB_MAP).sort((a, b) => b.length - a.length);
    for (const base of tabMapKeys) {
      if (pathname === base || pathname.startsWith(base + "/")) {
        tabLabel = SEMANTIC_TAB_MAP[base]?.[tabParam] ?? null;
        break;
      }
    }
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-0.5 text-xs text-muted-foreground px-1 py-1.5 flex-wrap"
    >
      <AnimatePresence mode="popLayout">
        {showOriginContext && origin && (
          <motion.span
            key="origin"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex items-center gap-1"
          >
            <Link
              href={origin.route}
              className="flex items-center gap-1 text-muted-foreground/70 hover:text-foreground transition-colors group"
              title={`Return to ${origin.workspace ?? "previous page"}`}
            >
              <ChevronLeft className="w-3 h-3 text-muted-foreground/50 group-hover:text-[hsl(var(--kf-accent2))] transition-colors" />
              <span className="italic">
                {origin.workspace ?? "Previous"}
                {origin.tab
                  ? ` › ${origin.tab.charAt(0).toUpperCase() + origin.tab.slice(1)}`
                  : ""}
                {origin.selectedEntityLabel
                  ? ` › ${origin.selectedEntityLabel}`
                  : ""}
              </span>
            </Link>
            <FlowConnector />
          </motion.span>
        )}
      </AnimatePresence>

      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05 }}
      >
        <Link href="/app" className="hover:text-foreground transition-colors">
          Home
        </Link>
      </motion.span>

      {crumbMeta.flatMap((meta, idx) => {
        if (!meta) return [];
        const { segment, href, label, isLast } = meta;

        const parentOverride = getParentOverride(segment);
        const items: React.ReactNode[] = [];

        if (parentOverride) {
          parentOverride.forEach((parent, pIdx) => {
            items.push(
              <motion.span
                key={`parent-${segment}-${pIdx}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  delay: idx * 0.04 + 0.05,
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                }}
                className="flex items-center gap-0.5"
              >
                <FlowConnector />
                <Link href={parent.href} className="hover:text-foreground transition-colors">
                  {parent.label}
                </Link>
              </motion.span>
            );
          });
        }

        // For /app/commerce and /app/expenses with tabs, render tab + view as separate crumbs
        const isTabbedPage = (segment === "commerce" || segment === "expenses") && tabParam && tabLabel;
        const viewLabel = viewParam ? viewParam.charAt(0).toUpperCase() + viewParam.slice(1) : null;

        if (isTabbedPage) {
          // Module crumb (linkable)
          items.push(
            <motion.span
              key={segment + idx}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: idx * 0.04 + 0.05,
                type: "spring",
                stiffness: 400,
                damping: 25,
              }}
              className="flex items-center gap-0.5"
            >
              <FlowConnector />
              <Link href={href ?? `/app/${segment}`} className="hover:text-foreground transition-colors">
                {label}
              </Link>
            </motion.span>
          );
          // Tab crumb (linkable, not last if view exists)
          items.push(
            <motion.span
              key={`tab-${tabParam}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: idx * 0.04 + 0.08,
                type: "spring",
                stiffness: 400,
                damping: 25,
              }}
              className="flex items-center gap-0.5"
            >
              <FlowConnector />
              <Link href={`/app/${segment}?tab=${tabParam}`} className="hover:text-foreground transition-colors">
                {tabLabel}
              </Link>
            </motion.span>
          );
          // View crumb (last, plain text)
          if (viewLabel) {
            items.push(
              <motion.span
                key={`view-${viewParam}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  delay: idx * 0.04 + 0.11,
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                }}
                className="flex items-center gap-0.5"
              >
                <FlowConnector />
                <span className="text-foreground font-medium relative">
                  {viewLabel}
                  <motion.span
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    className="absolute -bottom-0.5 left-0 right-0 h-[2px] rounded-full origin-left"
                    style={{
                      background:
                        "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    }}
                  />
                </span>
              </motion.span>
            );
          }
        } else {
          items.push(
            <motion.span
              key={segment + idx}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                delay: idx * 0.04 + 0.05,
                type: "spring",
                stiffness: 400,
                damping: 25,
              }}
              className="flex items-center gap-0.5"
            >
              <FlowConnector />
              {isLast ? (
                <span className="text-foreground font-medium relative">
                  {/* Books tabs on reports page show "Books" instead of "Reports › Books · PnL" */}
                  {tabParam?.startsWith("books-") && segment === "reports" ? "Books" : label}
                  {tabLabel && !(tabParam?.startsWith("books-") && segment === "reports") && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      › {tabLabel}
                    </span>
                  )}
                  {detailSurface &&
                    idx ===
                      crumbs.length - (isUuid(crumbs[crumbs.length - 1]) ? 2 : 1) && (
                      <motion.span
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        className="absolute -bottom-0.5 left-0 right-0 h-[2px] rounded-full origin-left"
                        style={{
                          background:
                            "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                        }}
                      />
                    )}
                </span>
              ) : href ? (
                <Link
                  href={href}
                  className="hover:text-foreground transition-colors"
                >
                  {label}
                </Link>
              ) : (
                <span className="text-muted-foreground/60">{label}</span>
              )}
            </motion.span>
          );
        }

        return items;
      })}
    </nav>
  );
}
