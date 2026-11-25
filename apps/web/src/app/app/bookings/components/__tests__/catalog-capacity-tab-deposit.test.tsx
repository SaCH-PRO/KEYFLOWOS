/**
 * SWP-SERVICE-DEPOSIT, the web half (BUG-048; journeys B and F; D-26, D-59, D-80).
 *
 * WHY this test exists: a service can take a deposit (Service.depositRequired, depositType PERCENT | FIXED,
 * depositValue), and since M17 the server stores and validates it on POST / PATCH services: PERCENT 1..100, FIXED
 * above 0 and at most the price, anything else 400; an explicit depositRequired false clears type and value. The
 * web had no deposit field anywhere: Bookings > Setup's service cards edited only buffer and lead time, and the
 * services read (fetchServices' schema) dropped the three fields, so a stored deposit could be neither seen nor
 * changed. The card's price was also always written in TTD, whatever the business's currency.
 *
 * Mounted on the real CatalogCapacityTab and the real client.ts wrappers (fetchServices, updateService). The write
 * is stubbed at the api module (apiPatch, in the exact { data, error, status } shape it returns); reads go through
 * client.ts's own fetch, which is stubbed; the toast is stubbed.
 *
 *   DEP-01  a stored 25% deposit is shown on the card and loaded into the editor
 *   DEP-02  setting a 25% deposit sends exactly { depositRequired, depositType PERCENT, depositValue 25 }
 *   DEP-03  a fixed deposit is in the business currency; a deposit equal to the price is accepted
 *   DEP-04  client-side refusals match the server's rule: PERCENT outside 1..100, FIXED <= 0 or above the price,
 *           no value; nothing is sent
 *   DEP-05  the server's 400 is the final answer: its message is shown and nothing is reported saved
 *   DEP-06  turning the toggle off and saving sends exactly { depositRequired: false } and the card says No deposit
 *   DEP-07  the card's price is in the business currency
 *   DEP-08  the tip's door: focusServiceId opens that service's deposit editor, and only that one
 *   DEP-09  an unknown focusServiceId says the service was not found
 *   DEP-10  fetchServices keeps the stored deposit fields
 *   DEP-11  saving with an untouched value keeps the stored number
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ComponentType } from "react";
import { render, screen, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  apiPatch: vi.fn(),
}));

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

import { toast } from "sonner";
import CatalogCapacityTab from "../catalog-capacity-tab";
import { fetchServices, type Service } from "@/lib/client";

const BUSINESS = "biz_dep_1";
const SERVER_FIXED_REFUSAL = "FIXED depositValue must be greater than 0 and at most the service price";

type DepositService = Service & {
  depositRequired?: boolean;
  depositType?: string | null;
  depositValue?: number | null;
};

function svc(over: Partial<DepositService> = {}): DepositService {
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

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return this; },
  } as unknown as Response;
}

interface RenderOpts {
  services?: DepositService[];
  currency?: string;
  focusServiceId?: string | null;
}

function renderTab(opts: RenderOpts = {}) {
  const onServiceUpdated = vi.fn();
  const onFocusServiceHandled = vi.fn();
  const props = {
    services: opts.services ?? [svc()],
    staff: [],
    bookings: [],
    staffForm: { name: "", email: "" },
    setStaffForm: () => {},
    onCreateStaff: () => {},
    onDeleteStaff: () => {},
    calendarConnected: false,
    calendarEmail: null,
    loading: false,
    businessId: BUSINESS,
    businessHoursSet: false,
    currency: opts.currency ?? "USD",
    focusServiceId: opts.focusServiceId ?? null,
    onServiceUpdated,
    onFocusServiceHandled,
  };
  // The deposit props are new in this packet; the cast keeps the RED commit compiling against the old props type.
  const Tab = CatalogCapacityTab as unknown as ComponentType<typeof props>;
  const utils = render(<Tab {...props} />);
  return { ...utils, onServiceUpdated, onFocusServiceHandled, props };
}

/** The service's deposit control on its card (collapsed summary button). */
function depositButton(name = "Gel manicure") {
  return screen.getByRole("button", { name: `Deposit for ${name}` });
}

function openEditor(name = "Gel manicure") {
  fireEvent.click(depositButton(name));
  return screen.getByRole("group", { name: `Deposit settings for ${name}` });
}

function patchOk(body: Record<string, unknown>) {
  api.apiPatch.mockResolvedValue({ data: { ...svc(), ...body }, error: null });
}

describe("Bookings > Setup: a service's deposit (SWP-SERVICE-DEPOSIT, BUG-048)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { message: "Not stubbed" }, "Not Found")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("DEP-01 a stored 25% deposit shows on the card and loads into the editor", () => {
    renderTab({ services: [svc({ depositRequired: true, depositType: "PERCENT", depositValue: 25 })] });

    const button = depositButton();
    expect(button).toHaveTextContent("25%");
    // 25% of 120, in the business currency.
    expect(button).toHaveTextContent("USD 30.00");

    const editor = openEditor();
    expect(within(editor).getByLabelText("Require a deposit")).toBeChecked();
    expect(within(editor).getByLabelText("Deposit type")).toHaveValue("PERCENT");
    expect(within(editor).getByLabelText("Deposit percent")).toHaveValue(25);
  });

  it("DEP-02 setting a 25% deposit sends exactly the three fields and the card shows it", async () => {
    patchOk({ depositRequired: true, depositType: "PERCENT", depositValue: 25 });
    const { onServiceUpdated } = renderTab();

    expect(depositButton()).toHaveTextContent("No deposit");
    const editor = openEditor();
    expect(within(editor).queryByLabelText("Deposit type")).not.toBeInTheDocument();
    fireEvent.click(within(editor).getByLabelText("Require a deposit"));
    expect(within(editor).getByLabelText("Deposit type")).toHaveValue("PERCENT");
    fireEvent.change(within(editor).getByLabelText("Deposit percent"), { target: { value: "25" } });
    expect(within(editor).getByTestId("deposit-preview")).toHaveTextContent("USD 30.00 of USD 120.00");
    fireEvent.click(within(editor).getByRole("button", { name: "Save deposit" }));

    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    expect(api.apiPatch).toHaveBeenCalledWith(`/bookings/businesses/${BUSINESS}/services/svc_1`, {
      depositRequired: true,
      depositType: "PERCENT",
      depositValue: 25,
    });
    await act(async () => {});
    expect(toast.success).toHaveBeenCalledWith("Deposit saved");
    expect(toast.error).not.toHaveBeenCalled();
    expect(onServiceUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "svc_1", depositRequired: true, depositType: "PERCENT", depositValue: 25 }));
    expect(screen.queryByRole("group", { name: "Deposit settings for Gel manicure" })).not.toBeInTheDocument();
    expect(depositButton()).toHaveTextContent("25%");
  });

  it("DEP-03 a fixed deposit is named in the business currency; one equal to the price is accepted", async () => {
    patchOk({ depositRequired: true, depositType: "FIXED", depositValue: 120 });
    renderTab({ currency: "USD" });

    const editor = openEditor();
    fireEvent.click(within(editor).getByLabelText("Require a deposit"));
    const type = within(editor).getByLabelText("Deposit type");
    expect(within(type as HTMLElement).getByRole("option", { name: "Fixed amount (USD)" })).toBeInTheDocument();
    fireEvent.change(type, { target: { value: "FIXED" } });
    const amount = within(editor).getByLabelText("Deposit amount (USD)");
    fireEvent.change(amount, { target: { value: "120" } });
    expect(within(editor).queryByTestId("deposit-problem")).not.toBeInTheDocument();
    const save = within(editor).getByRole("button", { name: "Save deposit" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    expect(api.apiPatch).toHaveBeenCalledWith(`/bookings/businesses/${BUSINESS}/services/svc_1`, {
      depositRequired: true,
      depositType: "FIXED",
      depositValue: 120,
    });
    await act(async () => {});
    expect(depositButton()).toHaveTextContent("USD 120.00");
  });

  it.each([
    ["PERCENT", "0.5", /between 1 and 100/],
    ["PERCENT", "0", /between 1 and 100/],
    ["PERCENT", "100.01", /between 1 and 100/],
    ["PERCENT", "", /enter the deposit/i],
    ["PERCENT", "abc", /enter the deposit/i],
    ["FIXED", "120.01", /at most the price \(USD 120\.00\)/],
    ["FIXED", "0", /more than 0/],
    ["FIXED", "-5", /more than 0/],
    ["FIXED", "", /enter the deposit/i],
  ])("DEP-04 %s %s is refused before anything is sent", (type, value, problem) => {
    renderTab();
    const editor = openEditor();
    fireEvent.click(within(editor).getByLabelText("Require a deposit"));
    fireEvent.change(within(editor).getByLabelText("Deposit type"), { target: { value: type } });
    const input = within(editor).getByLabelText(type === "PERCENT" ? "Deposit percent" : "Deposit amount (USD)");
    fireEvent.change(input, { target: { value } });

    expect(within(editor).getByTestId("deposit-problem")).toHaveTextContent(problem);
    const save = within(editor).getByRole("button", { name: "Save deposit" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(api.apiPatch).not.toHaveBeenCalled();
  });

  it.each([
    ["PERCENT", "1"],
    ["PERCENT", "100"],
    ["PERCENT", "12.5"],
    ["FIXED", "0.01"],
    ["FIXED", "120"],
  ])("DEP-04 control: %s %s is accepted (the server's own bounds)", (type, value) => {
    renderTab();
    const editor = openEditor();
    fireEvent.click(within(editor).getByLabelText("Require a deposit"));
    fireEvent.change(within(editor).getByLabelText("Deposit type"), { target: { value: type } });
    fireEvent.change(within(editor).getByLabelText(type === "PERCENT" ? "Deposit percent" : "Deposit amount (USD)"), { target: { value } });
    expect(within(editor).queryByTestId("deposit-problem")).not.toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Save deposit" })).toBeEnabled();
  });

  it("DEP-05 the server's 400 is the final answer: its message shows and nothing is reported saved", async () => {
    // The client still believes the price is 120 (another screen lowered it to 80 since): 100 passes here, the server refuses.
    api.apiPatch.mockResolvedValue({ data: null, error: SERVER_FIXED_REFUSAL, status: 400 });
    const { onServiceUpdated } = renderTab();

    const editor = openEditor();
    fireEvent.click(within(editor).getByLabelText("Require a deposit"));
    fireEvent.change(within(editor).getByLabelText("Deposit type"), { target: { value: "FIXED" } });
    fireEvent.change(within(editor).getByLabelText("Deposit amount (USD)"), { target: { value: "100" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save deposit" }));

    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(await within(editor).findByRole("alert")).toHaveTextContent(SERVER_FIXED_REFUSAL);
    expect(toast.error).toHaveBeenCalledWith(SERVER_FIXED_REFUSAL);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onServiceUpdated).not.toHaveBeenCalled();
    // Still open with what was typed, and the card still says no deposit.
    expect(screen.getByRole("group", { name: "Deposit settings for Gel manicure" })).toBeInTheDocument();
    expect(within(editor).getByLabelText("Deposit amount (USD)")).toHaveValue(100);
    expect(depositButton()).toHaveTextContent("No deposit");
  });

  it("DEP-06 turning the deposit off and saving sends exactly depositRequired false; the card says No deposit", async () => {
    patchOk({ depositRequired: false, depositType: null, depositValue: null });
    const { onServiceUpdated } = renderTab({ services: [svc({ depositRequired: true, depositType: "PERCENT", depositValue: 25 })] });

    const editor = openEditor();
    fireEvent.click(within(editor).getByLabelText("Require a deposit"));
    expect(within(editor).getByLabelText("Require a deposit")).not.toBeChecked();
    expect(within(editor).queryByLabelText("Deposit type")).not.toBeInTheDocument();
    expect(within(editor).queryByLabelText("Deposit percent")).not.toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "Save deposit" }));

    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    expect(api.apiPatch).toHaveBeenCalledWith(`/bookings/businesses/${BUSINESS}/services/svc_1`, { depositRequired: false });
    await act(async () => {});
    expect(toast.success).toHaveBeenCalledWith("Deposit turned off");
    expect(onServiceUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "svc_1", depositRequired: false, depositType: null, depositValue: null }));
    expect(depositButton()).toHaveTextContent("No deposit");
  });

  it("DEP-07 the card's price is written in the business currency", () => {
    renderTab({ currency: "USD" });
    const card = depositButton().closest(".kf-card") as HTMLElement;
    expect(card).toHaveTextContent("USD 120.00");
    expect(card).not.toHaveTextContent("TTD");
  });

  it("DEP-08 the tip's door opens that service's deposit editor, and only that one", async () => {
    const { onFocusServiceHandled } = renderTab({
      services: [svc(), svc({ id: "svc_2", name: "Pedicure", price: 80 })],
      focusServiceId: "svc_2",
    });

    expect(await screen.findByRole("group", { name: "Deposit settings for Pedicure" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Deposit settings for Gel manicure" })).not.toBeInTheDocument();
    await waitFor(() => expect(onFocusServiceHandled).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("DEP-09 a door naming a service that is not listed says so and opens nothing", async () => {
    const { onFocusServiceHandled } = renderTab({ focusServiceId: "svc_gone" });

    await waitFor(() => expect(onFocusServiceHandled).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("That service was not found. It may have been removed.");
    expect(screen.queryByRole("group", { name: /^Deposit settings for/ })).not.toBeInTheDocument();
  });

  it("DEP-10 fetchServices keeps the stored deposit fields", async () => {
    const stored = [
      { id: "svc_1", name: "Gel manicure", duration: 60, price: 120, depositRequired: true, depositType: "PERCENT", depositValue: 25 },
      { id: "svc_2", name: "Pedicure", duration: 45, price: 80, depositRequired: false, depositType: null, depositValue: null },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(url, "http://localhost");
      if (pathname.endsWith(`/bookings/businesses/${BUSINESS}/services`)) return jsonResponse(200, stored);
      return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
    }));

    const res = await fetchServices(BUSINESS);
    expect(res.error).toBeNull();
    expect(res.data).toEqual([
      expect.objectContaining({ id: "svc_1", depositRequired: true, depositType: "PERCENT", depositValue: 25 }),
      expect.objectContaining({ id: "svc_2", depositRequired: false, depositType: null, depositValue: null }),
    ]);
  });

  it("DEP-11 saving an untouched stored deposit sends the stored number, not text", async () => {
    patchOk({ depositRequired: true, depositType: "FIXED", depositValue: 30 });
    renderTab({ services: [svc({ depositRequired: true, depositType: "FIXED", depositValue: 30 })] });

    const editor = openEditor();
    expect(within(editor).getByLabelText("Deposit amount (USD)")).toHaveValue(30);
    fireEvent.click(within(editor).getByRole("button", { name: "Save deposit" }));

    await waitFor(() => expect(api.apiPatch).toHaveBeenCalledTimes(1));
    expect(api.apiPatch).toHaveBeenCalledWith(`/bookings/businesses/${BUSINESS}/services/svc_1`, {
      depositRequired: true,
      depositType: "FIXED",
      depositValue: 30,
    });
  });
});
