/**
 * PR195-JOURNAL-SCOPE (CR-P195-4): the recurring journal templates are manual
 * journals too (Run posts one at once, the scheduler posts the rest), so their
 * writes now need revenue write on the server, as POST journal-entries does.
 * The page read none of its write answers: a refused Run said "Journal entry
 * executed", a refused Delete removed the row from the screen, a refused
 * toggle and a refused create said nothing. A refusal is now said, and nothing
 * claims success:
 *
 *   RJ-01  a 403 on Run is an error naming the refusal; no "executed"
 *   RJ-02  a 403 on Delete keeps the row and says why; no "deleted"
 *   RJ-03  a 403 on Deactivate keeps the row as it was and says why
 *   RJ-04  CONTROL: an allowed Run still says "executed"
 *
 * PR195-BOOKS-DOORS:
 *   RJ-05  (CRR-P195JS-2) a 403 that is not ModuleScopeGuard's revenue refusal
 *          (BusinessGuard's "Unable to verify business access") is said in the
 *          server's words, not as "needs revenue write access"
 *   RJ-06  (SEC-P195JS-2) the template list now needs revenue read: a refused
 *          read is a refusal naming it, not an empty list, and offers no Add
 *          Entry; a 5xx says the list could not be loaded
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/finance/recurring-journals",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  getStoredBusinessId: () => "biz_1",
}));

const fetchRecurringJournalsMock = vi.fn();
const updateRecurringJournalMock = vi.fn();
const deleteRecurringJournalMock = vi.fn();
const runRecurringJournalMock = vi.fn();
const createRecurringJournalMock = vi.fn();

vi.mock("@/lib/api/finance", () => ({
  fetchRecurringJournals: (...args: unknown[]) => fetchRecurringJournalsMock(...args),
  createRecurringJournal: (...args: unknown[]) => createRecurringJournalMock(...args),
  updateRecurringJournal: (...args: unknown[]) => updateRecurringJournalMock(...args),
  deleteRecurringJournal: (...args: unknown[]) => deleteRecurringJournalMock(...args),
  runRecurringJournal: (...args: unknown[]) => runRecurringJournalMock(...args),
  fetchChartOfAccounts: async () => ({ data: { items: [] }, error: null }),
}));

vi.mock("@/lib/client", () => ({
  fetchFinanceSettings: async () => ({ data: { currency: "TTD" }, error: null }),
}));

const REFUSAL = "Insufficient permissions: revenue requires write access (you have read)";

const TEMPLATE = {
  id: "rje_1",
  businessId: "biz_1",
  name: "Monthly depreciation",
  description: null,
  frequency: "MONTHLY",
  nextRunDate: "2026-12-01T00:00:00.000Z",
  endDate: null,
  isActive: true,
  entries: [],
  runCount: 2,
  failureCount: 0,
  lastError: null,
  lastRunDate: null,
  cancelledAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const refused = { data: null, error: REFUSAL, status: 403 };

beforeEach(() => {
  vi.clearAllMocks();
  fetchRecurringJournalsMock.mockResolvedValue({ data: { items: [TEMPLATE] }, error: null });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderPage() {
  const { default: RecurringJournalsPage } = await import("../page");
  render(<RecurringJournalsPage />);
  await waitFor(() => expect(screen.getByText("Monthly depreciation")).toBeTruthy());
}

describe("Recurring Journals: a refused write is said, never shown as done (PR195-JOURNAL-SCOPE)", () => {
  it("RJ-01 a 403 on Run is an error naming the refusal, and nothing says executed", async () => {
    runRecurringJournalMock.mockResolvedValue(refused);
    await renderPage();
    fireEvent.click(screen.getByTitle("Run now"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(String(toastErrorMock.mock.calls[0][0])).toMatch(/revenue requires write access/);
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("RJ-02 a 403 on Delete keeps the row and says why; nothing says deleted", async () => {
    deleteRecurringJournalMock.mockResolvedValue(refused);
    await renderPage();
    fireEvent.click(screen.getByTitle("Delete"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(String(toastErrorMock.mock.calls[0][0])).toMatch(/revenue requires write access/);
    expect(screen.getByText("Monthly depreciation")).toBeTruthy();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("RJ-03 a 403 on Deactivate keeps the row active and says why", async () => {
    updateRecurringJournalMock.mockResolvedValue(refused);
    await renderPage();
    fireEvent.click(screen.getByTitle("Deactivate"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(String(toastErrorMock.mock.calls[0][0])).toMatch(/revenue requires write access/);
    expect(screen.getByTitle("Deactivate")).toBeTruthy();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("RJ-04 CONTROL: an allowed Run still says executed", async () => {
    runRecurringJournalMock.mockResolvedValue({ data: { transactionId: "tx_1", nextRunDate: "2027-01-01T00:00:00.000Z" }, error: null });
    await renderPage();
    fireEvent.click(screen.getByTitle("Run now"));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("Journal entry executed"));
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});

describe("Recurring Journals: refusals are said in the server's words (PR195-BOOKS-DOORS)", () => {
  it("RJ-05 (CRR-P195JS-2) a 403 that is not the revenue refusal is said in the server's words, not as needing revenue write", async () => {
    runRecurringJournalMock.mockResolvedValue({ data: null, error: "Unable to verify business access", status: 403 });
    await renderPage();
    fireEvent.click(screen.getByTitle("Run now"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    const said = String(toastErrorMock.mock.calls[0][0]);
    expect(said).toContain("Unable to verify business access");
    expect(said).not.toMatch(/needs revenue write/);
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("RJ-06 (SEC-P195JS-2) a refused template read is a refusal naming revenue read, not an empty list, and offers no Add Entry", async () => {
    fetchRecurringJournalsMock.mockResolvedValue({
      data: null,
      error: "Insufficient permissions: revenue requires read access (you have none)",
      status: 403,
    });
    const { default: RecurringJournalsPage } = await import("../page");
    render(<RecurringJournalsPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toMatch(/revenue requires read access/);
    expect(alert).toMatch(/You don.t have access to recurring journals/);
    expect(screen.queryByText("Monthly depreciation")).toBeNull();
    expect(screen.queryByText(/No recurring journal entries/i)).toBeNull();
    expect(screen.queryByText("Add Entry")).toBeNull();
  });

  it("RJ-06 a template list that fails for another reason (503) says it could not be loaded, not that there are none", async () => {
    fetchRecurringJournalsMock.mockResolvedValue({ data: null, error: "Service unavailable", status: 503 });
    const { default: RecurringJournalsPage } = await import("../page");
    render(<RecurringJournalsPage />);
    await waitFor(() => expect(screen.getByText(/Service unavailable/)).toBeTruthy());
    expect(screen.queryByText(/No recurring journal entries/i)).toBeNull();
  });
});
