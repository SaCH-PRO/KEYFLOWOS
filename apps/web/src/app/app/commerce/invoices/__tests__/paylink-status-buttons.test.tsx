/**
 * FU-WEB-PAYLINK-STATUS-BUTTONS (D-256, D-248): "Copy payment link" and
 * "Share via WhatsApp" / "Share WhatsApp" render only for payable invoice
 * statuses (SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED), matching the
 * server's CommerceService.INTENT_PAYABLE_STATUSES gate.
 *
 * Non-payable statuses (DRAFT, PENDING, PAID, VOID, FAILED, FULLY_CREDITED)
 * never render pay-link or WhatsApp share controls on any invoice surface:
 *   1. InvoicesPanel (row overflow menu + BillingDetailModal action bar)
 *   2. InvoiceMobileActions (bottom sheet)
 *   3. InvoicesHubPage (/app/commerce/invoices row dropdown)
 *   4. InvoiceDetailPage (/app/commerce/invoices/[id] dropdown + sidebar actions)
 *   5. InvoiceList (row action dropdown)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import type { Invoice } from "@/lib/client";

const fetchInvoices = vi.fn();
const getInvoice = vi.fn();
const fetchInvoicePayments = vi.fn();
const createInvoicePaymentLink = vi.fn();

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: "inv_detail" }),
  usePathname: () => "/app/commerce/invoices",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => {} }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task_plb", markTaskCompleted: vi.fn() }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({ refreshWorkspace: async () => "biz_plb", getStoredBusinessId: () => "biz_plb", getCachedBusiness: () => null }));
vi.mock("@/lib/api", () => ({
  apiDelete: vi.fn(async () => ({ data: null, error: null })),
  providerUnavailableOf: () => null,
}));
vi.mock("@/lib/client", () => ({
  fetchInvoices: (...args: unknown[]) => fetchInvoices(...args),
  fetchContacts: async () => ({ data: { contacts: [] }, error: null }),
  fetchProducts: async () => ({ data: [], error: null }),
  getGmailStatus: async () => ({ data: { connected: true, email: "ops@example.test" }, error: null }),
  getInvoice: (...args: unknown[]) => getInvoice(...args),
  getInvoiceTimeline: async () => ({ data: { entries: [] }, error: null }),
  fetchInvoicePayments: (...args: unknown[]) => fetchInvoicePayments(...args),
  listInvoicePayments: (...args: unknown[]) => fetchInvoicePayments(...args),
  updateInvoiceStatus: vi.fn(),
  markInvoicePaid: vi.fn(),
  resendInvoiceReceipt: vi.fn(),
  createInvoicePaymentLink: (...args: unknown[]) => createInvoicePaymentLink(...args),
  sendInvoiceEmail: vi.fn(),
  sendInvoiceReminder: vi.fn(),
  recordInvoicePayment: vi.fn(),
  confirmPendingPayment: vi.fn(),
  confirmPendingInvoicePayment: vi.fn(),
  refundInvoicePayment: vi.fn(),
  fetchInvoiceCreditNotes: async () => ({ data: [], error: null }),
}));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => null }));
vi.mock("../../components/tax-summary-panel", () => ({ TaxSummaryPanel: () => null }));
vi.mock("../../components/dunning-rules", () => ({ DunningRulesPanel: () => null }));
vi.mock("../../components/invoice-templates/template-customizer", () => ({ TemplateCustomizer: () => null }));
vi.mock("../../components/invoice-templates/template-renderer", () => ({ InvoiceTemplateRenderer: () => null }));
vi.mock("../../components/invoice-timeline", () => ({ InvoiceTimeline: () => null }));
vi.mock("../../components/time-log-widget", () => ({ TimeLogWidget: () => null }));
vi.mock("../../components/attribution-editor", () => ({ AttributionEditor: () => null }));
vi.mock("../../components/leverage-metrics-section", () => ({ LeverageMetricsSection: () => null }));

import * as commerceStatus from "@/lib/commerce-status";
import InvoicesPanel from "../invoices-panel";
import InvoicesHubPage from "../page";
import InvoiceDetailPage from "../[id]/page";
import { InvoiceMobileActions } from "../../components/invoice-mobile-actions";
import { InvoiceList } from "../components/invoice-list";

const NOW = new Date().toISOString();
const PAYABLE = ["SENT", "OVERDUE", "PARTIALLY_PAID", "PARTIALLY_CREDITED"] as const;
const NON_PAYABLE = ["DRAFT", "PENDING", "PAID", "VOID", "FAILED", "FULLY_CREDITED"] as const;

function makeInvoice(id: string, status: string): Invoice {
  return {
    id,
    invoiceNumber: id.toUpperCase(),
    status,
    total: 250,
    currency: "TTD",
    issueDate: NOW,
    dueDate: NOW,
    contactId: null,
    contact: { firstName: "Plb", lastName: id, email: `${id}@example.test` },
    items: [],
    payments: [],
  };
}

beforeEach(() => {
  fetchInvoices.mockResolvedValue({ data: [], error: null });
  fetchInvoicePayments.mockResolvedValue({ data: { payments: [], paidAmount: 0, remaining: 250 }, error: null });
  createInvoicePaymentLink.mockResolvedValue({ data: { token: "tok_test" }, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FU-WEB-PAYLINK-STATUS-BUTTONS (D-256, D-248): canonical server-pinned gate", () => {
  it("PLB-01 RED-BEFORE: PAYLINK_SHAREABLE_STATUSES and canShareInvoicePayLink live in @/lib/commerce-status and match server INTENT_PAYABLE_STATUSES", () => {
    const set = (commerceStatus as Record<string, unknown>).PAYLINK_SHAREABLE_STATUSES as ReadonlySet<string> | undefined;
    const fn = (commerceStatus as Record<string, unknown>).canShareInvoicePayLink as
      | ((s: string | null | undefined) => boolean)
      | undefined;
    expect(set).toBeInstanceOf(Set);
    expect(fn).toBeTypeOf("function");
    expect([...set!].sort()).toEqual([...PAYABLE].sort());

    for (const s of PAYABLE) expect(fn!(s), s).toBe(true);
    for (const s of [...NON_PAYABLE, null, undefined, ""]) expect(fn!(s), String(s)).toBe(false);

    const serverSrc = readFileSync(
      resolve(__dirname, "../../../../../../../server/src/modules/commerce/commerce.service.ts"),
      "utf8",
    );
    const match = serverSrc.match(/INTENT_PAYABLE_STATUSES\b\s*(?::[^=]*)?=\s*new Set\(\[([^\]]*)\]\)/);
    expect(match, "server CommerceService.INTENT_PAYABLE_STATUSES").not.toBeNull();
    const serverStatuses = [...match![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(serverStatuses.sort()).toEqual([...set!].sort());
  });
});

describe("FU-WEB-PAYLINK-STATUS-BUTTONS: InvoicesPanel (row menu + detail modal)", () => {
  it("PLB-02 RED-BEFORE: hides Share via WhatsApp and Copy payment link for DRAFT, PENDING, PAID, VOID, FAILED, FULLY_CREDITED", async () => {
    for (const status of NON_PAYABLE) {
      const inv = makeInvoice(`inv_${status.toLowerCase()}`, status);
      render(
        <InvoicesPanel
          invoices={[inv]}
          contacts={[]}
          products={[]}
          businessId="biz_plb"
          currency="TTD"
          loading={false}
          setInvoices={() => {}}
          setProducts={() => {}}
          gmailStatus={{ connected: true, email: "ops@example.test" }}
        />,
      );

      // Row overflow menu must not show "Share via WhatsApp"
      fireEvent.click(screen.getByLabelText("More actions"));
      expect(screen.queryByText("Share via WhatsApp"), `${status} row menu`).toBeNull();
      fireEvent.click(screen.getByLabelText("More actions"));

      // Detail modal action bar must not show "Copy payment link" or "Share via WhatsApp"
      fireEvent.click(screen.getByText(inv.invoiceNumber!));
      await waitFor(() => expect(screen.getAllByTitle("Duplicate invoice").length).toBeGreaterThanOrEqual(2));
      expect(screen.queryAllByTitle("Copy payment link"), `${status} detail Copy payment link`).toHaveLength(0);
      expect(screen.queryAllByTitle("Share via WhatsApp"), `${status} detail Share via WhatsApp`).toHaveLength(0);
      cleanup();
    }
  });

  it("PLB-03: renders Share via WhatsApp and Copy payment link for SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED", async () => {
    for (const status of PAYABLE) {
      const inv = makeInvoice(`inv_ok_${status.toLowerCase()}`, status);
      render(
        <InvoicesPanel
          invoices={[inv]}
          contacts={[]}
          products={[]}
          businessId="biz_plb"
          currency="TTD"
          loading={false}
          setInvoices={() => {}}
          setProducts={() => {}}
          gmailStatus={{ connected: true, email: "ops@example.test" }}
        />,
      );

      fireEvent.click(screen.getByLabelText("More actions"));
      expect(screen.getByText("Share via WhatsApp"), `${status} row menu`).toBeTruthy();
      fireEvent.click(screen.getByLabelText("More actions"));

      fireEvent.click(screen.getByText(inv.invoiceNumber!));
      await waitFor(() => expect(screen.getAllByTitle("Duplicate invoice").length).toBeGreaterThanOrEqual(2));
      expect(screen.getAllByTitle("Copy payment link").length, `${status} detail Copy payment link`).toBeGreaterThan(0);
      expect(screen.getAllByTitle("Share via WhatsApp").length, `${status} detail Share via WhatsApp`).toBeGreaterThan(0);
      cleanup();
    }
  });
});

describe("FU-WEB-PAYLINK-STATUS-BUTTONS: InvoiceMobileActions bottom sheet", () => {
  it("PLB-04 RED-BEFORE: omits Copy payment link and Share via WhatsApp for DRAFT/PENDING/PAID/VOID/FAILED/FULLY_CREDITED and renders both for payable statuses", () => {
    for (const status of NON_PAYABLE) {
      render(
        <InvoiceMobileActions
          open
          onClose={() => {}}
          invoiceNumber="INV-1"
          status={status}
          hasGmail
          onCopyPaymentLink={() => {}}
          onShareWhatsApp={() => {}}
        />,
      );
      expect(screen.queryByText("Copy payment link"), `${status} mobile Copy payment link`).toBeNull();
      expect(screen.queryByText("Share via WhatsApp"), `${status} mobile Share via WhatsApp`).toBeNull();
      if (status === "VOID") {
        expect(screen.getByText("No actions available for this invoice.")).toBeTruthy();
      }
      cleanup();
    }

    for (const status of PAYABLE) {
      render(
        <InvoiceMobileActions
          open
          onClose={() => {}}
          invoiceNumber="INV-2"
          status={status}
          hasGmail
          onCopyPaymentLink={() => {}}
          onShareWhatsApp={() => {}}
        />,
      );
      expect(screen.getByText("Copy payment link"), `${status} mobile Copy payment link`).toBeTruthy();
      expect(screen.getByText("Share via WhatsApp"), `${status} mobile Share via WhatsApp`).toBeTruthy();
      cleanup();
    }
  });
});

describe("FU-WEB-PAYLINK-STATUS-BUTTONS: InvoicesHubPage, InvoiceDetailPage, and InvoiceList", () => {
  it("PLB-05 RED-BEFORE: InvoicesHubPage hides Share WhatsApp across all 6 non-payable statuses and shows it across all 4 payable statuses", async () => {
    const allInvoices = [
      ...NON_PAYABLE.map((s) => makeInvoice(`inv_hub_${s.toLowerCase()}`, s)),
      ...PAYABLE.map((s) => makeInvoice(`inv_hub_${s.toLowerCase()}`, s)),
    ];
    fetchInvoices.mockResolvedValue({ data: allInvoices, error: null });

    render(<InvoicesHubPage />);
    await waitFor(() => expect(screen.getByText("INV_HUB_DRAFT")).toBeTruthy());

    const openRowMenu = (num: string) => {
      const row = screen.getByText(num).closest("tr") as HTMLElement;
      const btns = within(row).getAllByRole("button");
      fireEvent.click(btns[btns.length - 1]);
    };

    for (const s of NON_PAYABLE) {
      openRowMenu(`INV_HUB_${s}`);
      expect(screen.queryByText("Share WhatsApp"), `${s} hub row menu`).toBeNull();
    }

    for (const s of PAYABLE) {
      openRowMenu(`INV_HUB_${s}`);
      expect(screen.getByText("Share WhatsApp"), `${s} hub row menu`).toBeTruthy();
    }

    expect(createInvoicePaymentLink).not.toHaveBeenCalled();
  });

  it("PLB-06 RED-BEFORE: InvoiceDetailPage ([id]/page.tsx) hides Copy payment link for all 6 non-payable statuses and renders both header dropdown and sidebar controls for all 4 payable statuses", async () => {
    for (const status of NON_PAYABLE) {
      getInvoice.mockResolvedValue({ data: makeInvoice("inv_detail", status), error: null });
      render(<InvoiceDetailPage />);
      await waitFor(() => expect(screen.getByText(/INV_DETAIL/)).toBeTruthy());
      expect(screen.queryAllByText("Copy payment link"), `${status} detail page`).toHaveLength(0);
      cleanup();
    }

    for (const status of PAYABLE) {
      getInvoice.mockResolvedValue({ data: makeInvoice("inv_detail", status), error: null });
      render(<InvoiceDetailPage />);
      await waitFor(() => expect(screen.getByText(/INV_DETAIL/)).toBeTruthy());
      expect(screen.getAllByText("Copy payment link"), `${status} detail page header + sidebar`).toHaveLength(2);
      cleanup();
    }

    expect(createInvoicePaymentLink).not.toHaveBeenCalled();
  });

  it("PLB-07 RED-BEFORE: InvoiceList hides Share via WhatsApp across all 6 non-payable statuses and shows it across all 4 payable statuses", () => {
    const allInvoices = [
      ...NON_PAYABLE.map((s) => makeInvoice(`inv_list_${s.toLowerCase()}`, s)),
      ...PAYABLE.map((s) => makeInvoice(`inv_list_${s.toLowerCase()}`, s)),
    ];

    render(
      <InvoiceList
        invoices={allInvoices}
        contacts={[]}
        products={[]}
        businessId="biz_plb"
        currency="TTD"
        gmailStatus={{ connected: true, email: "ops@example.test" }}
        onSend={async () => {}}
        onMarkPaid={async () => {}}
        onVoid={async () => {}}
        onDelete={async () => {}}
        onRecordPayment={() => {}}
        onReminder={() => {}}
        onDuplicate={() => {}}
        onResendReceipt={async () => {}}
        onShareWhatsApp={() => {}}
        actionLoading={{}}
        statusFilter="ALL"
        onStatusFilterChange={() => {}}
      />,
    );

    const openRowMenu = (num: string) => {
      const row = screen.getByText(num).closest("tr") as HTMLElement;
      const btns = within(row).getAllByRole("button");
      fireEvent.click(btns[btns.length - 1]);
    };

    for (const s of NON_PAYABLE) {
      openRowMenu(`INV_LIST_${s}`);
      expect(screen.queryByText("Share via WhatsApp"), `${s} invoice-list row menu`).toBeNull();
    }

    for (const s of PAYABLE) {
      openRowMenu(`INV_LIST_${s}`);
      expect(screen.getByText("Share via WhatsApp"), `${s} invoice-list row menu`).toBeTruthy();
    }

    expect(createInvoicePaymentLink).not.toHaveBeenCalled();
  });
});
