/**
 * V1-45b-CREATE-IDEMPOTENCY-HTTP (owner ruling D-15): the full-page invoice
 * form (/app/commerce/invoices/new) sends one Idempotency-Key per open of the
 * page, minted with crypto.randomUUID and kept in a ref, on every save of that
 * open (Save Draft and Save & Send alike), so a save retried after a lost
 * response is answered with the invoice the first one created. A new open of
 * the page (a new mount) mints a new key. At the base no form minted a key.
 *
 * The page is mounted with the real client and api layer; fetch is stubbed at
 * the network edge. The workspace resolution and the contact / product lists
 * are stubbed (they are reads the save does not depend on).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const push = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce/invoices/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: async () => "biz_v45b_new",
  getStoredBusinessId: () => "biz_v45b_new",
  getCachedBusiness: () => ({ id: "biz_v45b_new", currency: "TTD" }),
}));
vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return {
    ...actual,
    fetchContacts: async () => ({ data: { contacts: [] }, error: null }),
    fetchProducts: async () => ({ data: [], error: null }),
  };
});

import NewInvoicePage from "../page";

const BIZ = "biz_v45b_new";
const CREATE_PATH = `/commerce/businesses/${BIZ}/invoices`;

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Error" : "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

type Call = { method: string; path: string; key: string | null; body: Record<string, unknown> | null };

function installServer(answers: Array<() => Promise<Response>>) {
  const calls: Call[] = [];
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, path: url.pathname, key: new Headers(init?.headers).get("Idempotency-Key"), body });
      if (method === "POST" && url.pathname === CREATE_PATH) {
        const answer = answers[Math.min(index, answers.length - 1)]!;
        index += 1;
        return answer();
      }
      return jsonResponse(200, {});
    }),
  );
  return { creates: () => calls.filter((c) => c.method === "POST" && c.path === CREATE_PATH) };
}

async function fillOneLine() {
  const description = await screen.findByPlaceholderText("Item description");
  fireEvent.change(description, { target: { value: "Consultation" } });
  const price = document.querySelector('input[step="0.01"]') as HTMLInputElement;
  fireEvent.change(price, { target: { value: "100" } });
}

function saveDraft(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Save Draft/ }) as HTMLButtonElement;
}

describe("V1-45b new invoice page: one Idempotency-Key per open of the page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-v45b");
    push.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("a retried save of one open reuses its key; a new open of the page mints a new one", async () => {
    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `0000000${++n}-bbbb-4bbb-8bbb-bbbbbbbbbbbb` as `${string}-${string}-${string}-${string}-${string}`,
    );
    const created = async () => jsonResponse(201, { id: "inv_v45b_new", invoiceNumber: "INV-0001", status: "DRAFT", total: 100, currency: "TTD" });
    const server = installServer([async () => jsonResponse(502, { message: "Bad gateway" }), created, created]);

    const first = render(<NewInvoicePage />);
    await fillOneLine();
    fireEvent.click(saveDraft());
    await waitFor(() => expect(server.creates()).toHaveLength(1));
    await waitFor(() => expect(saveDraft()).not.toBeDisabled());
    fireEvent.click(saveDraft());
    await waitFor(() => expect(server.creates()).toHaveLength(2));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/commerce/invoices/inv_v45b_new"));
    first.unmount();

    render(<NewInvoicePage />);
    await fillOneLine();
    fireEvent.click(saveDraft());
    await waitFor(() => expect(server.creates()).toHaveLength(3));

    const keys = server.creates().map((c) => c.key);
    expect(keys[0], "the first save sends a key").toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(keys[1], "the retry of the same open reuses it").toBe(keys[0]);
    expect(keys[2], "a new open mints a new one").toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(keys[2]).not.toBe(keys[0]);
    for (const c of server.creates()) expect(c.body).not.toHaveProperty("idempotencyKey");
  });
});
