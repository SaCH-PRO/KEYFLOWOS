/**
 * SWP-SERVICE-DEPOSIT, the web half, repair round 1: the deposit Setup shows is the deposit the customer is billed.
 *
 * WHY this test exists: both acceptance reviews (SEC-2, M-2) found that the Setup card and the editor's preview
 * computed a PERCENT deposit as (price x percent) / 100 in floating point and let toLocaleString round it, while the
 * server bills CommerceService.computeServiceDeposit, which takes percentOf (apps/server/src/modules/commerce/money.ts):
 * the exact decimal, rounded once to cents, half away from zero. 4.10 at 15% is 0.615: the page showed 0.61, the
 * customer is billed 0.62. SEC-3 found that a FIXED deposit with a fraction of a cent (10.005) was accepted and then
 * shown rounded, so the page and the stored value disagreed.
 *
 *   MONEY-01  each listed case is shown on the card and in the preview as the server bills it (the server's own
 *             percentOf is imported and asked, and the literal cents are pinned)
 *   MONEY-02  sweep: every price from 0.01 to 200.00 at 7.5, 10, 12.5, 15, 25, 33 and 75% equals an independent
 *             integer re-implementation of the server's rule, and the server's percentOf itself
 *   MONEY-03  a FIXED deposit is shown as the server bills it: at most the price (computeServiceDeposit's min)
 *   CENTS-01  a FIXED deposit with more than two decimals is refused before anything is sent, with a clear message
 *   CENTS-02  control: whole cents (10, 10.5, 10.50, 0.01) are accepted
 *
 * Mounted on the real CatalogCapacityTab; the write is stubbed at the api module, the toast is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ComponentType } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { percentOf as serverPercentOf } from "../../../../../../../server/src/modules/commerce/money";

const api = vi.hoisted(() => ({ apiPatch: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiPatch: api.apiPatch };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import * as tabModule from "../catalog-capacity-tab";
import type { Service } from "@/lib/client";

const CatalogCapacityTab = tabModule.default;

function svc(over: Partial<Service> = {}): Service {
  return {
    id: "svc_1",
    name: "Gel manicure",
    duration: 60,
    price: 120,
    depositRequired: false,
    depositType: null,
    depositValue: null,
    ...over,
  };
}

function renderTab(services: Service[]) {
  const props = {
    services,
    staff: [],
    bookings: [],
    staffForm: { name: "", email: "" },
    setStaffForm: () => {},
    onCreateStaff: () => {},
    onDeleteStaff: () => {},
    calendarConnected: false,
    calendarEmail: null,
    loading: false,
    businessId: "biz_money_1",
    businessHoursSet: false,
    currency: "USD",
    focusServiceId: null,
    onServiceUpdated: vi.fn(),
    onFocusServiceHandled: vi.fn(),
  };
  const Tab = CatalogCapacityTab as unknown as ComponentType<typeof props>;
  return render(<Tab {...props} />);
}

const depositButton = (name = "Gel manicure") => screen.getByRole("button", { name: `Deposit for ${name}` });

function openEditor(name = "Gel manicure") {
  fireEvent.click(depositButton(name));
  return screen.getByRole("group", { name: `Deposit settings for ${name}` });
}

/**
 * The server's rule re-implemented independently, in integer arithmetic: `rate` percent of `priceCents`, rounded to
 * cents half away from zero (prices here are positive). The rate is read as the decimal it is written as.
 */
function referenceDepositCents(priceCents: number, rate: number): number {
  const text = String(rate);
  const dot = text.indexOf(".");
  const num = Number(dot < 0 ? text : text.slice(0, dot) + text.slice(dot + 1));
  const den = dot < 0 ? 1 : 10 ** (text.length - dot - 1);
  const n = priceCents * num;
  const d = 100 * den;
  const q = Math.floor(n / d);
  const r = n - q * d;
  return 2 * r >= d ? q + 1 : q;
}

describe("Bookings > Setup: the deposit shown is the deposit billed (SWP-SERVICE-DEPOSIT repair round 1)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it.each([
    // price, percent, what the server bills
    [4.1, 15, "0.62"],
    [33.3, 15, "5.00"],
    [8.2, 7.5, "0.62"],
    [0.82, 75, "0.62"],
    [2.05, 30, "0.62"],
  ])("MONEY-01 %s at %s%% is shown as the server bills it (USD %s)", (price, percent, billed) => {
    // The server's own function agrees with the literal cents pinned here.
    expect(serverPercentOf(price, percent).toFixed(2)).toBe(billed);

    renderTab([svc({ price, depositRequired: true, depositType: "PERCENT", depositValue: percent })]);
    expect(depositButton()).toHaveTextContent(`Deposit ${percent}% · USD ${billed}`);

    const editor = openEditor();
    expect(within(editor).getByLabelText("Deposit percent")).toHaveValue(percent);
    expect(within(editor).getByTestId("deposit-preview")).toHaveTextContent(
      `Customers pay USD ${billed} of USD ${price.toFixed(2)} when they book.`,
    );

    // Typed afresh, the preview says the same.
    fireEvent.change(within(editor).getByLabelText("Deposit percent"), { target: { value: "" } });
    fireEvent.change(within(editor).getByLabelText("Deposit percent"), { target: { value: String(percent) } });
    expect(within(editor).getByTestId("deposit-preview")).toHaveTextContent(`Customers pay USD ${billed} of`);
  });

  it("MONEY-02 sweep: 0.01 to 200.00 at 7.5, 10, 12.5, 15, 25, 33 and 75% equals the server's rule", () => {
    const depositAmount = (tabModule as Record<string, unknown>).depositAmount as
      | ((price: number, type: "PERCENT" | "FIXED", value: number) => number)
      | undefined;
    expect(typeof depositAmount, "catalog-capacity-tab exports depositAmount, the amount every view of it shows").toBe("function");

    const rates = [7.5, 10, 12.5, 15, 25, 33, 75];
    const mismatches: string[] = [];
    let checked = 0;
    for (let cents = 1; cents <= 20_000; cents += 1) {
      const price = cents / 100;
      for (const rate of rates) {
        const expected = referenceDepositCents(cents, rate) / 100;
        const server = serverPercentOf(price, rate);
        const shown = depositAmount!(price, "PERCENT", rate);
        checked += 1;
        if (server !== expected) mismatches.push(`reference disagrees with the server: ${price} at ${rate}%: ${expected} vs ${server}`);
        if (shown !== expected && mismatches.length < 20) mismatches.push(`${price} at ${rate}%: shown ${shown}, billed ${expected}`);
      }
    }
    expect(checked).toBe(140_000);
    expect(mismatches).toEqual([]);
  });

  it("MONEY-03 a FIXED deposit is shown as the server bills it, at most the price", () => {
    renderTab([
      svc({ depositRequired: true, depositType: "FIXED", depositValue: 30 }),
      // Stored at 100 when the price was 120; the price was lowered to 80 since. computeServiceDeposit bills min(100, 80).
      svc({ id: "svc_2", name: "Pedicure", price: 80, depositRequired: true, depositType: "FIXED", depositValue: 100 }),
    ]);
    expect(depositButton()).toHaveTextContent("Deposit USD 30.00");
    expect(depositButton("Pedicure")).toHaveTextContent("Deposit USD 80.00");
  });

  it.each(["10.005", "0.001", "119.999", "1e-3"])(
    "CENTS-01 a FIXED deposit of %s (more than two decimals) is refused before anything is sent",
    (value) => {
      renderTab([svc()]);
      const editor = openEditor();
      fireEvent.click(within(editor).getByLabelText("Require a deposit"));
      fireEvent.change(within(editor).getByLabelText("Deposit type"), { target: { value: "FIXED" } });
      fireEvent.change(within(editor).getByLabelText("Deposit amount (USD)"), { target: { value } });

      expect(within(editor).getByTestId("deposit-problem")).toHaveTextContent(
        "A fixed deposit can have at most two decimal places (whole cents).",
      );
      expect(within(editor).queryByTestId("deposit-preview")).not.toBeInTheDocument();
      const save = within(editor).getByRole("button", { name: "Save deposit" });
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(api.apiPatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["10", "USD 10.00"],
    ["10.5", "USD 10.50"],
    ["10.50", "USD 10.50"],
    ["0.01", "USD 0.01"],
  ])("CENTS-02 control: a FIXED deposit of %s is accepted and previewed as %s", (value, shown) => {
    renderTab([svc()]);
    const editor = openEditor();
    fireEvent.click(within(editor).getByLabelText("Require a deposit"));
    fireEvent.change(within(editor).getByLabelText("Deposit type"), { target: { value: "FIXED" } });
    fireEvent.change(within(editor).getByLabelText("Deposit amount (USD)"), { target: { value } });

    expect(within(editor).queryByTestId("deposit-problem")).not.toBeInTheDocument();
    expect(within(editor).getByTestId("deposit-preview")).toHaveTextContent(`Customers pay ${shown} of USD 120.00`);
    expect(within(editor).getByRole("button", { name: "Save deposit" })).toBeEnabled();
  });
});
