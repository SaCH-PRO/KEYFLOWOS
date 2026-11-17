/**
 * FU-FINANCE-SETTINGS-SCOPE (V1-71): the screens that read the finance settings and change where the accountant export
 * goes say a refusal in plain words and never claim the address saved.
 *
 * The server now holds GET and PATCH /finance/businesses/:id/settings to revenue read (ModuleScopeGuard), and a send of
 * the accountant export that saves its recipient (saveRecipient) to settings admin and revenue read: a refused save is a
 * 403 with nothing sent and nothing written ("Insufficient permissions: saving the accountant's email address, which
 * receives the business's books (the accountant export), needs settings admin access (you have none)"). Before, the
 * settings page stayed on "Loading settings…" for a refused read and toasted the server's raw words for a refused save;
 * the Reports and Tax accountant boxes toasted the raw refusal and gave no way forward.
 *
 *   FS-01  RED-BEFORE  Finance settings: a refused read is a refusal in plain words, not "Loading settings…" forever
 *   FS-02  RED-BEFORE  Finance settings: a refused save says so in plain words on the page; no "Settings saved"
 *   FS-03  control     Finance settings: an accepted save still says "Settings saved"
 *   FS-05  control     Finance settings: a save the server refuses for the owner-only tax rate (D-11, the 403 PATCH
 *                      settings answers at this head) says "Nothing was saved." with the server's own words
 *   RA-01  RED-BEFORE  Reports accountant box: a refused save of the recipient says, in plain words, that nothing was sent
 *                      and the saved address did not change, what this box refused (saving a new default recipient needs
 *                      settings admin) and that it can still be sent without saving; it never claims a rule the server
 *                      does not hold; "Remember" is unticked and "Send without saving" is offered; no "Sent to"; the
 *                      address is not remembered
 *   RA-02  control     Reports accountant box: an accepted send still says "Sent to …"
 *   RA-03  RED-BEFORE  Reports accountant box: after that refusal, "Send without saving" sends the same address with
 *                      saveRecipient false and says "Sent to …" (one click, not untick-and-resend)
 *   TX-01  RED-BEFORE  Tax accountant box: the same refusal, the same words
 *
 * FU-FINANCE-SETTINGS-SCOPE repair (review FSS-CR-2, FSS-CR-3): the box says what it refused (saving a new default
 * from here), not "only a member who manages this business's settings ... can change where the accountant export
 * goes", and a member the save is refused to sends in one more click. FU-FINANCE-SETTINGS-PATCH (owner ruling D-205)
 * holds PATCH settings to the same rule and brings back the settings page's accountant refusal, with the box's
 * in-advance "Remember" hint: finance-settings-access.test.tsx (FSA-*, RM-*). These cases mount answers without the
 * hint (not known), where the box offers "Remember" as before.
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
const READ_REFUSAL = "Insufficient permissions: revenue requires read access (you have none)";
/** The server's binding refusal (core/connectors/connector-exports.ts assertMaySetExportDestination). */
const SAVE_REFUSAL =
  "Insufficient permissions: saving the accountant's email address, which receives the business's books (the accountant export), needs settings admin access (you have none)";
/** The D-11 owner-only tax rate refusal (FinanceSettingsService.assertTaxRateOwner). */
const TAX_RATE_REFUSAL = "Only the business owner can change the default tax rate.";

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

/** The production filter's body for a 403 (http-exception.filter.ts). */
function refused(path: string, message: string) {
  return jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message, error: "Forbidden", timestamp: "2026-11-16T00:00:00.000Z", path }, "Forbidden");
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
  defaultTaxRate: 0,
  currency: "TTD",
  accountantEmail: null as string | null,
  defaultCashAccountId: null,
  defaultArAccountId: null,
  defaultApAccountId: null,
  defaultTaxAccountId: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Finance settings (FU-FINANCE-SETTINGS-SCOPE)", () => {
  it("FS-01 RED-BEFORE: a refused read is a refusal in plain words, not \"Loading settings…\" forever", async () => {
    stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return refused(`${FIN}/settings`, READ_REFUSAL);
      if (method === "GET" && pathname.endsWith(`${FIN}/accounts`)) return refused(`${FIN}/accounts`, READ_REFUSAL);
      return undefined;
    });
    render(<FinanceSettingsPage />);
    const alert = await screen.findByText(/You don't have access to the finance settings in this business/);
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText(/Loading settings/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save settings/ })).not.toBeInTheDocument();
  });

  it("FS-02 RED-BEFORE: a refused save says so in plain words on the page (nothing was saved); no \"Settings saved\"", async () => {
    stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, { ...SETTINGS, accountantEmail: "books@firm.test" });
      if (method === "GET" && pathname.endsWith(`${FIN}/accounts`)) return jsonResponse(200, { items: [] });
      if (method === "PATCH" && pathname.endsWith(`${FIN}/settings`)) return refused(`${FIN}/settings`, READ_REFUSAL);
      return undefined;
    });
    render(<FinanceSettingsPage />);
    const email = await screen.findByPlaceholderText("accountant@firm.com");
    fireEvent.change(email, { target: { value: "me@elsewhere.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Nothing was saved/);
    expect(alert.textContent).toMatch(/You can't change the finance settings in this business/);
    expect(alert.textContent).not.toMatch(/Insufficient permissions/);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("FS-05 control: a save refused for the owner-only tax rate (D-11: 403 BUSINESS_PROFILE_OWNER_ONLY, a refusal PATCH settings answers at this head) says \"Nothing was saved.\" with the server's own words; no \"Settings saved\"", async () => {
    stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, SETTINGS);
      if (method === "GET" && pathname.endsWith(`${FIN}/accounts`)) return jsonResponse(200, { items: [] });
      if (method === "PATCH" && pathname.endsWith(`${FIN}/settings`)) {
        // The production filter's body for FinanceSettingsService.assertTaxRateOwner's refusal.
        return jsonResponse(403, {
          statusCode: 403, code: "BUSINESS_PROFILE_OWNER_ONLY", message: TAX_RATE_REFUSAL, fields: ["defaultTaxRate"],
          error: "Forbidden", timestamp: "2026-11-16T00:00:00.000Z", path: `${FIN}/settings`,
        }, "Forbidden");
      }
      return undefined;
    });
    render(<FinanceSettingsPage />);
    await screen.findByPlaceholderText("accountant@firm.com");
    fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(`Nothing was saved. ${TAX_RATE_REFUSAL}`);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("FS-03 control: an accepted save still says \"Settings saved\" and shows no refusal", async () => {
    stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, SETTINGS);
      if (method === "GET" && pathname.endsWith(`${FIN}/accounts`)) return jsonResponse(200, { items: [] });
      if (method === "PATCH" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, { ...SETTINGS, accountantEmail: "books@firm.test" });
      return undefined;
    });
    render(<FinanceSettingsPage />);
    const email = await screen.findByPlaceholderText("accountant@firm.com");
    fireEvent.change(email, { target: { value: "books@firm.test" } });
    fireEvent.click(screen.getByRole("button", { name: /Save settings/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Settings saved"));
    expect(screen.queryByText(/Nothing was saved/)).not.toBeInTheDocument();
  });
});

/** Opens the accountant box from `trigger`, types `to`, leaves "Remember" as it starts, and sends. */
async function sendFromBox(trigger: HTMLElement, to: string) {
  fireEvent.click(trigger);
  const dialogTitle = await screen.findByText("Send accountant export");
  const box = dialogTitle.closest("div.relative") as HTMLElement;
  const input = within(box).getByPlaceholderText("accountant@firm.com");
  fireEvent.change(input, { target: { value: to } });
  fireEvent.click(within(box).getByRole("button", { name: /Send email/ }));
  return box;
}

function expectPlainSaveRefusal(box: HTMLElement) {
  const alert = within(box).getByRole("alert");
  expect(alert.textContent).toMatch(/Nothing was sent/);
  expect(alert.textContent).toMatch(/saved accountant address was not changed/);
  // what this box refused, in plain words
  expect(alert.textContent).toMatch(/saving a new default recipient from here needs settings admin access/);
  expect(alert.textContent).toMatch(/You can still send the export to this address without saving it/);
  // review FSS-CR-2: the box says what it refused, saving from here, and no wider rule
  expect(alert.textContent).not.toMatch(/only a member who manages this business's settings/i);
  expect(alert.textContent).not.toMatch(/can change where the accountant export goes/);
  expect(alert.textContent).not.toMatch(/Insufficient permissions/);
  // review FSS-CR-3: the way forward is one click; "Remember" is unticked so a plain Send does not save either
  expect(within(box).getByRole("button", { name: "Send without saving" })).toBeInTheDocument();
  expect((within(box).getByRole("checkbox", { name: /Remember this as the default recipient/ }) as HTMLInputElement).checked).toBe(false);
}

/** The Reports page's own report read: unavailable here, so the page shows its error state (the box is under test). */
function reportsRoute(method: string, pathname: string): Response | undefined {
  if (method === "GET" && pathname.endsWith("/reports/generate")) return jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error");
  return undefined;
}

describe("Reports accountant box (FU-FINANCE-SETTINGS-SCOPE)", () => {
  it("RA-01 RED-BEFORE: a refused save of the recipient says in plain words that nothing was sent and the address did not change, and how to send without saving; no \"Sent to\"; the address is not remembered", async () => {
    const calls = stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, SETTINGS);
      if (method === "POST" && pathname.endsWith(`${FIN}/accountant-export/email`)) return refused(`${FIN}/accountant-export/email`, SAVE_REFUSAL);
      return reportsRoute(method, pathname);
    });
    render(<ReportsPage />);
    const trigger = await screen.findByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    const box = await sendFromBox(trigger, "me@elsewhere.test");
    await waitFor(() => expect(within(box).getByRole("alert")).toBeInTheDocument());
    expectPlainSaveRefusal(box);
    // it asked to save (no default yet, so "Remember" starts ticked), and was refused: no success claimed
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ to: "me@elsewhere.test", saveRecipient: true });
    expect(toast.success).not.toHaveBeenCalled();
    // the box stays open with the address typed, so the member can send it without saving in one click (RA-03)
    expect(screen.getByText("Send accountant export")).toBeInTheDocument();
    // closing and reopening prefills nothing: the refused address was not remembered as the default
    fireEvent.click(within(box).getByRole("button", { name: /Cancel/ }));
    fireEvent.click(trigger);
    const reopened = (await screen.findByText("Send accountant export")).closest("div.relative") as HTMLElement;
    expect((within(reopened).getByPlaceholderText("accountant@firm.com") as HTMLInputElement).value).toBe("");
  });

  it("RA-02 control: an accepted send still says \"Sent to …\" and shows no refusal", async () => {
    stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, { ...SETTINGS, accountantEmail: "books@firm.test" });
      if (method === "POST" && pathname.endsWith(`${FIN}/accountant-export/email`)) {
        return jsonResponse(201, { to: "books@firm.test", filename: "x.zip", bytes: 1, messageId: "m1", generatedAt: "2026-11-16T00:00:00.000Z", savedAsDefault: false });
      }
      return reportsRoute(method, pathname);
    });
    render(<ReportsPage />);
    const trigger = await screen.findByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    const box = await sendFromBox(trigger, "books@firm.test");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sent to books@firm.test"));
    expect(within(box).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(box).queryByRole("button", { name: "Send without saving" })).not.toBeInTheDocument();
  });

  it("RA-03 RED-BEFORE (review FSS-CR-3): after a refused save of the recipient, \"Send without saving\" sends the same address with saveRecipient false and says \"Sent to …\"; the address is not remembered", async () => {
    const calls = stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, SETTINGS);
      if (method === "POST" && pathname.endsWith(`${FIN}/accountant-export/email`)) {
        const posts = calls.filter((c) => c.method === "POST");
        const last = posts[posts.length - 1]?.body as { saveRecipient?: boolean } | undefined;
        // the server's rule: a send that saves a new recipient is refused whole; one that saves nothing goes
        if (last?.saveRecipient) return refused(`${FIN}/accountant-export/email`, SAVE_REFUSAL);
        return jsonResponse(201, { to: "me@elsewhere.test", filename: "x.zip", bytes: 1, messageId: "m1", generatedAt: "2026-11-16T00:00:00.000Z", savedAsDefault: false });
      }
      return reportsRoute(method, pathname);
    });
    render(<ReportsPage />);
    const trigger = await screen.findByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    const box = await sendFromBox(trigger, "me@elsewhere.test");
    await waitFor(() => expect(within(box).getByRole("alert")).toBeInTheDocument());
    fireEvent.click(within(box).getByRole("button", { name: "Send without saving" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sent to me@elsewhere.test"));
    const posts = calls.filter((c) => c.method === "POST").map((c) => c.body);
    expect(posts).toEqual([
      expect.objectContaining({ to: "me@elsewhere.test", saveRecipient: true }),
      expect.objectContaining({ to: "me@elsewhere.test", saveRecipient: false }),
    ]);
    // sent and closed; nothing was saved, so reopening prefills nothing
    expect(screen.queryByText("Send accountant export")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const reopened = (await screen.findByText("Send accountant export")).closest("div.relative") as HTMLElement;
    expect((within(reopened).getByPlaceholderText("accountant@firm.com") as HTMLInputElement).value).toBe("");
  });
});

describe("Tax accountant box (FU-FINANCE-SETTINGS-SCOPE)", () => {
  it("TX-01 RED-BEFORE: a refused save of the recipient says the same plain words; no \"Sent to\"", async () => {
    stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, SETTINGS);
      if (method === "GET" && /\/tax-liabilities$|\/tax\/liabilities$/.test(pathname)) return jsonResponse(200, { items: [] });
      if (method === "POST" && pathname.endsWith(`${FIN}/accountant-export/email`)) return refused(`${FIN}/accountant-export/email`, SAVE_REFUSAL);
      return undefined;
    });
    render(<TaxPage />);
    const [trigger] = await screen.findAllByRole("button", { name: /Send to accountant/ });
    await waitFor(() => expect(trigger).not.toBeDisabled());
    const box = await sendFromBox(trigger, "me@elsewhere.test");
    await waitFor(() => expect(within(box).getByRole("alert")).toBeInTheDocument());
    expectPlainSaveRefusal(box);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
