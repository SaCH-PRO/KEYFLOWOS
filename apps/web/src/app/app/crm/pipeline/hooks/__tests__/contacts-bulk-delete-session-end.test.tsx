/**
 * FU-UNDO-TOAST-SIGNOUT repair round 1, review SEC-UTS-1 / COR-UTS-2 (owner ruling D-283). Sign-out and sign-in now
 * dismiss the toasts on screen, but a bulk delete or an Undo's restore still on its way then answers AFTER both
 * dismisses: it raised "Deleted N contacts" with Undo, or "Restored N contacts" (and ran onRestored, re-reading the
 * screen), on the sign-in page or over the next person's shell. Its Undo was already inert (SEC-P37W-1, `deletedAs`).
 * An answer that lands after the session that sent it ended or changed hands now says nothing and re-reads nothing.
 *
 *   BSE-01 a delete answered after sign-out (clearStoredBusinessId) raises no toast
 *   BSE-02 a delete answered after another person's token was stored raises no toast
 *   BSE-03 a refused delete answered after sign-out raises no refusal toast, and resolves null (nothing deleted)
 *   BSE-04 a quiet delete still resolves what was deleted (the caller's list is right if it is still mounted)
 *   BSE-05 an Undo's restore answered after sign-out raises no toast and does not run onRestored
 *   BSE-06 an Undo's restore answered after another person's token was stored: no toast, no onRestored
 *   BSE-07 control: a same-user token rotation while the delete and the restore are on their way changes nothing:
 *          "Deleted 3 contacts" with Undo, then "Restored 3 contacts" and onRestored
 *   BSE-08 pin (the undo-time guard, SEC-P37W-1; orchestrator ruling with CONF-P37-1's supersession): a toast that
 *          survives a session change by some other path (another person's token written straight into storage, no
 *          dismiss) still cannot restore: its Undo says "earlier session" and sends nothing
 *   BSE-09 a partial delete with no ids named ({deleted: 2}), answered after sign-out: no toast; {deleted: 2, deletedIds: null}
 *   BSE-10 a delete of none ({deleted: 0}), answered after another person's token was stored: no toast;
 *          {deleted: 0, deletedIds: []}
 *   BSE-11 an answer that does not say how many ({}), answered after sign-out: no toast; {deleted: null, deletedIds: null}
 *   BSE-12 a delete sent with no session at all, answered with no session: no toast (no one to tell)
 * (BSE-09..12: review COR-UTS-4, round 3: every quiet branch is exercised, not only the full delete.)
 *
 * The real deleteContactsWithUndo and failure kit run; the HTTP client is gated; sonner is replaced by spies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastSpies = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>;
  for (const k of ["success", "error", "info", "warning", "message", "loading", "dismiss"]) fn[k] = vi.fn();
  return fn;
});
vi.mock("sonner", () => ({ toast: toastSpies }));

const client = vi.hoisted(() => ({
  bulkDeleteContacts: vi.fn(),
  bulkRestoreTrashItems: vi.fn(),
  bootstrapIdentity: vi.fn(async () => ({ data: null, error: "unused" })),
}));
vi.mock("@/lib/client", () => client);

import { deleteContactsWithUndo } from "../contacts-bulk-delete";
import { clearStoredBusinessId } from "@/lib/workspace";

const BIZ = "biz_bse";
const IDS = ["ct_1", "ct_2", "ct_3"];

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
let seq = 0;
const tokenFor = (sub: string) => `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub, n: ++seq })}.sig`;

/** A promise the test releases with `answer`. */
function gate<T>() {
  let release!: (v: T) => void;
  const promise = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const DELETED_ALL = { data: { deleted: 3 }, error: null, status: 200 };
const RESTORED_ALL = { data: { model: "contact", restored: IDS, failed: [], restoredCount: 3, failedCount: 0 }, error: null, status: 200 };

/** Every toast call made, of any kind. */
function toastCalls(): unknown[][] {
  const calls = [...toastSpies.mock.calls];
  for (const k of ["success", "error", "info", "warning", "message", "loading"]) calls.push(...toastSpies[k].mock.calls);
  return calls;
}

function clearToastCalls() {
  toastSpies.mockClear();
  for (const k of ["success", "error", "info", "warning", "message", "loading", "dismiss"]) toastSpies[k].mockClear();
}

/** The Undo the "Deleted 3 contacts" toast offered. */
function pressUndo() {
  const call = toastSpies.success.mock.calls.find(([title]) => title === "Deleted 3 contacts");
  const onClick = (call?.[1] as { action?: { onClick?: () => void } } | undefined)?.action?.onClick;
  expect(onClick, "the toast offered Undo").toBeTypeOf("function");
  onClick!();
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("kf_token", tokenFor("user-a"));
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  clearToastCalls();
  client.bulkDeleteContacts.mockReset();
  client.bulkRestoreTrashItems.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FU-UNDO-TOAST-SIGNOUT SEC-UTS-1: a bulk delete answered after its session ended says nothing", () => {
  it("BSE-01 a delete answered after sign-out raises no toast", async () => {
    const answer = gate<unknown>();
    client.bulkDeleteContacts.mockReturnValue(answer.promise);
    const done = deleteContactsWithUndo({ businessId: BIZ, ids: IDS });
    clearStoredBusinessId();
    clearToastCalls();
    answer.release(DELETED_ALL);
    await done;
    expect(toastCalls(), "nothing is said on the sign-in page").toEqual([]);
  });

  it("BSE-02 a delete answered after another person's token was stored raises no toast", async () => {
    const answer = gate<unknown>();
    client.bulkDeleteContacts.mockReturnValue(answer.promise);
    const done = deleteContactsWithUndo({ businessId: BIZ, ids: IDS });
    window.localStorage.setItem("kf_token", tokenFor("user-b"));
    answer.release(DELETED_ALL);
    await done;
    expect(toastCalls(), "nothing is said to the other person").toEqual([]);
  });

  it("BSE-03 a refused delete answered after sign-out raises no refusal toast and resolves null", async () => {
    const answer = gate<unknown>();
    client.bulkDeleteContacts.mockReturnValue(answer.promise);
    const done = deleteContactsWithUndo({ businessId: BIZ, ids: IDS });
    clearStoredBusinessId();
    clearToastCalls();
    answer.release({ data: null, error: "Insufficient permissions: crm requires write access (you have read)", status: 403 });
    expect(await done).toBeNull();
    expect(toastCalls()).toEqual([]);
  });

  it("BSE-04 a quiet delete still resolves what was deleted", async () => {
    const answer = gate<unknown>();
    client.bulkDeleteContacts.mockReturnValue(answer.promise);
    const done = deleteContactsWithUndo({ businessId: BIZ, ids: IDS });
    window.localStorage.setItem("kf_token", tokenFor("user-b"));
    answer.release(DELETED_ALL);
    expect(await done).toEqual({ deleted: 3, deletedIds: IDS });
    expect(toastCalls()).toEqual([]);
  });

  it("BSE-05 an Undo's restore answered after sign-out raises no toast and does not run onRestored", async () => {
    client.bulkDeleteContacts.mockResolvedValue(DELETED_ALL);
    const restore = gate<unknown>();
    client.bulkRestoreTrashItems.mockReturnValue(restore.promise);
    const onRestored = vi.fn();
    await deleteContactsWithUndo({ businessId: BIZ, ids: IDS, onRestored });
    pressUndo();
    expect(client.bulkRestoreTrashItems).toHaveBeenCalledWith(BIZ, "contact", IDS);
    clearStoredBusinessId();
    clearToastCalls();
    restore.release(RESTORED_ALL);
    await flush();
    await flush();
    expect(toastCalls(), "no 'Restored 3 contacts' on the sign-in page").toEqual([]);
    expect(onRestored, "the screen is not re-read for nobody").not.toHaveBeenCalled();
  });

  it("BSE-06 an Undo's restore answered after another person's token was stored: no toast, no onRestored", async () => {
    client.bulkDeleteContacts.mockResolvedValue(DELETED_ALL);
    const restore = gate<unknown>();
    client.bulkRestoreTrashItems.mockReturnValue(restore.promise);
    const onRestored = vi.fn();
    await deleteContactsWithUndo({ businessId: BIZ, ids: IDS, onRestored });
    pressUndo();
    window.localStorage.setItem("kf_token", tokenFor("user-b"));
    clearToastCalls();
    restore.release(RESTORED_ALL);
    await flush();
    await flush();
    expect(toastCalls()).toEqual([]);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("BSE-08 pin: an Undo pressed after the stored session changed without a dismiss says 'earlier session' and sends nothing", async () => {
    client.bulkDeleteContacts.mockResolvedValue(DELETED_ALL);
    const onRestored = vi.fn();
    await deleteContactsWithUndo({ businessId: BIZ, ids: IDS, onRestored });
    // Another person's token, written directly (not through clearAdminSession): the toast was not dismissed.
    window.localStorage.setItem("kf_token", tokenFor("user-b"));
    pressUndo();
    await flush();
    expect(client.bulkRestoreTrashItems, "no restore under the other person's session").not.toHaveBeenCalled();
    expect(toastSpies.warning).toHaveBeenCalledWith(
      "Nothing was restored: this Undo belonged to an earlier session.",
      expect.objectContaining({ description: "The contacts are still in Trash." }),
    );
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("BSE-09 a partial delete with no ids named, answered after sign-out, raises no toast", async () => {
    const answer = gate<unknown>();
    client.bulkDeleteContacts.mockReturnValue(answer.promise);
    const done = deleteContactsWithUndo({ businessId: BIZ, ids: IDS });
    clearStoredBusinessId();
    clearToastCalls();
    answer.release({ data: { deleted: 2 }, error: null, status: 200 });
    expect(await done).toEqual({ deleted: 2, deletedIds: null });
    expect(toastCalls(), "no 'Deleted 2 of 3 contacts' on the sign-in page").toEqual([]);
  });

  it("BSE-10 a delete of none, answered after another person's token was stored, raises no toast", async () => {
    const answer = gate<unknown>();
    client.bulkDeleteContacts.mockReturnValue(answer.promise);
    const done = deleteContactsWithUndo({ businessId: BIZ, ids: IDS });
    window.localStorage.setItem("kf_token", tokenFor("user-b"));
    answer.release({ data: { deleted: 0 }, error: null, status: 200 });
    expect(await done).toEqual({ deleted: 0, deletedIds: [] });
    expect(toastCalls(), "no 'None of the 3 selected contacts were deleted' to the other person").toEqual([]);
  });

  it("BSE-11 an answer that does not say how many, answered after sign-out, raises no toast", async () => {
    const answer = gate<unknown>();
    client.bulkDeleteContacts.mockReturnValue(answer.promise);
    const done = deleteContactsWithUndo({ businessId: BIZ, ids: IDS });
    clearStoredBusinessId();
    clearToastCalls();
    answer.release({ data: {}, error: null, status: 200 });
    expect(await done).toEqual({ deleted: null, deletedIds: null });
    expect(toastCalls(), "no 'the answer did not say how many' on the sign-in page").toEqual([]);
  });

  it("BSE-12 a delete sent with no session, answered with no session, raises no toast", async () => {
    window.localStorage.removeItem("kf_token");
    client.bulkDeleteContacts.mockResolvedValue(DELETED_ALL);
    await deleteContactsWithUndo({ businessId: BIZ, ids: IDS });
    expect(toastCalls(), "no one is signed in to be told").toEqual([]);
  });

  it("BSE-07 control: a same-user rotation while both are on their way changes nothing", async () => {
    const answer = gate<unknown>();
    client.bulkDeleteContacts.mockReturnValue(answer.promise);
    const restore = gate<unknown>();
    client.bulkRestoreTrashItems.mockReturnValue(restore.promise);
    const onRestored = vi.fn();
    const done = deleteContactsWithUndo({ businessId: BIZ, ids: IDS, onRestored });
    window.localStorage.setItem("kf_token", tokenFor("user-a"));
    answer.release(DELETED_ALL);
    await done;
    expect(toastSpies.success).toHaveBeenCalledWith("Deleted 3 contacts", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
    pressUndo();
    window.localStorage.setItem("kf_token", tokenFor("user-a"));
    restore.release(RESTORED_ALL);
    await flush();
    await flush();
    expect(toastSpies.success).toHaveBeenCalledWith("Restored 3 contacts");
    expect(onRestored).toHaveBeenCalledTimes(1);
  });
});
