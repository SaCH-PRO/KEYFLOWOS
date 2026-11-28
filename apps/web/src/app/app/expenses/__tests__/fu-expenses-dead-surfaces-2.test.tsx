/**
 * P258 FU-EXPENSES-DEAD-SURFACES-2 (launch-track, D-315, D-152; from the P252 worker's report and its correctness
 * review). Removed, not mounted, for the reason P252 gives: the EXPENSES-HUB-3 plan entry scopes the page to the
 * Categories and Recurring views, D-152 hides what v1 does not promise, and nothing in production imports these.
 *
 *   - the pipeline view, with the four helpers only it used (filters, metrics row, record card, stage bar);
 *   - the expense list, the budgets tab, the snapshot tab, the tax calculator and the action menu;
 *   - fetchRecurringCandidates in lib/client.ts, whose only reader (the list's "patterns" strip) is gone.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXPENSES = join(__dirname, "..");
const DEAD = [
  "components/expense-pipeline.tsx",
  "components/expense-filters.tsx",
  "components/expense-metrics-row.tsx",
  "components/expense-record-card.tsx",
  "components/expense-stage-bar.tsx",
  "components/expense-list.tsx",
  "components/expense-budgets-tab.tsx",
  "components/expenses-snapshot-tab.tsx",
  "components/expense-tax-calc.tsx",
  "components/expenses-action-menu.tsx",
];

describe("P258: the second set of dead expense surfaces is gone", () => {
  for (const path of DEAD) {
    it(`${path} is removed`, () => {
      expect(existsSync(join(EXPENSES, path)), `${path} still ships`).toBe(false);
    });
  }
  it("the client no longer offers the recurring-patterns read", () => {
    const client = readFileSync(join(EXPENSES, "../../../lib/client.ts"), "utf8");
    expect(client, "fetchRecurringCandidates or RecurringCandidate still in the client with no caller").not.toMatch(/\bfetchRecurringCandidates\b|\binterface RecurringCandidate\b/);
  });
  it("control: the surfaces v1 mounts are still there", () => {
    for (const path of ["page.tsx", "components/expense-categories-tab.tsx", "components/recurring-expenses-panel.tsx", "components/use-expenses-data.ts"]) {
      expect(existsSync(join(EXPENSES, path)), `${path} is missing`).toBe(true);
    }
  });
});
