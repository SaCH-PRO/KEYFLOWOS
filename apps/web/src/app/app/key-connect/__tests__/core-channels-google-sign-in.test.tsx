/**
 * R0-CMF5-GMAIL-CONNECT-BINDING review 2 (CMF5R-2): the Key Connect "Sign in
 * with Google" button after the business mailbox became OWNER only.
 *
 * POST /connect/google-suite/businesses/:b/auth-url with no services asks for
 * the default set, which includes gmail, and the server refuses that to anyone
 * who is not the business owner (403 {code:'GMAIL_OWNER_ONLY'}; integration case
 * R0-CMF5-H01). A member asking only for the other services still gets a URL.
 *
 * RED-BEFORE on 97669ec8: connectGoogle posted {} and showed the refusal as an
 * error, so every STAFF and ADMIN member lost Calendar, Drive, Forms, Contacts
 * and Business Profile, which they could connect before the repair.
 *
 * Mounted on the real section and the real api client (lib/api.ts); only
 * `fetch` and the toast are stubbed. The stubbed consent URLs are same-document
 * fragments, so the navigation the section makes is observable in jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: toastMock.toast, Toaster: () => null }));
const { toast } = toastMock;

import { CoreChannelsSection } from "../components/core-channels-section";

const BUSINESS = "biz_1";
const SUITE_PATH = `/connect/google-suite/businesses/${BUSINESS}/auth-url`;
/** Every Google service the sign-in offers except the business mailbox. */
const WITHOUT_GMAIL = ["calendar", "drive", "forms", "contacts", "business_profile"];

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => (text ? (JSON.parse(text) as unknown) : null),
    text: async () => text,
    clone() { return this; },
  } as unknown as Response;
}

/** The production filter's body for the owner-only refusal (http-exception.filter.ts). */
function ownerOnly() {
  return jsonResponse(403, {
    statusCode: 403, code: "GMAIL_OWNER_ONLY",
    message: "Only the business owner can connect, replace or disconnect the business mailbox", error: "Forbidden",
    timestamp: "2026-11-02T00:00:00.000Z", path: SUITE_PATH,
  }, "Forbidden");
}

interface Call { method: string; pathname: string; body: unknown }

function stubServer(route: (method: string, pathname: string, body: unknown) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, pathname, body });
    return route(method, pathname, body) ?? jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  }));
  return calls;
}

/** A consent URL jsdom can navigate to: this document with a fragment naming what was asked for. */
const consentUrl = (tag: string) => `${window.location.origin}/app/key-connect#${tag}`;
const suitePosts = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.pathname.endsWith(SUITE_PATH));

function renderSection() {
  return render(
    <CoreChannelsSection businessId={BUSINESS} entries={[]} onManageWhatsApp={() => {}} onManageEntry={() => {}} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/app/key-connect");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Sign in with Google after the business mailbox became OWNER only (CMF5R-2)", () => {
  it("[R0-CMF5-W09] RED-BEFORE: a member who is not the owner signs in with Google: the default sign-in is refused (403 GMAIL_OWNER_ONLY), the section asks again for every service but Gmail and goes to that consent, says Gmail is the owner's to connect, and shows no error", async () => {
    const calls = stubServer((method, pathname, body) => {
      if (method !== "POST" || !pathname.endsWith(SUITE_PATH)) return undefined;
      const services = (body as { services?: string[] } | undefined)?.services;
      if (!Array.isArray(services) || services.length === 0 || services.includes("gmail")) return ownerOnly();
      return jsonResponse(201, { authUrl: consentUrl("consent-without-gmail"), services }, "Created");
    });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    await waitFor(() => expect(window.location.hash).toBe("#consent-without-gmail"));
    expect(suitePosts(calls).map((c) => c.body)).toEqual([{}, { services: WITHOUT_GMAIL }]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(String(toast.info.mock.calls[0][0])).toMatch(/business owner/i);
    expect(String(toast.info.mock.calls[0][0])).toMatch(/Gmail/);
  });

  it("[R0-CMF5-W10] control: the owner's default sign-in (every service, Gmail included) goes straight to Google with one request and no notice", async () => {
    const calls = stubServer((method, pathname) =>
      method === "POST" && pathname.endsWith(SUITE_PATH)
        ? jsonResponse(201, { authUrl: consentUrl("consent-all-services"), services: ["gmail", ...WITHOUT_GMAIL] }, "Created")
        : undefined);
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    await waitFor(() => expect(window.location.hash).toBe("#consent-all-services"));
    expect(suitePosts(calls).map((c) => c.body)).toEqual([{}]);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("[R0-CMF5-W11] control: a refusal that is not the mailbox rule (403 from BusinessGuard) is shown as the error it is, and nothing is asked again", async () => {
    const calls = stubServer((method, pathname) =>
      method === "POST" && pathname.endsWith(SUITE_PATH)
        ? jsonResponse(403, { statusCode: 403, message: "You do not have access to this business", error: "Forbidden" }, "Forbidden")
        : undefined);
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You do not have access to this business"));
    expect(suitePosts(calls)).toHaveLength(1);
    expect(window.location.hash).toBe("");
  });
});
