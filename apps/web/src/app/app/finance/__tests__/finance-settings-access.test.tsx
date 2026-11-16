/**
 * FU-FINANCE-SETTINGS-PATCH (V1-71; owner ruling D-205): the finance settings page and the accountant box know, before
 * anything is sent, what the member may change, and say a refusal in plain words.
 *
 * The server (D-205) now holds PATCH /finance/businesses/:id/settings by field: a change of the accountant email needs
 * settings admin and revenue read (the same check the accountant box's "Remember this as the default recipient" runs),
 * a change of the accounting basis, fiscal year or a default account needs revenue write ("Insufficient permissions:
 * revenue requires write access (you have read)"), and the default tax rate stays the owner's (D-11). GET settings (and
 * PATCH's answer) carry the caller's hints: mayChangeAccountantEmail, mayChangeBooksSettings, mayChangeTaxRate. Before,
 * the page offered every field to every member and the accountant box offered "Remember" (ticked when no address was
 * saved) to members the server refuses it to, so they learned only from a refusal.
 *
 *   FSA-01  RED-BEFORE  a member who may change nothing (STAFF on role defaults): every control is view-only, the page
 *                       says why in plain words for each, and there is no "Save settings" button
 *   FSA-02  RED-BEFORE  a revenue:write member: basis, fiscal year and default accounts are offered; the accountant email
 *                       and the tax rate are view-only with their reasons; a save sends the settings, not the hints
 *   FSA-03  RED-BEFORE  a settings admin with revenue read: the accountant email is offered; basis, fiscal year, default
 *                       accounts and tax rate are view-only with their reasons
 *   FSA-04  control     the owner: everything is offered, no view-only notice
 *   FSA-05  control     an answer without hints (an older server): everything is offered, as before
 *   FSA-06  RED-BEFORE  a save refused for the accountant email says so in plain words; no "Settings saved"
 *   FSA-07  RED-BEFORE  a save refused for the basis, fiscal year or default accounts says so in plain words
 *   RM-01   RED-BEFORE  Reports accountant box, member who may not save the address: no "Remember" box, a plain note,
 *                       the send asks to save nothing and goes through ("Sent to …")
 *   RM-02   RED-BEFORE  Tax accountant box (the page's and the period drawer's): the same
 *   RM-03   control     a member who may save it: "Remember" is offered, ticked when no address is saved, and asked for
 *
 * Mounted on the real pages and the real api client (lib/api.ts, lib/client.ts); only `fetch`, the toast,
 * next/navigation and the stored business are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/finance",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStoredBusinessId: () => "biz_1",
  refreshWorkspace: async () => null,
}));

import { toast } from "sonner";
import FinanceSettingsPage from "../settings/page";
import ReportsPage from "../../reports/page";
import TaxPage from "../tax/page";

const FIN = "/finance/businesses/biz_1";
/** The server's binding refusal (core/connectors/connector-exports.ts assertMaySetExportDestination). */
const ADDRESS_REFUSAL =
  "Insufficient permissions: saving the accountant's email address, which receives the business's books (the accountant export), needs settings admin access (you have none)";
/** The server's refusal of a basis, fiscal year or default account change (FinanceSettingsService, ModuleScopeGuard's words). */
const BOOKS_REFUSAL = "Insufficient permissions: revenue requires write access (you have read)";

const BOOKS_LOCKED = /The accounting basis, fiscal year and default accounts: changing them needs permission to edit this business's books\./;
const ADDRESS_LOCKED = /The accountant email: changing it needs settings admin access in this business\./;
const RATE_LOCKED = /The default tax rate: only the business owner can change it\./;

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => (text ? (JSON.parse(text) as unknown) : null),
    text: async () => text,
    blob: async () => new Blob([text]),
    clone() { return this; },
  } as unknown as Response;
}

/** The production filter's body for a 403 (http-exception.filter.ts), with the refused fields the server names (under `details`). */
function refused(path: string, message: string, fields?: string[]) {
  return jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message, error: "Forbidden", timestamp: "2026-11-16T00:00:00.000Z", path, ...(fields ? { details: { fields } } : {}) }, "Forbidden");
}

type Call = { method: string; pathname: string; body: unknown };
function stubServer(route: (method: string, pathname: string) => Response | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    try { body = typeof init?.body === "string" ? JSON.parse(init.body) : null; } catch { body = init?.body ?? null; }
    calls.push({ method, pathname, body });
    return route(method, pathname) ?? jsonResponse(200, {});
  }));
  return calls;
}

const SETTINGS = {
  accountingBasis: "CASH",
  fiscalYearStartMonth: 1,
  defaultTaxRate: 12.5,
  currency: "TTD",
  accountantEmail: "books@firm.test" as string | null,
  defaultCashAccountId: null,
  defaultArAccountId: null,
  defaultApAccountId: null,
  defaultTaxAccountId: null,
};
type Hints = { mayChangeAccountantEmail: boolean; mayChangeBooksSettings: boolean; mayChangeTaxRate: boolean };
const NOTHING: Hints = { mayChangeAccountantEmail: false, mayChangeBooksSettings: false, mayChangeTaxRate: false };
const BOOKS_ONLY: Hints = { mayChangeAccountantEmail: false, mayChangeBooksSettings: true, mayChangeTaxRate: false };
const ADDRESS_ONLY: Hints = { mayChangeAccountantEmail: true, mayChangeBooksSettings: false, mayChangeTaxRate: false };
const EVERYTHING: Hints = { mayChangeAccountantEmail: true, mayChangeBooksSettings: true, mayChangeTaxRate: true };
const ACCOUNTS = { items: [{ id: "acct_1", name: "Main bank", type: "BANK", isActive: true, isDefault: false, currency: "TTD", currentBalance: 0 }] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

function settingsServer(settings: Record<string, unknown>, patch?: () => Response) {
  return stubServer((method, pathname) => {
    if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, settings);
    if (method === "GET" && pathname.endsWith(`${FIN}/accounts`)) return jsonResponse(200, ACCOUNTS);
    if (method === "PATCH" && pathname.endsWith(`${FIN}/settings`)) return patch ? patch() : jsonResponse(200, settings);
    return undefined;
  });
}

/** The General section's controls, by what they change. */
async function controls() {
  const email = (await screen.findByPlaceholderText("accountant@firm.com")) as HTMLInputElement;
  return {
    email,
    cash: screen.getByRole("button", { name: "Cash basis" }) as HTMLButtonElement,
    accrual: screen.getByRole("button", { name: "Accrual basis" }) as HTMLButtonElement,
    fiscal: screen.getByRole("combobox", { name: /Year starts in/ }) as HTMLSelectElement,
    rate: screen.getByRole("spinbutton") as HTMLInputElement,
    accounts: [/^Cash \/ Bank/, /^Accounts Receivable/, /^Accounts Payable/, /^Tax Payable/].map((name) => screen.getByRole("combobox", { name }) as HTMLSelectElement),
  };
}

describe("Finance settings: what this member may change (FU-FINANCE-SETTINGS-PATCH, D-205)", () => {
  it("FSA-01 RED-BEFORE: a member who may change nothing sees every control view-only, each with its reason in plain words, and no \"Save settings\" button", async () => {
    settingsServer({ ...SETTINGS, ...NOTHING });
    render(<FinanceSettingsPage />);
    const c = await controls();
    for (const el of [c.email, c.cash, c.accrual, c.fiscal, c.rate, ...c.accounts]) expect(el).toBeDisabled();
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/You can see these settings but can't change them\./);
    expect(note.textContent).toMatch(BOOKS_LOCKED);
    expect(note.textContent).toMatch(ADDRESS_LOCKED);
    expect(note.textContent).toMatch(RATE_LOCKED);
    expect(note.textContent).not.toMatch(/Insufficient permissions|revenue|settings:admin/);
    expect(screen.queryByRole("button", { name: /Save settings/ })).not.toBeInTheDocument();
  });

  it("FSA-02 RED-BEFORE: a revenue:write member is offered the basis, fiscal year and default accounts; the accountant email and the tax rate are view-only with their reasons; a save sends the settings and not the hints", async () => {
    const calls = settingsServer({ ...SETTINGS, ...BOOKS_ONLY }, () => jsonResponse(200, { ...SETTINGS, accountingBasis: "ACCRUAL", ...BOOKS_ONLY }));
    render(<FinanceSettingsPage />);
    const c = await controls();
    for (const el of [c.cash, c.accrual, c.fiscal, ...c.accounts]) expect(el).not.toBeDisabled();
    for (const el of [c.email, c.rate]) expect(el).toBeDisabled();
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/Some of these settings are view-only for you:/);
    expect(note.textContent).toMatch(ADDRESS_LOCKED);
    expect(note.textContent).toMatch(RATE_LOCKED);
    expect(note.textContent).not.toMatch(BOOKS_LOCKED);
    fireEvent.click(c.accrual);
    fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Settings saved"));
    const sent = calls.find((x) => x.method === "PATCH")?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ accountingBasis: "ACCRUAL", accountantEmail: "books@firm.test", defaultTaxRate: 12.5 });
    for (const k of Object.keys(BOOKS_ONLY)) expect(sent).not.toHaveProperty(k);
    // after the save the page keeps the hints PATCH answered: the address is still view-only
    expect((await controls()).email).toBeDisabled();
  });

  it("FSA-03 RED-BEFORE: a settings admin with revenue read is offered the accountant email; the basis, fiscal year, default accounts and tax rate are view-only with their reasons", async () => {
    settingsServer({ ...SETTINGS, ...ADDRESS_ONLY });
    render(<FinanceSettingsPage />);
    const c = await controls();
    expect(c.email).not.toBeDisabled();
    for (const el of [c.cash, c.accrual, c.fiscal, c.rate, ...c.accounts]) expect(el).toBeDisabled();
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(BOOKS_LOCKED);
    expect(note.textContent).toMatch(RATE_LOCKED);
    expect(note.textContent).not.toMatch(ADDRESS_LOCKED);
    expect(screen.getByRole("button", { name: /Save settings/ })).toBeInTheDocument();
  });

  it("FSA-04 control: the owner is offered everything, with no view-only notice", async () => {
    settingsServer({ ...SETTINGS, ...EVERYTHING });
    render(<FinanceSettingsPage />);
    const c = await controls();
    for (const el of [c.email, c.cash, c.accrual, c.fiscal, c.rate, ...c.accounts]) expect(el).not.toBeDisabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save settings/ })).toBeInTheDocument();
  });

  it("FSA-05 control: an answer without hints (an older server) offers everything, as before", async () => {
    settingsServer(SETTINGS);
    render(<FinanceSettingsPage />);
    const c = await controls();
    for (const el of [c.email, c.cash, c.accrual, c.fiscal, c.rate, ...c.accounts]) expect(el).not.toBeDisabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save settings/ })).toBeInTheDocument();
  });

  it("FSA-06 RED-BEFORE: a save the server refuses for the accountant email says so in plain words (nothing was saved); no \"Settings saved\"", async () => {
    settingsServer(SETTINGS, () => refused(`${FIN}/settings`, ADDRESS_REFUSAL, ["accountantEmail"]));
    render(<FinanceSettingsPage />);
    const c = await controls();
    fireEvent.change(c.email, { target: { value: "me@elsewhere.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Nothing was saved. You can't change the accountant email in this business: it needs settings admin access.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("FSA-07 RED-BEFORE: a save the server refuses for the basis, fiscal year or default accounts says so in plain words (nothing was saved); no \"Settings saved\"", async () => {
    settingsServer(SETTINGS, () => refused(`${FIN}/settings`, BOOKS_REFUSAL, ["accountingBasis"]));
    render(<FinanceSettingsPage />);
    const c = await controls();
    fireEvent.click(c.accrual);
    fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Nothing was saved. You can't change the accounting basis, fiscal year or default accounts in this business: it needs permission to edit its books.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});

/** The accountant box opened from `trigger`. */
async function openBox(trigger: HTMLElement) {
  fireEvent.click(trigger);
  const title = await screen.findByText("Send accountant export");
  return title.closest("div.relative") as HTMLElement;
}

function exportServer(settings: Record<string, unknown>, extra?: (method: string, pathname: string) => Response | undefined) {
  return stubServer((method, pathname) => {
    if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, settings);
    if (method === "POST" && pathname.endsWith(`${FIN}/accountant-export/email`)) {
      return jsonResponse(201, { to: "me@elsewhere.test", filename: "x.zip", bytes: 1, messageId: "m1", generatedAt: "2026-11-16T00:00:00.000Z", savedAsDefault: false });
    }
    if (method === "GET" && pathname.endsWith("/reports/generate")) return jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error");
    return extra?.(method, pathname);
  });
}

/** The box of a member who may not save the address: no "Remember", a plain note, and a send that saves nothing. */
async function expectSendOnlyBox(box: HTMLElement, calls: Call[]) {
  expect(within(box).queryByRole("checkbox", { name: /Remember this as the default recipient/ })).not.toBeInTheDocument();
  expect(within(box).getByText(/This address is not saved as the default recipient: saving one needs settings admin access in this business\./)).toBeInTheDocument();
  const input = within(box).getByPlaceholderText("accountant@firm.com") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "me@elsewhere.test" } });
  fireEvent.click(within(box).getByRole("button", { name: /Send email/ }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sent to me@elsewhere.test"));
  expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([expect.objectContaining({ to: "me@elsewhere.test", saveRecipient: false })]);
}

describe("The accountant box knows in advance whether \"Remember\" is allowed (FU-FINANCE-SETTINGS-PATCH)", () => {
  it("RM-01 RED-BEFORE: Reports, a member who may not save the address (no address saved yet): no \"Remember\" box, a plain note, and the send saves nothing and goes through", async () => {
    const calls = exportServer({ ...SETTINGS, accountantEmail: null, ...BOOKS_ONLY });
    render(<ReportsPage />);
    const trigger = await screen.findByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.pathname.endsWith(`${FIN}/settings`))).toBe(true));
    await expectSendOnlyBox(await openBox(trigger), calls);
  });

  it("RM-02 RED-BEFORE: Tax, the page's box and the period drawer's box: the same for a member who may not save the address", async () => {
    const liability = {
      id: "liab_1", businessId: "biz_1", type: "VAT", periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-03-31T23:59:59.999Z",
      taxableSales: 100, taxCollected: 12.5, taxPaid: 0, amountDue: 12.5, dueDate: null, status: "OPEN", notes: null,
      createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z",
    };
    const calls = exportServer({ ...SETTINGS, accountantEmail: null, ...NOTHING }, (method, pathname) => {
      if (method === "GET" && /\/tax-liabilities$/.test(pathname)) return jsonResponse(200, { items: [liability] });
      if (method === "GET" && /\/contributing-invoices$/.test(pathname)) return jsonResponse(200, { liability, invoices: [] });
      return undefined;
    });
    render(<TaxPage />);
    const [pageTrigger] = await screen.findAllByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(pageTrigger).not.toBeDisabled());
    await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.pathname.endsWith(`${FIN}/settings`))).toBe(true));
    await expectSendOnlyBox(await openBox(pageTrigger), calls);

    // the period drawer's own box
    calls.length = 0;
    vi.mocked(toast.success).mockClear();
    fireEvent.click(await screen.findByRole("button", { name: "Drill down" }));
    const triggers = await screen.findAllByRole("button", { name: /Send to accountant/ });
    const drawerTrigger = triggers[triggers.length - 1];
    await expectSendOnlyBox(await openBox(drawerTrigger), calls);
  });

  it("RM-03 control: a member who may save the address is offered \"Remember\", ticked when no address is saved, and the send asks to save it", async () => {
    const calls = exportServer({ ...SETTINGS, accountantEmail: null, ...ADDRESS_ONLY });
    render(<ReportsPage />);
    const trigger = await screen.findByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.pathname.endsWith(`${FIN}/settings`))).toBe(true));
    const box = await openBox(trigger);
    const remember = within(box).getByRole("checkbox", { name: /Remember this as the default recipient/ }) as HTMLInputElement;
    expect(remember.checked).toBe(true);
    expect(within(box).queryByText(/is not saved as the default recipient/)).not.toBeInTheDocument();
    fireEvent.change(within(box).getByPlaceholderText("accountant@firm.com"), { target: { value: "me@elsewhere.test" } });
    fireEvent.click(within(box).getByRole("button", { name: /Send email/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ to: "me@elsewhere.test", saveRecipient: true });
  });
});
