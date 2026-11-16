/**
 * SWP-CENSUS-HIDDEN review repair (COR-HID-1): the AR Clerk Queue on Money > Overview (/app/financial-flow).
 *
 * "Remind" sends the invoice reminder (POST .../invoices/:id/send-reminder, revenue write), then clears the queue
 * item (POST /flow-signals/businesses/:b/:id/resolve, revenue write for a money signal since the review repair).
 * The api client answers a refusal as { data: null, error, status } and does not throw, and the page ignored both
 * answers: a refused reminder still cleared the item, and a refused clear reloaded the queue with the item still
 * there and nothing said, so the member pressed "Remind" again and the customer got the same reminder twice.
 *
 *   AR-01  a refused reminder is said in the queue in the server's words; the item is not cleared
 *   AR-02  a reminder sent and a clear refused: the page says the reminder went out and the item could not be
 *          cleared, with why, so the member does not send it again
 *   AR-03  both answered: the item is cleared and the queue reloaded, nothing is said
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";

// The first case imports the whole page cold; the claim is about what the page says, not how fast it loads.
vi.setConfig({ testTimeout: 20_000 });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/financial-flow",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_ar_1" }));

const apiPostMock = vi.fn();
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async () => ({ data: null, error: null })),
  apiPost: (...args: unknown[]) => apiPostMock(...args),
}));
vi.mock("@/lib/api/finance", () => ({
  fetchReserveBuckets: vi.fn(async () => ({ data: { items: [] }, error: null })),
  createReserveBucket: vi.fn(),
  deleteReserveBucket: vi.fn(),
}));

const SIGNAL = {
  id: "sig_ar_1",
  businessId: "biz_ar_1",
  flows: ["FINANCIAL"],
  source: "SCHEDULER",
  type: "invoice.overdue",
  title: "Invoice INV-0042 is overdue",
  summary: "Customer owes 500.00",
  occurredAt: "2026-11-10T10:00:00.000Z",
  status: "ACTION_REQUIRED",
  importance: "HIGH",
  ownerRoleHint: "ACCOUNTS_RECEIVABLE_CLERK",
  payload: { invoiceId: "inv_42" },
};

const fetchRoleFlowQueueMock = vi.fn();
const resolveFlowSignalMock = vi.fn();
vi.mock("@/lib/api/flow-signal", () => ({
  fetchRoleFlowQueue: (...args: unknown[]) => fetchRoleFlowQueueMock(...args),
  resolveFlowSignal: (...args: unknown[]) => resolveFlowSignalMock(...args),
}));

const REVENUE_READ = "Insufficient permissions: revenue requires write access (you have read)";

beforeEach(() => {
  vi.clearAllMocks();
  fetchRoleFlowQueueMock.mockResolvedValue({ data: { items: [SIGNAL] }, error: null });
});
afterEach(() => cleanup());

async function pressRemind() {
  const { default: FinancialFlowPage } = await import("../page");
  render(<FinancialFlowPage />);
  await waitFor(() => expect(screen.getByText(SIGNAL.title)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Remind/ }));
}

describe("Financial Flow: AR Clerk Queue says a refusal (SWP-CENSUS-HIDDEN review COR-HID-1)", () => {
  it("AR-01 a refused reminder is said in the queue in the server's words, and the item is not cleared", async () => {
    apiPostMock.mockResolvedValue({ data: null, error: REVENUE_READ, status: 403 });
    await pressRemind();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/send invoice reminders/);
    expect(alert.textContent).toContain(REVENUE_READ);
    expect(apiPostMock).toHaveBeenCalledWith({ path: "/commerce/businesses/biz_ar_1/invoices/inv_42/send-reminder", body: {} });
    expect(resolveFlowSignalMock).not.toHaveBeenCalled();
  });

  it("AR-02 a reminder sent and a clear refused: the page says the reminder went out and why the item stays, so it is not sent twice", async () => {
    apiPostMock.mockResolvedValue({ data: { sent: true }, error: null });
    resolveFlowSignalMock.mockResolvedValue({ data: null, error: REVENUE_READ, status: 403 });
    await pressRemind();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/reminder was sent/i);
    expect(alert.textContent).toMatch(/could not be cleared/i);
    expect(alert.textContent).toContain(REVENUE_READ);
    expect(resolveFlowSignalMock).toHaveBeenCalledWith("biz_ar_1", SIGNAL.id);
  });

  it("AR-03 both answered: the item is cleared and the queue reloaded, and nothing is said", async () => {
    apiPostMock.mockResolvedValue({ data: { sent: true }, error: null });
    resolveFlowSignalMock.mockResolvedValue({ data: { ...SIGNAL, status: "RESOLVED" }, error: null });
    await pressRemind();
    await waitFor(() => expect(fetchRoleFlowQueueMock).toHaveBeenCalledTimes(2));
    expect(resolveFlowSignalMock).toHaveBeenCalledWith("biz_ar_1", SIGNAL.id);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
