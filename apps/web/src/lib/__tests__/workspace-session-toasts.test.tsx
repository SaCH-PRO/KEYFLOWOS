/**
 * FU-UNDO-TOAST-SIGNOUT (owner ruling D-283): the bulk-delete Undo toast lives in the app-wide Toaster
 * (components/providers.tsx) and outlived a sign-out, because sign-out and sign-in navigate in place. Since
 * FU-BULK-DELETE-UNDO's SEC-P37W-1 repair its Undo can no longer act for another person, but its text ("Deleted 3
 * contacts") stayed visible to the next person in the tab. Toasts belong to the session that raised them: they are
 * dismissed when the session ends (the sign-out wipe, clearStoredBusinessId, which the header's sign-out, RequireAuth's
 * redirect to sign-in and a global 401 all run) and when a session starts (clearAdminSession, which every sign-in
 * runs first: login-form, signup and the OAuth callback).
 *
 * The toast here is the real one: deleteContactsWithUndo (only the HTTP client is mocked) into a real sonner Toaster.
 *
 *   UTS-01 the sign-out wipe (clearStoredBusinessId) dismisses a pending Undo toast
 *   UTS-02 a sign-in (clearAdminSession, run first by every sign-in) dismisses a pending Undo toast
 *   UTS-03 the admin sign-out (adminSignOut) dismisses it too
 *   UTS-04 control: with no session boundary the Undo toast stays up and its Undo is offered
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { Toaster, toast } from "sonner";

const client = vi.hoisted(() => ({
  bulkDeleteContacts: vi.fn(),
  bulkRestoreTrashItems: vi.fn(),
  bootstrapIdentity: vi.fn(async () => ({ data: null, error: "unused" })),
}));

vi.mock("@/lib/client", () => client);
vi.mock("../client", () => client);

import { clearAdminSession, clearStoredBusinessId, adminSignOut } from "../workspace";
import { deleteContactsWithUndo } from "@/app/app/crm/pipeline/hooks/contacts-bulk-delete";

const BIZ = "biz-undo-toast";

function jwt(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, aud: "authenticated" })}.c2lnbmF0dXJl`;
}

async function raiseUndoToast() {
  client.bulkDeleteContacts.mockResolvedValue({ data: { deleted: 3 }, error: null, status: 200 });
  await act(async () => {
    await deleteContactsWithUndo({ businessId: BIZ, ids: ["c1", "c2", "c3"] });
  });
  await screen.findByText("Deleted 3 contacts");
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
}

async function expectUndoToastGone() {
  await waitFor(() => {
    expect(screen.queryByText("Deleted 3 contacts")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", jwt("user-a"));
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  render(<Toaster />);
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("FU-UNDO-TOAST-SIGNOUT: toasts end with the session (workspace)", () => {
  it("UTS-01 the sign-out wipe dismisses a pending Undo toast", async () => {
    await raiseUndoToast();
    act(() => {
      clearStoredBusinessId();
    });
    await expectUndoToastGone();
  });

  it("UTS-02 a sign-in (clearAdminSession, which every sign-in runs first) dismisses a pending Undo toast", async () => {
    await raiseUndoToast();
    // Another person signs in in this tab: login-form, signup and the OAuth callback each run clearAdminSession
    // before storing the new session.
    act(() => {
      clearAdminSession();
    });
    await expectUndoToastGone();
  });

  it("UTS-03 the admin sign-out dismisses a pending Undo toast", async () => {
    await raiseUndoToast();
    await act(async () => {
      await adminSignOut();
    });
    await expectUndoToastGone();
  });

  it("UTS-04 control: with no session boundary the Undo toast stays up", async () => {
    await raiseUndoToast();
    // Give a wrongly dismissed toast time to leave before looking.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    // Present and never dismissed: a dismissed toast stays in the DOM while it animates out, data-removed="true"
    // (review COR-UTS-1).
    const text = screen.getByText("Deleted 3 contacts");
    expect(text.closest("[data-sonner-toast]")?.getAttribute("data-removed"), "the toast was not dismissed").toBe("false");
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });
});
