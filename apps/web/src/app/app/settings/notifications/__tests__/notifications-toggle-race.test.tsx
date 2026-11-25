/**
 * FU-NOTIFICATIONS-PAGE-REFUSED (D-283), repair round 1: a toggle and the Retry this packet adds, and a Retry refused.
 *
 * The server's PATCH answers the whole preferences (transactional-email.service.ts updatePreferences returns them), and
 * a GET of customer-preferences is the server's truth. A toggle's answer is put on the page from the server, never
 * guessed from what the page held when the switch was clicked, because a Retry may have reloaded it in between.
 *
 *   NPR-08b RED-BEFORE  (re-read count only) the reload reads the pre-click value, then the PATCH is refused: the switch shows the pre-click
 *                       value (the server's, re-read), not a flip of what the page holds
 *   NPR-08c RED-BEFORE  a refused PATCH: the page re-reads the preferences and shows the server's (Payment Receipt
 *                       changed elsewhere), not a local revert of the click-time object
 *   NPR-08d RED-BEFORE  the PATCH succeeds after a Retry read the old value: the switch shows the PATCH's answer
 *   NPR-08e RED-BEFORE  the PATCH's write landed (a reload reads it) but its answer is lost (500), and the re-read fails:
 *                       a load has happened since the click, so nothing is reverted; the switch shows the reload's value
 *   NPR-08f RED-BEFORE  (re-read count only) no load since the click, the PATCH is refused and the re-read fails: the switch is put back
 *   NPR-09  guard       (SEC-NPR-2) a first load with the log rows, a failed preferences read, then a Retry refused (403):
 *                       no switch, no log row, no "(n)" count
 *   NPR-09b guard       the same with the switches showing and the log failed: after the refused Retry, no switch, no
 *                       row, no count
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

const BIZ = "biz_notif_race";
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
    id: "log_9",
    type: "payment_receipt",
    recipientEmail: "cara@example.test",
    subject: "Receipt RCPT-9",
    status: "SENT",
    sentAt: "2026-11-22T10:00:00.000Z",
    createdAt: "2026-11-22T10:00:00.000Z",
  },
];
const SETTINGS_REFUSAL = "Insufficient permissions: settings requires read access (you have none)";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const fail500 = () => json(500, { statusCode: 500, message: "Internal server error" });
const refused = () => json(403, { statusCode: 403, message: SETTINGS_REFUSAL, error: "Forbidden" });

/** Answers in order; the last one repeats. */
function queue(...answers: Array<() => Response>): () => Response {
  let i = 0;
  return () => answers[Math.min(i++, answers.length - 1)]();
}

interface Server {
  prefsGets: () => number;
  /** Decides the PATCH that is waiting. */
  answerPatch: (res: Response) => void;
}

function serve(prefs: () => Response, log: () => Response): Server {
  let gets = 0;
  let pending: ((res: Response) => void) | null = null;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    const method = (init?.method ?? "GET").toUpperCase();
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-preferences`)) {
      if (method === "PATCH") return new Promise<Response>((resolve) => { pending = resolve; });
      gets += 1;
      return prefs();
    }
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-log`)) return log();
    return json(404, { message: "Not Found" });
  }));
  return {
    prefsGets: () => gets,
    answerPatch: (res) => {
      if (!pending) throw new Error("no PATCH is waiting");
      pending(res);
      pending = null;
    },
  };
}

async function renderPage() {
  const { default: Page } = await import("@/app/app/settings/notifications/page");
  render(<Page />);
  await screen.findByRole("heading", { name: /customer notifications/i });
}

const BOOKING = /toggle booking confirmation/i;
const RECEIPT = /toggle payment receipt/i;
const checked = (name: RegExp) => screen.getByRole("switch", { name }).getAttribute("aria-checked");

/** Turns Booking Confirmation off; its PATCH then waits. */
async function clickBookingOff() {
  await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
  fireEvent.click(screen.getByRole("switch", { name: BOOKING }));
  expect(checked(BOOKING)).toBe("false");
}

/** Retry on the Log tab (the log read failed), then back on Preferences once the reload has landed. */
async function retryFromLog(server: Server, getsAfter: number) {
  fireEvent.click(screen.getByRole("button", { name: /^log\b/i }));
  fireEvent.click(await screen.findByRole("button", { name: /retry/i }));
  await waitFor(() => expect(server.prefsGets()).toBe(getsAfter));
  await waitFor(() => expect(screen.queryByRole("button", { name: /retry/i })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: /^preferences$/i }));
  await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
}

let run = 0;
beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("kf_token", `race-token-${++run}`);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("D-283 repair round 1: a toggle's answer comes from the server", () => {
  it("NPR-08b RED-BEFORE: reload reads the pre-click value, PATCH refused: the switch shows the pre-click value", async () => {
    const server = serve(() => json(200, PREFS), queue(fail500, () => json(200, [])));
    await renderPage();
    await clickBookingOff();
    await retryFromLog(server, 2);
    expect(checked(BOOKING)).toBe("true"); // the server never took the change

    server.answerPatch(json(400, { statusCode: 400, message: "Bad request" }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(server.prefsGets()).toBe(3); // re-read after the refusal
    expect(checked(BOOKING)).toBe("true");
    expect(checked(RECEIPT)).toBe("false");
  });

  it("NPR-08c RED-BEFORE: a refused PATCH re-reads the preferences and shows the server's", async () => {
    // Payment Receipt is turned on elsewhere while this member's PATCH is pending.
    const server = serve(queue(() => json(200, PREFS), () => json(200, { ...PREFS, payment_receipt: true })), () => json(200, LOG));
    await renderPage();
    await clickBookingOff();

    server.answerPatch(json(400, { statusCode: 400, message: "Bad request" }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(server.prefsGets()).toBe(2);
    expect(checked(BOOKING)).toBe("true");
    expect(checked(RECEIPT)).toBe("true");
  });

  it("NPR-08d RED-BEFORE: the PATCH succeeds after a Retry read the old value: the switch shows the PATCH's answer", async () => {
    const server = serve(() => json(200, PREFS), queue(fail500, () => json(200, [])));
    await renderPage();
    await clickBookingOff();
    await retryFromLog(server, 2);
    expect(checked(BOOKING)).toBe("true"); // the reload read the value before the PATCH was decided

    server.answerPatch(json(200, { ...PREFS, booking_confirmed: false }));
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Notification preference updated"));
    expect(checked(BOOKING)).toBe("false");
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("NPR-08e RED-BEFORE: the write landed, its answer is lost and the re-read fails: no revert over the reload", async () => {
    const landed = { ...PREFS, booking_confirmed: false };
    const server = serve(queue(() => json(200, PREFS), () => json(200, landed), fail500), queue(fail500, () => json(200, [])));
    await renderPage();
    await clickBookingOff();
    await retryFromLog(server, 2);
    expect(checked(BOOKING)).toBe("false"); // the reload read the landed write

    server.answerPatch(fail500());
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(server.prefsGets()).toBe(3);
    expect(checked(BOOKING)).toBe("false");
  });

  it("NPR-08f RED-BEFORE: no load since the click, PATCH refused and the re-read fails: the switch is put back", async () => {
    const server = serve(queue(() => json(200, PREFS), fail500), () => json(200, LOG));
    await renderPage();
    await clickBookingOff();

    server.answerPatch(json(400, { statusCode: 400, message: "Bad request" }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(server.prefsGets()).toBe(2);
    expect(checked(BOOKING)).toBe("true");
    expect(checked(RECEIPT)).toBe("false");
  });
});

describe("D-283 repair round 1: a Retry refused after a load that showed data (SEC-NPR-2)", () => {
  it("NPR-09 guard: log rows shown, preferences failed, Retry refused: no switch, no row, no count", async () => {
    serve(queue(fail500, refused), queue(() => json(200, LOG), refused));
    await renderPage();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^log \(1\)$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^log\b/i }));
    await screen.findByText("Receipt RCPT-9");

    fireEvent.click(screen.getByRole("button", { name: /^preferences$/i }));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(document.querySelector('[data-state="no-access"]')).not.toBeNull());
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^log \(\d+\)$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^log$/i }));
    await waitFor(() => expect(document.querySelector('[data-state="no-access"]')).not.toBeNull());
    expect(screen.queryByText("Receipt RCPT-9")).toBeNull();
    expect(screen.queryAllByRole("row")).toHaveLength(0);
  });

  it("NPR-09b guard: switches shown, log failed, Retry refused: no switch, no row, no count", async () => {
    serve(queue(() => json(200, PREFS), refused), queue(fail500, refused));
    await renderPage();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));

    fireEvent.click(screen.getByRole("button", { name: /^log\b/i }));
    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));
    await waitFor(() => expect(document.querySelector('[data-state="no-access"]')).not.toBeNull());
    expect(screen.queryAllByRole("row")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /^log$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^preferences$/i }));
    await waitFor(() => expect(document.querySelector('[data-state="no-access"]')).not.toBeNull());
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });
});
