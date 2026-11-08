import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BooksJournalTab, hasConfiguredExchangeRate } from "../books-journal-tab";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  }),
}));

vi.mock("@/lib/workspace", () => ({
  getStoredBusinessId: () => "biz_usd_1",
}));

const fetchJournalEntriesMock = vi.fn();
const createJournalEntryMock = vi.fn();
const fetchFinanceCoaMock = vi.fn();
const fetchFinanceAccountsMock = vi.fn();
const fetchFinanceSettingsMock = vi.fn();
const fetchExchangeRatesMock = vi.fn();

vi.mock("@/lib/client", () => ({
  fetchJournalEntries: (...args: unknown[]) => fetchJournalEntriesMock(...args),
  createJournalEntry: (...args: unknown[]) => createJournalEntryMock(...args),
  fetchFinanceCoa: (...args: unknown[]) => fetchFinanceCoaMock(...args),
  fetchFinanceAccounts: (...args: unknown[]) => fetchFinanceAccountsMock(...args),
  fetchFinanceSettings: (...args: unknown[]) => fetchFinanceSettingsMock(...args),
  fetchExchangeRates: (...args: unknown[]) => fetchExchangeRatesMock(...args),
}));

describe("BooksJournalTab — multi-bank COA attribution and non-TTD currency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchFinanceSettingsMock.mockResolvedValue({
      data: { currency: "USD" },
      error: null,
    });
    fetchExchangeRatesMock.mockResolvedValue({
      data: {
        items: [
          {
            id: "fx_eur_usd",
            fromCurrency: "EUR",
            toCurrency: "USD",
            rate: 1.1,
            date: "2026-09-01",
            source: "manual",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
      error: null,
    });
    fetchFinanceCoaMock.mockResolvedValue({
      data: {
        items: [
          { id: "coa_expense", code: "5100", name: "Payroll Expense", type: "EXPENSE", isActive: true },
          { id: "coa_bank", code: "1010", name: "Cash at Bank", type: "ASSET", isActive: true },
        ],
      },
      error: null,
    });
    fetchFinanceAccountsMock.mockResolvedValue({
      data: {
        items: [
          {
            id: "fa_bank_1",
            name: "Mercury Operating Checking",
            type: "BANK",
            currency: "USD",
            openingBalance: 40000,
            currentBalance: 40000,
            isDefault: true,
            isActive: true,
            chartOfAccountId: "coa_bank",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "fa_bank_2",
            name: "Chase Reserve Checking",
            type: "BANK",
            currency: "USD",
            openingBalance: 15000,
            currentBalance: 15000,
            isDefault: false,
            isActive: true,
            chartOfAccountId: "coa_bank",
            createdAt: "2026-01-02T00:00:00.000Z",
          },
        ],
      },
      error: null,
    });
    fetchJournalEntriesMock.mockResolvedValue({
      data: {
        items: [
          {
            id: "je_1",
            date: "2026-09-01T00:00:00.000Z",
            description: "Prior USD adjustment",
            amount: 300,
            currency: "",
            status: "POSTED",
            createdAt: "2026-09-01T00:00:00.000Z",
            entries: [
              {
                id: "le_1",
                accountId: "coa_expense",
                account: { id: "coa_expense", name: "Payroll Expense", type: "EXPENSE" },
                debit: 300,
                credit: 0,
              },
              {
                id: "le_2",
                accountId: "coa_bank",
                account: { id: "coa_bank", name: "Cash at Bank", type: "ASSET" },
                debit: 0,
                credit: 300,
              },
            ],
          },
        ],
      },
      error: null,
    });
    createJournalEntryMock.mockResolvedValue({
      data: { id: "je_2" },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("requires explicit FinancialAccount selection when multiple bank accounts share a COA and respects non-TTD business currency", async () => {
    render(<BooksJournalTab />);

    await waitFor(() => {
      expect(screen.getByText("Prior USD adjustment")).toBeTruthy();
    });

    // Open New Entry form
    fireEvent.click(screen.getByText("New Entry"));

    const currencySelect = screen.getByLabelText("Journal currency") as HTMLSelectElement;
    expect(currencySelect.value).toBe("USD");
    expect(Array.from(currencySelect.options).map((o) => o.value)).toEqual(["USD", "EUR"]);

    fireEvent.change(screen.getByPlaceholderText("e.g. Adjust prepaid insurance"), {
      target: { value: "Transfer payroll funding" },
    });

    const line1Coa = screen.getByLabelText("Line 1 chart of account");
    const line2Coa = screen.getByLabelText("Line 2 chart of account");
    fireEvent.change(line1Coa, { target: { value: "coa_expense" } });
    fireEvent.change(line2Coa, { target: { value: "coa_bank" } });

    const amountInputs = screen.getAllByPlaceholderText("0.00");
    fireEvent.change(amountInputs[0], { target: { value: "500" } }); // Line 1 debit
    fireEvent.change(amountInputs[3], { target: { value: "500" } }); // Line 2 credit

    // Line 2 maps to coa_bank, which has 2 active financial accounts -> disambiguation select must render
    const line2FaSelect = screen.getByLabelText("Line 2 financial account") as HTMLSelectElement;
    expect(line2FaSelect.value).toBe("");

    // Attempting to post without selecting a financial account must fail closed
    fireEvent.click(screen.getByText("Post Entry"));
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Select the specific financial account for shared cash/bank ledger accounts",
    );
    expect(createJournalEntryMock).not.toHaveBeenCalled();

    // Select the second bank account and post in EUR (configured foreign currency)
    fireEvent.change(line2FaSelect, { target: { value: "fa_bank_2" } });
    fireEvent.change(currencySelect, { target: { value: "EUR" } });
    fireEvent.click(screen.getByText("Post Entry"));

    await waitFor(() => {
      expect(createJournalEntryMock).toHaveBeenCalledTimes(1);
    });
    expect(createJournalEntryMock).toHaveBeenCalledWith(
      "biz_usd_1",
      expect.objectContaining({
        description: "Transfer payroll funding",
        currency: "EUR",
        entries: [
          expect.objectContaining({
            accountId: "coa_expense",
            debit: 500,
            credit: 0,
          }),
          expect.objectContaining({
            accountId: "coa_bank",
            financialAccountId: "fa_bank_2",
            debit: 0,
            credit: 500,
          }),
        ],
      }),
    );
  });

  it("validates foreign-currency availability against configured exchange rates", () => {
    const rates = [
      {
        id: "r1",
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: 1.1,
        date: "2026-09-01",
        source: "manual",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    expect(hasConfiguredExchangeRate("USD", "USD", rates)).toBe(true);
    expect(hasConfiguredExchangeRate("EUR", "USD", rates)).toBe(true);
    expect(hasConfiguredExchangeRate("USD", "EUR", rates)).toBe(true);
    expect(hasConfiguredExchangeRate("GBP", "USD", rates)).toBe(false);
  });
});
