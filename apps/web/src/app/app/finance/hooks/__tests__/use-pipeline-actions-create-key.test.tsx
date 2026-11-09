/**
 * V1-45b-CREATE-IDEMPOTENCY-HTTP (owner ruling D-15): the finance pipeline's
 * Duplicate actions create a quote or an invoice. Each duplicate of a document
 * is one create with one Idempotency-Key (crypto.randomUUID, kept in a ref):
 * a retry after a failed answer (a lost response) reuses it, so the server
 * answers the copy the first attempt made; once a duplicate succeeds, the next
 * Duplicate of that document is a new copy with a new key. At the base the
 * action sent no key, so a retried duplicate made two copies.
 *
 * The real hook and client run; fetch is stubbed at the network edge.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { renderHook, act, cleanup } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { usePipelineActions } from "../use-pipeline-actions";
import type { Invoice, Quote } from "@/lib/client";

const BIZ = "biz_v45b_pl";
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

type Call = { method: string; path: string; key: string | null };

function installServer() {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, path: url.pathname, key: new Headers(init?.headers).get("Idempotency-Key") });
      if (method === "POST" && (url.pathname === PATHS.quote || url.pathname === PATHS.invoice)) {
        const n = (counts[url.pathname] = (counts[url.pathname] ?? 0) + 1);
        if (n === 1) return jsonResponse(502, { message: "Bad gateway" });
        return jsonResponse(201, { id: `copy_${n}`, status: "DRAFT", total: 100, currency: "TTD", items: [] });
      }
      return jsonResponse(200, {});
    }),
  );
  return { creates: (kind: "quote" | "invoice") => calls.filter((c) => c.method === "POST" && c.path === PATHS[kind]) };
}

const QUOTE = {
  id: "q_src",
  quoteNumber: "QT-0001",
  status: "SENT",
  total: 100,
  currency: "TTD",
  contactId: "ct_v45b",
  items: [{ id: "qi_1", description: "Consultation", quantity: 1, unitPrice: 100, total: 100 }],
} as unknown as Quote;
const INVOICE = {
  id: "inv_src",
  invoiceNumber: "INV-0001",
  status: "SENT",
  total: 100,
  currency: "TTD",
  contactId: "ct_v45b",
  items: [{ id: "ii_1", description: "Consultation", quantity: 1, unitPrice: 100, total: 100 }],
} as unknown as Invoice;

function useHarness() {
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [quotes, setQuotes] = React.useState<Quote[]>([]);
  return { actions: usePipelineActions({ businessId: BIZ, invoices, quotes, setInvoices, setQuotes }), invoices, quotes };
}

describe("V1-45b usePipelineActions: Duplicate sends one Idempotency-Key per copy", () => {
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
    it(`${kind}: a retried duplicate reuses its key; the next duplicate after a success mints a new one`, async () => {
      let n = 0;
      vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
        () => `0000000${++n}-ffff-4fff-8fff-ffffffffffff` as `${string}-${string}-${string}-${string}-${string}`,
      );
      const server = installServer();
      const { result } = renderHook(() => useHarness());
      const duplicate = () =>
        kind === "quote" ? result.current.actions.handleDuplicateQuote(QUOTE) : result.current.actions.handleDuplicateInvoice(INVOICE);

      await act(async () => { await duplicate(); }); // 502: the copy may or may not exist
      await act(async () => { await duplicate(); }); // the retry: 201
      await act(async () => { await duplicate(); }); // a new copy: 201

      const keys = server.creates(kind).map((c) => c.key);
      expect(keys).toHaveLength(3);
      expect(keys[0], "the first attempt sends a key").toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
      expect(keys[1], "the retry reuses it").toBe(keys[0]);
      expect(keys[2], "a new copy mints a new one").toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
      expect(keys[2]).not.toBe(keys[0]);
      const listed = kind === "quote" ? result.current.quotes : result.current.invoices;
      expect(listed.map((d) => d.id)).toEqual(["copy_3", "copy_2"]);
    });
  }
});
