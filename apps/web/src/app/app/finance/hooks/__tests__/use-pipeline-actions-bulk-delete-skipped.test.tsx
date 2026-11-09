/**
 * W3-B6-WEB-BULK-SKIPPED (review CR-B6-1, owner ruling D-66): only DRAFT and
 * VOID invoices may be deleted, and PATCH invoices/bulk {action:"delete"}
 * deletes those and lists every refused invoice in `skipped` (id,
 * invoiceStatus and the single route's reason) with `skippedCount`
 * (FOLLOW3-B6). The finance pipeline's bulk delete
 * (usePipelineActions.handleBulkStatusChange) ignored both: it toasted
 * "N invoice(s) updated" and dropped every selected invoice from the list, so
 * a SENT invoice the server kept vanished from the screen with no word of why.
 *
 * The real hook and client run; fetch is stubbed at the network edge with the
 * server's bulk-delete answer.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { renderHook, act, cleanup } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));

import { toast } from "sonner";
import { usePipelineActions } from "../use-pipeline-actions";
import type { Invoice, Quote } from "@/lib/client";

const BIZ = "biz_w3b6_pl";
const BULK_PATH = `/commerce/businesses/${BIZ}/invoices/bulk`;
const VOID_FIRST = "Cannot delete a SENT invoice: only DRAFT and VOID invoices can be deleted; void it first";
const REFUND_FIRST = "Cannot delete an OVERDUE invoice: it holds TTD 40.00 received; refund the money received first, then void it";

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

function invoice(id: string, invoiceNumber: string, status: string): Invoice {
  return { id, invoiceNumber, status, total: 100, currency: "TTD", items: [], contactId: null, contact: null } as unknown as Invoice;
}

type Skip = { id: string; invoiceStatus: string; reason: string };

function installServer(answer: { updated: number; skipped: Skip[] }) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH" && url.pathname === BULK_PATH) {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse(200, { updated: answer.updated, action: "delete", skipped: answer.skipped, skippedCount: answer.skipped.length });
      }
      return jsonResponse(200, {});
    }),
  );
  return { bodies };
}

/** Every string a toast was shown with (title and description), whichever toast kind. */
function shownToasts(): string[] {
  const t = toast as unknown as Record<string, { mock: { calls: unknown[][] } }> & { mock: { calls: unknown[][] } };
  const calls = [t, t.success, t.error, t.info, t.warning, t.message].flatMap((fn) => fn.mock.calls);
  return calls.flatMap((args) =>
    args.flatMap((a) => (typeof a === "string" ? [a] : a && typeof a === "object" ? Object.values(a).filter((v): v is string => typeof v === "string") : [])),
  );
}

function useHarness(initial: Invoice[]) {
  const [invoices, setInvoices] = React.useState<Invoice[]>(initial);
  const [quotes, setQuotes] = React.useState<Quote[]>([]);
  return { actions: usePipelineActions({ businessId: BIZ, invoices, quotes, setInvoices, setQuotes }), invoices };
}

describe("W3-B6-WEB-BULK-SKIPPED (D-66, CR-B6-1) usePipelineActions bulk delete reads skipped / skippedCount", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-w3b6");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("D-66 CR-B6-1: a bulk delete answering 2 deleted and 1 skipped removes 2 rows, keeps the skipped one and shows its reason", async () => {
    const rows = [invoice("inv_draft", "INV-B6-001", "DRAFT"), invoice("inv_void", "INV-B6-002", "VOID"), invoice("inv_sent", "INV-B6-003", "SENT")];
    const server = installServer({ updated: 2, skipped: [{ id: "inv_sent", invoiceStatus: "SENT", reason: VOID_FIRST }] });
    const { result } = renderHook(() => useHarness(rows));

    await act(async () => {
      await result.current.actions.handleBulkDelete(new Set(rows.map((r) => r.id)));
    });

    expect(server.bodies).toEqual([{ ids: ["inv_draft", "inv_void", "inv_sent"], action: "delete" }]);
    expect(result.current.invoices.map((i) => i.id), "only the 2 deleted rows leave the list").toEqual(["inv_sent"]);
    const shown = shownToasts();
    expect(shown.some((s) => s.includes(VOID_FIRST)), `the skipped invoice's reason is shown: ${JSON.stringify(shown)}`).toBe(true);
    expect(shown.some((s) => s.includes("INV-B6-003")), `the skipped invoice is named: ${JSON.stringify(shown)}`).toBe(true);
    expect(shown.some((s) => /\b3 invoice/.test(s)), "nothing claims all 3 were done").toBe(false);
  });

  it("D-66 CR-B6-1: each skipped invoice's reason is shown (void it first, refund ... first); only the deleted DRAFT leaves the list", async () => {
    const rows = [invoice("inv_draft", "INV-B6-011", "DRAFT"), invoice("inv_sent", "INV-B6-012", "SENT"), invoice("inv_overdue", "INV-B6-013", "OVERDUE")];
    installServer({
      updated: 1,
      skipped: [
        { id: "inv_sent", invoiceStatus: "SENT", reason: VOID_FIRST },
        { id: "inv_overdue", invoiceStatus: "OVERDUE", reason: REFUND_FIRST },
      ],
    });
    const { result } = renderHook(() => useHarness(rows));

    await act(async () => {
      await result.current.actions.handleBulkDelete(new Set(rows.map((r) => r.id)));
    });

    expect(result.current.invoices.map((i) => i.id)).toEqual(["inv_sent", "inv_overdue"]);
    const shown = shownToasts();
    for (const [number, reason] of [["INV-B6-012", VOID_FIRST], ["INV-B6-013", REFUND_FIRST]] as const) {
      expect(shown.some((s) => s.includes(reason)), `${number}'s reason is shown: ${JSON.stringify(shown)}`).toBe(true);
      expect(shown.some((s) => s.includes(number)), `${number} is named: ${JSON.stringify(shown)}`).toBe(true);
    }
  });
});
