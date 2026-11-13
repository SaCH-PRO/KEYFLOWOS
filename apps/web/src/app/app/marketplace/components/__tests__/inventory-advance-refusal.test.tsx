/**
 * PR195-KEY-GATES (review finding CRR-P195BD-1): a purchase order's advance (its receipt posts the purchase) now
 * needs expenses write on the server (PR195-BOOKS-DOORS). The inventory command center's handleAdvancePO ignored
 * the answer (the api client answers a refusal as { error, status } and does not throw): a refused "Mark Received"
 * said nothing and reloaded as though it had worked.
 *
 *   ICC-01  RED-BEFORE  a refused advance says the refusal, claims nothing, and does not refresh the screen
 *   ICC-02  control     an allowed advance reloads the purchase orders and refreshes
 *
 * Mounted on the real component and the real api client (lib/api.ts); only `fetch`, the toast and
 * next/navigation are stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

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
  usePathname: () => "/app/marketplace",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { InventoryCommandCenter } from "../inventory-command-center";

const BUSINESS = "biz_1";
const BASE = `/marketplace/businesses/${BUSINESS}`;
const REFUSAL = "Insufficient permissions: expenses requires write access (you have read)";

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

interface Call { method: string; pathname: string }

function stubServer(advance: () => Response) {
  const calls: Call[] = [];
  /** The order as the server holds it: SHIPPED until an advance is answered 2xx. */
  let received = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, pathname });
    if (method === "POST" && pathname.endsWith(`${BASE}/purchase-orders/po_1/advance`)) {
      const answer = advance();
      if (answer.ok) received = true;
      return answer;
    }
    if (method === "GET" && pathname.endsWith(`${BASE}/purchase-orders`)) return jsonResponse(200, [{ ...PO, status: received ? "RECEIVED" : "SHIPPED" }]);
    return jsonResponse(200, {});
  }));
  return calls;
}

const PO = { id: "po_1", poNumber: "PO-0001", status: "SHIPPED", supplierName: "Acme Supply", total: 40, items: [] };

function renderCenter(onRefresh: () => void) {
  return render(
    <InventoryCommandCenter
      businessId={BUSINESS}
      basePath={BASE}
      warehouses={[]}
      inventory={[]}
      products={[]}
      purchaseOrders={[PO] as never}
      onCreateWarehouse={() => {}}
      onEditWarehouse={() => {}}
      onDeleteWarehouse={() => {}}
      onAddInventory={() => {}}
      onCreatePO={() => {}}
      onEditPO={() => {}}
      onRefresh={onRefresh}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  (toast.error as ReturnType<typeof vi.fn>).mockClear();
  (toast.success as ReturnType<typeof vi.fn>).mockClear();
});

describe("inventory command center: Mark Received (CRR-P195BD-1)", () => {
  it("ICC-01 RED-BEFORE: a refused advance says the refusal and does not refresh", async () => {
    const calls = stubServer(() => jsonResponse(403, { statusCode: 403, code: "FORBIDDEN", message: REFUSAL, error: "Forbidden" }, "Forbidden"));
    const onRefresh = vi.fn();
    renderCenter(onRefresh);
    fireEvent.click(screen.getByRole("button", { name: /Purchase Orders/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark Received/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(REFUSAL)));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    const reloads = () => calls.filter((c) => c.method === "GET" && c.pathname.endsWith(`${BASE}/purchase-orders`)).length;
    const before = reloads();
    await new Promise((r) => setTimeout(r, 50));
    expect(reloads()).toBe(before);
    expect(screen.getByRole("button", { name: /Mark Received/ })).toBeInTheDocument();
  });

  it("ICC-02 control: an allowed advance reloads the purchase orders and refreshes", async () => {
    stubServer(() => jsonResponse(201, { ...PO, status: "RECEIVED" }));
    const onRefresh = vi.fn();
    renderCenter(onRefresh);
    fireEvent.click(screen.getByRole("button", { name: /Purchase Orders/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Mark Received/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
