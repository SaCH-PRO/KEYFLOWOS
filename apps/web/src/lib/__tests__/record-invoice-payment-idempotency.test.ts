/**
 * R0-21-WEB-PAYMENT-FORMS: every web form that records an invoice payment sends
 * an idempotency key (M26, CF-08).
 *
 * The server (R0-D2, RecordPaymentDto) deduplicates a manual payment on
 * POST /commerce/businesses/:businessId/invoices/:invoiceId/payments only when
 * the body carries `idempotencyKey` (or a non-empty reference). No web form
 * sent one, so an operator retrying after a lost response recorded the payment
 * twice. The server reads the key from the BODY (RecordPaymentDto.idempotencyKey;
 * there is no header), so that is what the client sends.
 *
 * This file holds the client contract, a source guard over every caller of
 * recordInvoicePayment, and the invoice detail page's form (the other two forms
 * have their own files: payment-record-modal.test.tsx and
 * invoices-panel-submit.test.tsx).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import React from "react";
import { render, screen, cleanup, fireEvent, act, waitFor, within } from "@testing-library/react";

const refreshAccessToken = vi.fn();
const BIZ = "biz_r021d";
const INV = "inv_r021d";

vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return {
    ...actual,
    refreshAccessToken: () => refreshAccessToken(),
    refreshWorkspace: async () => BIZ,
    getStoredBusinessId: () => BIZ,
  };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: INV }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => `/app/commerce/invoices/${INV}`,
}));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));

const PAY_PATH = `/commerce/businesses/${BIZ}/invoices/${INV}/payments`;
const DETAIL_PATH = `/commerce/businesses/${BIZ}/invoices/${INV}`;

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? "Unauthorized" : status >= 400 ? "Error" : "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? "null")) as Record<string, unknown>;
}

function pathOf(call: unknown[]): string {
  const input = call[0] as string | Request;
  return new URL(typeof input === "string" ? input : input.url).pathname;
}

const recorded = {
  payment: { id: "p_1", amount: 40, status: "SUCCESSFUL", currency: "TTD", provider: "Cash", providerPaymentId: "manual_x", createdAt: "2026-10-30T10:00:00.000Z", businessId: BIZ, invoiceId: INV },
  invoice: { id: INV, status: "PARTIALLY_PAID", total: 100, currency: "TTD", payments: [] },
  paidAmount: 40,
  remaining: 60,
};

describe("recordInvoicePayment sends the idempotency key in the body the server reads", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-r021");
    refreshAccessToken.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("POSTs { amount, method, reference, notes, idempotencyKey } to the tenant payments route", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, recorded));
    const { recordInvoicePayment } = await import("@/lib/client");
    const res = await recordInvoicePayment(BIZ, INV, {
      amount: 40, method: "Cash", reference: "slip-9", notes: "counter", idempotencyKey: "k-123",
    });

    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ paidAmount: 40, remaining: 60 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pathOf(fetchMock.mock.calls[0]!)).toBe(PAY_PATH);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(bodyOf(fetchMock.mock.calls[0]!)).toEqual({
      amount: 40, method: "Cash", reference: "slip-9", notes: "counter", idempotencyKey: "k-123",
    });
  });

  it("a 401 refresh-and-retry resends the same key, so the server sees one attempt", async () => {
    refreshAccessToken.mockImplementation(async () => {
      window.localStorage.setItem("kf_token", "fresh-token");
      return true;
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: "jwt expired" }))
      .mockResolvedValueOnce(jsonResponse(201, recorded));
    const { recordInvoicePayment } = await import("@/lib/client");
    await recordInvoicePayment(BIZ, INV, { amount: 40, method: "Cash", idempotencyKey: "k-retry" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchMock.mock.calls[0]!).idempotencyKey).toBe("k-retry");
    expect(bodyOf(fetchMock.mock.calls[1]!).idempotencyKey).toBe("k-retry");
  });
});

describe("source guard: the input type declares the key and every caller passes one", () => {
  const webSrc = path.resolve(__dirname, "../..");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  /** The argument text of each `recordInvoicePayment(` call, matched to its closing paren. */
  function callsIn(source: string): string[] {
    const calls: string[] = [];
    const re = /\brecordInvoicePayment\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const before = source.slice(Math.max(0, m.index - 30), m.index);
      if (/function\s+$/.test(before)) continue; // the declaration itself
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < source.length && depth > 0) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")") depth--;
        i++;
      }
      calls.push(source.slice(m.index, i));
    }
    return calls;
  }

  it("client.ts: recordInvoicePayment's input type declares an optional string idempotencyKey", () => {
    const client = fs.readFileSync(path.join(webSrc, "lib/client.ts"), "utf8");
    const decl = client.match(/export async function recordInvoicePayment\([\s\S]*?\}\)\s*:/);
    expect(decl).not.toBeNull();
    expect(decl![0]).toMatch(/\bidempotencyKey\?:\s*string\b/);
  });

  it("every call of recordInvoicePayment under apps/web/src passes an idempotencyKey", () => {
    const callers: Record<string, string[]> = {};
    for (const file of walk(webSrc)) {
      const source = fs.readFileSync(file, "utf8");
      const calls = callsIn(source);
      if (calls.length) callers[path.relative(webSrc, file)] = calls;
    }
    // The three operator forms that record a manual payment (a new caller
    // must join this list and pass a key).
    expect(Object.keys(callers).sort()).toEqual([
      "app/app/commerce/invoices/[id]/page.tsx",
      "app/app/commerce/invoices/invoices-panel.tsx",
      "app/app/finance/hooks/use-pipeline-actions.ts",
    ]);
    for (const [file, calls] of Object.entries(callers)) {
      for (const call of calls) {
        expect(call, `${file}: ${call.slice(0, 80)}`).toMatch(/\bidempotencyKey\b/);
      }
    }
  });
});

describe("invoice detail page: one key per form open, reused on retry, single submit", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-r021");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function installServer(pay: Array<() => Promise<Response>>) {
    const posts: Array<Record<string, unknown>> = [];
    let i = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const p = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input)).pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && p === DETAIL_PATH) {
        return jsonResponse(200, {
          id: INV, invoiceNumber: "INV-R021D", status: "PARTIALLY_PAID", total: 100, currency: "TTD",
          payments: [{ ...recorded.payment, id: "p_0", amount: 30 }], paidAmount: 30, remaining: 70,
        });
      }
      if (method === "GET" && p.endsWith("/timeline")) return jsonResponse(200, { invoiceId: INV, entries: [] });
      if (method === "GET" && p === PAY_PATH) return jsonResponse(200, { payments: [], paidAmount: 30, remaining: 70, invoiceTotal: 100 });
      if (method === "POST" && p === PAY_PATH) {
        posts.push(JSON.parse(String(init?.body ?? "null")) as Record<string, unknown>);
        const next = pay[Math.min(i, pay.length - 1)]!;
        i++;
        return next();
      }
      return jsonResponse(200, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    return posts;
  }

  async function mountPage() {
    const { default: InvoiceDetailPage } = await import("@/app/app/commerce/invoices/[id]/page");
    render(React.createElement(InvoiceDetailPage));
    await screen.findByRole("heading", { name: /Invoice INV-R021D/ });
  }

  function form() {
    const heading = screen.getByRole("heading", { name: "Record Payment" });
    return within(heading.parentElement as HTMLElement);
  }

  async function openForm() {
    fireEvent.click(screen.getAllByRole("button", { name: /^Record Payment$/ })[0]!);
    await screen.findByRole("heading", { name: "Record Payment" });
  }

  it("each open gets one crypto.randomUUID key, a retry reuses it, the next open gets a new one", async () => {
    const uuids = ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ffffffff-ffff-4fff-8fff-ffffffffffff"];
    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => uuids[Math.min(n++, uuids.length - 1)] as `${string}-${string}-${string}-${string}-${string}`,
    );
    const posts = installServer([
      async () => jsonResponse(502, { message: "Bad gateway" }),
      async () => jsonResponse(201, recorded),
      async () => jsonResponse(201, recorded),
    ]);
    await mountPage();

    await openForm();
    fireEvent.change(form().getByRole("spinbutton"), { target: { value: "40" } });
    fireEvent.click(form().getByRole("button", { name: "Record Payment" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    await waitFor(() => expect(form().getByRole("button", { name: "Record Payment" })).not.toBeDisabled());
    fireEvent.click(form().getByRole("button", { name: "Record Payment" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Record Payment" })).toBeNull());

    expect(typeof posts[0]!.idempotencyKey).toBe("string");
    expect(posts[0]!.idempotencyKey).toBe(uuids[0]);
    expect(posts[1]!.idempotencyKey).toBe(posts[0]!.idempotencyKey);

    await openForm();
    fireEvent.change(form().getByRole("spinbutton"), { target: { value: "10" } });
    fireEvent.click(form().getByRole("button", { name: "Record Payment" }));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(typeof posts[2]!.idempotencyKey).toBe("string");
    expect(posts[2]!.idempotencyKey).not.toBe(posts[0]!.idempotencyKey);
  });

  it("a double click on Record Payment gives one POST", async () => {
    let release: (r: Response) => void = () => {};
    const posts = installServer([() => new Promise<Response>((resolve) => { release = resolve; })]);
    await mountPage();
    await openForm();
    fireEvent.change(form().getByRole("spinbutton"), { target: { value: "40" } });

    const button = form().getByRole("button", { name: "Record Payment" }) as HTMLButtonElement;
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(posts.length).toBeGreaterThanOrEqual(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(posts).toHaveLength(1);
    await act(async () => { release(jsonResponse(201, recorded)); });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Record Payment" })).toBeNull());
  });

  it("characterization: shows the server's paid and remaining and keeps them current from the record response", async () => {
    // Server-shaped: recordPayment answers the updated invoice with its rows
    // (a PENDING row included) and the SUCCESSFUL-only paidAmount/remaining.
    const rows = [
      { ...recorded.payment, id: "p_0", amount: 30 },
      { ...recorded.payment, id: "p_1", amount: 40 },
      { ...recorded.payment, id: "p_2", amount: 500, status: "PENDING" },
    ];
    installServer([async () => jsonResponse(201, {
      ...recorded,
      invoice: { ...recorded.invoice, payments: rows },
      paidAmount: 70,
      remaining: 30,
    })]);
    await mountPage();
    const paid = () => screen.getByText("Paid", { selector: "span" }).nextElementSibling?.textContent ?? "";
    const remaining = () => screen.getAllByText("Remaining", { selector: "span" }).map((e) => e.nextElementSibling?.textContent ?? "").join("|");
    expect(paid()).toMatch(/30\.00/);
    expect(remaining()).toMatch(/70\.00/);

    await openForm();
    fireEvent.change(form().getByRole("spinbutton"), { target: { value: "40" } });
    fireEvent.click(form().getByRole("button", { name: "Record Payment" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Record Payment" })).toBeNull());
    // Characterization: the figures follow the response's paidAmount/remaining
    // (the PENDING 500 row is not cash).
    await waitFor(() => expect(paid()).toMatch(/70\.00/));
    expect(remaining()).toMatch(/30\.00/);
  });
});
