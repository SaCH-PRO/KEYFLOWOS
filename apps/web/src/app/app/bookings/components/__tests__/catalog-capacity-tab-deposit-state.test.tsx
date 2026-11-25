/**
 * SWP-SERVICE-DEPOSIT, the web half, repair round 1: the deposit editor's state rules, pinned (M-3).
 *
 * WHY this test exists: the acceptance reviews found three rules of the deposit editor that no test held, so a mutant
 * removing each survived the suite:
 *   STATE-01  each opening starts from what is stored: Cancel, then reopen, shows the stored deposit, not what was typed
 *   STATE-02  a newer read of the service (the page reloaded its list) is what the card and the editor show
 *   STATE-03  a stored depositType other than PERCENT or FIXED (the column is free text) is not read as a deposit type:
 *             the card says "Deposit not set" and the editor offers PERCENT
 * (The page's merge of a saved service is pinned in bookings/__tests__/bookings-deposit-save-merge.test.tsx.)
 *
 * Mounted on the real CatalogCapacityTab; the write is stubbed at the api module, the toast is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ComponentType } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

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

import CatalogCapacityTab from "../catalog-capacity-tab";
import type { Service } from "@/lib/client";

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

function propsFor(services: Service[]) {
  return {
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
    businessId: "biz_state_1",
    businessHoursSet: false,
    currency: "USD",
    focusServiceId: null,
    onServiceUpdated: () => {},
    onFocusServiceHandled: () => {},
  };
}

const Tab = CatalogCapacityTab as unknown as ComponentType<ReturnType<typeof propsFor>>;

const depositButton = () => screen.getByRole("button", { name: "Deposit for Gel manicure" });
const editor = () => screen.getByRole("group", { name: "Deposit settings for Gel manicure" });

function openEditor() {
  fireEvent.click(depositButton());
  return editor();
}

describe("Bookings > Setup: the deposit editor's state rules (SWP-SERVICE-DEPOSIT repair round 1)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("STATE-01 Cancel, then reopen, shows the stored deposit, not what was typed", () => {
    render(<Tab {...propsFor([svc({ depositRequired: true, depositType: "PERCENT", depositValue: 25 })])} />);

    let group = openEditor();
    fireEvent.change(within(group).getByLabelText("Deposit type"), { target: { value: "FIXED" } });
    fireEvent.change(within(group).getByLabelText("Deposit amount (USD)"), { target: { value: "40" } });
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Deposit settings for Gel manicure" })).not.toBeInTheDocument();

    group = openEditor();
    expect(within(group).getByLabelText("Require a deposit")).toBeChecked();
    expect(within(group).getByLabelText("Deposit type")).toHaveValue("PERCENT");
    expect(within(group).getByLabelText("Deposit percent")).toHaveValue(25);

    // And a deposit turned on and typed, then cancelled, is off again on reopening.
    fireEvent.click(within(group).getByLabelText("Require a deposit"));
    expect(within(group).getByLabelText("Require a deposit")).not.toBeChecked();
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    group = openEditor();
    expect(within(group).getByLabelText("Require a deposit")).toBeChecked();
    expect(api.apiPatch).not.toHaveBeenCalled();
  });

  it("STATE-02 a newer read of the service is what the card and the editor show", () => {
    const view = render(<Tab {...propsFor([svc()])} />);
    expect(depositButton()).toHaveTextContent("No deposit");

    // The page reloaded its list: the deposit was set elsewhere.
    view.rerender(<Tab {...propsFor([svc({ depositRequired: true, depositType: "PERCENT", depositValue: 50 })])} />);
    expect(depositButton()).toHaveTextContent("Deposit 50% · USD 60.00");
    const group = openEditor();
    expect(within(group).getByLabelText("Require a deposit")).toBeChecked();
    expect(within(group).getByLabelText("Deposit percent")).toHaveValue(50);

    // And again: turned off elsewhere.
    fireEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    view.rerender(<Tab {...propsFor([svc()])} />);
    expect(depositButton()).toHaveTextContent("No deposit");
  });

  it.each(["WEIRD", "percent", "fixed", ""])(
    "STATE-03 a stored depositType %j is not read as a deposit type",
    (storedType) => {
      render(<Tab {...propsFor([svc({ depositRequired: true, depositType: storedType, depositValue: 25 })])} />);
      expect(depositButton()).toHaveTextContent("Deposit not set");
      expect(depositButton()).not.toHaveTextContent("USD");

      const group = openEditor();
      expect(within(group).getByLabelText("Deposit type")).toHaveValue("PERCENT");
    },
  );
});
