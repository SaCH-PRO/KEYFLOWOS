/**
 * FU-UNDO-TOAST-SIGNOUT (owner ruling D-283) at the auth boundary. The Toaster sits above RequireAuth
 * (components/providers.tsx), so a toast outlives the shell RequireAuth tears down. A toast belongs to the session that
 * raised it: when RequireAuth sees the session END or become ANOTHER person's, the pending toasts go (a bulk-delete
 * Undo toast says "Deleted 3 contacts" to whoever is in front of the tab next). When the session is the same person's,
 * they stay: the first verification of a shell (a toast raised just before it, at sign-in, is the new person's), a
 * same-user token rotation, and a background failure that says nothing about who is signed in.
 *
 *   RAT-01 another person's token from another tab (a sign-in there): the Undo toast is dismissed
 *   RAT-02 a sign-out in another tab (the token goes): dismissed, and sign-in opens
 *   RAT-03 a global 401: dismissed, and sign-in opens
 *   RAT-04 an admin bearer that appears (another acting principal): dismissed
 *   RAT-05 a same-user rotation whose background answer names another user id: dismissed
 *   RAT-06 a same-user rotation from another tab (a refresh there): the toast stays
 *   RAT-07 the shell's first verification: a toast raised before it (at sign-in) or during it stays
 *   RAT-08 a same-user rotation answered by a server error in the background: the toast stays
 *   RAT-09 a same-user rotation answered by a 403 in the background (the error state, same person): the toast stays
 *   RAT-10 while a same-user rotation is verified in the background, this tab stores another person's token (no
 *          storage event, no render): when the answer lands the shell is torn down and the toast dismissed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import { Toaster, toast } from "sonner";

const nav = vi.hoisted(() => ({
  pathname: "/app/crm/contacts",
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { RequireAuth } from "../require-auth";

let tokenSeq = 0;
function jwt(sub: string): string {
  tokenSeq += 1;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, aud: "authenticated", n: tokenSeq })}.c2lnbmF0dXJl`;
}

function subOf(token: string | null): string | null {
  try {
    const p = JSON.parse(Buffer.from(String(token).split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string };
    return p.sub ?? null;
  } catch {
    return null;
  }
}

function bearerOf(init?: RequestInit): string | null {
  const auth = new Headers(init?.headers).get("Authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type MeAnswer = { status: number; body?: unknown };
/** While set, GET /identity/me waits for it before answering. */
let meGate: Promise<void> | null = null;
let meAnswerFor: (bearer: string | null) => MeAnswer = (bearer) => ({ status: 200, body: { id: subOf(bearer) } });

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/identity/me")) {
    const answer = meAnswerFor(bearerOf(init));
    if (meGate) await meGate;
    return jsonResponse(answer.status, answer.body ?? {});
  }
  if (url.includes("/identity/refresh")) return jsonResponse(401, {});
  return jsonResponse(404, {});
});

function App() {
  return (
    <>
      <Toaster />
      <RequireAuth>
        <div data-testid="shell">shell</div>
      </RequireAuth>
    </>
  );
}

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function renderVerified() {
  const utils = render(<App />);
  await screen.findByTestId("shell");
  await settle();
  return utils;
}

async function raiseUndoToast() {
  act(() => {
    toast.success("Deleted 3 contacts", { duration: 10_000, action: { label: "Undo", onClick: () => {} } });
  });
  await screen.findByText("Deleted 3 contacts");
}

async function expectToastGone() {
  await waitFor(() => {
    expect(screen.queryByText("Deleted 3 contacts")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
}

/**
 * Waits, then checks the toast is still up and was never dismissed: a dismissed sonner toast stays in the DOM while it
 * animates out, marked data-removed="true" (review COR-UTS-1), so its presence alone does not prove it was kept.
 */
async function expectToastKept() {
  await settle(600);
  const text = screen.getByText("Deleted 3 contacts");
  expect(text.closest("[data-sonner-toast]")?.getAttribute("data-removed"), "the toast was not dismissed").toBe("false");
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
}

function otherTabWrites(key: string, value: string | null) {
  const oldValue = window.localStorage.getItem(key);
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: value, storageArea: window.localStorage }));
  });
}

let TOKEN_A = "";

beforeEach(() => {
  window.localStorage.clear();
  TOKEN_A = jwt("user-1");
  window.localStorage.setItem("kf_token", TOKEN_A);
  window.localStorage.setItem("kf_business_id", "biz-a");
  nav.pathname = "/app/crm/contacts";
  nav.router.replace.mockReset();
  nav.router.push.mockReset();
  meAnswerFor = (bearer) => ({ status: 200, body: { id: subOf(bearer) } });
  meGate = null;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FU-UNDO-TOAST-SIGNOUT: RequireAuth ends the toasts of a session that ended or changed hands", () => {
  it("RAT-01 another person's token from another tab dismisses the Undo toast", async () => {
    await renderVerified();
    await raiseUndoToast();
    otherTabWrites("kf_token", jwt("user-2"));
    await expectToastGone();
  });

  it("RAT-02 a sign-out in another tab dismisses the Undo toast and opens sign-in", async () => {
    await renderVerified();
    await raiseUndoToast();
    otherTabWrites("kf_token", null);
    await expectToastGone();
    expect(nav.router.replace).toHaveBeenCalledWith(`/auth/login?from=${encodeURIComponent("/app/crm/contacts")}`);
  });

  it("RAT-03 a global 401 dismisses the Undo toast and opens sign-in", async () => {
    await renderVerified();
    await raiseUndoToast();
    act(() => {
      window.dispatchEvent(new CustomEvent("kf:unauthorized", { detail: { path: "/crm/contacts" } }));
    });
    await expectToastGone();
    expect(nav.router.replace).toHaveBeenCalled();
  });

  it("RAT-04 an admin bearer that appears dismisses the Undo toast", async () => {
    await renderVerified();
    await raiseUndoToast();
    otherTabWrites("kf_admin_token", "admin-bearer-1");
    await expectToastGone();
  });

  it("RAT-05 a same-user rotation whose background answer names another user id dismisses the Undo toast", async () => {
    await renderVerified();
    await raiseUndoToast();
    const rotated = jwt("user-1");
    meAnswerFor = (bearer) => (bearer === rotated ? { status: 200, body: { id: "someone-else" } } : { status: 200, body: { id: subOf(bearer) } });
    otherTabWrites("kf_token", rotated);
    await expectToastGone();
  });

  it("RAT-06 a same-user rotation from another tab keeps the toast", async () => {
    await renderVerified();
    await raiseUndoToast();
    otherTabWrites("kf_token", jwt("user-1"));
    await expectToastKept();
    expect(screen.getByTestId("shell")).toBeTruthy();
  });

  it("RAT-07 the shell's first verification keeps a toast raised before it", async () => {
    // The Toaster is up before the shell (it sits in Providers, above RequireAuth): a toast raised at sign-in, before
    // the navigation into /app, is still on screen when RequireAuth mounts.
    render(<Toaster />);
    await raiseUndoToast();
    let answer = () => {};
    meGate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    render(
      <RequireAuth>
        <div data-testid="shell">shell</div>
      </RequireAuth>,
    );
    expect(screen.queryByText(/Verifying session/)).not.toBeNull();
    // A toast raised while the first /identity/me is on its way stays too.
    act(() => {
      toast("Welcome back", { duration: 10_000 });
    });
    meGate = null;
    await act(async () => {
      answer();
    });
    await screen.findByTestId("shell");
    await expectToastKept();
    expect(screen.getByText("Welcome back").closest("[data-sonner-toast]")?.getAttribute("data-removed")).toBe("false");
  });

  it("RAT-08 a same-user rotation answered by a server error in the background keeps the toast", async () => {
    await renderVerified();
    await raiseUndoToast();
    const rotated = jwt("user-1");
    meAnswerFor = (bearer) => (bearer === rotated ? { status: 503 } : { status: 200, body: { id: subOf(bearer) } });
    otherTabWrites("kf_token", rotated);
    await settle(2_000);
    await expectToastKept();
  });

  it("RAT-09 a same-user rotation answered by a 403 in the background keeps the toast", async () => {
    await renderVerified();
    await raiseUndoToast();
    const rotated = jwt("user-1");
    meAnswerFor = (bearer) => (bearer === rotated ? { status: 403 } : { status: 200, body: { id: subOf(bearer) } });
    otherTabWrites("kf_token", rotated);
    await waitFor(() => expect(screen.queryByText(/Server returned 403/)).not.toBeNull(), { timeout: 5_000 });
    await expectToastKept();
  });

  it("RAT-10 another person's token stored in this tab during a background check dismisses the Undo toast", async () => {
    await renderVerified();
    await raiseUndoToast();
    let answer = () => {};
    meGate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    otherTabWrites("kf_token", jwt("user-1"));
    await settle();
    expect(screen.getByTestId("shell"), "a same-user rotation keeps the shell while it is checked").toBeTruthy();
    // This tab stores another person's token: no storage event here, and nothing re-renders.
    window.localStorage.setItem("kf_token", jwt("user-2"));
    meGate = null;
    await act(async () => {
      answer();
    });
    await expectToastGone();
  });
});
