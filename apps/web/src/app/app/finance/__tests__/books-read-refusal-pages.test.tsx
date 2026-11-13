/**
 * PR195-KEY-GATES review repair (review finding CRR-P195KG-1, minor CRR-P195KG-2; owner rulings D-57, D-146).
 *
 * SEC-P195BW-4 put revenue read on GET intelligence/actions, intelligence/insight, accounts and reserves, which were
 * membership-only before. The packet moved the bank-rules, fixed-assets, reconciliation and tax pages to
 * moduleReadRefusal, but the other pages that read these doors showed the new 403 as an all-clear or an empty state,
 * against the packet's own rule (CRR-P195BD-1: a refused read is said as a refusal, never shown as an empty list).
 * The review reproduced, on the real components:
 *   - /app/finance/actions (and /app/money/actions): FinanceIntelPanel "All clear — no open finance issues detected.";
 *     the server-rendered strip "Finance is steady / No critical risks detected";
 *   - /app/finance/settings#accounts: "No accounts yet — Add a bank or cash account to get started.";
 *   - /app/finance/settings General: the default-account pickers silently empty.
 *
 *   IP-01  RED-BEFORE  the action queue panel: a refused read is a refusal naming revenue access, not "All clear"
 *   IP-02  control     an allowed, empty queue still says "All clear"
 *   IS-01  RED-BEFORE  the insight strip: a refused read is a refusal, not "Finance is steady"
 *   IS-02  control     an allowed read shows the server's headline
 *   AC-01  RED-BEFORE  Settings > Accounts: a refused list is a refusal, not "No accounts yet"
 *   AC-02  control     an allowed, empty list still says "No accounts yet"
 *   GS-01  RED-BEFORE  Settings > General: the default-account pickers say why no account is listed
 *
 * Mounted on the real components and the real api client (lib/api.ts, lib/client.ts); only `fetch`, the toast,
 * next/navigation, next/headers and the stored business are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (({ kf_token: { value: "tok_1" }, kf_business_id: { value: "biz_1" } }) as Record<string, { value: string }>)[name],
  }),
}));

vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getStoredBusinessId: () => "biz_1",
}));

import { FinanceIntelPanel } from "../_intel-panel";
import FinanceIntelStripSSR from "../_intel-strip-ssr";
import FinanceSettingsPage from "../settings/page";

const FIN = "/finance/businesses/biz_1";
const READ_REFUSAL = "Insufficient permissions: revenue requires read access (you have none)";

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => (text ? (JSON.parse(text) as unknown) : null),
    text: async () => text,
    clone() { return this; },
  } as unknown as Response;
}

/** The production filter's body for a ModuleScopeGuard refusal (http-exception.filter.ts). */
function refused(path: string) {
  return jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message: READ_REFUSAL, error: "Forbidden", timestamp: "2026-11-13T00:00:00.000Z", path }, "Forbidden");
}

function stubServer(route: (method: string, pathname: string) => Response | undefined) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    return route(method, pathname) ?? jsonResponse(200, {});
  }));
}

const SETTINGS = {
  accountingBasis: "CASH",
  fiscalYearStartMonth: 1,
  defaultTaxRate: 0,
  accountantEmail: null,
  defaultCashAccountId: null,
  defaultArAccountId: null,
  defaultApAccountId: null,
  defaultTaxAccountId: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Finance action queue (CRR-P195KG-1)", () => {
  it("IP-01 RED-BEFORE: a refused read is a refusal naming revenue access, not \"All clear\"", async () => {
    stubServer((method, pathname) => (method === "GET" && pathname.endsWith(`${FIN}/intelligence/actions`) ? refused(`${FIN}/intelligence/actions`) : undefined));
    render(<FinanceIntelPanel businessId="biz_1" currency="TTD" compact={false} />);
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument();
  });

  it("IP-02 control: an allowed, empty queue still says \"All clear\"", async () => {
    stubServer((method, pathname) => (method === "GET" && pathname.endsWith(`${FIN}/intelligence/actions`) ? jsonResponse(200, { items: [] }) : undefined));
    render(<FinanceIntelPanel businessId="biz_1" currency="TTD" compact={false} />);
    expect(await screen.findByText(/All clear/)).toBeInTheDocument();
    expect(screen.queryByText(/revenue requires read access/)).not.toBeInTheDocument();
  });
});

describe("Finance insight strip, server-rendered (CRR-P195KG-1)", () => {
  it("IS-01 RED-BEFORE: a refused read is a refusal, not \"Finance is steady\"", async () => {
    stubServer((method, pathname) => (method === "GET" && pathname.endsWith(`${FIN}/intelligence/insight`) ? refused(`${FIN}/intelligence/insight`) : undefined));
    render(await FinanceIntelStripSSR());
    expect(screen.getByText(/revenue requires read access/)).toBeInTheDocument();
    expect(screen.queryByText(/Finance is steady/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No critical risks detected/)).not.toBeInTheDocument();
  });

  it("IS-02 control: an allowed read shows the server's headline", async () => {
    stubServer((method, pathname) =>
      method === "GET" && pathname.endsWith(`${FIN}/intelligence/insight`)
        ? jsonResponse(200, { headline: "Two invoices are late", body: "Chase Alice.", source: "ai", generatedAt: "2026-11-13T00:00:00.000Z" })
        : undefined,
    );
    render(await FinanceIntelStripSSR());
    expect(screen.getByText("Two invoices are late")).toBeInTheDocument();
  });
});

describe("Finance settings (CRR-P195KG-1, CRR-P195KG-2)", () => {
  it("AC-01 RED-BEFORE: Settings > Accounts: a refused list is a refusal naming revenue access, not \"No accounts yet\"", async () => {
    window.history.replaceState(null, "", "/app/finance/settings#accounts");
    stubServer((method, pathname) => (method === "GET" && pathname.endsWith(`${FIN}/accounts`) ? refused(`${FIN}/accounts`) : undefined));
    render(<FinanceSettingsPage />);
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
    expect(screen.queryByText(/No accounts yet/)).not.toBeInTheDocument();
  });

  it("AC-02 control: an allowed, empty list still says \"No accounts yet\"", async () => {
    window.history.replaceState(null, "", "/app/finance/settings#accounts");
    stubServer((method, pathname) => (method === "GET" && pathname.endsWith(`${FIN}/accounts`) ? jsonResponse(200, { items: [] }) : undefined));
    render(<FinanceSettingsPage />);
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument();
  });

  it("GS-01 RED-BEFORE: Settings > General: the default-account pickers say why no account is listed", async () => {
    stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${FIN}/settings`)) return jsonResponse(200, SETTINGS);
      if (method === "GET" && pathname.endsWith(`${FIN}/accounts`)) return refused(`${FIN}/accounts`);
      return undefined;
    });
    render(<FinanceSettingsPage />);
    expect(await screen.findByText("Default accounts")).toBeInTheDocument();
    expect(await screen.findByText(/revenue requires read access/)).toBeInTheDocument();
  });
});
