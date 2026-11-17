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
 *
 * Review repair (FK-SEC-1, FK-COR-1, FK-COR-2), FK-13..FK-18:
 *   - lib/client.ts is the transport most screens use, and it is not lib/api.ts: its own apiGet (94 GET call
 *     sites) and about 32 write helpers rebuild the answer as { data, error } and drop `status`, and 8 helpers
 *     answer `{ error: res.statusText }`. Customers quick add (BUG-009) sends through client.ts createContact.
 *     A ModuleScopeGuard refusal through client.ts must still be said with what it needs and "Ask the owner"
 *     (write) and be "no-access" (read): only a 403 carries the guard's exact sentence (FK-13, FK-14).
 *   - production serves the API over HTTP/2 (Caddy), where Response.statusText is "", so those helpers answer a
 *     refusal or a proxy 502 as `error: ""`. Only a null or absent error is a success: an empty one is a loud
 *     failure, never "it went through" or an empty list (FK-15, FK-16).
 *   - every refusal shares one toast id, and sonner updates a toast by merging; a refusal with no next step must
 *     clear the last one's, so a 409 after a 5xx is not told to try again and a BusinessGuard 403 after a scope
 *     refusal is not told to ask the owner (FK-17, FK-18, on the real sonner Toaster).
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
import { createContact, fetchContacts, fetchInvoices, updatePlaybook } from "@/lib/client";
import { moduleReadRefusal, moduleWriteRefusal } from "@/lib/module-access";
import {
  REFUSAL_TOAST_ID,
  type ApiAnswer,
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

/**
 * ModuleScopeGuard's refusal as the server sends it: the guard's sentence (apps/server core/auth/module-scope.guard.ts)
 * in GlobalHttpExceptionFilter's body (core/filters/http-exception.filter.ts).
 */
function serverBody(statusCode: number, message: string, path: string) {
  const code: Record<number, string> = { 403: "FORBIDDEN", 409: "CONFLICT", 500: "INTERNAL_SERVER_ERROR" };
  const error: Record<number, string> = { 403: "Forbidden", 409: "Conflict", 500: "Internal Server Error" };
  return { statusCode, code: code[statusCode] ?? "UNKNOWN_ERROR", message, error: error[statusCode] ?? "Error", timestamp: new Date().toISOString(), path };
}

/**
 * fetch answering every request with `status` and `body` (no body when null) and the reason phrase `statusText`.
 * Over HTTP/2 (production: Caddy in front of the api) a browser's Response.statusText is always "". Records what
 * was sent.
 */
function stubFetch(status: number, body: unknown, statusText: string): string[] {
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      sent.push(`${(init?.method ?? "GET").toUpperCase()} ${new URL(url, "http://localhost").pathname}`);
      return new Response(body === null ? null : JSON.stringify(body), {
        status,
        statusText,
        headers: body === null ? {} : { "content-type": "application/json" },
      });
    }),
  );
  return sent;
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

type Send = (firstName: string) => Promise<ApiAnswer>;
/** lib/api.ts apiPost: answers a refusal as { data: null, error, status }. */
const viaApi: Send = (firstName) => apiPost({ path: "/crm/businesses/biz_fk/contacts", body: { firstName } });
/** lib/client.ts createContact, the helper Customers quick add uses (pipeline-tab-content.tsx): drops `status`. */
const viaClient: Send = (firstName) => createContact({ businessId: "biz_fk", firstName });

/**
 * The shape of the Customers quick add (BUG-009) with the kit adopted: await the create, ask the kit whether it
 * was refused, and close only when it was not. Built with createElement so this file stays .ts.
 */
function QuickAdd({ send = viaApi }: { send?: Send }) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState("");
  const { refused, message } = useRefusal();
  if (!open) return createElement("p", null, "Closed");
  const submit = async () => {
    const res = await send(name);
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

const CRM_READ_NONE = "Insufficient permissions: crm requires read access (you have none)";

describe("FAILURE-KIT review repair: lib/client.ts answers, which carry no status (FK-COR-1, FK-SEC-2)", () => {
  it("[FK-13] RED-BEFORE: BUG-009's own transport: a crm write refusal through lib/client.ts createContact is said with what it needs and to ask the owner, and the form stays open", async () => {
    const sent = stubFetch(403, serverBody(403, CRM_WRITE_REFUSAL, "/crm/businesses/biz_fk/contacts"), "Forbidden");
    // What the screen is handed: client.ts rebuilds the answer and drops the status (lib/client.ts, not changed here).
    await expect(createContact({ businessId: "biz_fk", firstName: "Jada" })).resolves.toEqual({ data: null, error: CRM_WRITE_REFUSAL });
    sent.length = 0;

    render(createElement(QuickAdd, { send: viaClient }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jada" } });
    fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(sent).toEqual(["POST /crm/businesses/biz_fk/contacts"]);

    const [title, options] = toastError.mock.calls[0] as [string, { id?: string; description?: string }];
    expect(title).toBe(moduleWriteRefusal({ status: 403, error: CRM_WRITE_REFUSAL }, "crm", "add customers"));
    expect(options.id).toBe(REFUSAL_TOAST_ID);
    expect(options.description).toMatch(/ask the owner/i);
    expect(screen.getByRole("dialog", { name: "Add contact" })).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveValue("Jada");
    expect(screen.getByRole("alert")).toHaveTextContent("You can't add customers in this business: it needs crm write access.");
  });

  it("[FK-14] RED-BEFORE: a crm read refusal through lib/client.ts fetchContacts (its own apiGet) is 'no-access' in PR195's words, not a failed load or an empty list", async () => {
    stubFetch(403, serverBody(403, CRM_READ_NONE, "/crm/businesses/biz_fk/contacts"), "Forbidden");
    const res = await fetchContacts("biz_fk");
    // client.ts apiGet answers the fallback list and the server's words, and no status.
    expect(res).toEqual({ data: { contacts: [], nextCursor: null, hasMore: false }, error: CRM_READ_NONE });
    expect(readState(res, { what: "your customers" })).toEqual({
      kind: "no-access",
      message: moduleReadRefusal({ status: 403, error: CRM_READ_NONE }, "crm", "your customers"),
    });
    expect(scopeRefusalOf(res)).toEqual({ module: "crm", level: "read" });
    expect(showRefusal(res, { what: "see customers" })).toBe(true);
    expect(toastError).toHaveBeenLastCalledWith(
      `You can't see customers in this business: it needs crm read access. ${CRM_READ_NONE}`,
      expect.objectContaining({ id: REFUSAL_TOAST_ID, description: expect.stringMatching(/ask the owner/i) }),
    );

    // Without a status only the guard's exact sentence counts (only a 403 carries it): not a sentence that merely
    // contains it, not a KEY plan step's longer refusal, not BusinessGuard's words.
    const noStatus = (error: string) => ({ data: null, error });
    expect(scopeRefusalOf(noStatus(CRM_WRITE_REFUSAL))).toEqual({ module: "crm", level: "write" });
    expect(scopeRefusalOf(noStatus(`Error: ${CRM_WRITE_REFUSAL}`))).toBeNull();
    expect(scopeRefusalOf(noStatus(`${CRM_WRITE_REFUSAL}; KEY runs "create_contact" for a member only with the module access its routes require (D-98)`))).toBeNull();
    expect(scopeRefusalOf(noStatus("No access to this business"))).toBeNull();
    expect(readState(noStatus("Unable to verify business access"), { what: "your customers" })).toEqual({
      kind: "failed",
      message: "Couldn't load your customers: Unable to verify business access",
    });
    // A status that is not 403 still rules it out, sentence or not.
    expect(scopeRefusalOf({ data: null, error: CRM_WRITE_REFUSAL, status: 400 })).toBeNull();
    expect(scopeRefusalOf({ data: null, error: CRM_WRITE_REFUSAL, status: 500 })).toBeNull();
  });
});

describe("FAILURE-KIT review repair: an empty error is a failure, never a success (FK-SEC-1)", () => {
  it("[FK-15] RED-BEFORE: only a null or absent error is a success; error \"\" (or blank) is refused loudly and is a failed load", () => {
    const blank = { data: null, error: "" };
    expect(refusalMessage(blank)).toBe("That didn't go through.");
    expect(refusalMessage(blank, { what: "change playbooks" })).toBe("Couldn't change playbooks.");
    expect(refusalMessage({ data: null, error: "   " }, { what: "save" })).toBe("Couldn't save.");
    expect(scopeRefusalOf(blank)).toBeNull();

    expect(showRefusal(blank, { what: "change playbooks" })).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenLastCalledWith("Couldn't change playbooks.", expect.objectContaining({ id: REFUSAL_TOAST_ID }));

    const { result } = renderHook(() => useRefusal());
    let refused = false;
    act(() => {
      refused = result.current.refused({ data: null, error: "" });
    });
    expect(refused).toBe(true);
    expect(result.current.message).toBe("That didn't go through.");
    expect(toastError).toHaveBeenCalledTimes(2);

    expect(readState({ data: [], error: "" }, { what: "your invoices" })).toEqual({ kind: "failed", message: "Couldn't load your invoices." });
    expect(readState({ data: [], error: " " })).toEqual({ kind: "failed", message: "Couldn't load this." });

    // A null or absent error is still a success (deleteService answers { error: null }).
    expect(refusalMessage({ error: null })).toBeNull();
    expect(refusalMessage({ data: { id: "pb_1" } })).toBeNull();
    expect(readState({ data: [] })).toEqual({ kind: "ok" });
    expect(readState({ data: [], error: null })).toEqual({ kind: "ok" });
  });

  it("[FK-16] RED-BEFORE: over HTTP/2 (no reason phrase) a refused lib/client.ts updatePlaybook and an empty-body 502 on fetchInvoices are loud, not success", async () => {
    // A member of another business renames its playbook: BusinessGuard refuses; client.ts answers res.statusText.
    stubFetch(403, serverBody(403, "No access to this business", "/automation/businesses/biz_b/playbooks/pb_b"), "");
    const res = await updatePlaybook({ businessId: "biz_b", playbookId: "pb_b", name: "renamed", enabled: false });
    expect(res).toEqual({ data: null, error: "" });
    expect(refusalMessage(res, { what: "change playbooks" })).toBe("Couldn't change playbooks.");
    expect(showRefusal(res, { what: "change playbooks" })).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(readState(res).kind).toBe("failed");

    // The api is down behind the proxy: 502 with no body; client.ts apiGet answers res.statusText and an empty list.
    stubFetch(502, null, "");
    const invoices = await fetchInvoices("biz_fk");
    expect(invoices).toEqual({ data: [], error: "" });
    expect(readState(invoices, { what: "your invoices" })).toEqual({ kind: "failed", message: "Couldn't load your invoices." });
  });
});

describe("FAILURE-KIT review repair: the one refusal toast on the real sonner Toaster (FK-COR-2)", () => {
  let sonner: typeof import("sonner");

  beforeEach(async () => {
    sonner = await vi.importActual<typeof import("sonner")>("sonner");
    // The kit's toast.error goes to the real sonner for these cases only.
    toastError.mockImplementation((message: string, data?: Parameters<typeof sonner.toast.error>[1]) => sonner.toast.error(message, data));
  });

  afterEach(() => {
    toastError.mockReset();
  });

  const toasts = () => document.querySelectorAll("[data-sonner-toast]");

  it("[FK-17] RED-BEFORE: a 409 shown after a 5xx is one toast in the 409's words, without the 5xx's 'Try again in a moment.'", async () => {
    render(createElement(sonner.Toaster));
    expect(showRefusal({ data: null, error: "Internal server error", status: 500 })).toBe(true);
    expect(await screen.findByText("Try again in a moment.")).toBeInTheDocument();

    expect(showRefusal({ data: null, error: PHONE_TAKEN, status: 409 })).toBe(true);
    expect(await screen.findByText(PHONE_TAKEN)).toBeInTheDocument();
    expect(toasts()).toHaveLength(1);
    expect(screen.queryByText("Internal server error")).not.toBeInTheDocument();
    expect(screen.queryByText("Try again in a moment.")).not.toBeInTheDocument();
  });

  it("[FK-18] RED-BEFORE: a BusinessGuard 403 shown after a scope refusal is not told to ask the owner (CRR-P195JS-2)", async () => {
    render(createElement(sonner.Toaster));
    expect(showRefusal({ data: null, error: CRM_WRITE_REFUSAL, status: 403 }, { what: "add customers" })).toBe(true);
    expect(await screen.findByText("Ask the owner for access.")).toBeInTheDocument();

    expect(showRefusal({ data: null, error: "No access to this business", status: 403 }, { what: "add customers" })).toBe(true);
    expect(await screen.findByText("No access to this business")).toBeInTheDocument();
    expect(toasts()).toHaveLength(1);
    expect(screen.queryByText("Ask the owner for access.")).not.toBeInTheDocument();
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
