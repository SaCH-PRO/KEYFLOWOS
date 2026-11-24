/**
 * MOUNT-QUOTES, defence in depth (BUG-033): no bulk status change on quotes
 * ever reaches the server as a delete unless it is the bulk Delete itself.
 *
 * At main 9a7b5011 use-pipeline-actions' handleBulkStatusChange mapped a quote's
 * bulk status as "SENT" -> send, "REJECTED" -> reject, anything else -> delete,
 * so the pipeline's Status > Void (an invoice status the menu offered for a
 * mixed selection) deleted every selected quote. FinancePipeline leaves Sales
 * with this packet; the hook still guards itself for any mount to come.
 *
 * THE RULE: for quotes, VOID (and any status the quote route has no action for)
 * is refused with a notice, never a delete; the invoices in the same selection
 * are still voided; DELETE is the only status that deletes.
 *
 *   PQV-01  RED-BEFORE  VOID on a mixed selection: no quotes/bulk call, invoices/bulk gets "void", the member is told
 *   PQV-02  RED-BEFORE  an unknown status (PAID) never deletes quotes
 *   PQV-03  control     SENT -> send, REJECTED -> reject, DELETE -> delete (the bulk Delete)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { renderHook, act, cleanup } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));

import { toast } from "sonner";
import { usePipelineActions } from "../use-pipeline-actions";
import type { Invoice, Quote } from "@/lib/client";

const BIZ = "biz_v1mq_void";
const QUOTES_BULK = `/commerce/businesses/${BIZ}/quotes/bulk`;
const INVOICES_BULK = `/commerce/businesses/${BIZ}/invoices/bulk`;

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, statusText: "OK", json: async () => JSON.parse(text) as unknown, text: async () => text } as unknown as Response;
}

type Call = { path: string; body: { ids: string[]; action: string } };
function installServer() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    if ((init?.method ?? "GET").toUpperCase() === "PATCH" && (url.pathname === QUOTES_BULK || url.pathname === INVOICES_BULK)) {
      const body = JSON.parse(String(init?.body)) as { ids: string[]; action: string };
      calls.push({ path: url.pathname, body });
      return jsonResponse(200, { updated: body.ids.length, action: body.action, skipped: [] });
    }
    return jsonResponse(200, {});
  }));
  return {
    quoteCalls: () => calls.filter((c) => c.path === QUOTES_BULK),
    invoiceCalls: () => calls.filter((c) => c.path === INVOICES_BULK),
  };
}

const quote = (id: string, status: Quote["status"]): Quote =>
  ({ id, quoteNumber: `QT-${id}`, status, total: 100, currency: "TTD", items: [], contactId: "ct", businessId: BIZ, issueDate: "2026-11-01", createdAt: "2026-11-01" }) as unknown as Quote;
const invoice = (id: string, status: string): Invoice =>
  ({ id, invoiceNumber: `INV-${id}`, status, total: 100, currency: "TTD", items: [], contactId: null, contact: null }) as unknown as Invoice;

function useHarness(quotes0: Quote[], invoices0: Invoice[]) {
  const [quotes, setQuotes] = React.useState<Quote[]>(quotes0);
  const [invoices, setInvoices] = React.useState<Invoice[]>(invoices0);
  const actions = usePipelineActions({ businessId: BIZ, invoices, quotes, setInvoices, setQuotes });
  return { actions, quotes, invoices };
}

const toastText = () => {
  const t = toast as unknown as Record<string, { mock: { calls: unknown[][] } }> & { mock: { calls: unknown[][] } };
  return [t, t.success, t.error, t.info, t.warning, t.message].flatMap((fn) => fn.mock.calls).flat().filter((a): a is string => typeof a === "string");
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("MOUNT-QUOTES: a quote VOID never deletes (use-pipeline-actions)", () => {
  it("PQV-01 RED-BEFORE: VOID on a mixed selection refuses the quotes, voids the invoices, and says so", async () => {
    const server = installServer();
    const { result } = renderHook(() => useHarness([quote("q1", "SENT"), quote("q2", "DRAFT")], [invoice("i1", "SENT")]));
    await act(async () => {
      await result.current.actions.handleBulkStatusChange(new Set(["q1", "q2", "i1"]), "VOID");
    });
    expect(server.quoteCalls()).toEqual([]);
    expect(server.invoiceCalls().map((c) => c.body)).toEqual([{ ids: ["i1"], action: "void" }]);
    // The quotes are untouched locally too.
    expect(result.current.quotes.map((q) => q.status)).toEqual(["SENT", "DRAFT"]);
    expect(toastText().some((t) => /quote/i.test(t) && /void/i.test(t) && /reject/i.test(t))).toBe(true);
  });

  it("PQV-02 RED-BEFORE: a status the quote route has no action for (PAID) never deletes quotes", async () => {
    const server = installServer();
    const { result } = renderHook(() => useHarness([quote("q1", "SENT")], []));
    await act(async () => {
      await result.current.actions.handleBulkStatusChange(new Set(["q1"]), "PAID");
    });
    expect(server.quoteCalls()).toEqual([]);
    expect(result.current.quotes).toHaveLength(1);
  });

  it("PQV-03 control: SENT sends, REJECTED rejects, and DELETE (the bulk Delete) deletes", async () => {
    const server = installServer();
    const { result } = renderHook(() => useHarness([quote("q1", "DRAFT"), quote("q2", "SENT"), quote("q3", "DRAFT")], []));
    await act(async () => {
      await result.current.actions.handleBulkStatusChange(new Set(["q1"]), "SENT");
      await result.current.actions.handleBulkStatusChange(new Set(["q2"]), "REJECTED");
      await result.current.actions.handleBulkDelete(new Set(["q3"]));
    });
    expect(server.quoteCalls().map((c) => c.body)).toEqual([
      { ids: ["q1"], action: "send" },
      { ids: ["q2"], action: "reject" },
      { ids: ["q3"], action: "delete" },
    ]);
    expect(result.current.quotes.map((q) => `${q.id}:${q.status}`)).toEqual(["q1:SENT", "q2:REJECTED"]);
  });
});
