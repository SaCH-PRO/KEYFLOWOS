/**
 * FU-NOTIFICATIONS-PAGE-REFUSED (D-283), review round 1: the Retry a failed load offers.
 *
 *   NPR-07  guard       (COR finding 1) a 500 on the log, then Retry answered 200: the log shows, counted, and no alert
 *                       or no-access state remains
 *   NPR-08  RED-BEFORE  (COR finding 3; RED at a8c6bffd against the click-time revert) a toggle refused while a Retry
 *                       reloads the preferences: the page ends on the server's preferences, not on the ones it had when
 *                       the switch was clicked. Repair round 1 (SEC-NPR-1): the fixture is a real server's, whose
 *                       undecided PATCH has not changed Booking Confirmation, so the reload still reads it on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { toast } from "sonner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/settings/notifications",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BIZ = "biz_notif_retry";
const PREFS = {
  booking_confirmed: true,
  booking_reminder: true,
  booking_rescheduled: false,
  booking_cancelled: true,
  invoice_sent: true,
  payment_receipt: false,
};
const LOG = [
  {
    id: "log_1",
    type: "invoice_sent",
    recipientEmail: "ben@example.test",
    subject: "Invoice INV-1",
    status: "SENT",
    sentAt: "2026-11-21T10:00:00.000Z",
    createdAt: "2026-11-21T10:00:00.000Z",
  },
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = (method: string) => Response | Promise<Response>;

function serve(handlers: { prefs: Handler; log: Handler }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    const method = (init?.method ?? "GET").toUpperCase();
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-preferences`)) return handlers.prefs(method);
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-log`)) return handlers.log(method);
    return json(404, { message: "Not Found" });
  }));
}

async function renderPage() {
  const { default: Page } = await import("@/app/app/settings/notifications/page");
  render(<Page />);
  await screen.findByRole("heading", { name: /customer notifications/i });
}

const checked = (name: RegExp) => screen.getByRole("switch", { name }).getAttribute("aria-checked");

let run = 0;
beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", `retry-token-${++run}`);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-283 review round 1: Retry on Settings > Notifications", () => {
  it("NPR-07 guard: a failed log load, then Retry answered 200, shows the log and no alert", async () => {
    let logCalls = 0;
    serve({
      prefs: () => json(200, PREFS),
      log: () => (++logCalls === 1 ? json(500, { statusCode: 500, message: "Internal server error" }) : json(200, LOG)),
    });
    await renderPage();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    fireEvent.click(screen.getByRole("button", { name: /^log\b/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't load/i);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByText("Invoice INV-1");
    expect(screen.getByRole("button", { name: /^log \(1\)$/i })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector('[data-state="no-access"]')).toBeNull();
    expect(logCalls).toBe(2);
  });

  it("NPR-08 RED-BEFORE: a refused toggle is put back on the preferences a Retry reloaded, not on stale ones", async () => {
    let prefsGets = 0;
    let logGets = 0;
    let failPatch!: () => void;
    // What the server holds after the click: Payment Receipt changed elsewhere; Booking Confirmation still on, because
    // the PATCH that would turn it off has not been decided (and is then refused).
    const fresh = { ...PREFS, payment_receipt: true };
    serve({
      prefs: (method) => {
        if (method === "PATCH") {
          return new Promise<Response>((resolve) => {
            failPatch = () => resolve(json(400, { statusCode: 400, message: "Bad request" }));
          });
        }
        return json(200, ++prefsGets === 1 ? PREFS : fresh);
      },
      log: () => (++logGets === 1 ? json(500, { statusCode: 500, message: "Internal server error" }) : json(200, [])),
    });
    await renderPage();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));

    // Toggle Booking Confirmation off; the PATCH is still in flight.
    fireEvent.click(screen.getByRole("switch", { name: /toggle booking confirmation/i }));
    expect(checked(/toggle booking confirmation/i)).toBe("false");

    // The log failed; Retry reloads both reads while the PATCH waits.
    fireEvent.click(screen.getByRole("button", { name: /^log\b/i }));
    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));
    await screen.findByText(/no customer notifications sent yet/i);
    expect(prefsGets).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: /^preferences$/i }));
    await waitFor(() => expect(checked(/toggle payment receipt/i)).toBe("true"));
    expect(checked(/toggle booking confirmation/i)).toBe("true");
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();

    // The PATCH is refused (the page has handled it once its error toast is shown): the page holds the server's
    // preferences, Booking Confirmation on and the reloaded Payment Receipt on.
    failPatch();
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(checked(/toggle booking confirmation/i)).toBe("true");
    expect(checked(/toggle payment receipt/i)).toBe("true");
  });
});
