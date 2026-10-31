/**
 * R0-ID-WEB-AUTHORITY-UX (V1-07 review CR-REG-1): the team invite form sends
 * the server's role defaults, key for key, across every canonical module.
 *
 * WHY this test exists: the server's role defaults
 * (apps/server/src/core/authority/module-vocabulary.ts ROLE_DEFAULT_SCOPES)
 * cover the 14 canonical modules, including analytics, operations and
 * connect. The invite form's DEFAULT_SCOPES was an 11-key map without them,
 * and the server reads an explicit map's missing key as 'none'. So an ADMIN
 * invited through the web held analytics/operations 'none', and that ADMIN was
 * then (correctly, under the K2 grantor ceiling) refused when inviting a STAFF
 * with server defaults (STAFF has analytics/operations 'read'): a correct
 * server refusal that looked like a bug.
 *
 * The expected maps are the SERVER constant itself, imported through a
 * relative path (not a copied fixture), so any future change to the server's
 * role defaults fails this test until the form follows it.
 *
 * Mounted on the real TeamSettingsPage; only the api module's request helpers
 * and the toast are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  CANONICAL_MODULES,
  DEFAULT_APPROVAL_TIERS,
  ROLE_DEFAULT_SCOPES,
} from "../../../../../../../server/src/core/authority/module-vocabulary";

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPostSimple: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: api.apiGet,
    apiPostSimple: api.apiPostSimple,
    apiPatch: api.apiPatch,
    apiDelete: api.apiDelete,
  };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import TeamSettingsPage from "../page";

const BUSINESS = "biz_team_1";

const DASHBOARD = {
  members: [],
  totalMembers: 0,
  recentActivity: [],
  permissionModules: [...CANONICAL_MODULES],
};

async function openInviteForm(role: "STAFF" | "ADMIN") {
  render(<TeamSettingsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Invite/ }));
  fireEvent.change(screen.getByLabelText("Team member email"), { target: { value: "new.member@example.com" } });
  fireEvent.change(screen.getByLabelText("Select role"), { target: { value: role } });
}

async function sendInvite(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: /Send Invite/ }));
  await waitFor(() => expect(api.apiPostSimple).toHaveBeenCalledTimes(1));
  const [path, payload] = api.apiPostSimple.mock.calls[0] as [string, Record<string, unknown>];
  expect(path).toBe(`/identity/businesses/${BUSINESS}/team`);
  return payload;
}

describe("team invite form: the default scope map is the server's role defaults", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_business_id", BUSINESS);
    api.apiGet.mockResolvedValue({ data: DASHBOARD, error: null });
    api.apiPostSimple.mockResolvedValue({ data: { id: "mem_new" }, error: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("[R0-ID-UX-T01] the server's role defaults cover all 14 canonical modules (the pin's own premise)", () => {
    expect(CANONICAL_MODULES).toHaveLength(14);
    for (const role of ["STAFF", "ADMIN"] as const) {
      expect(Object.keys(ROLE_DEFAULT_SCOPES[role]).sort()).toEqual([...CANONICAL_MODULES].sort());
    }
  });

  it.each(["STAFF", "ADMIN"] as const)(
    "[R0-ID-UX-T02] inviting a %s with untouched defaults sends ROLE_DEFAULT_SCOPES for that role key for key",
    async (role) => {
      await openInviteForm(role);
      const payload = await sendInvite();

      expect(payload.role).toBe(role);
      expect(payload.scopes).toEqual(ROLE_DEFAULT_SCOPES[role]);
      expect(payload.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS[role]);
    },
  );

  it("[R0-ID-UX-T03] the inviter can still lower scopes, including a module the old 11-key form omitted", async () => {
    await openInviteForm("ADMIN");
    fireEvent.click(screen.getByRole("button", { name: /Set permissions/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Set CRM / Clients to read" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Analytics to none" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Operations to read" }));

    const payload = await sendInvite();

    expect(payload.scopes).toEqual({
      ...ROLE_DEFAULT_SCOPES.ADMIN,
      crm: "read",
      analytics: "none",
      operations: "read",
    });
  });
});
