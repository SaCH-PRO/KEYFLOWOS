/**
 * V1-63 (SWP-SEC-AUDIT-TRUTH), browser sweep BUG-065: Settings > Security says what the audit
 * measured, and a member the server refuses is told so.
 *
 * The server's audit (apps/server security-audit.service.ts) now answers a status per check,
 * 'passed', 'failed' or 'not_tracked', and counts only measured checks in score, passed and total
 * (notTracked counts the rest): no MFA state and no last sign-in are recorded, so those two checks
 * are 'not_tracked' instead of claiming '100% of team members have MFA enabled' as a pass. GET
 * .../audit needs settings read (ModuleScopeGuard), so a STAFF member on the role defaults is
 * refused 403.
 *
 * Before: the page drew a check that is not a pass with the warning styling of a failure, and a
 * refused audit as a toast over an empty page.
 *
 * Required: a not-tracked check says 'Not tracked', is drawn neither as a pass nor as a failure,
 * and the summary says how many checks were not tracked next to 'N of M checks passed'; a 403
 * shows 'No access' and to ask the business owner, with no score, no checks and no toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";

const REFUSAL_READ = "Insufficient permissions: settings requires read access (you have none)";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("@/lib/api", () => api);

import SecurityAuditPage from "../page";

const MFA = {
  id: "mfa-enforcement",
  category: "auth",
  severity: "info",
  status: "not_tracked",
  title: "Multi-factor authentication",
  description: "Not tracked: KEYFLOWOS does not record whether team members use multi-factor authentication, so this audit makes no claim about it.",
  passed: false,
};
const INACTIVE = {
  id: "inactive-users",
  category: "auth",
  severity: "info",
  status: "not_tracked",
  title: "Inactive users",
  description: "Not tracked: KEYFLOWOS does not record when a team member last signed in, so this audit makes no claim about inactive members.",
  passed: false,
};
const PRIVACY = {
  id: "privacy-settings",
  category: "data",
  severity: "info",
  status: "passed",
  title: "Privacy settings",
  description: "Forget grace window is 30 days.",
  passed: true,
};
const ENV = {
  id: "env-secrets",
  category: "config",
  severity: "critical",
  status: "failed",
  title: "Environment secrets",
  description: "Issues: DATABASE_URL points to localhost",
  passed: false,
  recommendation: "Rotate weak keys and remove localhost database URLs from production.",
};

const AUDIT = { score: 50, passed: 1, total: 2, notTracked: 2, checks: [MFA, PRIVACY, INACTIVE, ENV] };

/** The card that holds a check's title (its status hook, else the card markup the page has always drawn). */
function cardOf(title: string): HTMLElement {
  const heading = screen.getByText(title);
  return (heading.closest("[data-check-status]") ?? heading.closest("div.rounded-xl")) as HTMLElement;
}

beforeEach(() => {
  api.apiGet.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => cleanup());

describe("security audit page: what the audit measured", () => {
  it("[WEB-SAT-01] a not-tracked check says 'Not tracked' and is drawn neither as a pass nor as a failure", async () => {
    api.apiGet.mockResolvedValue({ data: AUDIT, error: null });
    render(<SecurityAuditPage />);
    await screen.findByText("Multi-factor authentication");

    for (const title of ["Multi-factor authentication", "Inactive users"]) {
      const card = cardOf(title);
      expect(card, `${title} is drawn as a check card`).not.toBeNull();
      expect(within(card).queryByText(/^not tracked$/i), `${title} says Not tracked`).not.toBeNull();
      // Neither the pass styling (emerald) nor the failure styling (amber/rose).
      expect(card.className, `${title} is not drawn as a pass`).not.toMatch(/emerald/);
      expect(card.className, `${title} is not drawn as a failure`).not.toMatch(/amber|rose/);
      expect(within(card).queryByText(/recommendation/i)).toBeNull();
      expect(card.getAttribute("data-check-status"), title).toBe("not_tracked");
    }
    // The measured checks keep their pass and failure styling.
    expect(cardOf("Privacy settings").getAttribute("data-check-status")).toBe("passed");
    expect(cardOf("Privacy settings").className).toMatch(/emerald/);
    expect(cardOf("Environment secrets").getAttribute("data-check-status")).toBe("failed");
    expect(cardOf("Environment secrets").className).toMatch(/rose/);
  });

  it("[WEB-SAT-02] the summary counts the measured checks and says how many were not tracked; no MFA percentage anywhere", async () => {
    api.apiGet.mockResolvedValue({ data: AUDIT, error: null });
    render(<SecurityAuditPage />);
    await screen.findByText("Multi-factor authentication");

    expect(screen.getByText(/1 of 2 checks passed/)).toBeInTheDocument();
    expect(screen.getByText(/2 not tracked/i)).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+% of team members/);
  });

  it("[WEB-SAT-03] a 403 refusal says 'No access' and to ask the business owner: no score, no checks, no toast", async () => {
    api.apiGet.mockResolvedValue({ data: null, error: REFUSAL_READ, status: 403 });
    render(<SecurityAuditPage />);

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/no access/i);
    expect(notice).toHaveTextContent(/ask the business owner/i);
    expect(screen.queryByText(/security score/i)).toBeNull();
    expect(screen.queryByText(/checks passed/i)).toBeNull();
    expect(screen.queryByText("Multi-factor authentication")).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    // A refused member is not offered a re-run that can only be refused again.
    expect(screen.queryByRole("button", { name: /run audit/i })).toBeNull();
  });

  it("[WEB-SAT-04] a failure that is not a refusal keeps the toast and shows no score (control)", async () => {
    api.apiGet.mockResolvedValue({ data: null, error: "Internal server error", status: 500 });
    render(<SecurityAuditPage />);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Internal server error"));
    expect(screen.queryByText(/security score/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * Review finding SAT-COR-1 (repair): only ModuleScopeGuard's refusal of settings says the member lacks
 * the audit's access (isModuleScopeRefusal, review CRR-P195JS-2). BusinessGuard also answers 403 when it
 * cannot complete its check ("Unable to verify business access" on a database error such as a statement
 * timeout, "Service unavailable" when Prisma is missing), and another module's refusal names another
 * module: none of these says anything about settings. The page told an OWNER "No access, ask the owner"
 * and hid Run audit on each of them, so the owner could not retry without reloading.
 */
describe("security audit page: a 403 that is not the settings refusal", () => {
  it.each([
    ["BusinessGuard's transient database failure", "Unable to verify business access"],
    ["BusinessGuard without its database", "Service unavailable"],
    ["another module's refusal", "Insufficient permissions: revenue requires read access (you have none)"],
  ])(
    "[WEB-SAT-05] %s (403 %j) is not told as 'No access': the toast says the server's words and Run audit stays, so a re-run shows the audit (RED: 'No access, ask the owner', no button)",
    async (_what, error) => {
      api.apiGet.mockResolvedValueOnce({ data: null, error, status: 403 });
      render(<SecurityAuditPage />);

      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(error));
      expect(screen.queryByRole("alert"), "no refusal notice").toBeNull();
      expect(screen.queryByText(/no access, ask the owner/i)).toBeNull();
      expect(screen.queryByText(/security score/i)).toBeNull();

      // The owner retries in place once the server can answer again.
      api.apiGet.mockResolvedValueOnce({ data: AUDIT, error: null, status: 200 });
      const rerun = screen.getByRole("button", { name: /run audit/i });
      fireEvent.click(rerun);
      await screen.findByText("Multi-factor authentication");
      expect(screen.getByText(/1 of 2 checks passed/)).toBeInTheDocument();
      expect(api.apiGet).toHaveBeenCalledTimes(2);
    },
  );
});
