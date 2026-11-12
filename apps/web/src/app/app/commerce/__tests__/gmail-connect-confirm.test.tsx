/**
 * R0-CMF5-GMAIL-CONNECT-BINDING review repairs (CR-CMF5-1, CR-CMF5-2): the web
 * half of the owner-only, user-bound Gmail connection.
 *
 * The server links nothing at the OAuth callback: it stages a PENDING
 * connection and sends the browser to /app/commerce?gmail=pending&pending=<id>,
 * and only the owner who started it, confirming the mailbox it was completed
 * with, activates it (GET .../gmail/pending/:id shows that mailbox; POST
 * .../gmail/confirm {pendingId, email} activates it). Connecting, replacing and
 * disconnecting are OWNER only: anyone else gets 403 {code:'GMAIL_OWNER_ONLY'}.
 *
 * RED-BEFORE (pkt/R0-CMF5-GMAIL-CONNECT-BINDING at 929fd95d): nothing in
 * apps/web read gmail=pending or called .../gmail/confirm, so an owner could
 * not finish connecting Gmail in the app; handleDisconnectGmail ignored
 * apiDelete's {error} and showed "Gmail disconnected" on a 403; the Revenue and
 * Marketing connect buttons showed nothing on a 403.
 *
 * Review 2 (CMF5R-3, W08): the confirmation is sent once. RED-BEFORE on
 * 97669ec8: handleConfirmPendingGmail had no in-flight guard and ConfirmDialog
 * never disabled its button, so a second click POSTed confirm again and the
 * owner saw "Gmail connected" next to the server's 404.
 *
 * Mounted on the real hooks, the real commerce page and the real api client
 * (lib/api.ts); only `fetch`, the toast, the router and the page's unrelated
 * children are stubbed, so the error shapes are the ones apiGet/apiPost/apiDelete
 * really produce from the production GlobalHttpExceptionFilter body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: toastMock.toast, Toaster: () => null }));
const { toast } = toastMock;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/lib/workspace", () => ({
  getStoredBusinessId: () => "biz_1",
  refreshWorkspace: async () => "biz_1",
}));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEvent: () => {}, useModuleEmit: () => vi.fn() }));

// The commerce page's unrelated children, reduced to nothing (as commerce-tab-follows-url.test.tsx does).
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/lib/use-return-navigation", () => ({
  useReturnNavigation: () => ({ getReturnLabel: () => "Back", navigateBack: vi.fn() }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: () => {} }));
vi.mock("@/hooks/use-plan", () => ({ usePlan: () => ({ checkLimit: () => ({ allowed: true }) }) }));
vi.mock("@/components/guide/keyflow-unified-shell", () => ({
  KeyflowUnifiedShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/components/ui/skeleton", () => ({ ListPageSkeleton: () => <div>loading</div> }));
vi.mock("@/components/ui/workspace-error", () => ({ WorkspaceError: () => <div>error</div> }));
vi.mock("@/components/ui/mobile-action-sheet", () => ({ MobileActionSheet: () => null }));
vi.mock("@/components/layout/flow-quick-launcher", () => ({ FlowQuickLauncher: () => null }));
vi.mock("../../finance/components/finance-pipeline", () => ({ FinancePipeline: () => null }));
vi.mock("../../finance/components/revenue-composer", () => ({ RevenueComposer: () => null }));
vi.mock("../recurring/recurring-panel", () => ({ default: () => null }));
vi.mock("../components/commerce-overview-tab", () => ({ CommerceOverviewTab: () => null }));
vi.mock("../components/tab-frame", () => ({ TabFrame: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../components/commerce-kpi-strip", () => ({ CommerceKpiStrip: () => null }));
vi.mock("../components/revenue-record-drawer", () => ({ RevenueRecordDrawer: () => null }));
vi.mock("../components/commerce-banners", () => ({ CommerceBanners: () => null }));
vi.mock("../components/commerce-header-right", () => ({ CommerceHeaderRight: () => null }));
vi.mock("../components/revenue-action-menu", () => ({ RevenueActionMenu: () => null }));
vi.mock("../components/standalone-payment-recorder", () => ({ StandalonePaymentRecorder: () => null }));
vi.mock("../hooks/use-billing-workspace", () => ({
  useBillingWorkspace: () => ({
    pendingPrefill: null, prefillForContact: vi.fn(),
    triggerNewQuote: 0, triggerNewInvoice: 0, triggerNewSchedule: 0,
    setTriggerNewQuote: vi.fn(), setTriggerNewInvoice: vi.fn(), setTriggerNewSchedule: vi.fn(),
  }),
}));
/** The shell's data is not under test; its Gmail integration is the real hook. */
vi.mock("../hooks/use-commerce-shell", async () => {
  const { useCommerceIntegrations } = await import("../hooks/use-commerce-integrations");
  return {
    useCommerceShell: () => ({
      businessId: "biz_1", businessCurrency: "TTD",
      workspaceLoading: false, workspaceError: null,
      products: [], setProducts: vi.fn(),
      invoices: [], setInvoices: vi.fn(),
      quotes: [], setQuotes: vi.fn(),
      contacts: [], loading: false, error: null,
      integrations: useCommerceIntegrations("biz_1"),
    }),
  };
});

import { useCommerceIntegrations, GMAIL_OWNER_ONLY_TEXT } from "../hooks/use-commerce-integrations";
import { useMarketing } from "../../marketing/hooks/use-marketing";
import CommercePage from "../page";

const BUSINESS = "biz_1";
const PENDING_ID = "gmc_pending_1";
const STAGED_EMAIL = "someone@gmail.test";

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

/** The production filter's body for the owner-only refusal (http-exception.filter.ts). */
function ownerOnly() {
  return jsonResponse(403, {
    statusCode: 403, code: "GMAIL_OWNER_ONLY",
    message: "Only the business owner can connect, replace or disconnect the business mailbox", error: "Forbidden",
    timestamp: "2026-11-02T00:00:00.000Z", path: "/commerce",
  }, "Forbidden");
}

type Route = (method: string, pathname: string, body: unknown) => Response | undefined;
interface Call { method: string; pathname: string; body: unknown }

/** Answers the routes given, 404 for anything else; returns every request made. */
function stubServer(route: Route) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, pathname, body });
    return route(method, pathname, body) ?? jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  }));
  return calls;
}

const gmailPath = (suffix: string) => `/commerce/businesses/${BUSINESS}/gmail${suffix}`;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/app/commerce");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Revenue Gmail controls surface the owner-only refusal (CR-CMF5-2)", () => {
  it("[R0-CMF5-W01] RED-BEFORE: disconnect refused with 403 GMAIL_OWNER_ONLY shows the owner-only rule, never 'Gmail disconnected', and keeps the mailbox shown as connected", async () => {
    stubServer((method, pathname) => (method === "DELETE" && pathname.endsWith(gmailPath("")) ? ownerOnly() : undefined));
    const { result } = renderHook(() => useCommerceIntegrations(BUSINESS));
    act(() => {
      result.current.setGmailStatus({ connected: true, email: "kept@gmail.test" });
      result.current.setConfirmDisconnectGmail(true);
    });
    await act(async () => { await result.current.handleDisconnectGmail(); });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(GMAIL_OWNER_ONLY_TEXT);
    expect(result.current.gmailStatus).toEqual({ connected: true, email: "kept@gmail.test" });
    expect(result.current.confirmDisconnectGmail).toBe(false);
  });

  it("[R0-CMF5-W02] control: an owner's disconnect (200, empty body) reports success and shows the mailbox disconnected", async () => {
    stubServer((method, pathname) => (method === "DELETE" && pathname.endsWith(gmailPath("")) ? jsonResponse(200, undefined) : undefined));
    const { result } = renderHook(() => useCommerceIntegrations(BUSINESS));
    act(() => result.current.setGmailStatus({ connected: true, email: "mine@gmail.test" }));
    await act(async () => { await result.current.handleDisconnectGmail(); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Gmail disconnected");
    expect(result.current.gmailStatus).toEqual({ connected: false, email: null });
  });

  it("[R0-CMF5-W03] RED-BEFORE: Connect Gmail refused with 403 GMAIL_OWNER_ONLY (Revenue and Marketing) shows the owner-only rule instead of nothing", async () => {
    const calls = stubServer((method, pathname) => (method === "GET" && pathname.endsWith(gmailPath("/auth-url")) ? ownerOnly() : undefined));
    const revenue = renderHook(() => useCommerceIntegrations(BUSINESS));
    await act(async () => { await revenue.result.current.handleConnectGmail(); });
    expect(toast.error).toHaveBeenCalledWith(GMAIL_OWNER_ONLY_TEXT);
    expect(revenue.result.current.loadingGmail).toBe(false);

    toast.error.mockClear();
    const marketing = renderHook(() => useMarketing());
    await waitFor(() => expect(marketing.result.current.businessId).toBe(BUSINESS));
    await act(async () => { await marketing.result.current.handleGmailConnect(); });
    expect(toast.error).toHaveBeenCalledWith(GMAIL_OWNER_ONLY_TEXT);
    expect(calls.filter((c) => c.pathname.endsWith(gmailPath("/auth-url")))).toHaveLength(2);
  });
});

describe("the owner finishes connecting Gmail in the app, seeing the mailbox first (CR-CMF5-1)", () => {
  function pendingServer(onConfirm: (body: unknown) => Response) {
    return stubServer((method, pathname, body) => {
      if (method === "GET" && pathname.endsWith(gmailPath(`/pending/${PENDING_ID}`))) {
        return jsonResponse(200, { pendingId: PENDING_ID, email: STAGED_EMAIL, expiresAt: new Date(Date.now() + 600_000).toISOString() });
      }
      if (method === "POST" && pathname.endsWith(gmailPath("/confirm"))) return onConfirm(body);
      return undefined;
    });
  }

  it("[R0-CMF5-W04] RED-BEFORE: /app/commerce?gmail=pending&pending=<id> reads the staged mailbox, asks 'Connect <email>?', and the owner's click confirms exactly that mailbox; the hand-off leaves the URL", async () => {
    const calls = pendingServer(() => jsonResponse(201, { connected: true, email: STAGED_EMAIL }, "Created"));
    window.history.replaceState({}, "", `/app/commerce?gmail=pending&pending=${PENDING_ID}`);
    render(<CommercePage />);

    expect(await screen.findByText(`Connect ${STAGED_EMAIL}?`)).toBeTruthy();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("pending")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("gmail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Connect mailbox" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`Gmail connected: ${STAGED_EMAIL}`));
    const confirms = calls.filter((c) => c.method === "POST" && c.pathname.endsWith(gmailPath("/confirm")));
    expect(confirms).toHaveLength(1);
    expect(confirms[0].body).toEqual({ pendingId: PENDING_ID, email: STAGED_EMAIL });
    expect(screen.queryByText(`Connect ${STAGED_EMAIL}?`)).toBeNull();
  });

  it("[R0-CMF5-W05] the owner declines ('Not this mailbox'): nothing is confirmed", async () => {
    const calls = pendingServer(() => jsonResponse(201, { connected: true, email: STAGED_EMAIL }, "Created"));
    window.history.replaceState({}, "", `/app/commerce?gmail=pending&pending=${PENDING_ID}`);
    render(<CommercePage />);
    await screen.findByText(`Connect ${STAGED_EMAIL}?`);
    fireEvent.click(screen.getByRole("button", { name: "Not this mailbox" }));
    expect(screen.queryByText(`Connect ${STAGED_EMAIL}?`)).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("[R0-CMF5-W06] a refused confirmation (403 GMAIL_OWNER_ONLY) is shown as the owner-only rule, not as connected", async () => {
    pendingServer(() => ownerOnly());
    window.history.replaceState({}, "", `/app/commerce?gmail=pending&pending=${PENDING_ID}`);
    render(<CommercePage />);
    await screen.findByText(`Connect ${STAGED_EMAIL}?`);
    fireEvent.click(screen.getByRole("button", { name: "Connect mailbox" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GMAIL_OWNER_ONLY_TEXT));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("[R0-CMF5-W07] a pending id the server does not show this user (404) asks nothing and says to connect again; gmail=error says the sign-in failed", async () => {
    const calls = stubServer((method, pathname) =>
      method === "GET" && pathname.endsWith(gmailPath("/pending/gmc_gone"))
        ? jsonResponse(404, { statusCode: 404, code: "GMAIL_PENDING_NOT_FOUND", message: "No pending Gmail connection of yours with this id for this business; start the connection again" }, "Not Found")
        : undefined);
    window.history.replaceState({}, "", "/app/commerce?gmail=pending&pending=gmc_gone");
    const first = render(<CommercePage />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No pending Gmail connection of yours with this id for this business; start the connection again"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    first.unmount();

    toast.error.mockClear();
    window.history.replaceState({}, "", "/app/commerce?gmail=error&reason=invalid_state");
    render(<CommercePage />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That Gmail sign-in expired or was already used. Connect Gmail again."));
    expect(new URLSearchParams(window.location.search).get("gmail")).toBeNull();
  });

  it("[R0-CMF5-W08] review 2 CMF5R-3: while the confirmation is in flight the Connect button is disabled and a second click (or a second call of the hook) sends nothing: one confirm POST, one success toast, no error toast", async () => {
    const releases: Array<(res: Response) => void> = [];
    const held = () => new Promise<Response>((resolve) => { releases.push(resolve); });
    const calls = stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(gmailPath(`/pending/${PENDING_ID}`))) {
        return jsonResponse(200, { pendingId: PENDING_ID, email: STAGED_EMAIL, expiresAt: new Date(Date.now() + 600_000).toISOString() });
      }
      if (method === "POST" && pathname.endsWith(gmailPath("/confirm"))) return held() as unknown as Response;
      return undefined;
    });
    const confirmPosts = () => calls.filter((c) => c.method === "POST" && c.pathname.endsWith(gmailPath("/confirm")));
    const created = () => jsonResponse(201, { connected: true, email: STAGED_EMAIL }, "Created");

    window.history.replaceState({}, "", `/app/commerce?gmail=pending&pending=${PENDING_ID}`);
    const page = render(<CommercePage />);
    await screen.findByText(`Connect ${STAGED_EMAIL}?`);
    fireEvent.click(screen.getByRole("button", { name: "Connect mailbox" }));
    const busy = (await screen.findByRole("button", { name: "Connecting..." })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    fireEvent.click(busy);
    await waitFor(() => expect(releases.length).toBeGreaterThan(0));
    await act(async () => { for (const release of releases) release(created()); });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(`Gmail connected: ${STAGED_EMAIL}`));
    expect(confirmPosts()).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    page.unmount();

    // The hook's own guard: two calls while the first is in flight send one POST.
    vi.clearAllMocks();
    releases.length = 0;
    calls.length = 0;
    const { result } = renderHook(() => useCommerceIntegrations(BUSINESS));
    await act(async () => { await result.current.loadPendingGmail(PENDING_ID); });
    expect(result.current.pendingGmail?.email).toBe(STAGED_EMAIL);
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.handleConfirmPendingGmail();
      second = result.current.handleConfirmPendingGmail();
    });
    await waitFor(() => expect(releases.length).toBeGreaterThan(0));
    await act(async () => {
      for (const release of releases) release(created());
      await Promise.all([first, second]);
    });
    expect(confirmPosts()).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
