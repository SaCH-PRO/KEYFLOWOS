/**
 * FU-NOTIFICATIONS-PAGE-REFUSED (D-283), repair round 1: a toggle and the Retry this packet adds, and a Retry refused.
 *
 * The server's PATCH answers the whole preferences (transactional-email.service.ts updatePreferences returns them), and
 * a GET of customer-preferences is the server's truth. A toggle's answer is put on the page from the server, never
 * guessed from what the page held when the switch was clicked, because a Retry may have reloaded it in between.
 *
 *   NPR-08b RED-BEFORE  (re-read count only) the reload reads the pre-click value, then the PATCH is refused: the switch shows the pre-click
 *                       value (the server's, re-read), not a flip of what the page holds
 *   NPR-08c RED-BEFORE  a refused PATCH: the page re-reads the preferences and the refused switch shows the server's
 *                       value. Round 3: only that switch is taken from the re-read (Payment Receipt, changed elsewhere,
 *                       is left for a load to show), the same rule as a PATCH answer: every other switch is decided by
 *                       its own answer or by a load, so no re-read can flip a switch another answer has decided
 *   NPR-08d RED-BEFORE  the PATCH succeeds after a Retry read the old value: the switch shows the PATCH's answer
 *   NPR-08e RED-BEFORE  the PATCH's write landed (a reload reads it) but its answer is lost (500), and the re-read fails:
 *                       a load has happened since the click, so nothing is reverted; the switch shows the reload's value
 *   NPR-08f RED-BEFORE  (re-read count only) no load since the click, the PATCH is refused and the re-read fails: the switch is put back
 *   NPR-08g RED-BEFORE  (mutant R4; round 2, SEC-NPR-5 / COR-NPR-5) Booking Confirmation's PATCH waits; Payment
 *                       Receipt's succeeds, and only its own switch is taken from its answer: Booking Confirmation stays
 *                       off, still saving (disabled), not flipped back on by an answer read before its own PATCH. Then
 *                       Booking Confirmation's PATCH is refused and the re-read fails: it goes back to its pre-click value
 *   NPR-08h RED-BEFORE  (round 2, SEC-NPR-6) a PATCH refused and its re-read refused by ModuleScopeGuard (access revoked
 *                       mid-session): the page says no access, no switch left on screen
 *   NPR-08i RED-BEFORE  (round 2) two PATCHes answered out of order: Payment Receipt commits first but its answer comes
 *                       last; the page ends as the server holds both switches
 *   NPR-08j RED-BEFORE  (round 2, the same race on the failure path) Booking Confirmation's PATCH waits; Payment
 *                       Receipt's is refused and only Payment Receipt is taken from its re-read (Booking still on at the
 *                       server, Invoice Sent changed elsewhere): Booking stays off, Invoice Sent as the page had it
 *   NPR-08k RED-BEFORE  (round 3 review) the same, but Booking Confirmation's PATCH succeeds while the re-read is in
 *                       flight (the re-read was read before Booking committed): Booking stays as its answer set it
 *   NPR-08m guard       (mutant T2) a switch clicked after the re-read was sent, still saving when it answers, keeps
 *                       its own value
 *   NPR-08n RED-BEFORE  (round 3 confirm review) a switch clicked after the re-read was sent and answered before it: the
 *                       older re-read does not overwrite its answer
 *   NPR-08o guard       (mutant U2) the write landed but its answer was lost (500), no load since the click: the re-read
 *                       (Booking Confirmation off at the server) decides the switch, not a revert to the pre-click value
 *   NPR-08l RED-BEFORE  (round 3 review) a re-read refused by ModuleScopeGuard also takes the log off the page: no row,
 *                       no "(n)" count, no access on the Log tab
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

type Answer = () => Response | Promise<Response>;

/** Answers in order; the last one repeats. */
function queue(...answers: Answer[]): Answer {
  let i = 0;
  return () => answers[Math.min(i++, answers.length - 1)]();
}

interface Server {
  prefsGets: () => number;
  /** Decides a waiting PATCH: the one whose body sets `key`, or the oldest. */
  answerPatch: (res: Response, key?: string) => void;
}

function serve(prefs: Answer, log: Answer): Server {
  let gets = 0;
  const pending: Array<{ keys: string[]; resolve: (res: Response) => void }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://web.origin.invalid");
    const method = (init?.method ?? "GET").toUpperCase();
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-preferences`)) {
      if (method === "PATCH") {
        const keys = Object.keys(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Promise<Response>((resolve) => { pending.push({ keys, resolve }); });
      }
      gets += 1;
      return prefs();
    }
    if (pathname.endsWith(`/notifications/businesses/${BIZ}/customer-log`)) return log();
    return json(404, { message: "Not Found" });
  }));
  return {
    prefsGets: () => gets,
    answerPatch: (res, key) => {
      const at = key === undefined ? 0 : pending.findIndex((p) => p.keys.includes(key));
      if (at < 0 || !pending[at]) throw new Error(`no PATCH is waiting${key ? ` for ${key}` : ""}`);
      const [next] = pending.splice(at, 1);
      next.resolve(res);
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
    expect(checked(RECEIPT)).toBe("false"); // only the refused switch is taken from the re-read
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

describe("D-283 repair round 1: two toggles", () => {
  it("NPR-08g RED-BEFORE: a refused toggle is put back to its pre-click value after another toggle's answer", async () => {
    const server = serve(queue(() => json(200, PREFS), fail500), () => json(200, LOG));
    await renderPage();
    await clickBookingOff();
    fireEvent.click(screen.getByRole("switch", { name: RECEIPT }));
    expect(checked(RECEIPT)).toBe("true");

    // Payment Receipt's PATCH goes through. Its answer was read before Booking Confirmation's PATCH was decided, so it
    // still says Booking Confirmation on; only Payment Receipt is taken from it. Booking Confirmation stays off and
    // saving (its switch disabled), and Payment Receipt is no longer saving.
    server.answerPatch(json(200, { ...PREFS, payment_receipt: true }), "payment_receipt");
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Notification preference updated"));
    expect(checked(BOOKING)).toBe("false");
    expect(checked(RECEIPT)).toBe("true");
    expect((screen.getByRole("switch", { name: BOOKING }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: RECEIPT }) as HTMLButtonElement).disabled).toBe(false);

    // Booking Confirmation's PATCH is refused, and the re-read fails; no load has run since the click.
    server.answerPatch(json(400, { statusCode: 400, message: "Bad request" }), "booking_confirmed");
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(server.prefsGets()).toBe(2);
    expect(checked(BOOKING)).toBe("true");
    expect(checked(RECEIPT)).toBe("true");
    expect((screen.getByRole("switch", { name: BOOKING }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("NPR-08i RED-BEFORE: two PATCH answers out of order: the page ends as the server holds both switches", async () => {
    const server = serve(() => json(200, PREFS), () => json(200, LOG));
    await renderPage();
    await clickBookingOff();
    fireEvent.click(screen.getByRole("switch", { name: RECEIPT }));

    // The server commits Payment Receipt, then Booking Confirmation. Booking's answer (both changes) arrives first;
    // Payment Receipt's (read before Booking's commit: Booking still on) arrives last.
    const serverNow = { ...PREFS, booking_confirmed: false, payment_receipt: true };
    server.answerPatch(json(200, serverNow), "booking_confirmed");
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledTimes(1));
    server.answerPatch(json(200, { ...PREFS, payment_receipt: true }), "payment_receipt");
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledTimes(2));
    expect(checked(BOOKING)).toBe(String(serverNow.booking_confirmed));
    expect(checked(RECEIPT)).toBe(String(serverNow.payment_receipt));
  });
});

describe("D-283 repair round 2: a re-read does not overwrite a switch still saving", () => {
  it("NPR-08j RED-BEFORE: a refused toggle's re-read leaves another pending switch as it is", async () => {
    const reread = { ...PREFS, invoice_sent: false };
    const server = serve(queue(() => json(200, PREFS), () => json(200, reread)), () => json(200, LOG));
    await renderPage();
    await clickBookingOff();
    fireEvent.click(screen.getByRole("switch", { name: RECEIPT }));

    server.answerPatch(json(400, { statusCode: 400, message: "Bad request" }), "payment_receipt");
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(server.prefsGets()).toBe(2);
    expect(checked(RECEIPT)).toBe("false");
    expect(checked(/toggle invoice sent/i)).toBe("true"); // not the refused switch: left for a load
    expect(checked(BOOKING)).toBe("false"); // still saving: its own answer decides it

    server.answerPatch(json(200, { ...PREFS, booking_confirmed: false, invoice_sent: false }), "booking_confirmed");
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Notification preference updated"));
    expect(checked(BOOKING)).toBe("false");
  });
});

describe("D-283 repair round 3: a re-read in flight while another switch's PATCH succeeds", () => {
  it("NPR-08k RED-BEFORE: a switch decided while the re-read was in flight keeps its own answer", async () => {
    let releaseReread!: () => void;
    const reread = () =>
      new Promise<Response>((resolve) => {
        // Read before Booking Confirmation's commit: the server still had it on.
        releaseReread = () => resolve(json(200, PREFS));
      });
    const server = serve(queue(() => json(200, PREFS), reread), () => json(200, LOG));
    await renderPage();
    await clickBookingOff();
    fireEvent.click(screen.getByRole("switch", { name: RECEIPT }));

    server.answerPatch(json(400, { statusCode: 400, message: "Bad request" }), "payment_receipt");
    await waitFor(() => expect(server.prefsGets()).toBe(2)); // the re-read is out, and held
    server.answerPatch(json(200, { ...PREFS, booking_confirmed: false, payment_receipt: false }), "booking_confirmed");
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Notification preference updated"));
    expect(checked(BOOKING)).toBe("false");

    releaseReread();
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(checked(BOOKING)).toBe("false");
    expect(checked(RECEIPT)).toBe("false");
  });
});

describe("D-283 repair round 3: a switch clicked while the re-read is in flight", () => {
  it("NPR-08m guard: a switch clicked after the re-read was sent, still saving when it answers, keeps its value", async () => {
    let releaseReread!: () => void;
    const reread = () =>
      new Promise<Response>((resolve) => {
        releaseReread = () => resolve(json(200, PREFS)); // Invoice Sent still on at the server
      });
    const server = serve(queue(() => json(200, PREFS), reread), () => json(200, LOG));
    await renderPage();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    fireEvent.click(screen.getByRole("switch", { name: RECEIPT }));

    server.answerPatch(json(400, { statusCode: 400, message: "Bad request" }), "payment_receipt");
    await waitFor(() => expect(server.prefsGets()).toBe(2)); // the re-read is out, and held
    fireEvent.click(screen.getByRole("switch", { name: /toggle invoice sent/i }));
    expect(checked(/toggle invoice sent/i)).toBe("false");

    releaseReread();
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(checked(RECEIPT)).toBe("false");
    expect(checked(/toggle invoice sent/i)).toBe("false"); // its own PATCH decides it
    expect((screen.getByRole("switch", { name: /toggle invoice sent/i }) as HTMLButtonElement).disabled).toBe(true);

    server.answerPatch(json(200, { ...PREFS, invoice_sent: false }), "invoice_sent");
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Notification preference updated"));
    expect(checked(/toggle invoice sent/i)).toBe("false");
  });
});

describe("D-283 repair round 3: a switch clicked and answered while the re-read is in flight", () => {
  it("NPR-08n RED-BEFORE: an older re-read does not overwrite a switch answered while it was in flight", async () => {
    let releaseReread!: () => void;
    const reread = () =>
      new Promise<Response>((resolve) => {
        releaseReread = () => resolve(json(200, PREFS)); // read before Invoice Sent's commit: still on
      });
    const server = serve(queue(() => json(200, PREFS), reread), () => json(200, LOG));
    await renderPage();
    await waitFor(() => expect(screen.getAllByRole("switch")).toHaveLength(6));
    fireEvent.click(screen.getByRole("switch", { name: RECEIPT }));

    server.answerPatch(json(400, { statusCode: 400, message: "Bad request" }), "payment_receipt");
    await waitFor(() => expect(server.prefsGets()).toBe(2)); // the re-read is out, and held
    fireEvent.click(screen.getByRole("switch", { name: /toggle invoice sent/i }));
    server.answerPatch(json(200, { ...PREFS, invoice_sent: false }), "invoice_sent");
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Notification preference updated"));
    expect(checked(/toggle invoice sent/i)).toBe("false");

    releaseReread();
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(checked(/toggle invoice sent/i)).toBe("false");
    expect(checked(RECEIPT)).toBe("false");
  });
});

describe("D-283 repair round 3: the re-read decides, not a revert", () => {
  it("NPR-08o guard: a lost answer to a write that landed: the re-read decides the switch", async () => {
    const server = serve(queue(() => json(200, PREFS), () => json(200, { ...PREFS, booking_confirmed: false })), () => json(200, LOG));
    await renderPage();
    await clickBookingOff();

    server.answerPatch(fail500());
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(server.prefsGets()).toBe(2);
    expect(checked(BOOKING)).toBe("false");
  });
});

describe("D-283 repair round 2: access revoked mid-session (SEC-NPR-6)", () => {
  it("NPR-08h RED-BEFORE: a PATCH refused and its re-read refused: no access, no switch on screen", async () => {
    const writeRefused = () =>
      json(403, { statusCode: 403, message: "Insufficient permissions: settings requires write access (you have none)", error: "Forbidden" });
    const server = serve(queue(() => json(200, PREFS), refused), () => json(200, LOG));
    await renderPage();
    await clickBookingOff();

    server.answerPatch(writeRefused());
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    expect(server.prefsGets()).toBe(2);
    await waitFor(() => expect(document.querySelector('[data-state="no-access"]')).not.toBeNull());
    expect(document.querySelector('[data-state="no-access"]')!.textContent).toContain(SETTINGS_REFUSAL);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("NPR-08l RED-BEFORE: a re-read refused also takes the log off the page", async () => {
    const server = serve(queue(() => json(200, PREFS), refused), () => json(200, LOG));
    await renderPage();
    expect(screen.getByRole("button", { name: /^log \(1\)$/i })).toBeTruthy();
    await clickBookingOff();

    server.answerPatch(json(403, { statusCode: 403, message: "Insufficient permissions: settings requires write access (you have none)" }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to update notification preference"));
    await waitFor(() => expect(document.querySelector('[data-state="no-access"]')).not.toBeNull());
    expect(screen.queryByRole("button", { name: /^log \(\d+\)$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^log$/i }));
    await waitFor(() => expect(document.querySelector('[data-state="no-access"]')).not.toBeNull());
    expect(screen.queryByText("Receipt RCPT-9")).toBeNull();
    expect(screen.queryAllByRole("row")).toHaveLength(0);
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
