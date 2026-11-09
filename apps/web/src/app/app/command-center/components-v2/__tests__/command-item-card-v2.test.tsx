/**
 * PR196-PROJECTS-WEB (WPD-01, WPD-02): a Command Center priority card opens the
 * screen its item names.
 *
 * WHY: PR #196 linked the card title (and a "View details" button) to
 * /app/command-center/${item.id}. A snapshot item's id is made up by the server
 * (`approval-${proposal.id}`, `temporal-${slug}`, 'constitution-stale',
 * `module-readiness-...`, business-command-center.service.ts), not a CommandItem
 * row id, so the detail page's GET /command/businesses/:bid/items/:id is a 404
 * for every one of them and the screen says "Failed to load command item". The
 * server already names the real target on every item it can: item.href.
 *
 * Required: the card's title opens item.href, a route that exists in the app;
 * no link on the card points at /app/command-center/<snapshot id>; an item with
 * no href has no title link (nothing is made up).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { CommandItemCardV2 } from "../command-item-card-v2";
import type { CommandCenterItem } from "@/lib/api/business-command-center";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/command-center",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const APP_DIR = path.join(__dirname, "..", "..", "..", "..");
const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

/** The page file that serves `route` under the app-router conventions (as link-targets.spec.ts resolves it). */
function resolvesToRoute(route: string): boolean {
  const pathname = route.split(/[?#]/)[0];
  let dir = APP_DIR;
  for (const seg of pathname.replace(/^\//, "").split("/").filter(Boolean)) {
    const literal = path.join(dir, seg);
    if (isDir(literal)) {
      dir = literal;
      continue;
    }
    const dynamic = isDir(dir) ? fs.readdirSync(dir).find((d) => /^[[(]/.test(d) && isDir(path.join(dir, d))) : undefined;
    if (!dynamic) return false;
    dir = path.join(dir, dynamic);
  }
  return fs.existsSync(path.join(dir, "page.tsx"));
}

/** Items shaped as BusinessCommandCenterService builds them (ids made up, href the real screen). */
const APPROVAL: CommandCenterItem = {
  id: "approval-prop_wpd01",
  type: "KEY_APPROVAL",
  priority: "HIGH",
  title: "Approve: send the overdue reminders",
  summary: "KEY proposes sending 3 reminders.",
  evidence: ["3 invoices are overdue"],
  source: "KEY Autonomy",
  sourceId: "prop_wpd01",
  href: "/app/key-autonomy?tab=pending",
  actions: [{ label: "Review approval", actionType: "REVIEW", href: "/app/key-autonomy?tab=pending" }],
};

const TEMPORAL: CommandCenterItem = {
  id: "temporal-quarter-close",
  type: "TEMPORAL_URGENT",
  priority: "CRITICAL",
  title: "Quarter close is in 2 days",
  summary: "File the quarter.",
  evidence: [],
  source: "Temporal Flow",
  href: "/app/temporal-flow?eventId=evt_1",
  actions: [{ label: "Open Temporal Flow", actionType: "OPEN", href: "/app/temporal-flow" }],
};

const CONSTITUTION: CommandCenterItem = {
  id: "constitution-stale",
  type: "CONSTITUTION",
  priority: "MEDIUM",
  title: "Your constitution is stale",
  summary: "Regenerate it.",
  evidence: [],
  source: "Business Genome",
  href: "/app/profile?tab=business-genome&section=constitution",
  actions: [],
};

/** A brief risk: the server sets no href on it. */
const NO_HREF: CommandCenterItem = {
  id: "brief-risk-ins_1",
  type: "RISK",
  priority: "HIGH",
  title: "Cash runway is short",
  summary: "Runway under 30 days.",
  evidence: [],
  source: "Executive Brief",
  actions: [],
};

afterEach(cleanup);

describe("CommandItemCardV2 opens the item's own screen (WPD-01, WPD-02)", () => {
  for (const item of [APPROVAL, TEMPORAL, CONSTITUTION]) {
    it(`${item.type}: the title links to item.href (${item.href}), a route that exists`, () => {
      render(<CommandItemCardV2 item={item} />);
      const link = screen.getByRole("link", { name: item.title });
      expect(link.getAttribute("href")).toBe(item.href);
      expect(resolvesToRoute(item.href!), `${item.href} has no page`).toBe(true);
    });
  }

  it("no link on a card points at /app/command-center/<snapshot id>, which 404s", () => {
    const { container } = render(
      <>
        <CommandItemCardV2 item={APPROVAL} />
        <CommandItemCardV2 item={TEMPORAL} />
        <CommandItemCardV2 item={CONSTITUTION} />
        <CommandItemCardV2 item={NO_HREF} />
      </>,
    );
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => h.startsWith("/app/command-center/"))).toEqual([]);
  });

  it("an item with no href shows its title without a link (no made-up target)", () => {
    render(<CommandItemCardV2 item={NO_HREF} />);
    expect(screen.getByText(NO_HREF.title)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: NO_HREF.title })).toBeNull();
  });
});
