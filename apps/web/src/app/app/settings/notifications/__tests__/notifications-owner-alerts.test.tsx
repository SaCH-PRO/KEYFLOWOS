// @vitest-environment-options {"url": "https://app.keyflowos.test/app/settings/notifications"}
/**
 * OWNER-ALERTS-WEB (D-154): Settings > Notifications gets "Your alerts": the install step and the owner's alert
 * toggles for bookings, payments and "I've paid" claims. OwnerAlertsListener (OWNER-ALERTS-SERVER) reads them from
 * Business.notificationPreferences as owner_alert_bookings / _payments / _claims (absent = on); they are read and
 * saved through GET/PATCH /notifications/businesses/:id/customer-preferences, the route this page already uses
 * (settings read/write, FU-NOTIFICATIONS-PREFS-GUARD).
 *
 * The default tab (customer emails, six switches) is unchanged: notifications-push-moved.test.tsx NPM-01..03.
 *
 *   NOA-01  RED-BEFORE  a "Your alerts" tab shows the install step and three alert switches read from the server
 *                       (a key the server does not have is on, as the listener reads it)
 *   NOA-02  RED-BEFORE  turning bookings off PATCHes only { owner_alert_bookings: false } to API_BASE with the token,
 *                       and the switch stays off once the server answers it saved
 *   NOA-03  RED-BEFORE  a refused save puts the switch back and says it was not saved
 *   NOA-04  RED-BEFORE  a 200 that did not keep the value (a server that drops the key) puts the switch back and says
 *                       it was not saved: "saved" is what the server answers, not what was sent
 *   NOA-05  RED-BEFORE  a failed read says the alert settings could not be loaded (no switches), and Retry reads again
 *   NOA-06  control     the default tab still shows the six customer-email switches and no alert switch
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

interface Call { url: string; method: string; auth: string | null; body: unknown }

function serve(opts: {
  prefs?: Record<string, unknown>;
  failRead?: number;
  patch?: (body: Record<string, unknown>, prefs: Record<string, unknown>) => Response;
} = {}): Call[] {
  const calls: Call[] = [];
  let failRead = opts.failRead ?? 0;
  const prefs: Record<string, unknown> = {
    booking_confirmed: true, booking_reminder: true, booking_rescheduled: true, booking_cancelled: true,
    invoice_sent: true, payment_receipt: true, ...(opts.prefs ?? {}),
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, auth: new Headers(init?.headers).get("authorization"), body });
    if (url === PREFS_URL && method === "GET") {
      if (failRead > 0) { failRead -= 1; return Response.json({ message: "Internal Server Error" }, { status: 500 }); }
      return Response.json(prefs);
    }
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
  fireEvent.click(await screen.findByRole("button", { name: /^your alerts$/i }));
  return screen.findByRole("region", { name: /your alerts/i });
}

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", "owner-token");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-154: Settings > Notifications > Your alerts", () => {
  it("NOA-01 RED-BEFORE: the install step and three alert switches read from the server", async () => {
    serve({ prefs: { owner_alert_payments: false } });
    const region = await openAlerts();
    expect(within(region).getByRole("heading", { name: /install keyflowos on your phone/i })).toBeTruthy();
    const bookings = await within(region).findByRole("switch", { name: /new bookings/i });
    expect(bookings.getAttribute("aria-checked")).toBe("true");
    expect(within(region).getByRole("switch", { name: /payments received/i }).getAttribute("aria-checked")).toBe("false");
    expect(within(region).getByRole("switch", { name: /i've paid/i }).getAttribute("aria-checked")).toBe("true");
    expect(within(region).getAllByRole("switch")).toHaveLength(3);
    expect(region.textContent ?? "").toMatch(/push.*email/i);
  });

  it("NOA-02 RED-BEFORE: turning bookings off PATCHes only that key to API_BASE and stays off", async () => {
    const calls = serve();
    const region = await openAlerts();
    const bookings = await within(region).findByRole("switch", { name: /new bookings/i });
    fireEvent.click(bookings);
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe(PREFS_URL);
    expect(patch.auth).toBe("Bearer owner-token");
    expect(patch.body).toEqual({ owner_alert_bookings: false });
    await waitFor(() => expect((bookings as HTMLButtonElement).disabled).toBe(false));
    expect(bookings.getAttribute("aria-checked")).toBe("false");
    expect(within(region).queryByRole("alert")).toBeNull();
  });

  it("NOA-03 RED-BEFORE: a refused save puts the switch back and says it was not saved", async () => {
    serve({ patch: () => Response.json({ message: "Forbidden" }, { status: 403 }) });
    const region = await openAlerts();
    const claims = await within(region).findByRole("switch", { name: /i've paid/i });
    fireEvent.click(claims);
    const alert = await within(region).findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/not saved/i);
    expect(claims.getAttribute("aria-checked")).toBe("true");
  });

  it("NOA-04 RED-BEFORE: a 200 that did not keep the value puts the switch back and says it was not saved", async () => {
    // A server that drops unknown keys answers its stored preferences without the owner alert key.
    serve({ patch: (_body, prefs) => Response.json(prefs) });
    const region = await openAlerts();
    const payments = await within(region).findByRole("switch", { name: /payments received/i });
    fireEvent.click(payments);
    const alert = await within(region).findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/not saved/i);
    expect(payments.getAttribute("aria-checked")).toBe("true");
  });

  it("NOA-05 RED-BEFORE: a failed read says so with no switches, and Retry reads again", async () => {
    const calls = serve({ failRead: 2 });
    const region = await openAlerts();
    const alert = await within(region).findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/could not be loaded/i);
    expect(within(region).queryAllByRole("switch")).toHaveLength(0);
    const reads = calls.filter((c) => c.method === "GET" && c.url === PREFS_URL).length;
    fireEvent.click(within(region).getByRole("button", { name: /retry/i }));
    expect(await within(region).findByRole("switch", { name: /new bookings/i })).toBeTruthy();
    expect(calls.filter((c) => c.method === "GET" && c.url === PREFS_URL).length).toBe(reads + 1);
  });

  it("NOA-06 control: the default tab still shows the six customer-email switches and no alert switch", async () => {
    serve();
    const { default: Page } = await import("@/app/app/settings/notifications/page");
    render(<Page />);
    await screen.findByRole("heading", { name: /customer notifications/i });
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    expect(screen.queryByRole("switch", { name: /new bookings/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /your alerts/i })).toBeNull();
  });
});
