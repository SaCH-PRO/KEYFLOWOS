/**
 * FU-NAV-A3-CODEX-235 (b) (Codex on PR #235): My account does not show a member the business settings they cannot
 * open.
 *
 * NAV-A3 offers My account (/app/settings/profile) to every member, settings: "none" included. That page inherits
 * app/settings/layout.tsx, whose tab strip linked Billing, Team, Webhooks, AI Control and every other business
 * settings page to everyone. The strip now follows the member's modules the way the nav and the settings index read
 * them (useMemberModuleLevels, canOpenModule): the settings hub's pages need settings, Team needs team, KEY (AI)
 * needs operations; unknown (no answer yet, a failed read) hides nothing, and the server refuses what is not allowed.
 *
 *   SLA-01  RED-BEFORE  a member with no settings, team or operations access sees no business settings tab on My
 *                       account; the page itself still renders
 *   SLA-02  RED-BEFORE  a member with team access only sees the Team tab alone
 *   SLA-03  control     an owner (every module) sees every tab, as before
 *   SLA-04  control     an access read that fails hides nothing (the server decides)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/settings/profile",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null, setCurrentMeta: () => {} }) }));

import SettingsLayout from "../layout";

const BIZ = "biz_c235";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answers my-access with these module levels, or a 503 for null. */
function serve(modules: Record<string, string> | null) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (pathname.endsWith(`/identity/businesses/${BIZ}/my-access`)) {
      return modules ? json(200, { role: modules.settings === "admin" ? "OWNER" : "STAFF", modules }) : json(503, { message: "Service Unavailable" });
    }
    return json(404, { message: "Not Found" });
  }));
}

const ALL = ["crm", "revenue", "bookings", "storefront", "settings", "analytics", "operations", "expenses", "team", "projects", "content", "automations"];
const every = (level: string) => Object.fromEntries(ALL.map((m) => [m, level]));

function renderLayout() {
  render(
    <SettingsLayout>
      <p>Your account</p>
    </SettingsLayout>,
  );
}
const tabs = () => screen.queryAllByRole("tab").map((t) => t.getAttribute("href"));

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FU-NAV-A3-CODEX-235 (b): the settings tab strip follows the member's modules", () => {
  it("SLA-01 RED-BEFORE: a member with no settings, team or operations access sees no business settings tab", async () => {
    serve({ ...every("write"), settings: "none", team: "none", operations: "none" });
    renderLayout();
    await waitFor(() => expect(tabs()).toEqual([]));
    expect(screen.getByText("Your account")).toBeInTheDocument();
  });

  it("SLA-02 RED-BEFORE: a member with team access only sees the Team tab alone", async () => {
    serve({ ...every("none"), team: "write" });
    renderLayout();
    await waitFor(() => expect(tabs()).toEqual(["/app/settings/team"]));
  });

  it("SLA-03 control: an owner sees every tab", async () => {
    serve(every("admin"));
    renderLayout();
    await new Promise((r) => setTimeout(r, 50));
    expect(tabs()).toContain("/app/settings/billing");
    expect(tabs()).toContain("/app/settings/team");
    expect(tabs()).toContain("/app/settings/ai");
    expect(tabs().length).toBeGreaterThanOrEqual(19);
  });

  it("SLA-04 control: an access read that fails hides nothing", async () => {
    serve(null);
    renderLayout();
    await new Promise((r) => setTimeout(r, 50));
    expect(tabs().length).toBeGreaterThanOrEqual(19);
  });
});
