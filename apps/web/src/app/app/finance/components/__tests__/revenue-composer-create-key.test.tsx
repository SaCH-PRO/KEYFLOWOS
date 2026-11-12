/**
 * V1-45b-CREATE-IDEMPOTENCY-HTTP (owner ruling D-15): the revenue composer
 * (the quote and invoice forms the Revenue page opens) sends one
 * Idempotency-Key per open of each form, minted with crypto.randomUUID and
 * kept in a ref, on every save of that open; the next open mints a new key.
 * At the base no form minted a key, so a save retried after a lost response
 * created a second document.
 *
 * The composer is mounted with its real hooks and the real client; fetch is
 * stubbed at the network edge. The form modal is reduced to buttons that fill
 * one line, save and close (the composer's own handlers run).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

type StubProps = {
  open: boolean;
  docType: "quote" | "invoice";
  items: Array<{ id: string }>;
  onSubmit: () => void;
  onClose: () => void;
  onContactChange: (id: string) => void;
  onUpdateItem: (id: string, field: string, value: string) => void;
};
vi.mock("../../../commerce/components/billing-form-modal", () => ({
  BillingFormModal: (props: StubProps) =>
    props.open ? (
      <div>
        <button
          onClick={() => {
            props.onContactChange("ct_v45b");
            props.onUpdateItem(props.items[0]!.id, "description", "Consultation");
            props.onUpdateItem(props.items[0]!.id, "unitPrice", "100");
          }}
        >
          Fill {props.docType}
        </button>
        <button onClick={props.onSubmit}>Save {props.docType}</button>
        <button onClick={props.onClose}>Close {props.docType}</button>
      </div>
    ) : null,
}));

import { RevenueComposer } from "../revenue-composer";

const BIZ = "biz_v45b_rc";
const PATHS = { quote: `/commerce/businesses/${BIZ}/quotes`, invoice: `/commerce/businesses/${BIZ}/invoices` };

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

/** POST answers per path: 502 first, then 201 (the last answer repeats). */
function installServer() {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, path: url.pathname, key: new Headers(init?.headers).get("Idempotency-Key"), body });
      if (method === "POST" && (url.pathname === PATHS.quote || url.pathname === PATHS.invoice)) {
        const n = (counts[url.pathname] = (counts[url.pathname] ?? 0) + 1);
        if (n === 1) return jsonResponse(502, { message: "Bad gateway" });
        return jsonResponse(201, { id: `doc_${n}`, status: "DRAFT", total: 100, currency: "TTD", items: [] });
      }
      return jsonResponse(200, {});
    }),
  );
  return { creates: (kind: "quote" | "invoice") => calls.filter((c) => c.method === "POST" && c.path === PATHS[kind]) };
}

function Composer({ quoteTick, invoiceTick }: { quoteTick: number; invoiceTick: number }) {
  return (
    <RevenueComposer
      businessId={BIZ}
      contacts={[]}
      products={[]}
      setQuotes={vi.fn()}
      setInvoices={vi.fn()}
      setProducts={vi.fn()}
      triggerNewQuote={quoteTick}
      triggerNewInvoice={invoiceTick}
    />
  );
}

describe("V1-45b revenue composer: one Idempotency-Key per open of the quote and invoice forms", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-v45b");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  for (const kind of ["quote", "invoice"] as const) {
    it(`${kind}: a retried save of one open reuses its key; the next open mints a new one`, async () => {
      let n = 0;
      vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
        () => `0000000${++n}-eeee-4eee-8eee-eeeeeeeeeeee` as `${string}-${string}-${string}-${string}-${string}`,
      );
      const server = installServer();
      const ticks = (t: number) => (kind === "quote" ? { quoteTick: t, invoiceTick: 0 } : { quoteTick: 0, invoiceTick: t });
      const { rerender } = render(<Composer {...ticks(0)} />);

      rerender(<Composer {...ticks(1)} />);
      fireEvent.click(await screen.findByRole("button", { name: `Fill ${kind}` }));
      fireEvent.click(screen.getByRole("button", { name: `Save ${kind}` }));
      await waitFor(() => expect(server.creates(kind)).toHaveLength(1));
      fireEvent.click(await screen.findByRole("button", { name: `Save ${kind}` }));
      await waitFor(() => expect(server.creates(kind)).toHaveLength(2));
      await waitFor(() => expect(screen.queryByRole("button", { name: `Save ${kind}` })).toBeNull());

      rerender(<Composer {...ticks(2)} />);
      fireEvent.click(await screen.findByRole("button", { name: `Fill ${kind}` }));
      fireEvent.click(screen.getByRole("button", { name: `Save ${kind}` }));
      await waitFor(() => expect(server.creates(kind)).toHaveLength(3));

      const keys = server.creates(kind).map((c) => c.key);
      expect(keys[0], "the first save sends a key").toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
      expect(keys[1], "the retry of the same open reuses it").toBe(keys[0]);
      expect(keys[2], "the next open mints a new one").toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
      expect(keys[2]).not.toBe(keys[0]);
      for (const c of server.creates(kind)) expect(c.body).not.toHaveProperty("idempotencyKey");
    });
  }
});
