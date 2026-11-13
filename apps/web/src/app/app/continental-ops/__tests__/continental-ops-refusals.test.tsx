/**
 * SWEEP-P0-SCOPES second review repair (findings CRV-1, major, and CRV-2, minor): the Continental Ops
 * stock-count, goods-receipt and delivery-note screens never show a write the server refused as done.
 *
 * This packet gated every write of these three controllers to storefront write (one class-level
 * ModuleScopeGuard; at base they were membership-only). A member with storefront read (STAFF on role
 * defaults) gets 403 "Insufficient permissions: storefront requires write access (you have read)".
 * The api client answers a refusal as { data: null, error } and does not throw, so:
 *   - CRV-1: each delete handler awaited the delete, ignored the answer, removed the row and said
 *     "Deleted" (the row came back on reload);
 *   - CRV-2: create, adjust, post, fulfil and cancel acted only on res.data and said nothing.
 *
 * Required: a refused write shows the server's refusal (toast.error), says no success and leaves the
 * list as the server holds it; a write the server applies still says so.
 *
 * The network is a fetch stub: reads answer one row, every write answers the server's module-scope
 * 403 (or, for the controls, its success).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/lib/workspace", async (orig) => ({ ...(await orig<object>()), getStoredBusinessId: () => "biz_1" }));

const REFUSAL = "Insufficient permissions: storefront requires write access (you have read)";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Forbidden" : "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text),
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

/** Reads answer `read`; every write answers `write` (the refusal by default). */
function stub(read: unknown, sent: string[], write: { status: number; body: unknown } = { status: 403, body: { statusCode: 403, message: REFUSAL, error: "Forbidden" } }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(url, "http://localhost").pathname;
    sent.push(`${method} ${path}`);
    if (method !== "GET") return jsonResponse(write.status, write.body);
    return jsonResponse(200, read);
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

const PAGES = [
  {
    label: "stock counts",
    load: () => import("../stock-counts/page"),
    row: { id: "sc1", countNumber: "SC-OWNER-1", status: "COMPLETED", items: [], countDate: "2026-11-01T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z" },
    number: "SC-OWNER-1",
    action: { title: "Apply adjustments", path: "/adjust" },
    create: { open: /add count/i, field: "Count Number", submit: /create count/i },
  },
  {
    label: "goods receipts",
    load: () => import("../goods-receipts/page"),
    row: { id: "gr1", grNumber: "GR-OWNER-1", status: "DRAFT", items: [], receivedDate: "2026-11-01T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z" },
    number: "GR-OWNER-1",
    action: { title: "Post to inventory", path: "/post" },
    create: { open: /add g\/r/i, field: "G/R Number", submit: /create g\/r/i },
  },
  {
    label: "delivery notes",
    load: () => import("../delivery-notes/page"),
    row: { id: "dn1", dnNumber: "DN-OWNER-1", status: "ISSUED", items: [], invoiceId: "inv_1", createdAt: "2026-11-01T00:00:00.000Z" },
    number: "DN-OWNER-1",
    action: { title: "Mark delivered", path: "/fulfill" },
    action2: { title: "Cancel", path: "/cancel" },
    create: { open: /add d\/n/i, field: "D/N Number", submit: /create d\/n/i, extra: "Invoice ID" },
  },
] as const;

/** The row's delete button: the red one without a title (cancel, on delivery notes, has one). */
function deleteButton(container: HTMLElement): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button")).filter((b) => b.className.includes("hover:bg-red-500") && !b.getAttribute("title"));
  expect(buttons.length).toBe(1);
  return buttons[0] as HTMLButtonElement;
}

for (const page of PAGES) {
  describe(`Continental Ops ${page.label}: refused writes`, () => {
    it(`[WEB-COPS-DEL] RED-BEFORE (CRV-1): a refused delete shows the server's refusal, keeps the row and never says "Deleted"`, async () => {
      const Page = (await page.load()).default;
      const sent: string[] = [];
      stub({ items: [page.row] }, sent);
      window.confirm = () => true;
      const { container } = render(<Page />);
      await screen.findByText(page.number);
      fireEvent.click(deleteButton(container));
      await waitFor(() => expect(sent.some((s) => s.startsWith("DELETE"))).toBe(true));
      await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(screen.getByText(page.number)).toBeInTheDocument();
    });

    it(`[WEB-COPS-ACT] RED-BEFORE (CRV-2): a refused "${page.action.title}" shows the server's refusal`, async () => {
      const Page = (await page.load()).default;
      const sent: string[] = [];
      stub({ items: [page.row] }, sent);
      window.confirm = () => true;
      render(<Page />);
      await screen.findByText(page.number);
      fireEvent.click(screen.getByTitle(page.action.title));
      await waitFor(() => expect(sent.some((s) => s.startsWith("POST") && s.endsWith(page.action.path))).toBe(true));
      await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    if ("action2" in page) {
      it(`[WEB-COPS-ACT2] RED-BEFORE (CRV-2): a refused "${page.action2.title}" shows the server's refusal`, async () => {
        const Page = (await page.load()).default;
        const sent: string[] = [];
        stub({ items: [page.row] }, sent);
        window.confirm = () => true;
        render(<Page />);
        await screen.findByText(page.number);
        fireEvent.click(screen.getByTitle(page.action2.title));
        await waitFor(() => expect(sent.some((s) => s.startsWith("POST") && s.endsWith(page.action2.path))).toBe(true));
        await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
        expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      });
    }

    it(`[WEB-COPS-NEW] RED-BEFORE (CRV-2): a refused create shows the server's refusal and adds nothing`, async () => {
      const Page = (await page.load()).default;
      const sent: string[] = [];
      stub({ items: [] }, sent);
      render(<Page />);
      fireEvent.click(await screen.findByRole("button", { name: page.create.open }));
      fireEvent.change(screen.getByLabelText(page.create.field), { target: { value: "NEW-1" } });
      if ("extra" in page.create) fireEvent.change(screen.getByLabelText(page.create.extra), { target: { value: "inv_9" } });
      fireEvent.click(screen.getByRole("button", { name: page.create.submit }));
      await waitFor(() => expect(sent.some((s) => s.startsWith("POST"))).toBe(true));
      await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it(`[WEB-COPS-OK] a delete the server applies removes the row and says so`, async () => {
      const Page = (await page.load()).default;
      const sent: string[] = [];
      stub({ items: [page.row] }, sent, { status: 200, body: {} });
      window.confirm = () => true;
      const { container } = render(<Page />);
      await screen.findByText(page.number);
      fireEvent.click(deleteButton(container));
      await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Deleted"));
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByText(page.number)).toBeNull());
    });
  });
}
