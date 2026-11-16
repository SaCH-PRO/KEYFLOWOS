/**
 * SWEEP-P0-FOLLOWUP, staffbookings ruling (owner ruling at the recommended option): STAFF handle bookings by
 * default. The server's STAFF role default is bookings 'write' (module-vocabulary.ts ROLE_DEFAULT_SCOPES), so the
 * team invite form shows and sends bookings write for a STAFF invite with untouched defaults, every other STAFF
 * default unchanged (read; none for settings, team and ai, and for connect, none for every role). The inviter can
 * still lower it to read.
 *
 * Mounted on the real TeamSettingsPage; only the api module's request helpers and the toast are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CANONICAL_MODULES } from "../../../../../../../server/src/core/authority/module-vocabulary";

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

const BUSINESS = "biz_team_staffbk";
const STAFF_DENIED = ["settings", "team", "ai"];
const NONE_FOR_EVERY_ROLE = ["connect"];

async function openStaffInvite() {
  render(<TeamSettingsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /Invite/ }));
  fireEvent.change(screen.getByLabelText("Team member email"), { target: { value: "new.staff@example.com" } });
  fireEvent.change(screen.getByLabelText("Select role"), { target: { value: "STAFF" } });
}

async function sendInvite(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: /Send Invite/ }));
  await waitFor(() => expect(api.apiPostSimple).toHaveBeenCalledTimes(1));
  const [path, payload] = api.apiPostSimple.mock.calls[0] as [string, Record<string, unknown>];
  expect(path).toBe(`/identity/businesses/${BUSINESS}/team`);
  return payload;
}

describe("team invite form: STAFF handle bookings by default (SWEEP-P0-FOLLOWUP staffbookings)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_business_id", BUSINESS);
    api.apiGet.mockResolvedValue({
      data: { members: [], totalMembers: 0, recentActivity: [], permissionModules: [...CANONICAL_MODULES] },
      error: null,
    });
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

  it("[SFB-WEB-01] RED-BEFORE: a STAFF invite with untouched defaults sends bookings write; every other module keeps the STAFF default", async () => {
    await openStaffInvite();
    const payload = await sendInvite();

    const scopes = payload.scopes as Record<string, string>;
    expect(payload.role).toBe("STAFF");
    expect(scopes.bookings).toBe("write");
    for (const module of CANONICAL_MODULES.filter((m) => m !== "bookings")) {
      expect(scopes[module], module).toBe([...STAFF_DENIED, ...NONE_FOR_EVERY_ROLE].includes(module) ? "none" : "read");
    }
  });

  it("[SFB-WEB-02] RED-BEFORE: the permissions grid marks Bookings write for a STAFF invite, and the inviter can lower it to read", async () => {
    await openStaffInvite();
    fireEvent.click(screen.getByRole("button", { name: /Set permissions/ }));

    const write = await screen.findByRole("button", { name: "Set Bookings to write" });
    expect(write.className).toContain("ring-1");
    expect(screen.getByRole("button", { name: "Set Bookings to read" }).className).not.toContain("ring-1");

    fireEvent.click(screen.getByRole("button", { name: "Set Bookings to read" }));
    const payload = await sendInvite();
    expect((payload.scopes as Record<string, string>).bookings).toBe("read");
  });
});
