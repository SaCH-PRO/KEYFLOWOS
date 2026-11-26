// @vitest-environment-options {"url": "https://app.keyflowos.test/app/settings/notifications"}
/**
 * OWNER-ALERTS-WEB (D-154): Settings > Notifications gets an "Owner alerts" tab: the install step and the business
 * owner's alert toggles for bookings, payments and "I've paid" claims. OwnerAlertsListener (OWNER-ALERTS-SERVER)
 * reads them from Business.notificationPreferences as owner_alert_bookings / _payments / _claims (absent = on).
 *
 * Repair round 1 (orchestrator ruling on SEC-OAW-1: fail closed until the owner rules): they are the business owner's
 * alerts, changed only by an owner (an OWNER membership; a change affects every owner). The tab reads
 * GET /notifications/businesses/:id/owner-alerts ({ bookings, payments, claims, canChange }) and saves through
 * PATCH .../customer-preferences, which refuses a non-owner (403 OWNER_ALERTS_OWNER_ONLY). Everyone else sees the
 * switches read-only. Reads and refusals are said with FAILURE-KIT (COR-OAW-1, SEC-OAW-3): a refused read is
 * NoAccessState with no Retry; a refused save is said in the kit's words, with no "Try again" on a 403.
 *
 * The default tab (customer emails, six switches) is unchanged: notifications-push-moved.test.tsx NPM-01..03.
 *
 *   NOA-01  RED-BEFORE  for an owner: an "Owner alerts" tab with the install step and three switches read from the
 *                       server; the words say they are the business owner's and that a change affects every owner,
 *                       and never "your"
 *   NOA-02  RED-BEFORE  turning bookings off PATCHes only { owner_alert_bookings: false } to API_BASE with the token,
 *                       and the switch stays off once the server answers it saved
 *   NOA-03  RED-BEFORE  a refused save (403) puts the switch back and says the server's words, with no "Try again"
 *   NOA-04  RED-BEFORE  a 200 that did not keep the value puts the switch back and says it was not saved
 *   NOA-05  RED-BEFORE  a failed read (500) says it could not be loaded (no switches), and Retry reads again
 *   NOA-06  control     the default tab still shows the six customer-email switches and no alert switch
 *   NOA-07  RED-BEFORE  for a member who may not change them (canChange false): the three values, read-only, with
 *                       "Only the business owner can change these."; a click sends nothing
 *   NOA-08  RED-BEFORE  a refused read (a ModuleScopeGuard 403) is NoAccessState, with no Retry and no switches
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { API_BASE } from "@/lib/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/settings/notifications",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const BIZ = "biz_noa";
const PREFS_URL = `${API_BASE}/notifications/businesses/${BIZ}/customer-preferences`;
const ALERTS_URL = `${API_BASE}/notifications/businesses/${BIZ}/owner-alerts`;
const OWNER_ONLY = "Only the business owner can change the owner's alerts (bookings, payments, \"I've paid\" claims).";

interface Call { url: string; method: string; auth: string | null; body: unknown }

function serve(opts: {
  alerts?: { bookings: boolean; payments: boolean; claims: boolean };
  canChange?: boolean;
  /** Answers for the first N owner-alerts reads, before the real one. */
  readFailures?: Response[];
  patch?: (body: Record<string, unknown>, prefs: Record<string, unknown>) => Response;
} = {}): Call[] {
  const calls: Call[] = [];
  const failures = [...(opts.readFailures ?? [])];
  const a = opts.alerts ?? { bookings: true, payments: true, claims: true };
  const prefs: Record<string, unknown> = {
    booking_confirmed: true, booking_reminder: true, booking_rescheduled: true, booking_cancelled: true,
    invoice_sent: true, payment_receipt: true,
    owner_alert_bookings: a.bookings, owner_alert_payments: a.payments, owner_alert_claims: a.claims,
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, auth: new Headers(init?.headers).get("authorization"), body });
    if (url === ALERTS_URL && method === "GET") {
      const failure = failures.shift();
      if (failure) return failure;
      return Response.json({
        bookings: prefs.owner_alert_bookings !== false,
        payments: prefs.owner_alert_payments !== false,
        claims: prefs.owner_alert_claims !== false,
        canChange: opts.canChange ?? true,
      });
    }
    if (url === PREFS_URL && method === "GET") return Response.json(prefs);
    if (url === PREFS_URL && method === "PATCH") {
      if (opts.patch) return opts.patch(body, prefs);
      Object.assign(prefs, body);
      return Response.json(prefs);
    }
    if (url.startsWith(`${API_BASE}/notifications/businesses/${BIZ}/customer-log`)) return Response.json([]);
    return Response.json({ message: "Not Found" }, { status: 404 });
  }));
  return calls;
}

async function openAlerts() {
  const { default: Page } = await import("@/app/app/settings/notifications/page");
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: /^owner alerts$/i }));
  return screen.findByRole("region", { name: /owner alerts/i });
}

const patches = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", "owner-token");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-154: Settings > Notifications > Owner alerts", () => {
  it("NOA-01 RED-BEFORE: the install step and three switches, in the business owner's words", async () => {
    serve({ alerts: { bookings: true, payments: false, claims: true } });
    const region = await openAlerts();
    expect(within(region).getByRole("heading", { name: /install keyflowos on your phone/i })).toBeTruthy();
    const bookings = await within(region).findByRole("switch", { name: /new bookings/i });
    expect(bookings.getAttribute("aria-checked")).toBe("true");
    expect((bookings as HTMLButtonElement).disabled).toBe(false);
    expect(within(region).getByRole("switch", { name: /payments received/i }).getAttribute("aria-checked")).toBe("false");
    expect(within(region).getByRole("switch", { name: /i've paid/i }).getAttribute("aria-checked")).toBe("true");
    expect(within(region).getAllByRole("switch")).toHaveLength(3);
    const settings = within(region).getByTestId("owner-alert-settings");
    const words = settings.textContent ?? "";
    expect(words).toMatch(/business owner/i);
    expect(words).toMatch(/every owner/i);
    expect(words).toMatch(/push.*email/i);
    expect(words).not.toMatch(/\byour?\b/i);
    expect(within(settings).queryByText(/only the business owner can change these/i)).toBeNull();
  });

  it("NOA-02 RED-BEFORE: turning bookings off PATCHes only that key to API_BASE and stays off", async () => {
    const calls = serve();
    const region = await openAlerts();
    const bookings = await within(region).findByRole("switch", { name: /new bookings/i });
    fireEvent.click(bookings);
    await waitFor(() => expect(patches(calls)).toHaveLength(1));
    const patch = patches(calls)[0];
    expect(patch.url).toBe(PREFS_URL);
    expect(patch.auth).toBe("Bearer owner-token");
    expect(patch.body).toEqual({ owner_alert_bookings: false });
    await waitFor(() => expect((bookings as HTMLButtonElement).disabled).toBe(false));
    expect(bookings.getAttribute("aria-checked")).toBe("false");
    expect(within(region).queryByRole("alert")).toBeNull();
  });

  it("NOA-03 RED-BEFORE: a refused save puts the switch back and says the server's words, with no Try again", async () => {
    serve({
      patch: () => Response.json({ statusCode: 403, code: "OWNER_ALERTS_OWNER_ONLY", message: OWNER_ONLY }, { status: 403 }),
    });
    const region = await openAlerts();
    const claims = await within(region).findByRole("switch", { name: /i've paid/i });
    fireEvent.click(claims);
    const alert = await within(region).findByRole("alert");
    expect(alert.textContent ?? "").toContain(OWNER_ONLY);
    expect(alert.textContent ?? "").not.toMatch(/try again/i);
    await waitFor(() => expect(claims.getAttribute("aria-checked")).toBe("true"));
  });

  it("NOA-04 RED-BEFORE: a 200 that did not keep the value puts the switch back and says it was not saved", async () => {
    serve({ patch: (_body, prefs) => Response.json({ ...prefs, owner_alert_payments: true }) });
    const region = await openAlerts();
    const payments = await within(region).findByRole("switch", { name: /payments received/i });
    fireEvent.click(payments);
    const alert = await within(region).findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/not saved/i);
    await waitFor(() => expect(payments.getAttribute("aria-checked")).toBe("true"));
  });

  it("NOA-05 RED-BEFORE: a failed read says so with no switches, and Retry reads again", async () => {
    const calls = serve({ readFailures: [Response.json({ message: "Internal Server Error" }, { status: 500 })] });
    const region = await openAlerts();
    const alert = await within(region).findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/couldn't load the business owner's alerts/i);
    expect(within(region).queryAllByRole("switch")).toHaveLength(0);
    const reads = calls.filter((c) => c.url === ALERTS_URL).length;
    fireEvent.click(within(region).getByRole("button", { name: /retry/i }));
    expect(await within(region).findByRole("switch", { name: /new bookings/i })).toBeTruthy();
    expect(calls.filter((c) => c.url === ALERTS_URL).length).toBe(reads + 1);
  });

  it("NOA-06 control: the default tab still shows the six customer-email switches and no alert switch", async () => {
    serve();
    const { default: Page } = await import("@/app/app/settings/notifications/page");
    render(<Page />);
    await screen.findByRole("heading", { name: /customer notifications/i });
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    expect(screen.queryByRole("switch", { name: /new bookings/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /owner alerts/i })).toBeNull();
  });

  it("NOA-07 RED-BEFORE: a member who may not change them sees them read-only, and a click sends nothing", async () => {
    const calls = serve({ alerts: { bookings: true, payments: false, claims: true }, canChange: false });
    const region = await openAlerts();
    const bookings = await within(region).findByRole("switch", { name: /new bookings/i });
    const switches = within(region).getAllByRole("switch");
    expect(switches).toHaveLength(3);
    for (const sw of switches) expect((sw as HTMLButtonElement).disabled).toBe(true);
    expect(within(region).getByRole("switch", { name: /payments received/i }).getAttribute("aria-checked")).toBe("false");
    expect(within(region).getByText("Only the business owner can change these.")).toBeTruthy();
    fireEvent.click(bookings);
    await new Promise((r) => setTimeout(r, 50));
    expect(patches(calls)).toHaveLength(0);
    expect(bookings.getAttribute("aria-checked")).toBe("true");
  });

  it("NOA-08 RED-BEFORE: a refused read is NoAccessState, with no Retry and no switches", async () => {
    serve({
      readFailures: [
        Response.json({ statusCode: 403, message: "Insufficient permissions: settings requires read access (you have none)" }, { status: 403 }),
      ],
    });
    const region = await openAlerts();
    expect(await within(region).findByText(/no access - ask the owner/i)).toBeTruthy();
    expect(within(region).queryByRole("button", { name: /retry/i })).toBeNull();
    expect(within(region).queryAllByRole("switch")).toHaveLength(0);
  });
});
