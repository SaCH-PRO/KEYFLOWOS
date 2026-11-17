/**
 * FAILURE-KIT (re-cut v1 plan, step 3, lane web; product principle "Failures are loud and kind").
 *
 * WHY this test exists: the api client answers a refused request as { data: null, error, status } and does not
 * throw (lib/api.ts handleErrorResponse), so a screen that only catches never sees a refusal. The browser sweep
 * found that class on every hub: Customers quick add closes and resets on 403/409 with no toast (BUG-009), a
 * refused expense delete toasts "Expense deleted" (BUG-031), a refused stock adjustment closes silently (BUG-032),
 * Quick Add Contact swallows a 409 (BUG-097). PR195 gave the finance pages moduleWriteRefusal and
 * moduleReadRefusal (lib/module-scope-refusal.ts, re-exported by lib/module-access.ts); this kit builds the one
 * shared answer on them: a refused write is said in one toast with why and what to do next, and useRefusal()
 * tells the form it was refused so it stays open with what was typed.
 *
 * Required here:
 *   - a 403 write refusal, answered by the real transport, produces exactly one toast that says why and to ask the
 *     owner, and the form stays open with what was typed (RED: the kit does not exist, so a screen's await-then-close
 *     produces no toast);
 *   - a 409 is said in the server's own words; a write that goes through says nothing and closes;
 *   - the words are PR195's moduleWriteRefusal / moduleReadRefusal for a ModuleScopeGuard refusal, the server's own
 *     words for any other error; a BusinessGuard 403 is never said as "no access";
 *   - the kit does not touch transport: lib/client.ts, lib/api.ts, lib/api/*, lib/fetch-with-retry.ts do not
 *     import it, and it imports none of them (fetch-with-retry-503.test.ts stays unchanged and green).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup, renderHook, act } from "@testing-library/react";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: toastError, message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

import { apiPost } from "@/lib/api";
import { moduleReadRefusal, moduleWriteRefusal } from "@/lib/module-access";
import {
  REFUSAL_TOAST_ID,
  answerFromThrown,
  readRefusal,
  readState,
  refusalMessage,
  scopeRefusalOf,
  showRefusal,
  useRefusal,
} from "@/lib/failure-kit";

const CRM_WRITE_REFUSAL = "Insufficient permissions: crm requires write access (you have read)";
const TEAM_READ_REFUSAL = "Insufficient permissions: team requires read access (you have none)";
const SETTINGS_ADMIN_REFUSAL = "Insufficient permissions: settings requires admin access (you have write)";
const PHONE_TAKEN = "A contact with this phone number already exists in this business";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 403 ? "Forbidden" : status === 409 ? "Conflict" : status >= 400 ? "Error" : "OK",
    headers: { "content-type": "application/json" },
  });
}

/** fetch answering every POST with `status`/`body`; records what was sent. */
function stubPost(status: number, body: unknown): string[] {
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      sent.push(`${(init?.method ?? "GET").toUpperCase()} ${new URL(url, "http://localhost").pathname}`);
      return jsonResponse(status, body);
    }),
  );
  return sent;
}

/**
 * The shape of the Customers quick add (BUG-009) with the kit adopted: await the create, ask the kit whether it
 * was refused, and close only when it was not. Built with createElement so this file stays .ts.
 */
function QuickAdd() {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState("");
  const { refused, message } = useRefusal();
  if (!open) return createElement("p", null, "Closed");
  const submit = async () => {
    const res = await apiPost({ path: "/crm/businesses/biz_fk/contacts", body: { firstName: name } });
    if (refused(res, { what: "add customers" })) return;
    setOpen(false);
  };
  return createElement(
    "div",
    { role: "dialog", "aria-label": "Add contact" },
    createElement("input", { "aria-label": "First name", value: name, onChange: (e: { target: { value: string } }) => setName(e.target.value) }),
    createElement("button", { type: "button", onClick: () => void submit() }, "Add contact"),
    message ? createElement("p", { role: "alert" }, message) : null,
  );
}

beforeEach(() => {
  toastError.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FAILURE-KIT: a refused write is loud and keeps the form (BUG-009, BUG-031, BUG-032, BUG-097)", () => {
  it("[FK-01] RED-BEFORE: a 403 write refusal from the real transport produces one toast that says why and to ask the owner, and the form stays open with what was typed", async () => {
    const sent = stubPost(403, { statusCode: 403, message: CRM_WRITE_REFUSAL, error: "Forbidden" });
    render(createElement(QuickAdd));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(sent).toEqual(["POST /crm/businesses/biz_fk/contacts"]);

    const [title, options] = toastError.mock.calls[0] as [string, { id?: string; description?: string }];
    expect(title).toBe(moduleWriteRefusal({ status: 403, error: CRM_WRITE_REFUSAL }, "crm", "add customers"));
    expect(title).toMatch(/^You can't add customers in this business: it needs crm write access\./);
    expect(options.id).toBe(REFUSAL_TOAST_ID);
    expect(options.description).toMatch(/ask the owner/i);

    // The form is kept: still open, the name still typed, the reason beside it.
    expect(screen.getByRole("dialog", { name: "Add contact" })).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("Jada");
    expect(screen.getByRole("alert")).toHaveTextContent("You can't add customers in this business");
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
  });

  it("[FK-02] a 409 (phone already in use) is said in the server's own words, and the form stays open", async () => {
    stubPost(409, { statusCode: 409, code: "contact_phone_taken", message: PHONE_TAKEN, existingContactId: null });
    render(createElement(QuickAdd));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Marcus" } });
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const [title, options] = toastError.mock.calls[0] as [string, { id?: string; description?: string }];
    expect(title).toBe(PHONE_TAKEN);
    expect(options.id).toBe(REFUSAL_TOAST_ID);
    expect(options.description ?? "").not.toMatch(/ask the owner/i);
    expect(screen.getByLabelText("First name")).toHaveValue("Marcus");
    expect(screen.getByRole("alert")).toHaveTextContent(PHONE_TAKEN);
  });

  it("[FK-03] a write that goes through says nothing and the form closes", async () => {
    stubPost(201, { id: "c_1", firstName: "Jada" });
    render(createElement(QuickAdd));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(screen.getByText("Closed")).toBeInTheDocument());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("[FK-04] repeated refusals share one toast (one id), not a stack", async () => {
    stubPost(403, { statusCode: 403, message: CRM_WRITE_REFUSAL, error: "Forbidden" });
    render(createElement(QuickAdd));
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    const ids = toastError.mock.calls.map((c) => (c[1] as { id?: string }).id);
    expect(new Set(ids)).toEqual(new Set([REFUSAL_TOAST_ID]));
  });

  it("[FK-05] useRefusal: refused() is false for a success and clears the last reason; clear() empties it", () => {
    const { result } = renderHook(() => useRefusal());
    let refused = false;
    act(() => {
      refused = result.current.refused({ data: null, error: CRM_WRITE_REFUSAL, status: 403 }, { what: "add customers" });
    });
    expect(refused).toBe(true);
    expect(result.current.message).toMatch(/^You can't add customers/);
    act(() => {
      refused = result.current.refused({ data: { id: "c_1" }, error: null });
    });
    expect(refused).toBe(false);
    expect(result.current.message).toBeNull();
    act(() => {
      result.current.refused({ data: null, error: PHONE_TAKEN, status: 409 });
    });
    expect(result.current.message).toBe(PHONE_TAKEN);
    act(() => result.current.clear());
    expect(result.current.message).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(2);
  });
});

describe("FAILURE-KIT: the words, built on PR195's moduleWriteRefusal / moduleReadRefusal", () => {
  const scope = (error: string) => ({ data: null, error, status: 403 });

  it("[FK-06] refusalMessage: null for a success or no answer; PR195's words for a ModuleScopeGuard refusal; the server's words otherwise", () => {
    expect(refusalMessage({ data: { id: "x" }, error: null })).toBeNull();
    expect(refusalMessage(null)).toBeNull();
    expect(refusalMessage(undefined)).toBeNull();
    expect(refusalMessage(scope(CRM_WRITE_REFUSAL), { what: "add customers" })).toBe(
      moduleWriteRefusal(scope(CRM_WRITE_REFUSAL), "crm", "add customers"),
    );
    // No `what`: still names the module the refusal names, never a guess.
    expect(refusalMessage(scope(CRM_WRITE_REFUSAL))).toBe(moduleWriteRefusal(scope(CRM_WRITE_REFUSAL), "crm", "do this"));
    // A route that needs admin is said as admin, not write.
    expect(refusalMessage(scope(SETTINGS_ADMIN_REFUSAL), { what: "change settings" })).toBe(
      `You can't change settings in this business: it needs settings admin access. ${SETTINGS_ADMIN_REFUSAL}`,
    );
    // BusinessGuard's 403s say nothing about the member's modules: the server's own words.
    expect(refusalMessage(scope("Unable to verify business access"), { what: "add customers" })).toBe("Unable to verify business access");
    expect(refusalMessage(scope("No access to this business"))).toBe("No access to this business");
    // A 4xx/5xx and a network failure (no status) in their own words.
    expect(refusalMessage({ data: null, error: PHONE_TAKEN, status: 409 })).toBe(PHONE_TAKEN);
    expect(refusalMessage({ data: null, error: "Failed to fetch" })).toBe("Failed to fetch");
  });

  it("[FK-07] scopeRefusalOf names the module and level of a ModuleScopeGuard refusal only", () => {
    expect(scopeRefusalOf(scope(CRM_WRITE_REFUSAL))).toEqual({ module: "crm", level: "write" });
    expect(scopeRefusalOf(scope(TEAM_READ_REFUSAL))).toEqual({ module: "team", level: "read" });
    expect(scopeRefusalOf(scope(SETTINGS_ADMIN_REFUSAL))).toEqual({ module: "settings", level: "admin" });
    expect(scopeRefusalOf({ data: null, error: CRM_WRITE_REFUSAL, status: 400 })).toBeNull();
    expect(scopeRefusalOf(scope("Unable to verify business access"))).toBeNull();
    expect(scopeRefusalOf(scope("crm requires write access (you have read)"))).toBeNull();
    expect(scopeRefusalOf(null)).toBeNull();
  });

  it("[FK-08] readRefusal / readState: a refused read is 'no-access' in PR195's words; a BusinessGuard 403 or a 5xx is a failed load; never an empty success", () => {
    expect(readRefusal(scope(TEAM_READ_REFUSAL), { what: "your team" })).toBe(moduleReadRefusal(scope(TEAM_READ_REFUSAL), "team", "your team"));
    expect(readRefusal(scope("Unable to verify business access"), { what: "your team" })).toBeNull();
    expect(readRefusal({ data: [], error: null })).toBeNull();

    expect(readState({ data: [], error: null }, { what: "your team" })).toEqual({ kind: "ok" });
    expect(readState(scope(TEAM_READ_REFUSAL), { what: "your team" })).toEqual({
      kind: "no-access",
      message: moduleReadRefusal(scope(TEAM_READ_REFUSAL), "team", "your team"),
    });
    expect(readState(scope("Unable to verify business access"), { what: "your team" })).toEqual({
      kind: "failed",
      message: "Couldn't load your team: Unable to verify business access",
    });
    expect(readState({ data: null, error: "Internal server error", status: 500 })).toEqual({
      kind: "failed",
      message: "Couldn't load this: Internal server error",
    });
    // No answer at all is not a success either.
    expect(readState(null, { what: "your team" })).toEqual({ kind: "failed", message: "Couldn't load your team." });
  });

  it("[FK-09] showRefusal toasts once with the shared id and says what to do next; returns false and stays quiet for a success", () => {
    expect(showRefusal({ data: { ok: true }, error: null })).toBe(false);
    expect(toastError).not.toHaveBeenCalled();

    expect(showRefusal(scope(CRM_WRITE_REFUSAL), { what: "delete expenses" })).toBe(true);
    expect(toastError).toHaveBeenLastCalledWith(
      moduleWriteRefusal(scope(CRM_WRITE_REFUSAL), "crm", "delete expenses"),
      expect.objectContaining({ id: REFUSAL_TOAST_ID, description: expect.stringMatching(/ask the owner/i) }),
    );

    expect(showRefusal({ data: null, error: "Internal server error", status: 500 }, { what: "save" })).toBe(true);
    expect(toastError).toHaveBeenLastCalledWith(
      "Internal server error",
      expect.objectContaining({ id: REFUSAL_TOAST_ID, description: expect.stringMatching(/try again/i) }),
    );

    expect(showRefusal({ data: null, error: "A note is required for manual adjustments", status: 400 })).toBe(true);
    const [, options] = toastError.mock.calls.at(-1) as [string, { description?: string }];
    expect(options.description).toBeUndefined();
  });

  it("[FK-10] answerFromThrown turns a thrown error into an answer the kit can say", () => {
    expect(answerFromThrown(new Error("boom"))).toEqual({ data: null, error: "boom" });
    expect(answerFromThrown("nope")).toEqual({ data: null, error: "Something went wrong." });
    expect(refusalMessage(answerFromThrown(new Error("boom")))).toBe("boom");
  });
});

describe("FAILURE-KIT: no change to transport (r0 KEEP: fetch-with-retry-503.test.ts)", () => {
  const lib = path.resolve(__dirname, "..");
  const kitModules = /["'](?:@\/lib\/|\.\.?\/(?:lib\/)?)(?:failure-kit|status-labels)["']|["']@\/components\/ui\/no-access-state["']/;

  it("[FK-11] lib/client.ts, lib/api.ts, lib/api/* and lib/fetch-with-retry.ts do not import the kit", () => {
    const transport = ["client.ts", "api.ts", "fetch-with-retry.ts"].map((f) => path.join(lib, f));
    const apiDir = path.join(lib, "api");
    if (existsSync(apiDir)) for (const f of readdirSync(apiDir)) if (/\.tsx?$/.test(f)) transport.push(path.join(apiDir, f));
    expect(transport.length).toBeGreaterThan(3);
    for (const file of transport) expect(readFileSync(file, "utf8"), `${path.relative(lib, file)} imports the failure kit`).not.toMatch(kitModules);
  });

  it("[FK-12] the kit imports no transport: it reads answers, it does not send or retry", () => {
    const kit = readFileSync(path.join(lib, "failure-kit.ts"), "utf8");
    const imports = [...kit.matchAll(/^\s*import[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec, "a transport import in the kit").not.toMatch(/(^|\/)(client|api|fetch-with-retry|api-base)$|\/lib\/api\//);
    expect(imports).toContain("./module-scope-refusal");
  });
});
