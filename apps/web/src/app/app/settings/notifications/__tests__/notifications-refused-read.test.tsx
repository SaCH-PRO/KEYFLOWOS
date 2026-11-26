/**
 * FU-NOTIFICATIONS-PAGE-REFUSED (owner ruling D-283): a refused read on Settings > Notifications says "no access",
 * never "nothing sent".
 *
 * The customer-email preferences and log need settings read (FU-NOTIFICATIONS-PREFS-GUARD, @RequireModuleScope('settings',
 * 'read')). A settings-none member who reaches /app/settings/notifications by URL or a bookmark is refused both reads
 * with ModuleScopeGuard's 403, and the page dropped it: a blank Preferences tab, and "No customer notifications sent
 * yet" under "Log (0)". It now judges each read with FAILURE-KIT's readState and shows NoAccessState for a refusal; any
 * other failure (a 5xx, a network error, BusinessGuard's 403) is said as a failed load, not as no access.
 *
 *   NPR-01  RED-BEFORE  both reads refused: no-access on the Preferences tab and on the Log tab, never the empty-log
 *                       text, and the Log tab is not counted as "(0)"
 *   NPR-02  RED-BEFORE  only the log refused: the preferences still show; the Log tab says no access
 *   NPR-03  RED-BEFORE  a 5xx on both reads is a failed load on both tabs, not no access and not "nothing sent"
 *   NPR-04  RED-BEFORE  a network failure is a failed load, not no access
 *   NPR-05  RED-BEFORE  a 403 that is not ModuleScopeGuard's settings refusal is a failed load, not no access
 *   NPR-06  control     an owner (or settings reader) still sees the preferences and the log
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/settings/notifications",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const BIZ = "biz_notif_refused";
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
    type: "booking_confirmed",
    recipientEmail: "ana@example.test",
    recipientName: "Ana",
    subject: "Your booking is confirmed",
    status: "SENT",
    sentAt: "2026-11-20T10:00:00.000Z",
    createdAt: "2026-11-20T10:00:00.000Z",
  },
];
/** ModuleScopeGuard's refusal of a settings-none member (apps/server core/auth/module-scope.guard.ts). */
const SETTINGS_REFUSAL = "Insufficient permissions: settings requires read access (you have none)";
const EMPTY_LOG_TEXT = /no customer notifications sent yet/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function refused(): Response {
  return json(403, { statusCode: 403, message: SETTINGS_REFUSAL, error: "Forbidden" });
}

type Answer = () => Response | Promise<Response>;

function serve(answers: { prefs: Answer; log: Answer }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-preferences`)) return answers.prefs();
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-log`)) return answers.log();
    return json(404, { message: "Not Found" });
  }));
}

async function renderPage() {
  const { default: Page } = await import("@/app/app/settings/notifications/page");
  render(<Page />);
  await screen.findByRole("heading", { name: /customer notifications/i });
}

function openLog() {
  fireEvent.click(screen.getByRole("button", { name: /^log\b/i }));
}

function noAccess(): HTMLElement | null {
  return document.querySelector('[data-state="no-access"]');
}

let run = 0;
beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BIZ);
  // A token of its own per test: lib/api.ts coalesces in-flight GETs by URL and Authorization, so a read still being
  // retried from one test (NPR-04's network failure) is never joined by the next.
  window.localStorage.setItem("kf_token", `member-token-${++run}`);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-283: Settings > Notifications says no access on a refused read, not 'nothing sent'", () => {
  it("NPR-01 RED-BEFORE: both reads refused: no access on both tabs, never the empty-log text or a (0) count", async () => {
    serve({ prefs: refused, log: refused });
    await renderPage();

    await waitFor(() => expect(noAccess()).not.toBeNull());
    expect(noAccess()!.textContent).toMatch(/no access - ask the owner/i);
    expect(noAccess()!.textContent).toContain(SETTINGS_REFUSAL);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);

    expect(screen.queryByRole("button", { name: /^log \(0\)$/i })).toBeNull();
    openLog();
    await waitFor(() => expect(noAccess()).not.toBeNull());
    expect(noAccess()!.textContent).toMatch(/no access - ask the owner/i);
    expect(screen.queryByText(EMPTY_LOG_TEXT)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("NPR-02 RED-BEFORE: only the log refused: the preferences still show, the Log tab says no access", async () => {
    serve({ prefs: () => json(200, PREFS), log: refused });
    await renderPage();

    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    expect(noAccess()).toBeNull();

    openLog();
    await waitFor(() => expect(noAccess()).not.toBeNull());
    expect(screen.queryByText(EMPTY_LOG_TEXT)).toBeNull();
  });

  it("NPR-03 RED-BEFORE: a 5xx on both reads is a failed load on both tabs, not no access and not 'nothing sent'", async () => {
    serve({
      prefs: () => json(500, { statusCode: 500, message: "Internal server error" }),
      log: () => json(500, { statusCode: 500, message: "Internal server error" }),
    });
    await renderPage();

    const prefsAlert = await screen.findByRole("alert");
    expect(prefsAlert.textContent).toMatch(/couldn't load/i);
    expect(prefsAlert.textContent).toMatch(/internal server error/i);
    expect(noAccess()).toBeNull();

    openLog();
    const logAlert = await screen.findByRole("alert");
    expect(logAlert.textContent).toMatch(/couldn't load/i);
    expect(noAccess()).toBeNull();
    expect(screen.queryByText(EMPTY_LOG_TEXT)).toBeNull();
  });

  // lib/fetch-with-retry retries a GET's network failure three times with backoff (about 2.1 s) before it answers.
  it("NPR-04 RED-BEFORE: a network failure is a failed load, not no access", { timeout: 15_000 }, async () => {
    serve({
      prefs: () => Promise.reject(new TypeError("Failed to fetch")),
      log: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const { default: Page } = await import("@/app/app/settings/notifications/page");
    render(<Page />);
    await screen.findByRole("heading", { name: /customer notifications/i }, { timeout: 8_000 });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't load/i);
    expect(noAccess()).toBeNull();

    openLog();
    await screen.findByRole("alert");
    expect(noAccess()).toBeNull();
    expect(screen.queryByText(EMPTY_LOG_TEXT)).toBeNull();
  });

  it("NPR-05 RED-BEFORE: a 403 that is not the settings scope refusal is a failed load, not no access", async () => {
    const other = () => json(403, { statusCode: 403, message: "Unable to verify business access" });
    serve({ prefs: other, log: other });
    await renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/unable to verify business access/i);
    expect(noAccess()).toBeNull();

    openLog();
    await screen.findByRole("alert");
    expect(noAccess()).toBeNull();
    expect(screen.queryByText(EMPTY_LOG_TEXT)).toBeNull();
  });

  it("NPR-06 control: an owner or settings reader still sees the preferences and the log", async () => {
    serve({ prefs: () => json(200, PREFS), log: () => json(200, LOG) });
    await renderPage();

    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    expect(screen.getByRole("switch", { name: /toggle booking confirmation/i }).getAttribute("aria-checked")).toBe("true");
    expect(noAccess()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    expect(screen.getByRole("button", { name: /^log \(1\)$/i })).toBeTruthy();
    openLog();
    await screen.findByText("Your booking is confirmed");
    expect(screen.queryByText(EMPTY_LOG_TEXT)).toBeNull();
    expect(noAccess()).toBeNull();
  });

  it("NPR-06b control: an owner with nothing sent yet still sees the empty-log text", async () => {
    serve({ prefs: () => json(200, PREFS), log: () => json(200, []) });
    await renderPage();

    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    openLog();
    await screen.findByText(EMPTY_LOG_TEXT);
    expect(noAccess()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
