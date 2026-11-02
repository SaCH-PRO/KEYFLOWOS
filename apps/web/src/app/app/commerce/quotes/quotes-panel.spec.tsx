/**
 * V1-53b-QUOTE-RESIDUALS: the quotes panel reports the rows a bulk action skipped.
 *
 * PATCH /commerce/businesses/:b/quotes/bulk (V1-50, V1-QUOTE-CHAIN-finish)
 * answers { updated, action, skipped: [{ id, quoteStatus, code }], skippedCount }:
 * a row the quote transition table refuses (converted, decided), or that the
 * bulk action does not move from, is left as it is and listed in `skipped`.
 *
 * Before this packet the panel's bulk send, reject and delete showed
 * "<updated> quote(s) updated", cleared the whole selection, and patched the
 * rows it guessed from their status on screen: a converted quote stored as a
 * DRAFT or SENT row was shown SENT or removed although the server refused it,
 * and a VIEWED quote the server rejected stayed VIEWED.
 *
 * Contract pinned here (QuotesPanel mounted with the real client, fetch stubbed
 * at the network edge, the quotes held in React state as the commerce page holds
 * them):
 *   - the panel says how many selected rows were skipped and why, naming each
 *     skipped quote's number;
 *   - the skipped rows stay selected, the rest of the selection is cleared;
 *   - only the rows the server changed (selected and not skipped) are patched
 *     locally: moved to the bulk status, or removed for a delete; a skipped
 *     row keeps its status;
 *   - with nothing updated there is no "updated" success message;
 *   - with nothing skipped the panel behaves as before (regression control).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { useEffect, useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";

const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as unknown as ((...args: unknown[]) => unknown) & Record<string, ReturnType<typeof vi.fn>>;
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.info = vi.fn();
  fn.warning = vi.fn();
  return fn;
});
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => undefined }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task", markTaskCompleted: () => undefined }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: null, saveBranding: vi.fn(), savingBranding: false }),
}));
vi.mock("../components/billing-form-modal", () => ({ BillingFormModal: () => null }));
vi.mock("../components/billing-detail-modal", () => ({ BillingDetailModal: () => null }));
vi.mock("../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => ({}) }));

import QuotesPanel from "./quotes-panel";
import type { Quote } from "@/lib/client";

const BIZ = "biz_v53b";
const BULK_PATH = `/commerce/businesses/${BIZ}/quotes/bulk`;

function quote(id: string, fields: Partial<Quote>): Quote {
  return {
    id,
    quoteNumber: `QT-${id}`,
    status: "DRAFT",
    subtotal: 100,
    total: 100,
    currency: "TTD",
    issueDate: "2026-11-01T10:00:00.000Z",
    businessId: BIZ,
    contactId: "ct_v53b",
    contact: { id: "ct_v53b", firstName: "Ana", lastName: "Lee", email: "ana@example.test" } as Quote["contact"],
    items: [{ id: `${id}_i1`, description: "Service", quantity: 1, unitPrice: 100, total: 100 }] as Quote["items"],
    createdAt: "2026-11-01T10:00:00.000Z",
    ...fields,
  };
}

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

type BulkCall = { ids: string[]; action: string };

/** Stubs fetch: the bulk route answers `reply`, every other call an empty 200. */
function installServer(reply: { status?: number; body: unknown }) {
  const bulkCalls: BulkCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PATCH" && url.pathname === BULK_PATH) {
      bulkCalls.push(JSON.parse(String(init?.body ?? "{}")) as BulkCall);
      return jsonResponse(reply.status ?? 200, reply.body);
    }
    return jsonResponse(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { bulkCalls };
}

let latest: Quote[] = [];
const track = (quotes: Quote[]) => {
  latest = quotes;
};

/** Holds the quotes in React state, as the commerce page does, and reports each committed list. */
function Harness({ initial }: { initial: Quote[] }) {
  const [quotes, setQuotes] = useState<Quote[]>(initial);
  useEffect(() => {
    track(quotes);
  }, [quotes]);
  return (
    <QuotesPanel
      quotes={quotes}
      contacts={[]}
      products={[]}
      businessId={BIZ}
      loading={false}
      gmailStatus={{ connected: false, email: null }}
      setProducts={vi.fn()}
      setQuotes={setQuotes}
      setInvoices={vi.fn()}
    />
  );
}

function checkbox(q: Quote): HTMLInputElement {
  return screen.getByLabelText(`Select quote ${q.quoteNumber}`) as HTMLInputElement;
}

function select(...qs: Quote[]) {
  for (const q of qs) fireEvent.click(checkbox(q));
  for (const q of qs) expect(checkbox(q).checked).toBe(true);
}

function bulkStatus(label: "Send All" | "Reject All") {
  fireEvent.click(screen.getByRole("button", { name: /^Status$/ }));
  fireEvent.click(screen.getByRole("button", { name: label }));
}

function bulkDelete() {
  const bar = screen.getByLabelText("Clear selection").parentElement as HTMLElement;
  fireEvent.click(within(bar).getByRole("button", { name: /Delete/ }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
}

/** Waits for the one bulk request, then lets the panel handle its answer. */
async function settle(server: { bulkCalls: BulkCall[] }) {
  await waitFor(() => expect(server.bulkCalls).toHaveLength(1));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function statusOf(id: string): string | undefined {
  return latest.find((q) => q.id === id)?.status;
}

beforeEach(() => {
  latest = [];
  for (const k of ["success", "error", "info", "warning"]) toastMock[k]!.mockClear();
  (toastMock as unknown as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("V1-53b quotes panel: bulk actions report skipped rows", () => {
  it("bulk send: a converted DRAFT the server skips stays DRAFT and selected, the panel says it was skipped and why; the sent rows move and leave the selection", async () => {
    const d1 = quote("q_d1", { status: "DRAFT" });
    const d2 = quote("q_d2", { status: "DRAFT" });
    const convd = quote("q_convd", { status: "DRAFT", invoiceId: "inv_v53b" });
    const s1 = quote("q_s1", { status: "SENT" });
    const server = installServer({
      body: { updated: 2, action: "send", skipped: [{ id: convd.id, quoteStatus: "DRAFT", code: "quote_converted" }], skippedCount: 1 },
    });
    render(<Harness initial={[d1, d2, convd, s1]} />);
    select(d1, d2, convd);
    bulkStatus("Send All");
    await settle(server);
    expect(server.bulkCalls).toEqual([{ ids: [d1.id, d2.id, convd.id], action: "send" }]);

    // Only the rows the server changed are patched.
    expect(statusOf(d1.id)).toBe("SENT");
    expect(statusOf(d2.id)).toBe("SENT");
    expect(statusOf(convd.id)).toBe("DRAFT");
    expect(statusOf(s1.id)).toBe("SENT");
    expect(latest.find((q) => q.id === convd.id)).toBe(convd);
    expect(latest.find((q) => q.id === s1.id)).toBe(s1);

    // The skipped row stays selected; the moved ones leave the selection.
    expect(checkbox(convd).checked).toBe(true);
    expect(checkbox(d1).checked).toBe(false);
    expect(checkbox(d2).checked).toBe(false);
    expect(screen.getByText(/^1 of 4$/)).toBeTruthy();

    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(String(toastMock.success.mock.calls[0]![0])).toMatch(/^2 quote/);

    const notice = screen.getByTestId("quotes-bulk-skipped");
    expect(notice.textContent).toMatch(/1 of 3/);
    expect(notice.textContent).toMatch(/skipped/i);
    expect(notice.textContent).toContain(convd.quoteNumber);
    expect(notice.textContent).toMatch(/converted to an invoice/i);
  });

  it("bulk reject: the server's VIEWED move is shown REJECTED; a DRAFT it skips (not eligible) stays DRAFT and selected, with the reason", async () => {
    const s1 = quote("q_s1", { status: "SENT" });
    // The server stores VIEWED (QuoteStatus); the web Quote type does not list it.
    const v1 = quote("q_v1", { status: "VIEWED" as Quote["status"] });
    const dr = quote("q_dr", { status: "DRAFT" });
    const server = installServer({
      body: { updated: 2, action: "reject", skipped: [{ id: dr.id, quoteStatus: "DRAFT", code: "quote_bulk_not_eligible" }], skippedCount: 1 },
    });
    render(<Harness initial={[s1, v1, dr]} />);
    select(s1, v1, dr);
    bulkStatus("Reject All");
    await settle(server);
    expect(server.bulkCalls).toEqual([{ ids: [s1.id, v1.id, dr.id], action: "reject" }]);

    expect(statusOf(s1.id)).toBe("REJECTED");
    expect(statusOf(v1.id)).toBe("REJECTED");
    expect(statusOf(dr.id)).toBe("DRAFT");
    expect(checkbox(dr).checked).toBe(true);
    expect(checkbox(s1).checked).toBe(false);
    expect(checkbox(v1).checked).toBe(false);

    const notice = screen.getByTestId("quotes-bulk-skipped");
    expect(notice.textContent).toMatch(/1 of 3/);
    expect(notice.textContent).toContain(dr.quoteNumber);
    expect(notice.textContent).toMatch(/only a sent or viewed quote can be rejected/i);
  });

  it("bulk delete: a converted SENT quote the server skips is not removed and stays selected; the deleted DRAFT is removed", async () => {
    const d1 = quote("q_d1", { status: "DRAFT" });
    const cs = quote("q_cs", { status: "SENT", invoiceId: "inv_v53b_cs" });
    const server = installServer({
      body: { updated: 1, action: "delete", skipped: [{ id: cs.id, quoteStatus: "SENT", code: "quote_converted" }], skippedCount: 1 },
    });
    render(<Harness initial={[d1, cs]} />);
    select(d1, cs);
    bulkDelete();
    await settle(server);
    expect(server.bulkCalls).toEqual([{ ids: [d1.id, cs.id], action: "delete" }]);

    expect(latest.map((q) => q.id)).toEqual([cs.id]);
    expect(latest[0]).toBe(cs);
    expect(checkbox(cs).checked).toBe(true);
    expect(screen.queryByLabelText(`Select quote ${d1.quoteNumber}`)).toBeNull();

    const notice = screen.getByTestId("quotes-bulk-skipped");
    expect(notice.textContent).toMatch(/1 of 2/);
    expect(notice.textContent).toContain(cs.quoteNumber);
    expect(notice.textContent).toMatch(/converted to an invoice/i);
  });

  it("every selected row skipped: no 'updated' success, nothing patched, the selection is kept, and each reason is listed", async () => {
    const acc = quote("q_acc", { status: "ACCEPTED" });
    const raced = quote("q_raced", { status: "DRAFT" });
    const server = installServer({
      body: {
        updated: 0,
        action: "send",
        skipped: [
          { id: acc.id, quoteStatus: "ACCEPTED", code: "quote_transition_not_allowed" },
          { id: raced.id, quoteStatus: "SENT", code: "quote_status_changed" },
        ],
        skippedCount: 2,
      },
    });
    render(<Harness initial={[acc, raced]} />);
    select(acc, raced);
    bulkStatus("Send All");
    await settle(server);

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(latest[0]).toBe(acc);
    expect(latest[1]).toBe(raced);
    expect(checkbox(acc).checked).toBe(true);
    expect(checkbox(raced).checked).toBe(true);

    const notice = screen.getByTestId("quotes-bulk-skipped");
    expect(notice.textContent).toMatch(/2 of 2/);
    expect(notice.textContent).toContain(acc.quoteNumber);
    expect(notice.textContent).toContain(raced.quoteNumber);
    expect(notice.textContent).toMatch(/accepted quote cannot be sent/i);
    expect(notice.textContent).toMatch(/changed while the action ran/i);
  });

  it("the skipped notice can be dismissed", async () => {
    const convd = quote("q_convd", { status: "DRAFT", invoiceId: "inv_v53b" });
    installServer({
      body: { updated: 0, action: "send", skipped: [{ id: convd.id, quoteStatus: "DRAFT", code: "quote_converted" }], skippedCount: 1 },
    });
    render(<Harness initial={[convd]} />);
    select(convd);
    bulkStatus("Send All");
    const notice = await screen.findByTestId("quotes-bulk-skipped");
    fireEvent.click(within(notice).getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("quotes-bulk-skipped")).toBeNull();
  });

  it("regression control: nothing skipped moves every selected row, clears the selection and shows no skipped notice", async () => {
    const d1 = quote("q_d1", { status: "DRAFT" });
    const d2 = quote("q_d2", { status: "DRAFT" });
    installServer({ body: { updated: 2, action: "send", skipped: [], skippedCount: 0 } });
    render(<Harness initial={[d1, d2]} />);
    select(d1, d2);
    bulkStatus("Send All");

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(String(toastMock.success.mock.calls[0]![0])).toMatch(/^2 quote/);
    await waitFor(() => expect(statusOf(d1.id)).toBe("SENT"));
    expect(statusOf(d2.id)).toBe("SENT");
    expect(checkbox(d1).checked).toBe(false);
    expect(checkbox(d2).checked).toBe(false);
    expect(screen.queryByLabelText("Clear selection")).toBeNull();
    expect(screen.queryByTestId("quotes-bulk-skipped")).toBeNull();
  });

  it("regression control: a refused bulk request shows the error and keeps the selection and the rows", async () => {
    const d1 = quote("q_d1", { status: "DRAFT" });
    installServer({ status: 400, body: { statusCode: 400, message: "ids must be a non-empty array" } });
    render(<Harness initial={[d1]} />);
    select(d1);
    bulkStatus("Send All");

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(statusOf(d1.id)).toBe("DRAFT");
    expect(checkbox(d1).checked).toBe(true);
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
