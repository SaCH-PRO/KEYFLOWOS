/**
 * SWP-TEAM-WEB (V1 step 5; journey J; BUG-063, BUG-115, BUG-116, BUG-135; legacyaccess ruling D-179): the states of
 * Settings > Team. The no-access plumbing is FAILURE-KIT's (lib/failure-kit.ts readState, components/ui/no-access-state).
 *
 *   TPS-01  RED-BEFORE  BUG-063 / J6: a refused dashboard read (ModuleScopeGuard 403, team read) shows "No access - ask
 *                       the owner", no Invite and no "0 owner 0 admin 0 staff"
 *   TPS-02  RED-BEFORE  a failed dashboard read (5xx) says it could not load the team, not "No Team Members Yet"
 *   TPS-03  RED-BEFORE  BUG-115 / J3: after inviting an Admin, the invite form's role is the default (Staff) again, and
 *                       the next invite, role untouched, is sent as STAFF
 *   TPS-04  RED-BEFORE  BUG-116 / J4: an invitePending row says "Invited" and is left out of the owner/admin/staff counts
 *   TPS-05  RED-BEFORE  J2: the role control offers Staff, Admin, Front desk and Bookkeeper; each preset sends its own
 *                       role and scope set over the 14 canonical modules (no server change: role ADMIN or STAFF, levels
 *                       from the server's vocabulary):
 *                         Admin      ADMIN, the ADMIN role defaults (team write, connect none, every other module admin), tier 3
 *                         Front desk STAFF, bookings write and crm read (the STAFF defaults for those two), every other none, tier 0
 *                         Bookkeeper STAFF, revenue read and expenses read (the STAFF defaults), every other none, tier 0
 *   TPS-06  RED-BEFORE  the invite email is sent trimmed and in lower case (J1: one address in any letters)
 *   TPS-07  RED-BEFORE  D-179: a member invited through the old 11-item form (an explicit map with neither analytics nor
 *                       operations) shows Analytics and Operations as "No access"; nothing is sent until the owner
 *                       presses the one-click grant, which sends the member's map with analytics and operations at its
 *                       role's default (STAFF read, ADMIN admin), every other key and the tier unchanged
 *   TPS-08  RED-BEFORE  D-179: the grant is the owner's: an ADMIN viewing the same row sees "No access" and no grant
 *   TPS-09  control     a member whose map names analytics and operations (even at none) is not a legacy row
 *   TPS-11  RED-BEFORE  journey J2 (three presets in a row): after an invite the form stays open, its email empty and
 *                       its role Staff, ready for the next one (it closed with an exit animation, and a second invite
 *                       typed into the closing form was lost)
 *   TPS-10  RED-BEFORE  BUG-135: the "Set permissions & approval tier" toggle reads "Setpermissions & approval tier" in
 *                       the production build (seen live at c5a5a99e): its label was the {Hide/Set} expression and a
 *                       separate " permissions & approval tier" text, and the build drops the space between them. The
 *                       label is now one text, so no build can split it (jsdom keeps the space, so the case pins the
 *                       one text node; e2e/sweep-team.spec.ts reads the toggle's name in the built app)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import {
  CANONICAL_MODULES,
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
  return { ...actual, apiGet: api.apiGet, apiPostSimple: api.apiPostSimple, apiPatch: api.apiPatch, apiDelete: api.apiDelete };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import TeamSettingsPage from "../page";
import { clearStoredBusinessId, setCachedUser } from "@/lib/workspace";

const BUSINESS = "biz_tps";
const OWNER_ID = "usr_tps_owner";

/** The 11 modules of the invite form before analytics, operations and connect were added (R0-ID-WEB-AUTHORITY-UX). */
const LEGACY_FORM_MODULES = ["crm", "revenue", "bookings", "projects", "content", "expenses", "automations", "storefront", "settings", "ai", "team"];

type Row = ReturnType<typeof member>;

function member(userId: string, role: string, permissionScopes: Record<string, string>, maxApprovalTier: number, extra: Record<string, unknown> = {}) {
  return {
    id: `mem_${userId}`,
    userId,
    role,
    permissionScopes,
    maxApprovalTier,
    activeTasks: 0,
    recentActions: [],
    user: { id: userId, email: `${userId}@example.com`, name: userId },
    ...extra,
  };
}

const owner = () => member(OWNER_ID, "OWNER", { ...ROLE_DEFAULT_SCOPES.OWNER }, 4);

function serveTeam(members: Row[]) {
  api.apiGet.mockResolvedValue({
    data: { members, totalMembers: members.length, recentActivity: [], permissionModules: [...CANONICAL_MODULES] },
    error: null,
  });
}

/** Every canonical module at none, then `levels`. */
const onlyThese = (levels: Record<string, string>) => ({ ...Object.fromEntries(CANONICAL_MODULES.map((m) => [m, "none"])), ...levels });

async function renderAs(meId: string) {
  setCachedUser({ id: meId, email: `${meId}@example.com`, role: "USER" });
  render(<TeamSettingsPage />);
}

/** Opens the invite form with its Invite toggle, unless it is open already (the toggle would close it). */
async function openInviteForm() {
  const toggle = await screen.findByRole("button", { name: /^Invite$/ });
  if (!screen.queryByLabelText("Team member email")) fireEvent.click(toggle);
  return screen.getByLabelText("Team member email");
}

/** The invite form's role control: member cards carry their own, the invite form's is the first. */
const inviteRole = () => screen.getAllByLabelText("Select role")[0] as HTMLSelectElement;

async function sendInvite(email: string, role?: string): Promise<Record<string, unknown>> {
  const before = api.apiPostSimple.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Team member email"), { target: { value: email } });
  if (role) fireEvent.change(inviteRole(), { target: { value: role } });
  fireEvent.click(screen.getByRole("button", { name: /Send Invite/ }));
  await waitFor(() => expect(api.apiPostSimple).toHaveBeenCalledTimes(before + 1));
  const [path, payload] = api.apiPostSimple.mock.calls[before] as [string, Record<string, unknown>];
  expect(path).toBe(`/identity/businesses/${BUSINESS}/team`);
  return payload;
}

/** A member's row: the innermost block around its email that holds the row's own Remove control. */
function rowAround(email: HTMLElement): HTMLElement | null {
  for (let el: HTMLElement | null = email; el; el = el.parentElement) {
    if (el.querySelector("button[aria-label='Remove team member']")) return el;
  }
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_business_id", BUSINESS);
  api.apiPostSimple.mockResolvedValue({ data: { id: "mem_new" }, error: null });
  api.apiPatch.mockResolvedValue({ data: {}, error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("SWP-TEAM-WEB: a refused or failed team read (BUG-063, journey J6)", () => {
  it("TPS-01 RED-BEFORE: a 403 for team read shows 'No access - ask the owner', no Invite and no zero counts", async () => {
    api.apiGet.mockResolvedValue({
      data: null,
      error: "Insufficient permissions: team requires read access (you have none)",
      status: 403,
    });
    await renderAs("usr_tps_staff");
    await waitFor(() => expect(screen.getByText(/no access/i)).toBeTruthy());
    expect(document.body.textContent ?? "").toMatch(/ask the owner/i);
    expect(screen.queryByRole("button", { name: /^Invite$/ }), "Invite for a member refused the team").toBeNull();
    expect(screen.queryByText(/^\d+ (owner|admin|staff)$/), "the refused read shown as counts").toBeNull();
    expect(screen.queryByText(/no team members yet/i), "the refused read shown as an empty team").toBeNull();
  });

  it("TPS-02 RED-BEFORE: a 500 says the team could not load, not that there are no members", async () => {
    api.apiGet.mockResolvedValue({ data: null, error: "Internal server error", status: 500 });
    await renderAs(OWNER_ID);
    await waitFor(() => expect(screen.getByText(/couldn't load your team/i)).toBeTruthy());
    // COR-TW-1: a failed load is not a refusal.
    expect(screen.queryByText(/no access/i), "a 500 shown as No access").toBeNull();
    expect(screen.queryByText(/^\d+ (owner|admin|staff)$/), "the failed read shown as counts").toBeNull();
    expect(screen.queryByText(/no team members yet/i), "the failed read shown as an empty team").toBeNull();
    expect(screen.queryByRole("button", { name: /^Invite$/ })).toBeNull();
  });
});

describe("SWP-TEAM-WEB: the invite form (BUG-115, journey J2, J3)", () => {
  it("TPS-03 RED-BEFORE: after an Admin invite the role is Staff again, and the next invite is STAFF", async () => {
    serveTeam([owner()]);
    await renderAs(OWNER_ID);
    await openInviteForm();
    const first = await sendInvite("ade@example.com", "ADMIN");
    expect(first.role).toBe("ADMIN");

    await openInviteForm();
    expect(inviteRole().value, "the invite form's role after an Admin invite (BUG-115)").toBe("STAFF");
    const next = await sendInvite("bea@example.com");
    expect(next.role, "the next invite, role untouched").toBe("STAFF");
    expect(next.scopes).toEqual(ROLE_DEFAULT_SCOPES.STAFF);
  });

  it("TPS-05 RED-BEFORE: the presets Admin, Front desk and Bookkeeper each send their own role and scope set", async () => {
    serveTeam([owner()]);
    await renderAs(OWNER_ID);
    await openInviteForm();
    const offered = Array.from(inviteRole().options).map((o) => o.text.trim());
    expect(offered).toEqual(["Staff", "Admin", "Front desk", "Bookkeeper"]);

    const cases: Array<[string, string, Record<string, string>, number]> = [
      ["Admin", "ADMIN", { ...ROLE_DEFAULT_SCOPES.ADMIN }, 3],
      ["Front desk", "STAFF", onlyThese({ bookings: ROLE_DEFAULT_SCOPES.STAFF.bookings, crm: ROLE_DEFAULT_SCOPES.STAFF.crm }), 0],
      ["Bookkeeper", "STAFF", onlyThese({ revenue: ROLE_DEFAULT_SCOPES.STAFF.revenue, expenses: ROLE_DEFAULT_SCOPES.STAFF.expenses }), 0],
    ];
    for (const [label, role, scopes, tier] of cases) {
      await openInviteForm();
      const option = Array.from(inviteRole().options).find((o) => o.text.trim() === label)!;
      const payload = await sendInvite(`${label.replace(/\s+/g, "").toLowerCase()}@example.com`, option.value);
      expect({ label, role: payload.role, scopes: payload.scopes, tier: payload.maxApprovalTier }).toEqual({ label, role, scopes, tier });
    }
    expect(ROLE_DEFAULT_SCOPES.STAFF.bookings).toBe("write");
    expect(ROLE_DEFAULT_SCOPES.STAFF.crm).toBe("read");
  });

  it("TPS-11 RED-BEFORE: after an invite the form stays open, emptied, at Staff, for the next one", async () => {
    serveTeam([owner()]);
    await renderAs(OWNER_ID);
    await openInviteForm();
    await sendInvite("ade@example.com", "FRONT_DESK");
    await new Promise((r) => setTimeout(r, 400));
    const email = screen.queryByLabelText("Team member email") as HTMLInputElement | null;
    expect(email, "the invite form after an invite").not.toBeNull();
    expect(email!.value).toBe("");
    expect(inviteRole().value).toBe("STAFF");
    const next = await sendInvite("bea@example.com", "BOOKKEEPER");
    expect(next.email).toBe("bea@example.com");
    expect(next.role).toBe("STAFF");
    expect(next.scopes).toEqual(onlyThese({ revenue: "read", expenses: "read" }));
  });

  it("TPS-06 RED-BEFORE: the invite email is sent trimmed and in lower case", async () => {
    serveTeam([owner()]);
    await renderAs(OWNER_ID);
    await openInviteForm();
    const payload = await sendInvite("  Nadine.Example@Example.COM ");
    expect(payload.email).toBe("nadine.example@example.com");
  });

  it("TPS-10 RED-BEFORE: the 'Set permissions & approval tier' toggle's label is one text, with its spaces (BUG-135)", async () => {
    serveTeam([owner()]);
    await renderAs(OWNER_ID);
    await openInviteForm();
    const toggle = screen.getByRole("button", { name: "Set permissions & approval tier" });
    const texts = Array.from(toggle.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "")
      .map((n) => n.textContent);
    expect(texts, "the toggle's label as the build sees it (BUG-135: 'Set' and ' permissions & approval tier')").toEqual([
      "Set permissions & approval tier",
    ]);
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide permissions & approval tier" })).toBeTruthy();
  });
});

describe("SWP-TEAM-WEB: pending invites (BUG-116, journey J4)", () => {
  it("TPS-04 RED-BEFORE: an invitePending row says Invited and is not counted", async () => {
    serveTeam([
      owner(),
      member("usr_tps_pending", "STAFF", { ...ROLE_DEFAULT_SCOPES.STAFF }, 0, { invitePending: true }),
    ]);
    await renderAs(OWNER_ID);
    const row = rowAround(await screen.findByText("usr_tps_pending@example.com"));
    expect(row, "the member row").not.toBeNull();
    expect(within(row!).getByText(/^Invited$/), "the pending row is marked").toBeTruthy();
    // Each count is its own badge (jsdom's textContent runs them together).
    expect(screen.getByText(/^1 owner$/)).toBeTruthy();
    expect(screen.getByText(/^0 staff$/), "the pending invite counted as staff").toBeTruthy();
    expect(screen.getByText(/^1 invited$/)).toBeTruthy();
  });
});

describe("SWP-TEAM-WEB: members from the old 11-item form (legacyaccess, D-179)", () => {
  const legacyScopes = Object.fromEntries(LEGACY_FORM_MODULES.map((m) => [m, ROLE_DEFAULT_SCOPES.STAFF[m as keyof typeof ROLE_DEFAULT_SCOPES.STAFF]]));
  const legacy = () => member("usr_tps_legacy", "STAFF", { ...legacyScopes }, 0);
  const legacyAdminScopes = Object.fromEntries(LEGACY_FORM_MODULES.map((m) => [m, ROLE_DEFAULT_SCOPES.ADMIN[m as keyof typeof ROLE_DEFAULT_SCOPES.ADMIN]]));

  const rowOf = async (userId: string) => {
    const row = rowAround(await screen.findByText(`${userId}@example.com`));
    expect(row, "the member row").not.toBeNull();
    return row!;
  };

  it("TPS-07 RED-BEFORE: the row shows Analytics and Operations as No access; the owner's one click grants the role default", async () => {
    serveTeam([owner(), legacy(), member("usr_tps_legacy_admin", "ADMIN", { ...legacyAdminScopes }, 3)]);
    await renderAs(OWNER_ID);
    const row = await rowOf("usr_tps_legacy");
    expect(within(row).getByText(/Analytics and Operations: No access/i)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(api.apiPatch, "nothing is granted by itself").not.toHaveBeenCalled();

    fireEvent.click(within(row).getByRole("button", { name: /grant analytics and operations/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    const [path, body] = api.apiPatch.mock.calls[0] as [string, { scopes: Record<string, string>; maxApprovalTier: number }];
    expect(path).toBe(`/identity/businesses/${BUSINESS}/team/mem_usr_tps_legacy/permissions`);
    expect(body).toEqual({ scopes: { ...legacyScopes, analytics: "read", operations: "read" }, maxApprovalTier: 0 });

    const adminRow = await rowOf("usr_tps_legacy_admin");
    fireEvent.click(within(adminRow).getByRole("button", { name: /grant analytics and operations/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(2));
    const [, adminBody] = api.apiPatch.mock.calls[1] as [string, { scopes: Record<string, string>; maxApprovalTier: number }];
    expect(adminBody).toEqual({ scopes: { ...legacyAdminScopes, analytics: "admin", operations: "admin" }, maxApprovalTier: 3 });
  });

  it("TPS-08 RED-BEFORE: an ADMIN viewing the row sees No access and no grant", async () => {
    serveTeam([owner(), member("usr_tps_admin", "ADMIN", { ...ROLE_DEFAULT_SCOPES.ADMIN }, 3), legacy()]);
    await renderAs("usr_tps_admin");
    const row = await rowOf("usr_tps_legacy");
    expect(within(row).getByText(/Analytics and Operations: No access/i)).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /grant analytics and operations/i })).toBeNull();
  });

  it("TPS-09 control: a map that names analytics and operations, even at none, is not a legacy row", async () => {
    serveTeam([owner(), member("usr_tps_chosen", "STAFF", { ...legacyScopes, analytics: "none", operations: "none" }, 0)]);
    await renderAs(OWNER_ID);
    const row = await rowOf("usr_tps_chosen");
    expect(within(row).queryByText(/Analytics and Operations: No access/i)).toBeNull();
    expect(within(row).queryByRole("button", { name: /grant analytics and operations/i })).toBeNull();
  });
});

/**
 * Repair round 1 (the orchestrator's reviews of 0705bb0d):
 *   TPR-01  SEC-TW-M1: a viewer whose own row holds team read (not write) is not offered Invite or the presets (the
 *           server refuses the invite 403); team write and the owner are; a viewer the page cannot find in the list
 *           keeps the form (the server is the authority there, as R0-ID-UX-T07 relies on)
 *   TPR-02  SEC-TW-M2 / COR-TW-3: the legacy row is exactly the old 11-item form's shape: all eleven of its modules
 *           named and both analytics and operations absent. Not an empty array or object, not a map missing only one
 *           of the two, and never the OWNER's row
 *   TPR-03  COR-TW-2: an invite with edited scopes is followed by an untouched one that sends the role defaults
 *   TPR-04  COR-TW-4: a reload that fails after a good first load keeps the team on screen and says so, with Try again
 */
describe("SWP-TEAM-WEB repair 1", () => {
  const legacyStaffScopes = () =>
    Object.fromEntries(LEGACY_FORM_MODULES.map((m) => [m, ROLE_DEFAULT_SCOPES.STAFF[m as keyof typeof ROLE_DEFAULT_SCOPES.STAFF]]));
  const rowOf = async (userId: string) => {
    const row = rowAround(await screen.findByText(`${userId}@example.com`));
    expect(row, "the member row").not.toBeNull();
    return row!;
  };

  it("TPR-01 SEC-TW-M1: team read without write is not offered Invite; team write and the owner are", async () => {
    const viewer = member("usr_tpr_reader", "STAFF", { ...ROLE_DEFAULT_SCOPES.STAFF, team: "read" }, 0);
    serveTeam([owner(), viewer]);
    await renderAs("usr_tpr_reader");
    await screen.findByText("usr_tpr_reader@example.com");
    expect(screen.queryByRole("button", { name: /^Invite$/ }), "Invite for team read").toBeNull();
    expect(screen.queryByLabelText("Team member email")).toBeNull();
    cleanup();

    serveTeam([owner(), member("usr_tpr_writer", "ADMIN", { ...ROLE_DEFAULT_SCOPES.ADMIN }, 3)]);
    await renderAs("usr_tpr_writer");
    expect(await screen.findByRole("button", { name: /^Invite$/ }), "Invite for team write").toBeTruthy();
    cleanup();

    serveTeam([owner()]);
    await renderAs(OWNER_ID);
    expect(await screen.findByRole("button", { name: /^Invite$/ }), "Invite for the owner").toBeTruthy();
    cleanup();

    serveTeam([owner()]);
    await renderAs("usr_tpr_not_listed");
    expect(await screen.findByRole("button", { name: /^Invite$/ }), "Invite for a viewer the page cannot find").toBeTruthy();
  });

  it("TPR-02 SEC-TW-M2 / COR-TW-3: only the old form's exact shape is a legacy row, never the owner's", async () => {
    const { analytics: _a, ...withoutAnalytics } = { ...ROLE_DEFAULT_SCOPES.STAFF };
    const { operations: _o, ...withoutOperations } = { ...ROLE_DEFAULT_SCOPES.STAFF };
    void _a;
    void _o;
    const cases: Array<[string, string, unknown, boolean]> = [
      ["the old 11-item form", "STAFF", legacyStaffScopes(), true],
      ["an empty array", "STAFF", [], false],
      ["an empty map", "STAFF", {}, false],
      ["analytics missing, operations named", "STAFF", withoutAnalytics, false],
      ["operations missing, analytics named", "STAFF", withoutOperations, false],
      ["eight of the old form's modules", "STAFF", Object.fromEntries(Object.entries(legacyStaffScopes()).slice(0, 8)), false],
    ];
    const wrong: string[] = [];
    for (const [name, role, scopes, legacy] of cases) {
      const id = `usr_tpr_${name.replace(/[^a-z0-9]+/gi, "_")}`;
      serveTeam([owner(), member(id, role, scopes as Record<string, string>, 0)]);
      await renderAs(OWNER_ID);
      const row = await rowOf(id);
      const shown = !!within(row).queryByText(/Analytics and Operations: No access/i);
      if (shown !== legacy) wrong.push(`${name}: ${shown ? "shown" : "not shown"}`);
      cleanup();
    }
    expect(wrong, "rows marked legacy the wrong way").toEqual([]);

    // The OWNER's own row, even with the old form's map, has nothing to grant (the owner holds every module).
    serveTeam([member(OWNER_ID, "OWNER", legacyStaffScopes(), 4), member("usr_tpr_other", "STAFF", { ...ROLE_DEFAULT_SCOPES.STAFF }, 0)]);
    await renderAs(OWNER_ID);
    await rowOf("usr_tpr_other");
    expect(screen.queryByText(/Analytics and Operations: No access/i), "the owner's row marked legacy").toBeNull();
  });

  it("TPR-03 COR-TW-2: after an invite with edited scopes, an untouched invite sends the Staff defaults", async () => {
    serveTeam([owner()]);
    await renderAs(OWNER_ID);
    await openInviteForm();
    fireEvent.click(screen.getByRole("button", { name: "Set permissions & approval tier" }));
    fireEvent.click(screen.getByRole("button", { name: "Set Analytics to none" }));
    fireEvent.click(screen.getByRole("button", { name: "Set CRM / Clients to write" }));
    const edited = await sendInvite("ade@example.com");
    expect(edited.scopes).toEqual({ ...ROLE_DEFAULT_SCOPES.STAFF, analytics: "none", crm: "write" });
    const next = await sendInvite("bea@example.com");
    expect(next.role).toBe("STAFF");
    expect(next.scopes, "the untouched invite after an edited one").toEqual(ROLE_DEFAULT_SCOPES.STAFF);
  });

  it("TPR-04 COR-TW-4: a failed reload keeps the team on screen, says so, and Try again reloads it", async () => {
    serveTeam([owner(), member("usr_tpr_kept", "STAFF", { ...ROLE_DEFAULT_SCOPES.STAFF }, 0)]);
    await renderAs(OWNER_ID);
    await screen.findByText("usr_tpr_kept@example.com");
    const good = api.apiGet.getMockImplementation();
    api.apiGet.mockResolvedValue({ data: null, error: "Bad gateway", status: 502 });
    await openInviteForm();
    await sendInvite("cara@example.com");
    const notice = await screen.findByRole("alert");
    expect(notice.textContent ?? "").toMatch(/couldn't load your team/i);
    expect(screen.getByText("usr_tpr_kept@example.com"), "the team kept on screen").toBeTruthy();
    expect(screen.getByLabelText("Team member email"), "the invite form kept on screen").toBeTruthy();

    serveTeam([owner(), member("usr_tpr_kept", "STAFF", { ...ROLE_DEFAULT_SCOPES.STAFF }, 0), member("usr_tpr_cara", "STAFF", { ...ROLE_DEFAULT_SCOPES.STAFF }, 0)]);
    void good;
    fireEvent.click(within(notice).getByRole("button", { name: /try again/i }));
    await screen.findByText("usr_tpr_cara@example.com");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

/**
 * Repair round 2 (the orchestrator's reviews of 0081360f):
 *   TPR-05  SEC-TW-R1 / COR-TW-R2-1: a reload refused 403 (a module-scope refusal, or BusinessGuard's "No access to
 *           this business" for a removed member) drops the team from the screen and shows the refusal; only a 5xx, a
 *           network failure or an empty error keeps the last good list (TPR-04)
 *   TPR-06  COR-TW-R2-2: a viewer row with no scope map (null) is read at its role's defaults, as the server's
 *           memberModuleLevel reads it: an ADMIN sees Invite, a STAFF does not
 *   TPR-07  COR-TW-R2-3: a reload that lowers the viewer's own team level to read while the form is open takes the
 *           form and Invite away
 *   TPR-08  SEC-TW-R2, control (judged acceptable as designed): with no cached user the form stays, and the server's
 *           refusal is what stops a member below team write. Hiding it was tried and breaks R0-ID-UX-T02 and
 *           SFB-WEB-01/02 (invite-default-scopes / staff-bookings-default, outside this packet's write set), which
 *           render the page with no cached user; so it is left, as the review allowed
 */
describe("SWP-TEAM-WEB repair 2", { timeout: 15_000 }, () => {
  const kept = () => member("usr_tpr_kept2", "STAFF", { ...ROLE_DEFAULT_SCOPES.STAFF }, 0);

  async function reloadAnswering(answer: { data: null; error: string; status: number }) {
    serveTeam([owner(), kept()]);
    await renderAs(OWNER_ID);
    await screen.findByText("usr_tpr_kept2@example.com");
    api.apiGet.mockResolvedValue(answer);
    await openInviteForm();
    await sendInvite("dee@example.com");
  }

  it("TPR-05a: a module-scope 403 on reload shows No access and the old rows are gone", async () => {
    await reloadAnswering({ data: null, error: "Insufficient permissions: team requires read access (you have none)", status: 403 });
    await waitFor(() => expect(screen.getByText(/no access - ask the owner/i)).toBeTruthy());
    expect(screen.queryByText("usr_tpr_kept2@example.com"), "the old team left on screen").toBeNull();
    expect(screen.queryByLabelText("Team member email")).toBeNull();
  });

  it("TPR-05b: BusinessGuard's 'No access to this business' 403 on reload drops the team and says so", async () => {
    await reloadAnswering({ data: null, error: "No access to this business", status: 403 });
    await waitFor(() => expect(screen.queryByText("usr_tpr_kept2@example.com"), "the old team left on screen").toBeNull());
    expect(document.body.textContent ?? "").toMatch(/no access to this business/i);
    expect(screen.queryByLabelText("Team member email")).toBeNull();
    expect(screen.queryByText(/as it was last loaded/i), "the refusal shown as a soft notice").toBeNull();
  });

  it("TPR-06: a viewer row with a null map is read at its role's defaults (ADMIN invites, STAFF does not)", async () => {
    serveTeam([owner(), member("usr_tpr_null_admin", "ADMIN", null as unknown as Record<string, string>, 3)]);
    await renderAs("usr_tpr_null_admin");
    expect(await screen.findByRole("button", { name: /^Invite$/ }), "Invite for an ADMIN with no stored map").toBeTruthy();
    cleanup();

    serveTeam([owner(), member("usr_tpr_null_staff", "STAFF", null as unknown as Record<string, string>, 0)]);
    await renderAs("usr_tpr_null_staff");
    await screen.findByText("usr_tpr_null_staff@example.com");
    expect(screen.queryByRole("button", { name: /^Invite$/ }), "Invite for a STAFF with no stored map").toBeNull();
  });

  it("TPR-07: a reload that lowers the viewer to team read takes the open form and Invite away", async () => {
    const writer = (team: string) => member("usr_tpr_writer2", "ADMIN", { ...ROLE_DEFAULT_SCOPES.ADMIN, team }, 3);
    serveTeam([owner(), writer("write")]);
    await renderAs("usr_tpr_writer2");
    await openInviteForm();
    serveTeam([owner(), writer("read")]);
    await sendInvite("eve@example.com");
    await waitFor(() => expect(screen.queryByLabelText("Team member email"), "the form after the viewer was lowered").toBeNull());
    expect(screen.queryByRole("button", { name: /^Invite$/ })).toBeNull();
  });

  it("TPR-08 control: with no cached user the form stays and the server's refusal is shown", async () => {
    clearStoredBusinessId();
    window.localStorage.setItem("kf_business_id", BUSINESS);
    serveTeam([owner(), kept()]);
    render(<TeamSettingsPage />);
    await screen.findByText("usr_tpr_kept2@example.com");
    api.apiPostSimple.mockResolvedValue({ data: null, error: "Insufficient permissions: team requires write access (you have read)", status: 403 });
    await openInviteForm();
    await sendInvite("fay@example.com");
    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Insufficient permissions: team requires write access (you have read)"));
  });
});

/**
 * Repair round 3 (the orchestrator's confirmations of a1e51c58):
 *   TPR-09  a refused reload clears what was open: the permission editor (a full member record), the remove confirm
 *           and the invite form do not come back when Try again loads the team again
 *   TPR-10  each half of `refused`: a guard sentence with no status, or a non-403 status, is a refusal; a bare 403
 *           with other words ("Forbidden") is a refusal; both drop the team
 *   TPR-11  null maps: the inviter cap reads an ADMIN inviter with no map at the ADMIN defaults (nothing lowered); an
 *           unedited save in the permission editor for a null-map member sends the role defaults, not {}; the
 *           overview table shows a null-map member at the role defaults
 *   TPR-12  an array map is an explicit map with every module absent (the server reads it so): no role defaults, so
 *           an ADMIN viewer holding one is not offered Invite
 *   TPR-13  loadedOnce is reset by a refusal: Try again after a refused reload that then fails 502 says the new
 *           failure, not the old refusal
 */
describe("SWP-TEAM-WEB repair 3", { timeout: 15_000 }, () => {
  const other = () => member("usr_tpr_other3", "STAFF", { ...ROLE_DEFAULT_SCOPES.STAFF }, 0);
  const refusedBy = (error: string, status?: number) => ({ data: null, error, ...(status === undefined ? {} : { status }) });

  it("TPR-09: a refused reload clears the open editor, remove confirm and invite form", async () => {
    serveTeam([owner(), other()]);
    await renderAs(OWNER_ID);
    const row = rowAround(await screen.findByText("usr_tpr_other3@example.com"))!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit permissions" }));
    expect(screen.getByText(/Permissions for usr_tpr_other3/)).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Remove team member" }));
    expect(screen.getByText(/Are you sure you want to remove/)).toBeTruthy();
    await openInviteForm();
    api.apiGet.mockResolvedValue(refusedBy("No access to this business", 403));
    await sendInvite("gil@example.com");
    const retry = await screen.findByRole("button", { name: /try again/i });

    serveTeam([owner(), other()]);
    fireEvent.click(retry);
    await screen.findByText("usr_tpr_other3@example.com");
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(/Permissions for usr_tpr_other3/), "the editor came back").toBeNull();
    expect(screen.queryByText(/Are you sure you want to remove/), "the remove confirm came back").toBeNull();
    expect(screen.queryByLabelText("Team member email"), "the invite form came back").toBeNull();
  });

  it("TPR-10: a guard sentence without a 403, and a bare 403, are both refusals that drop the team", async () => {
    const answers: Array<[string, ReturnType<typeof refusedBy>]> = [
      ["the guard sentence, no status", refusedBy("No access to this business")],
      ["the guard sentence, status 404", refusedBy("Not a member of this business", 404)],
      ["a bare 403 'Forbidden'", refusedBy("Forbidden", 403)],
    ];
    const kept: string[] = [];
    for (const [name, answer] of answers) {
      serveTeam([owner(), other()]);
      await renderAs(OWNER_ID);
      await screen.findByText("usr_tpr_other3@example.com");
      await openInviteForm();
      api.apiGet.mockResolvedValue(answer);
      await sendInvite("hal@example.com");
      await new Promise((r) => setTimeout(r, 200));
      if (screen.queryByText("usr_tpr_other3@example.com")) kept.push(name);
      cleanup();
      api.apiPostSimple.mockClear();
    }
    expect(kept, "refusals that left the team on screen").toEqual([]);
  });

  it("TPR-11a: an ADMIN inviter with no map is capped at the ADMIN defaults, so nothing is lowered", async () => {
    serveTeam([owner(), member("usr_tpr_nullinv", "ADMIN", null as unknown as Record<string, string>, 3)]);
    await renderAs("usr_tpr_nullinv");
    await openInviteForm();
    expect(screen.queryByText(/start at your own access/), "rows lowered for a null-map ADMIN").toBeNull();
    const payload = await sendInvite("ida@example.com");
    expect(payload.scopes).toEqual(ROLE_DEFAULT_SCOPES.STAFF);
  });

  it("TPR-11b: an unedited save for a null-map member sends the role defaults, not {}", async () => {
    serveTeam([owner(), member("usr_tpr_nullmem", "STAFF", null as unknown as Record<string, string>, 0)]);
    await renderAs(OWNER_ID);
    const row = rowAround(await screen.findByText("usr_tpr_nullmem@example.com"))!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit permissions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Permissions" }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    const [, body] = api.apiPatch.mock.calls[0] as [string, { scopes: Record<string, string> }];
    expect(body.scopes).toEqual(ROLE_DEFAULT_SCOPES.STAFF);
  });

  it("TPR-11c: the overview table shows a null-map member at the role defaults", async () => {
    serveTeam([owner(), member("usr_tpr_nulltab", "STAFF", null as unknown as Record<string, string>, 0)]);
    await renderAs(OWNER_ID);
    await screen.findByText("usr_tpr_nulltab@example.com");
    // The Permissions tab (its label is the tab key, "permissions").
    fireEvent.click(screen.getAllByRole("button").find((btn) => btn.textContent?.trim() === "permissions")!);
    const cell = await screen.findByText("usr_tpr_nulltab", { selector: "td" });
    const icons = Array.from(cell.closest("tr")!.querySelectorAll("svg")).map((i) => i.getAttribute("class") ?? "");
    // STAFF defaults: bookings write (emerald), most modules read (blue), settings/team/ai/connect none.
    expect(icons.filter((c) => c.includes("text-emerald-400")).length, "write cells").toBe(1);
    expect(icons.filter((c) => c.includes("text-blue-400")).length, "read cells").toBe(9);
  });

  it("TPR-12: an ADMIN viewer holding an array map is not offered Invite", async () => {
    serveTeam([owner(), member("usr_tpr_arr", "ADMIN", [] as unknown as Record<string, string>, 3)]);
    await renderAs("usr_tpr_arr");
    await screen.findByText("usr_tpr_arr@example.com");
    expect(screen.queryByRole("button", { name: /^Invite$/ }), "Invite for an ADMIN with an array map").toBeNull();
  });

  it("TPR-13: after a refused reload, Try again that fails 502 says the new failure", async () => {
    serveTeam([owner(), other()]);
    await renderAs(OWNER_ID);
    await screen.findByText("usr_tpr_other3@example.com");
    await openInviteForm();
    api.apiGet.mockResolvedValue(refusedBy("No access to this business", 403));
    await sendInvite("jo@example.com");
    const retry = await screen.findByRole("button", { name: /try again/i });
    api.apiGet.mockResolvedValue(refusedBy("Bad gateway", 502));
    fireEvent.click(retry);
    await waitFor(() => expect(document.body.textContent ?? "").toMatch(/Couldn't load your team: Bad gateway/));
    expect(document.body.textContent ?? "").not.toMatch(/No access to this business/);
  });
});
