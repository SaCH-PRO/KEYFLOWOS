/**
 * PR195-PORT (owner PR #195 part 3): the General Journal page at
 * /app/finance/journal (BooksJournalTab in UnifiedPageShell).
 *
 * The PR's version of this test asserted a journal currency picker (a foreign
 * currency posted at an exchange rate) and a per-line FinancialAccount picker
 * for chart rows several bank accounts share. The head rules otherwise and the
 * head wins: one currency per business, and a manual journal in another
 * currency is refused at the posting door (D-13, V1-37: a sourceless mismatch
 * is 400); the ledger keeps cash per chart row and FinancialAccount balances
 * are opening snapshots (V1-34), so the door takes no FinancialAccount. Kept,
 * on those rules:
 *
 *   J-01  amounts are in the business currency (a USD business reads USD, not
 *         the old literal TTD); there is no currency or financial-account
 *         picker, and the posted body carries neither
 *   J-02  a member the server refuses the journal read (403, revenue read,
 *         D-57) sees the refusal, not an empty journal, and no New Entry
 *   J-03  a 503 says the journal is unavailable, not that it is empty
 *   J-04  an unbalanced entry is refused before anything is sent
 *   J-05  /app/finance/journal is the journal page itself, no longer a
 *         redirect to the ledger
 *
 * PR195-JOURNAL-SCOPE (CR-P195-4): posting needs revenue write on the server.
 * The client has no cheap way to know the member's scopes before it posts (no
 * endpoint answers the caller's own module levels, and the team list needs
 * team read, which STAFF lacks), so the 403 itself is rendered as a refusal:
 *   J-06  a 403 on post is an alert naming the refusal, the form closes and
 *         New Entry goes; nothing says "posted"
 *   J-07  any other refusal (400) keeps the form and says why
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BooksJournalTab } from "../books-journal-tab";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/finance/journal",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: (...args: unknown[]) => redirectMock(...args),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  getStoredBusinessId: () => "biz_usd_1",
}));

const fetchJournalEntriesMock = vi.fn();
const createJournalEntryMock = vi.fn();
const fetchFinanceCoaMock = vi.fn();
const fetchFinanceSettingsMock = vi.fn();

vi.mock("@/lib/client", () => ({
  fetchJournalEntries: (...args: unknown[]) => fetchJournalEntriesMock(...args),
  createJournalEntry: (...args: unknown[]) => createJournalEntryMock(...args),
  fetchFinanceCoa: (...args: unknown[]) => fetchFinanceCoaMock(...args),
  fetchFinanceSettings: (...args: unknown[]) => fetchFinanceSettingsMock(...args),
}));

const PRIOR_ENTRY = {
  id: "je_1",
  date: "2026-09-01T00:00:00.000Z",
  description: "Prior USD adjustment",
  amount: 300,
  currency: "USD",
  status: "POSTED",
  createdAt: "2026-09-01T00:00:00.000Z",
  entries: [
    { id: "le_1", accountId: "coa_expense", account: { id: "coa_expense", name: "Payroll Expense", type: "EXPENSE" }, debit: 300, credit: 0 },
    { id: "le_2", accountId: "coa_bank", account: { id: "coa_bank", name: "Cash at Bank", type: "ASSET" }, debit: 0, credit: 300 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchFinanceSettingsMock.mockResolvedValue({ data: { currency: "USD" }, error: null });
  fetchFinanceCoaMock.mockResolvedValue({
    data: {
      items: [
        { id: "coa_expense", code: "6400", name: "Payroll Expense", type: "EXPENSE", isActive: true },
        { id: "coa_bank", code: "1010", name: "Cash at Bank", type: "ASSET", isActive: true },
      ],
    },
    error: null,
  });
  fetchJournalEntriesMock.mockResolvedValue({ data: { items: [PRIOR_ENTRY] }, error: null, status: 200 });
  createJournalEntryMock.mockResolvedValue({ data: { id: "je_2" }, error: null });
});

afterEach(() => {
  cleanup();
});

function fillBalancedEntry(debit = "500", credit = "500") {
  fireEvent.change(screen.getByPlaceholderText("e.g. Adjust prepaid insurance"), { target: { value: "Transfer payroll funding" } });
  fireEvent.change(screen.getByLabelText("Line 1 chart of account"), { target: { value: "coa_expense" } });
  fireEvent.change(screen.getByLabelText("Line 2 chart of account"), { target: { value: "coa_bank" } });
  const amounts = screen.getAllByPlaceholderText("0.00");
  fireEvent.change(amounts[0], { target: { value: debit } }); // line 1 debit
  fireEvent.change(amounts[3], { target: { value: credit } }); // line 2 credit
}

describe("General Journal (PR195-PORT)", () => {
  it("J-01 posts in the business currency with no currency or financial-account picker", async () => {
    render(<BooksJournalTab />);
    await waitFor(() => expect(screen.getByText("Prior USD adjustment")).toBeTruthy());

    fireEvent.click(screen.getByText("New Entry"));
    expect(screen.queryByLabelText("Journal currency")).toBeNull();
    expect(screen.queryByLabelText(/financial account/i)).toBeNull();
    expect(screen.getByText(/Amounts in USD/)).toBeTruthy();

    fillBalancedEntry();
    expect(screen.getByText(/Debits:.*500\.00/).textContent).toMatch(/USD|\$/);
    expect(screen.getByText(/Debits:.*500\.00/).textContent).not.toMatch(/TT\$|TTD/);

    fireEvent.click(screen.getByText("Post Entry"));
    await waitFor(() => expect(createJournalEntryMock).toHaveBeenCalledTimes(1));
    const [businessId, body] = createJournalEntryMock.mock.calls[0];
    expect(businessId).toBe("biz_usd_1");
    expect(body).toMatchObject({
      description: "Transfer payroll funding",
      entries: [
        { accountId: "coa_expense", debit: 500, credit: 0 },
        { accountId: "coa_bank", debit: 0, credit: 500 },
      ],
    });
    expect(body).not.toHaveProperty("currency");
    for (const line of body.entries) expect(line).not.toHaveProperty("financialAccountId");
  });

  it("J-02 a refused journal read shows the refusal, not an empty journal, and offers no New Entry", async () => {
    fetchJournalEntriesMock.mockResolvedValue({
      data: null,
      error: "Insufficient permissions: revenue requires read access (you have none)",
      status: 403,
    });
    render(<BooksJournalTab />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/revenue requires read access/);
    expect(screen.getByRole("alert").textContent).toMatch(/You don.t have access to the journal/);
    expect(screen.queryByText("No journal entries yet")).toBeNull();
    expect(screen.queryByText("New Entry")).toBeNull();
  });

  it("J-03 a 503 says the journal is unavailable, not empty", async () => {
    fetchJournalEntriesMock.mockResolvedValue({ data: null, error: "Service unavailable", status: 503 });
    render(<BooksJournalTab />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/unavailable/i);
    expect(screen.queryByText("No journal entries yet")).toBeNull();
  });

  it("J-04 an unbalanced entry is refused before anything is sent", async () => {
    render(<BooksJournalTab />);
    await waitFor(() => expect(screen.getByText("Prior USD adjustment")).toBeTruthy());
    fireEvent.click(screen.getByText("New Entry"));
    fillBalancedEntry("500", "450");
    fireEvent.click(screen.getByText("Post Entry"));
    expect(createJournalEntryMock).not.toHaveBeenCalled();
  });

  it("J-06 PR195-JOURNAL-SCOPE (CR-P195-4): a post the server refuses 403 (revenue write) renders a clear refusal, closes the form and offers no New Entry", async () => {
    createJournalEntryMock.mockResolvedValue({
      data: null,
      error: "Insufficient permissions: revenue requires write access (you have read)",
      status: 403,
    });
    render(<BooksJournalTab />);
    await waitFor(() => expect(screen.getByText("Prior USD adjustment")).toBeTruthy());
    fireEvent.click(screen.getByText("New Entry"));
    fillBalancedEntry();
    fireEvent.click(screen.getByText("Post Entry"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toMatch(/can.t post journal entries in this business/i);
    expect(alert).toMatch(/revenue requires write access/);
    // Not a silent failure, and not a success: the form is gone, New Entry with it, and nothing says "posted".
    expect(screen.queryByText("Post Entry")).toBeNull();
    expect(screen.queryByText("New Entry")).toBeNull();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    // The member may still read the journal they may not write.
    expect(screen.getByText("Prior USD adjustment")).toBeTruthy();
  });

  it("J-07 a post refused for another reason (400) keeps the form and says why", async () => {
    createJournalEntryMock.mockResolvedValue({ data: null, error: "Journal entry requires at least 2 lines", status: 400 });
    render(<BooksJournalTab />);
    await waitFor(() => expect(screen.getByText("Prior USD adjustment")).toBeTruthy());
    fireEvent.click(screen.getByText("New Entry"));
    fillBalancedEntry();
    fireEvent.click(screen.getByText("Post Entry"));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Journal entry requires at least 2 lines"));
    expect(screen.getByText("Post Entry")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("J-05 /app/finance/journal is the General Journal page, not a redirect", async () => {
    const { default: JournalPage } = await import("../../journal/page");
    render(<JournalPage />);
    expect(redirectMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Prior USD adjustment")).toBeTruthy());
    expect(screen.getAllByText("General Journal").length).toBeGreaterThan(0);
  });
});
