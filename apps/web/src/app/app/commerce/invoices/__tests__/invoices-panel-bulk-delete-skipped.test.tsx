/**
 * W3-B6-WEB-BULK-SKIPPED (review CR-B6-1, owner ruling D-66): only DRAFT and
 * VOID invoices may be deleted, and PATCH invoices/bulk {action:"delete"}
 * deletes those and lists every refused invoice in `skipped` (id,
 * invoiceStatus and the single route's reason) with `skippedCount`
 * (FOLLOW3-B6). The Sales > Invoices panel's bulk delete
 * (handleBulkStatusChange) ignored both: it toasted "N invoice(s) updated" and
 * removed the selected rows its own status table called eligible (DRAFT, SENT,
 * OVERDUE), so a SENT invoice the server kept vanished from the list with no
 * word of why, and a VOID invoice the server deleted stayed listed.
 *
 * The panel is mounted with its real bulk bar, confirm dialog, hooks and the
 * real client; fetch is stubbed at the network edge with the server's
 * bulk-delete answer. Only the panel's unrelated side panels and app-shell
 * contexts are stubbed (as invoices-panel-submit.test.tsx does).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => {} }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task_w3b6", markTaskCompleted: vi.fn() }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => null }));
vi.mock("../../components/tax-summary-panel", () => ({ TaxSummaryPanel: () => null }));
vi.mock("../../components/dunning-rules", () => ({ DunningRulesPanel: () => null }));
vi.mock("../../components/billing-detail-modal", () => ({ BillingDetailModal: () => null }));
vi.mock("../../components/invoice-mobile-actions", () => ({ InvoiceMobileActions: () => null }));

import { toast } from "sonner";
import InvoicesPanel from "../invoices-panel";
import type { Invoice } from "@/lib/client";

const BIZ = "biz_w3b6_ip";
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
  return {
    id, invoiceNumber, status, total: 100, currency: "TTD", payments: [],
    issueDate: new Date().toISOString(), dueDate: null, contactId: null, contact: null, items: [],
  };
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
      if (method === "GET" && url.pathname.endsWith("/document-templates")) {
        return jsonResponse(200, { templates: [], branding: {} });
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

/** The reason is shown: on the page, or in a toast. */
function reasonShown(reason: string): boolean {
  return (document.body.textContent ?? "").includes(reason) || shownToasts().some((s) => s.includes(reason));
}

function invoiceShownAsSkipped(number: string): boolean {
  return shownToasts().some((s) => s.includes(number));
}

function Panel({ initial }: { initial: Invoice[] }) {
  const [invoices, setInvoices] = React.useState<Invoice[]>(initial);
  const [products, setProducts] = React.useState<import("@/lib/client").Product[]>([]);
  return (
    <InvoicesPanel
      invoices={invoices}
      contacts={[]}
      products={products}
      businessId={BIZ}
      loading={false}
      setProducts={setProducts}
      setInvoices={setInvoices}
      gmailStatus={null}
      currency="TTD"
    />
  );
}

/** The invoice numbers the list shows, sorted (the list's own order is by date). */
const listed = () =>
  screen
    .queryAllByRole("checkbox", { name: /^Select invoice / })
    .map((el) => el.getAttribute("aria-label")!.replace("Select invoice ", ""))
    .sort();

async function bulkDelete(numbers: string[]) {
  for (const n of numbers) fireEvent.click(screen.getByRole("checkbox", { name: `Select invoice ${n}` }));
  fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /^Delete$/ }));
}

describe("W3-B6-WEB-BULK-SKIPPED (D-66, CR-B6-1) invoices-panel bulk delete reads skipped / skippedCount", () => {
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
    const server = installServer({ updated: 2, skipped: [{ id: "inv_sent", invoiceStatus: "SENT", reason: VOID_FIRST }] });
    render(
      <Panel initial={[invoice("inv_draft", "INV-B6-001", "DRAFT"), invoice("inv_void", "INV-B6-002", "VOID"), invoice("inv_sent", "INV-B6-003", "SENT")]} />,
    );
    await waitFor(() => expect(listed()).toHaveLength(3));

    await bulkDelete(["INV-B6-001", "INV-B6-002", "INV-B6-003"]);

    await waitFor(() => expect(server.bodies).toHaveLength(1));
    expect(server.bodies[0]).toEqual({ ids: ["inv_draft", "inv_void", "inv_sent"], action: "delete" });
    await waitFor(() => expect(listed(), "only the 2 deleted rows leave the list").toEqual(["INV-B6-003"]));
    expect(reasonShown(VOID_FIRST), `the skipped invoice's reason is shown: ${JSON.stringify(shownToasts())}`).toBe(true);
    expect(invoiceShownAsSkipped("INV-B6-003"), `the skipped invoice is named: ${JSON.stringify(shownToasts())}`).toBe(true);
    expect(shownToasts().some((s) => /\b3 invoice/.test(s)), "nothing claims all 3 were done").toBe(false);
  });

  it("D-66 CR-B6-1: each skipped invoice's reason is shown (void it first, refund ... first); only the deleted DRAFT leaves the list", async () => {
    installServer({
      updated: 1,
      skipped: [
        { id: "inv_sent", invoiceStatus: "SENT", reason: VOID_FIRST },
        { id: "inv_overdue", invoiceStatus: "OVERDUE", reason: REFUND_FIRST },
      ],
    });
    render(
      <Panel initial={[invoice("inv_draft", "INV-B6-011", "DRAFT"), invoice("inv_sent", "INV-B6-012", "SENT"), invoice("inv_overdue", "INV-B6-013", "OVERDUE")]} />,
    );
    await waitFor(() => expect(listed()).toHaveLength(3));

    await bulkDelete(["INV-B6-011", "INV-B6-012", "INV-B6-013"]);

    await waitFor(() => expect(listed()).toEqual(["INV-B6-012", "INV-B6-013"]));
    for (const [number, reason] of [["INV-B6-012", VOID_FIRST], ["INV-B6-013", REFUND_FIRST]] as const) {
      expect(reasonShown(reason), `${number}'s reason is shown: ${JSON.stringify(shownToasts())}`).toBe(true);
      expect(invoiceShownAsSkipped(number), `${number} is named: ${JSON.stringify(shownToasts())}`).toBe(true);
    }
  });
});
