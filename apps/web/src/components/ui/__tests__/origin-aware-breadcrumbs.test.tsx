/**
 * NAV-A3 (sweep BUG-067, BUG-123): the breadcrumbs come from the route registry.
 *
 *   - BUG-067: a crumb linked a route with no page. On /app/schedule/calendar the "Schedule" crumb went to
 *     /app/schedule, a 404 (only /app/schedule/calendar has a page).
 *   - BUG-123: a crumb showed a slug or a database id. Ids are cuids ("cmwu..." has letters past "f"), which the old
 *     uuid check missed, so a contact's pages showed the raw id as a crumb. And no doubles: on /app/money/expenses
 *     the trail read "Money > Money > Expenses", and the 28 pages built on StandardModuleLayout or UnifiedPageShell
 *     drew a second trail under the one the app layout draws.
 *
 * The oracle for "is a page" is the app's own page files, read from disk here (not the code under test).
 * Cases tagged RED-BEFORE fail on the packet's base (f6764f4c); CONTROL cases pass on both.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, cleanup, within } from "@testing-library/react";
import { FileText } from "lucide-react";

const nav = vi.hoisted(() => ({ pathname: "/app", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));

import { OriginAwareBreadcrumbs } from "../origin-aware-breadcrumbs";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import { APP_PAGE_ROUTES, isAppPage } from "@/lib/app-page-routes";

/* ── The oracle: every page.tsx under src/app/app, as a matcher ── */
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../app/app");
/** Each page's route as the page files spell it ("/app/crm/contacts/[contactId]"). */
const ROUTES_ON_DISK: string[] = [];
function pagePatterns(): RegExp[] {
  const out: RegExp[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name.startsWith("_") || e.name === "__tests__" || e.name === "components") continue;
        walk(path.join(dir, e.name), [...segs, e.name]);
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(e.name)) {
        let re = "^/app";
        for (const s of segs) {
          if (/^\(.*\)$/.test(s)) continue; // a route group adds no segment
          if (/^\[\[\.\.\..+\]\]$/.test(s)) re += "(?:/[^/]+)*";
          else if (/^\[\.\.\..+\]$/.test(s)) re += "(?:/[^/]+)+";
          else if (/^\[.+\]$/.test(s)) re += "/[^/]+";
          else re += "/" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        }
        out.push(new RegExp(re + "$"));
        ROUTES_ON_DISK.push(["/app", ...segs.filter((x) => !/^\(.*\)$/.test(x))].join("/"));
      }
    }
  };
  walk(APP_DIR, []);
  return out;
}
const PAGES = pagePatterns();
const isPage = (href: string) => PAGES.some((re) => re.test(href.split(/[?#]/)[0]!));

function trail(pathname: string, search = "") {
  cleanup();
  nav.pathname = pathname;
  nav.search = search;
  render(<OriginAwareBreadcrumbs />);
  const el = screen.getByRole("navigation", { name: "Breadcrumb" });
  const links = within(el).queryAllByRole("link").map((a) => ({ text: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" }));
  /** The crumbs as the reader sees them: each link, and each plain crumb's own label (a tab suffix is part of it). */
  const labels = Array.from(el.querySelectorAll(":scope > span > a, :scope > span > span"))
    .map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return { links, labels, text: (el.textContent ?? "").replace(/\s+/g, " ") };
}

afterEach(() => cleanup());

describe("NAV-A3: every crumb that is a link opens a page", () => {
  it("the oracle reads the app's pages (sanity)", () => {
    expect(PAGES.length).toBeGreaterThan(150);
    expect(isPage("/app/schedule/calendar")).toBe(true);
    expect(isPage("/app/schedule")).toBe(false);
    expect(isPage("/app/crm/contacts/cmwujpiuf00n57dx4navng6ud/overview")).toBe(true);
  });

  it("RED-BEFORE (BUG-067): on /app/schedule/calendar no crumb links /app/schedule", () => {
    const { links } = trail("/app/schedule/calendar");
    expect(links.map((l) => l.href)).not.toContain("/app/schedule");
  });

  it("RED-BEFORE (BUG-067): on a sample of real pages, every linked crumb is a page", () => {
    const id = "cmwujpiuf00n57dx4navng6ud";
    const paths = [
      "/app/schedule/calendar",
      `/app/crm/contacts/${id}/overview`,
      `/app/crm/accounts/${id}`,
      `/app/crm/sequences/${id}/analytics`,
      "/app/money/expenses",
      "/app/settings/team",
      "/app/commerce/invoices/new",
      `/app/key-flows/${id}`,
      "/app/finance/ledger",
    ];
    const broken: string[] = [];
    for (const p of paths) {
      expect(isPage(p), `${p} is itself a page (the sample is real)`).toBe(true);
      for (const l of trail(p).links) if (!isPage(l.href)) broken.push(`${p}: "${l.text}" -> ${l.href}`);
    }
    expect(broken).toEqual([]);
  });

  it("CONTROL: a parent that is a page stays a link (/app/commerce/invoices/new links Invoices)", () => {
    const { links } = trail("/app/commerce/invoices/new");
    expect(links).toContainEqual({ text: "Invoices", href: "/app/commerce/invoices" });
  });
});

describe("NAV-A3: labels, not slugs or ids", () => {
  it("RED-BEFORE (BUG-123): a contact's pages never show the contact's id", () => {
    const id = "cmwujpiuf00n57dx4navng6ud";
    for (const tab of ["overview", "money", "bookings", "notes", "timeline"]) {
      expect(trail(`/app/crm/contacts/${id}/${tab}`).text, tab).not.toContain(id);
    }
    expect(trail(`/app/crm/contacts/${id}`).text).not.toContain(id);
  });

  it("CONTROL: a uuid is hidden too", () => {
    const id = "3f2b8c1e-9a4d-4e7b-8f21-6c5d0a9e1b7f";
    expect(trail(`/app/crm/contacts/${id}/overview`).text).not.toContain(id);
  });

  it("RED-BEFORE (BUG-123): a segment the registry does not name is shown as words, not a slug", () => {
    const { labels } = trail("/app/crm/data-quality");
    expect(labels.join(" | ")).not.toMatch(/data-quality/);
    expect(labels).toContain("Data quality");
  });
});

describe("NAV-A3: no doubles", () => {
  it("RED-BEFORE (BUG-123): /app/money/expenses names Money once", () => {
    const { labels } = trail("/app/money/expenses");
    expect(labels.filter((l) => l === "Money")).toHaveLength(1);
  });

  it("RED-BEFORE (BUG-123): no label repeats on a sample of pages", () => {
    const doubles: string[] = [];
    for (const p of ["/app/money/expenses", "/app/money/books", "/app/finance/ledger", "/app/reports", "/app/crm/contacts", "/app/settings/team"]) {
      const { labels } = trail(p);
      const seen = new Set<string>();
      for (const l of labels) {
        if (seen.has(l)) doubles.push(`${p}: "${l}" (${labels.join(" > ")})`);
        seen.add(l);
      }
    }
    expect(doubles).toEqual([]);
  });

  it("RED-BEFORE (BUG-123): a page shell draws no second trail (the app layout draws the one trail)", () => {
    cleanup();
    nav.pathname = "/app/finance/ledger";
    render(
      <UnifiedPageShell title="Ledger" icon={FileText}>
        <p>body</p>
      </UnifiedPageShell>,
    );
    expect(screen.queryAllByRole("navigation", { name: "Breadcrumb" })).toHaveLength(0);
  });
});

describe("NAV-A3: lib/app-page-routes.ts is the app's page list", () => {
  it("lists exactly the page files under src/app/app (add or remove the routes this prints)", () => {
    const disk = new Set(ROUTES_ON_DISK);
    const listed = new Set(APP_PAGE_ROUTES);
    expect({ missing: [...disk].filter((r) => !listed.has(r)).sort(), extra: [...listed].filter((r) => !disk.has(r)).sort() }).toEqual({ missing: [], extra: [] });
  });

  it("matches static pages and [segment] pages, and nothing else", () => {
    expect(isAppPage("/app/schedule/calendar")).toBe(true);
    expect(isAppPage("/app/schedule")).toBe(false);
    expect(isAppPage("/app/crm/contacts/cmwujpiuf00n57dx4navng6ud/overview?x=1")).toBe(true);
    expect(isAppPage("/app/crm/contacts/a/b/c")).toBe(false);
    expect(isAppPage("/app/does-not-exist")).toBe(false);
  });
});

/*
 * Review repairs (NAV-A3 acceptance review, 21fccca9): the branches the rewrite kept, pinned, and two doubles the
 * label rule missed.
 */
function currentCrumb() {
  return screen.getByRole("navigation", { name: "Breadcrumb" }).querySelector('[aria-current="page"]');
}
const underlined = () => !!currentCrumb()?.querySelector(".origin-left");

describe("NAV-A3 review repairs: the trail's other branches", () => {
  it("CONTROL (MINOR-5): Sales with a tab shows the tab as a link, and the view as the current crumb", () => {
    const { links } = trail("/app/commerce", "tab=pipeline&view=board");
    expect(links).toContainEqual({ text: "Sales", href: "/app/commerce" });
    expect(links).toContainEqual({ text: "Pipeline", href: "/app/commerce?tab=pipeline" });
    expect(currentCrumb()?.textContent).toBe("Board");
  });

  it("RED-BEFORE (MINOR-5): the view crumb keeps its underline, as on the base", () => {
    trail("/app/commerce", "tab=pipeline&view=board");
    expect(underlined()).toBe(true);
  });

  it("CONTROL (MINOR-5): a Books tab on Reports reads Books; another tab is a suffix", () => {
    trail("/app/reports", "tab=books-pnl");
    expect(currentCrumb()?.textContent).toBe("Books");
    trail("/app/reports", "tab=pnl");
    expect(currentCrumb()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Reports › Profit & Loss");
  });

  it("CONTROL (MINOR-5): a detail page underlines its current crumb; a plain page does not", () => {
    trail("/app/documents/cmwujpiuf00n57dx4navng6ud");
    expect(underlined()).toBe(true);
    trail("/app/settings/team");
    expect(underlined()).toBe(false);
  });

  it("CONTROL (MINOR-5): when the current crumb repeats an earlier label, the current one stays", () => {
    const { labels } = trail("/app/money/expenses");
    expect(labels[labels.length - 1]).toBe("Expenses");
    expect(currentCrumb()?.textContent).toBe("Expenses");
  });

  it("RED-BEFORE (MINOR-6): two crumbs never open the same page (Customers and Contacts on a contact)", () => {
    const { links } = trail("/app/crm/contacts/cmwujpiuf00n57dx4navng6ud/overview");
    const hrefs = links.map((l) => l.href);
    expect(new Set(hrefs).size, hrefs.join(", ")).toBe(hrefs.length);
  });

  it("RED-BEFORE (MINOR-6): a module's parent is added only where the module is the top level", () => {
    const { labels } = trail("/app/intelligence/reports");
    expect(labels).not.toContain("Money");
    expect(trail("/app/reports").labels).toContain("Money");
  });

  it("RED-BEFORE (NIT-7): the account page's crumb names My account", () => {
    trail("/app/settings/profile");
    expect(currentCrumb()?.textContent).toBe("My account");
    trail("/app/profile");
    expect(currentCrumb()?.textContent).toBe("Profile");
  });
});

