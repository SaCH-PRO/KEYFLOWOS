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
  rankOf,
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
import { setCachedUser } from "@/lib/workspace";
import { toast } from "sonner";

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

/**
 * R0-ID-WEB-AUTHORITY-UX review repairs (SEC-UX-1, CR-1): an inviter whose own
 * authority is narrower than the 14-module role defaults.
 *
 * An ADMIN invited through the pre-packet web form holds that form's explicit
 * 11-key map: no analytics, no operations (the server reads a missing key as
 * 'none'). The server's K2 ceiling (IdentityService.authorityExcess) refuses any
 * invite above the inviter's own authority with 403 "You cannot grant more
 * authority than your own", and is not changed here. Before these repairs the
 * form sent the full STAFF defaults (analytics/operations read) for that ADMIN,
 * so its untouched default invite, which used to succeed, was refused with a
 * message that names no module.
 *
 * The form now starts a bounded inviter (anyone but the OWNER and a SUPER_ADMIN,
 * as on the server) at the role defaults capped at the inviter's own level per
 * module and approval tier, says which ones it lowered, and on a ceiling refusal
 * names each module above the inviter's own access. The inviter is the cached
 * signed-in user, found in the team dashboard's member list.
 */
const OWNER_ID = "usr_owner";
const INVITER_ID = "usr_inviter";

/** The pre-packet web form's role maps, transcribed (11 keys; no analytics, operations, connect). */
const LEGACY_FORM_MODULES = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team"];
const LEGACY_FORM_SCOPES = {
  OWNER: Object.fromEntries(LEGACY_FORM_MODULES.map((m) => [m, "admin"])),
  ADMIN: Object.fromEntries(LEGACY_FORM_MODULES.map((m) => [m, m === "team" ? "write" : "admin"])),
};

function member(userId: string, role: string, permissionScopes: Record<string, string>, maxApprovalTier: number) {
  return {
    id: `mem_${userId}`,
    userId,
    role,
    permissionScopes,
    maxApprovalTier,
    activeTasks: 0,
    recentActions: [],
    user: { id: userId, email: `${userId}@example.com`, name: userId },
  };
}

/** The server's K2 rule for module levels: the grant's level, capped at the inviter's (missing key = none). */
function cappedAt(grant: Record<string, string>, own: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    CANONICAL_MODULES.map((m) => {
      const mine = own[m] ?? "none";
      return [m, rankOf(grant[m]) <= rankOf(mine) ? grant[m] : mine];
    }),
  );
}

/** The canonical modules where `grant` holds more than `own`, as authorityExcess compares them. */
function modulesAbove(grant: Record<string, string>, own: Record<string, string>): string[] {
  return CANONICAL_MODULES.filter((m) => rankOf(grant[m]) > rankOf(own[m] ?? "none"));
}

async function openInviteFormAs(
  me: { id: string; role?: string },
  members: ReturnType<typeof member>[],
  role: "STAFF" | "ADMIN",
) {
  setCachedUser({ id: me.id, email: `${me.id}@example.com`, role: me.role ?? "USER" });
  api.apiGet.mockResolvedValue({ data: { ...DASHBOARD, members, totalMembers: members.length }, error: null });
  render(<TeamSettingsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Invite/ }));
  // Member cards carry their own "Select role" control; the invite form is the first one.
  fireEvent.change(screen.getByLabelText("Team member email"), { target: { value: "new.member@example.com" } });
  fireEvent.change(screen.getAllByLabelText("Select role")[0], { target: { value: role } });
}

describe("team invite form: an inviter narrower than the role defaults (SEC-UX-1, CR-1)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_business_id", BUSINESS);
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

  const legacyAdminTeam = () => [
    member(OWNER_ID, "OWNER", LEGACY_FORM_SCOPES.OWNER, 4),
    member(INVITER_ID, "ADMIN", LEGACY_FORM_SCOPES.ADMIN, 3),
  ];

  it.each(["STAFF", "ADMIN"] as const)(
    "[R0-ID-UX-T04] a legacy 11-key ADMIN inviting a %s with untouched defaults sends the role defaults capped at its own map, and is told which modules were lowered",
    async (role) => {
      await openInviteFormAs({ id: INVITER_ID }, legacyAdminTeam(), role);

      // The notice names the lowered modules before anything is sent.
      const notice = await screen.findByText(/Analytics and Operations start at your own access/);
      expect(notice.textContent).not.toMatch(/Integrations|CRM|Approval tier/);

      const payload = await sendInvite();
      const expected = cappedAt(ROLE_DEFAULT_SCOPES[role], LEGACY_FORM_SCOPES.ADMIN);
      // Premise: only analytics and operations are capped (connect is none in every role default).
      expect(expected).toEqual({ ...ROLE_DEFAULT_SCOPES[role], analytics: "none", operations: "none" });
      expect(payload.scopes).toEqual(expected);
      expect(modulesAbove(payload.scopes as Record<string, string>, LEGACY_FORM_SCOPES.ADMIN)).toEqual([]);
      expect(payload.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS[role]);
      expect(payload.role).toBe(role);
    },
  );

  it("[R0-ID-UX-T05] the approval tier starts at the inviter's own tier when that is below the role default, and the notice says so", async () => {
    const team = [member(OWNER_ID, "OWNER", {}, 4), member(INVITER_ID, "ADMIN", { ...ROLE_DEFAULT_SCOPES.ADMIN }, 1)];
    await openInviteFormAs({ id: INVITER_ID }, team, "ADMIN");

    const notice = await screen.findByText(/Approval tier starts at your own access/);
    expect(notice.textContent).not.toMatch(/Analytics|Operations/);

    const payload = await sendInvite();
    expect(payload.scopes).toEqual(ROLE_DEFAULT_SCOPES.ADMIN);
    expect(payload.maxApprovalTier).toBe(1);
  });

  it("[R0-ID-UX-T06] a ceiling refusal names each module above the inviter's own access and keeps the form open", async () => {
    await openInviteFormAs({ id: INVITER_ID }, legacyAdminTeam(), "STAFF");
    fireEvent.click(screen.getByRole("button", { name: /Set permissions/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Set Analytics to read" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Integrations to read" }));
    api.apiPostSimple.mockResolvedValue({ data: null, error: "You cannot grant more authority than your own", status: 403 });

    await sendInvite();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const message = vi.mocked(toast.error).mock.calls[0][0] as string;
    expect(message).toMatch(/^You cannot grant more authority than your own: /);
    expect(message).toContain("Analytics read (yours: none)");
    expect(message).toContain("Integrations read (yours: none)");
    expect(message).not.toMatch(/CRM|Operations|Revenue/);
    expect(message).toMatch(/business owner/);
    expect(toast.success).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Team member email") as HTMLInputElement).value).toBe("new.member@example.com");
  });

  it("[R0-ID-UX-T07] a refusal the page cannot explain (inviter not in the member list) shows the server's message unchanged", async () => {
    await openInviteFormAs({ id: "usr_not_listed" }, legacyAdminTeam(), "STAFF");
    api.apiPostSimple.mockResolvedValue({ data: null, error: "You cannot grant more authority than your own", status: 403 });

    const payload = await sendInvite();

    expect(payload.scopes).toEqual(ROLE_DEFAULT_SCOPES.STAFF);
    expect(screen.queryByText(/start at your own access/)).toBeNull();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You cannot grant more authority than your own"));
  });

  it.each([
    ["the OWNER (holding the legacy 11-key map)", { id: OWNER_ID }],
    ["a SUPER_ADMIN (holding the legacy 11-key ADMIN map)", { id: INVITER_ID, role: "SUPER_ADMIN" }],
  ] as const)(
    "[R0-ID-UX-T08] %s is not bounded by the server, so its defaults are not capped",
    async (_label, me) => {
      await openInviteFormAs(me, legacyAdminTeam(), "STAFF");
      const payload = await sendInvite();
      expect(payload.scopes).toEqual(ROLE_DEFAULT_SCOPES.STAFF);
      expect(screen.queryByText(/start at your own access/)).toBeNull();
    },
  );

  it.each(["STAFF", "ADMIN"] as const)(
    "[R0-ID-UX-T09] control: a 14-key ADMIN (server role defaults, tier 3) inviting a %s sends the role defaults unchanged, with no notice",
    async (role) => {
      const team = [member(OWNER_ID, "OWNER", {}, 4), member(INVITER_ID, "ADMIN", { ...ROLE_DEFAULT_SCOPES.ADMIN }, 3)];
      await openInviteFormAs({ id: INVITER_ID }, team, role);
      const payload = await sendInvite();
      expect(payload.scopes).toEqual(ROLE_DEFAULT_SCOPES[role]);
      expect(payload.maxApprovalTier).toBe(DEFAULT_APPROVAL_TIERS[role]);
      expect(screen.queryByText(/start at your own access/)).toBeNull();
    },
  );
});
