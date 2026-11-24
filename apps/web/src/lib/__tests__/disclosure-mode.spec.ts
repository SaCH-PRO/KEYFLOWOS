/**
 * NAV-A1 (owner rulings D-150 'hubs', D-151 'labels'): the disclosure modes are gone.
 *
 * Startup, Growth and Enterprise filtered the nav through three label allowlists kept by hand in
 * lib/disclosure-mode.ts, switched from a chip in the header and stored in this browser
 * (kf_disclosure_mode). The allowlists drifted from the nav more than once and hid most of the app
 * (this spec's earlier version recorded that history), and the default mode, startup, still dropped
 * Team, Reports and Payments from the owner's menu. What the menu shows now follows what the business
 * sells (stored on the business, BIZ-SETTINGS-WEB) and what the member may open (their module scopes),
 * never a per-browser mode.
 *
 *   DM-01 lib/disclosure-mode.ts no longer exists, and no source file imports it or reads its storage key.
 *   DM-02 the header has no mode chip (no "Workspace Mode" menu, no Startup / Growth / Enterprise).
 *   DM-03 the shell filters the nav by no label allowlist.
 *   DM-04 an owner's menu has Team, Reports and Payments (startup, the default mode, dropped all three), and the
 *         doors the old allowlists existed to keep: Invoices, Contacts' hub (Customers), the diary (Schedule), the
 *         business profile.
 *   DM-05 the bottom bar marks no slot by comparing a hard-coded route.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { menuSectionsFor, hubsFor, type ModuleLevels } from "../nav-config";

const WEB_SRC = path.join(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(WEB_SRC, rel), "utf8");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const OWNER = Object.fromEntries(
  ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team", "analytics", "operations", "connect"].map((m) => [m, "admin"]),
) as ModuleLevels;

describe("NAV-A1: the disclosure modes are removed", () => {
  it("DM-01 lib/disclosure-mode.ts is gone and nothing imports it or reads its storage key", () => {
    expect(fs.existsSync(path.join(WEB_SRC, "lib", "disclosure-mode.ts"))).toBe(false);
    const offenders = sourceFiles(WEB_SRC).filter((f) => {
      const text = fs.readFileSync(f, "utf8");
      return /disclosure-mode|kf_disclosure_mode|kf:disclosure-mode-changed/.test(text);
    });
    expect(offenders.map((f) => path.relative(WEB_SRC, f))).toEqual([]);
  });

  it("DM-02 the header has no mode chip", () => {
    const header = read("components/layout/app-header.tsx");
    expect(header).not.toMatch(/Workspace Mode|MODE_LABELS|disclosureMode|modeMenu/);
    const layout = read("app/app/layout.tsx");
    expect(layout).not.toMatch(/disclosureMode|modeMenu/);
  });

  it("DM-03 the shell filters the nav by no label allowlist", () => {
    const hook = read("hooks/use-app-layout.ts");
    expect(hook).not.toMatch(/MODE_OPERATE_ITEMS|MODE_BUILD_ITEMS|\.includes\(i\.label\)/);
  });

  it("DM-04 an owner's menu has Team, Reports and Payments, and the doors the allowlists were for", () => {
    const { hubSections, moreSections } = menuSectionsFor("both", OWNER);
    const items = [...hubSections, ...moreSections].flatMap((s) => s.items.map((i) => i.label));
    for (const label of ["Team", "Reports", "Payments", "Invoices", "Business profile"]) expect(items, label).toContain(label);
    const hubs = hubsFor("both", OWNER).map((h) => h.label);
    for (const hub of ["Customers", "Schedule", "Sales", "Money"]) expect(hubs, hub).toContain(hub);
  });

  it("DM-05 the bottom bar compares no hard-coded route", () => {
    const component = read("components/layout/mobile-bottom-nav-v2.tsx");
    expect(component, "still comparing against a hardcoded route").not.toMatch(/item\.href === ["']\/app\//);
  });
});
