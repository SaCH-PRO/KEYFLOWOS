/**
 * V1-15b repair2, review LC-2 — the accounting periods screen shows the
 * server's refusal of a close, a reopen or a new period.
 *
 * WHY this test exists: V1-15 made the period routes refuse what they used to
 * accept: closing a month that has not ended is 400 ("Accounting period
 * 2026-11 has not ended: ..."), and closing or reopening is OWNER / ADMIN only
 * (403 for STAFF). This screen is the only web caller of those routes, and the
 * Add Period form defaults to the current month, so the first close a user
 * tries is usually refused. apiPost never throws on an HTTP error: it returns
 * { data: null, error }. The handlers only reacted to `res.data`, so every
 * refusal was silent: no error, no success, nothing. Each refusal must be
 * shown with the server's message, and must not report a success.
 *
 * Mounted on the real AccountingPeriodsPage and the real api client
 * (lib/api.ts); only `fetch`, the toast, window.confirm and next/navigation are
 * stubbed, so the error shape under test is the one apiPost really produces
 * from the production GlobalHttpExceptionFilter body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import AccountingPeriodsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/finance/accounting-periods",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const BUSINESS = "biz_periods";
const NOT_ENDED = "Accounting period 2026-11 has not ended: a period can be closed only after its last day.";
const NOT_ADMIN_CLOSE = "Only the business owner or an admin can close an accounting period.";
const NOT_ADMIN_REOPEN = "Only the business owner or an admin can reopen an accounting period.";
const EXISTS = "Accounting period already exists";

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

/** The production filter's body for a refusal (http-exception.filter.ts). */
function refusal(status: 400 | 403, message: string, path: string) {
  return jsonResponse(status, {
    statusCode: status, message, error: status === 400 ? "Bad Request" : "Forbidden",
    timestamp: "2026-11-02T00:00:00.000Z", path,
  }, status === 400 ? "Bad Request" : "Forbidden");
}

const OPEN = { id: "p_open", year: 2026, month: 11, startDate: "2026-11-01T00:00:00.000Z", endDate: "2026-11-30T23:59:59.999Z", status: "OPEN" };
const CLOSED = { id: "p_closed", year: 2026, month: 9, startDate: "2026-09-01T00:00:00.000Z", endDate: "2026-09-30T23:59:59.999Z", status: "CLOSED" };

/** Answers the period list, and every POST with `onPost(pathname)`. Returns the POSTed paths. */
function stubServer(onPost: (pathname: string) => Response) {
  const posted: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if ((init?.method ?? "GET") === "POST") {
      posted.push(pathname);
      return onPost(pathname);
    }
    if (pathname.endsWith(`/finance/businesses/${BUSINESS}/accounting-periods`)) return jsonResponse(200, { items: [OPEN, CLOSED] });
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  }));
  return { posted };
}

async function mountWithRows() {
  render(<AccountingPeriodsPage />);
  await screen.findByTitle("Close period");
}

beforeEach(() => {
  window.localStorage.setItem("kf_business_id", BUSINESS);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("accounting periods: a refused close, reopen or create is shown, never silent", () => {
  it("LC2-01: closing a month that has not ended (400) shows the server's reason and no success", async () => {
    const { posted } = stubServer((p) => refusal(400, NOT_ENDED, p));
    await mountWithRows();
    fireEvent.click(screen.getByTitle("Close period"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOT_ENDED));
    expect(posted).toEqual([`/finance/businesses/${BUSINESS}/accounting-periods/${OPEN.id}/close`]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("LC2-02: a STAFF close (403) shows who can close", async () => {
    stubServer((p) => refusal(403, NOT_ADMIN_CLOSE, p));
    await mountWithRows();
    fireEvent.click(screen.getByTitle("Close period"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOT_ADMIN_CLOSE));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("LC2-03: a STAFF reopen (403) shows who can reopen", async () => {
    const { posted } = stubServer((p) => refusal(403, NOT_ADMIN_REOPEN, p));
    await mountWithRows();
    fireEvent.click(screen.getByTitle("Reopen period"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOT_ADMIN_REOPEN));
    expect(posted).toEqual([`/finance/businesses/${BUSINESS}/accounting-periods/${CLOSED.id}/reopen`]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("LC2-04: a refused new period (400) shows the reason, and the form stays open", async () => {
    stubServer((p) => refusal(400, EXISTS, p));
    await mountWithRows();
    fireEvent.click(screen.getByText("Add Period"));
    fireEvent.click(await screen.findByText("Create Period"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(EXISTS));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Create Period")).toBeInTheDocument();
  });

  it("LC2-05: an accepted close still reports success and reloads", async () => {
    const { posted } = stubServer(() => jsonResponse(201, { ...OPEN, status: "CLOSED" }));
    await mountWithRows();
    fireEvent.click(screen.getByTitle("Close period"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Period closed"));
    expect(posted).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
