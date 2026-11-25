import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * SWP-REMOVED-MEMBER-NOTICE (BUG-117, journey J8): a member whose access to the business they were working in is
 * removed is told so, by name, instead of being moved silently into another workspace.
 *
 * The trigger is the authoritative membership list (GET /identity/businesses), never one screen's 403 (that can be a
 * scope refusal, D-46): when the list no longer holds the stored business, workspace.ts records a removed-business
 * notice, names it from the business cache when the cache describes that business, and announces it. The notice is
 * raised only for the same person who had the business (the cached user is the signed-in user), so a stale id left
 * by another account on a shared device never names that account's business.
 *
 *   RMN-01  RED-BEFORE  the stored business is missing from a non-empty list: the remaining business is selected and
 *                       a notice names the lost one (and is announced)
 *   RMN-02  RED-BEFORE  the list is empty and bootstrap gives no business (W11-WEB-OWNER-MEMBERSHIP-REFUSAL forgets
 *                       the id): the notice still names the lost business
 *   RMN-03  pin         the stored business is still a membership: no notice
 *   RMN-04  pin         the list is unavailable: no notice, the stored choice is kept
 *   RMN-05  pin         nothing stored (a first sign-in): no notice
 *   RMN-06  RED-BEFORE  the cache describes another business: the notice carries no name rather than a wrong one
 *   RMN-07  pin         a stale id under a different signed-in user (shared device): no notice
 *   RMN-08  RED-BEFORE  dismissing clears the notice; signing out clears it too
 * Security review round (1be13828):
 *   RMN-09  RED-AT-1be13828  MAJOR-1: another account signing in on the same browser never sees the notice (it is
 *                       cleared at sign-in, and dropped when the resolved user is not the one it was raised for)
 *   RMN-10  RED-AT-1be13828  MINOR-1: leftover state from another account (its business, cache and user cache) is
 *                       never raised as a notice to the signed-in user, even after a failed list read overwrote the
 *                       cached user; the leftover business is forgotten
 *   RMN-11  pin         MINOR-2: access given back (the business is in the list again) clears the notice
 * Correctness review round:
 *   RMN-12  pin         a member who switched business themselves (selectBusiness drops the cached user) and is then
 *                       removed from the business they switched away from gets no notice: it is not the one stored
 */

const { bootstrapIdentity } = vi.hoisted(() => ({ bootstrapIdentity: vi.fn() }));
vi.mock("@/lib/client", () => ({ bootstrapIdentity: (...args: unknown[]) => bootstrapIdentity(...args) }));

const OWNERS = { id: "biz-owners-salon", name: "Owner's Salon" };
const OWN = { id: "biz-members-own", name: "Member's Own" };
const MEMBER = { id: "user-member", email: "member@rmn.test", name: "Member" };
const TOKEN = "rmn-token";

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
function serve(opts: { businesses?: unknown; businessesStatus?: number; me?: unknown }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith("/identity/businesses")) return json(opts.businessesStatus ?? 200, opts.businesses ?? []);
    if (String(url).endsWith("/identity/me")) return json(200, opts.me ?? MEMBER);
    if (String(url).endsWith("/identity/refresh")) return json(401, {});
    return json(404, {});
  });
}

/** The member was working in the owner's salon: its id, its cache and their own user cache are stored. */
function workingIn(business: { id: string; name: string }, cachedBusiness: { id: string; name: string } = business, user: unknown = MEMBER) {
  window.localStorage.setItem("kf_business_id", business.id);
  window.localStorage.setItem("kf_business_cache", JSON.stringify(cachedBusiness));
  window.localStorage.setItem("kf_user_cache", JSON.stringify(user));
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  document.cookie = "kf_business_id=; Path=/; Max-Age=0";
  window.localStorage.setItem("kf_token", TOKEN);
  bootstrapIdentity.mockReset();
  bootstrapIdentity.mockImplementation(async () => ({ data: null, error: "refused", errorCode: "owner_membership_required", status: 403 }));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SWP-REMOVED-MEMBER-NOTICE: a removed member is told, by name", () => {
  it("RMN-01 RED-BEFORE: the stored business is missing from the list: the remaining one is selected and a notice names the lost one", async () => {
    workingIn(OWNERS);
    serve({ businesses: [OWN] });
    const announced: unknown[] = [];
    window.addEventListener("kf:business-removed", (e) => announced.push((e as CustomEvent).detail));
    const ws = await import("../workspace");

    await expect(ws.refreshWorkspace()).resolves.toBe(OWN.id);

    expect(announced, "the removal is announced to the shell").toEqual([{ id: OWNERS.id, name: OWNERS.name }]);
    expect(ws.getRemovedBusinessNotice()).toEqual({ id: OWNERS.id, name: OWNERS.name });
  });

  it("RMN-02 RED-BEFORE: an empty list and a refused bootstrap: the notice still names the lost business", async () => {
    workingIn(OWNERS);
    serve({ businesses: [] });
    const ws = await import("../workspace");

    await expect(ws.refreshWorkspace()).resolves.toBeNull();

    expect(ws.getRemovedBusinessNotice()).toEqual({ id: OWNERS.id, name: OWNERS.name });
    expect(window.localStorage.getItem("kf_token")).toBe(TOKEN);
  });

  it("RMN-03 pin: the stored business is still a membership: no notice", async () => {
    workingIn(OWNERS);
    serve({ businesses: [OWN, OWNERS] });
    const ws = await import("../workspace");

    await expect(ws.refreshWorkspace()).resolves.toBe(OWNERS.id);
    expect(ws.getRemovedBusinessNotice?.() ?? null).toBeNull();
  });

  it("RMN-04 pin: an unavailable list raises no notice and keeps the stored choice", async () => {
    workingIn(OWNERS);
    serve({ businessesStatus: 503 });
    const ws = await import("../workspace");

    await expect(ws.refreshWorkspace()).resolves.toBe(OWNERS.id);
    expect(ws.getRemovedBusinessNotice?.() ?? null).toBeNull();
  });

  it("RMN-05 pin: nothing stored (a first sign-in) raises no notice", async () => {
    window.localStorage.setItem("kf_user_cache", JSON.stringify(MEMBER));
    serve({ businesses: [OWN] });
    const ws = await import("../workspace");

    await expect(ws.refreshWorkspace()).resolves.toBe(OWN.id);
    expect(ws.getRemovedBusinessNotice?.() ?? null).toBeNull();
  });

  it("RMN-06 RED-BEFORE: the cache describes another business: the notice carries no name rather than a wrong one", async () => {
    workingIn(OWNERS, { id: "biz-some-other", name: "Some Other Co" });
    serve({ businesses: [OWN] });
    const ws = await import("../workspace");

    await ws.refreshWorkspace();
    expect(ws.getRemovedBusinessNotice()).toEqual({ id: OWNERS.id, name: null });
  });

  it("RMN-07 pin: a stale id under a different signed-in user (shared device) raises no notice", async () => {
    workingIn(OWNERS, OWNERS, { id: "user-previous-account", email: "previous@rmn.test" });
    serve({ businesses: [OWN] });
    const ws = await import("../workspace");

    await expect(ws.refreshWorkspace()).resolves.toBe(OWN.id);
    expect(ws.getRemovedBusinessNotice?.() ?? null).toBeNull();
  });

  it("RMN-08 RED-BEFORE: dismissing clears the notice, and signing out clears it too", async () => {
    workingIn(OWNERS);
    serve({ businesses: [OWN] });
    const ws = await import("../workspace");
    await ws.refreshWorkspace();
    expect(ws.getRemovedBusinessNotice()).not.toBeNull();

    ws.dismissRemovedBusinessNotice();
    expect(ws.getRemovedBusinessNotice()).toBeNull();

    workingIn(OWNERS);
    await ws.refreshWorkspace();
    expect(ws.getRemovedBusinessNotice()).not.toBeNull();
    ws.clearStoredBusinessId();
    expect(ws.getRemovedBusinessNotice()).toBeNull();
  });

  it("RMN-09 RED-AT-1be13828: another account signing in on the same browser never sees the notice", async () => {
    workingIn(OWNERS);
    serve({ businesses: [OWN] });
    const ws = await import("../workspace");
    await ws.refreshWorkspace();
    expect(ws.getRemovedBusinessNotice(), "A's notice is raised").not.toBeNull();

    // A closes the browser without signing out; B signs in (login form, OAuth callback and signup all do this).
    ws.clearAdminSession();
    ws.setStoredToken("token-b");
    expect(ws.getRemovedBusinessNotice(), "B's sign-in starts with no notice of A's").toBeNull();

    // Even a notice written back by an older tab is dropped once B is resolved.
    window.localStorage.setItem("kf_removed_business", JSON.stringify({ id: OWNERS.id, name: OWNERS.name, userId: MEMBER.id }));
    serve({ businesses: [{ id: "biz-b-own", name: "B Own" }], me: { id: "user-b", email: "b@rmn.test" } });
    await ws.refreshWorkspace();
    expect(ws.getRemovedBusinessNotice(), "a notice raised for A is never kept for B").toBeNull();
  });

  it("RMN-10 RED-AT-1be13828: another account's leftover business is never raised to the signed-in user", async () => {
    // A's state is left behind; B's token is stored (B's sign-in failed after storing it).
    workingIn(OWNERS);
    window.localStorage.setItem("kf_token", "token-b");
    const B = { id: "user-b", email: "b@rmn.test" };
    serve({ businessesStatus: 503, me: B });
    const ws = await import("../workspace");
    await ws.refreshWorkspace();

    serve({ businesses: [{ id: "biz-b-own", name: "B Own" }], me: B });
    await expect(ws.refreshWorkspace()).resolves.toBe("biz-b-own");
    expect(ws.getRemovedBusinessNotice(), "A's business is never named to B").toBeNull();
    expect(window.localStorage.getItem("kf_business_cache") ?? "", "A's business cache is gone").not.toContain(OWNERS.name);
  });

  it("RMN-11 pin: access given back clears the notice", async () => {
    workingIn(OWNERS);
    serve({ businesses: [OWN] });
    const ws = await import("../workspace");
    await ws.refreshWorkspace();
    expect(ws.getRemovedBusinessNotice()).not.toBeNull();

    serve({ businesses: [OWN, OWNERS] });
    await ws.refreshWorkspace();
    expect(ws.getRemovedBusinessNotice(), "re-invited: the notice no longer holds").toBeNull();
  });

  it("RMN-12 pin: a member who switched away themselves gets no notice for the business they left", async () => {
    workingIn(OWNERS);
    serve({ businesses: [OWN, OWNERS] });
    const ws = await import("../workspace");
    ws.selectBusiness(OWN.id);
    // Removed from the business they had already switched away from.
    serve({ businesses: [OWN] });
    await expect(ws.refreshWorkspace()).resolves.toBe(OWN.id);
    expect(ws.getRemovedBusinessNotice()).toBeNull();
  });
});
