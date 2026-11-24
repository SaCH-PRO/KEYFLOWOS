"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { useNavigationContext } from "@/lib/navigation-context";
import { isAppPage } from "@/lib/app-page-routes";
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

/**
 * NAV-A3 (BUG-123): a database id is never a crumb. Ids are uuids or cuids ("cmwujpiuf00n57dx4navng6ud": letters past
 * "f", so a hex-only check missed them); a route segment is a word or a slug, which has no digits.
 */
function isId(s: string) {
  if (/^[0-9a-f-]{20,}$/i.test(s)) return true;
  return s.length >= 16 && /^[a-z0-9_-]+$/i.test(s) && /\d/.test(s) && /[a-z]/i.test(s);
}

/** Pages whose crumb is not their segment's registry label (NAV-A3 NIT-7: the account page is not "Profile"). */
const PAGE_LABELS: Record<string, string> = { "/app/settings/profile": "My account" };

/** NAV-A3 (BUG-123): a segment the registry does not name reads as words ("data-quality" -> "Data quality"). */
function labelFor(segment: string) {
  const label = getLabel(segment);
  if (label !== segment) return label;
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
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
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return null;

  const appIndex = segments.indexOf("app");
  if (appIndex === -1) return null;

  const crumbs = segments.slice(appIndex + 1);
  if (crumbs.length === 0) return null;

  const topModule = crumbs[0];
  const configSurface = isConfigSurface(topModule);
  const detailSurface = crumbs.length > 1 && isDetailSurface(topModule) && crumbs.some(isId);

  const origin = isHydrated ? getOriginContext() : null;
  const showOriginContext =
    (configSurface || detailSurface) && origin && origin.route !== pathname;

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
  const viewLabel = viewParam ? viewParam.charAt(0).toUpperCase() + viewParam.slice(1) : null;

  /*
   * ── The trail, built as a list first (NAV-A3) ──
   * A crumb is a link only when its path opens a page (BUG-067: lib/app-page-routes.ts); otherwise it is plain text.
   * Ids are never crumbs, and a segment the registry does not name reads as words (BUG-123). A label already on the
   * trail is not repeated (BUG-123: /app/money/expenses read "Money > Money > Expenses").
   */
  type Crumb = { key: string; label: string; href?: string; current?: boolean; suffix?: string | null; underline?: boolean };
  const linkIfPage = (href: string | undefined) => (href && isAppPage(href) ? href : undefined);
  let lastIdx = -1;
  crumbs.forEach((seg, i) => { if (!isId(seg)) lastIdx = i; });

  const built: Crumb[] = [];
  crumbs.forEach((segment, idx) => {
    if (isId(segment)) return;
    const rawHref = "/app/" + crumbs.slice(0, idx + 1).join("/");
    const href = getAlias(rawHref) ?? rawHref;
    const label = PAGE_LABELS[rawHref] ?? labelFor(segment);
    const isLast = idx === lastIdx;

    // A module's parent (Money above Books, Expenses, Reports) belongs only where the module is the top level: under
    // /app/money it is already on the trail, and /app/intelligence/reports is not Money's (review MINOR-6).
    if (idx === 0) getParentOverride(segment)?.forEach((parent, pIdx) => {
      built.push({ key: `parent-${segment}-${pIdx}`, label: parent.label, href: linkIfPage(parent.href) });
    });

    // For /app/commerce and /app/expenses with tabs, render tab + view as separate crumbs
    if ((segment === "commerce" || segment === "expenses") && tabParam && tabLabel) {
      built.push({ key: segment + idx, label, href: linkIfPage(href) ?? linkIfPage(`/app/${segment}`) });
      const tabBase = `/app/${segment}`;
      built.push({ key: `tab-${tabParam}`, label: tabLabel, href: isAppPage(tabBase) ? `${tabBase}?tab=${tabParam}` : undefined });
      if (viewLabel) built.push({ key: `view-${viewParam}`, label: viewLabel, current: true, underline: true });
      return;
    }

    if (isLast) {
      // Books tabs on reports page show "Books" instead of "Reports › Books · PnL"
      const books = !!tabParam?.startsWith("books-") && segment === "reports";
      built.push({
        key: segment + idx,
        label: books ? "Books" : label,
        current: true,
        suffix: books ? null : tabLabel,
        underline: detailSurface,
      });
      return;
    }
    built.push({ key: segment + idx, label, href: isNoLinkSegment(segment) ? undefined : linkIfPage(href) });
  });

  // No doubles: a label already on the trail (Home included), or a link to a page an earlier crumb already opens
  // (Customers and Contacts both open /app/crm/contacts), is dropped; the current crumb always stays.
  const trail: Crumb[] = [];
  const seen = new Set<string>(["Home"]);
  const seenHrefs = new Set<string>(["/app"]);
  for (const c of built) {
    if (c.href && !c.current) {
      if (seenHrefs.has(c.href)) continue;
      seenHrefs.add(c.href);
    }
    if (seen.has(c.label)) {
      if (!c.current) continue;
      const earlier = trail.findIndex((t) => t.label === c.label);
      if (earlier >= 0) trail.splice(earlier, 1);
    }
    seen.add(c.label);
    trail.push(c);
  }

  const underlineBar = (
    <motion.span
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      className="absolute -bottom-0.5 left-0 right-0 h-[2px] rounded-full origin-left"
      style={{
        background:
          "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
      }}
    />
  );

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

      {trail.map((crumb, idx) => (
        <motion.span
          key={crumb.key}
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
          {crumb.current ? (
            <span className="text-foreground font-medium relative" aria-current="page">
              {crumb.label}
              {crumb.suffix && (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  › {crumb.suffix}
                </span>
              )}
              {crumb.underline && underlineBar}
            </span>
          ) : crumb.href ? (
            <Link href={crumb.href} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-muted-foreground/60">{crumb.label}</span>
          )}
        </motion.span>
      ))}
    </nav>
  );
}
