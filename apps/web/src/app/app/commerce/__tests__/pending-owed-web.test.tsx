/**
 * FU-PENDING-OWED-WEB (owner rulings D-256, D-252): every web owed figure counts
 * PENDING invoices through one shared OWED_STATUSES constant in @/lib/commerce-status
 * pinned against the server's OPEN_RECEIVABLE_STATUSES (less PARTIALLY_CREDITED),
 * nets stored payments via invoiceRemainingOwed (remaining balance, NaN-safe),
 * and keeps reminder buttons and handlers off PENDING.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { render, screen, cleanup, within, fireEvent, waitFor, renderHook } from "@testing-library/react";
import type { Invoice, PaymentRecord, Quote } from "@/lib/client";

const fetchInvoices = vi.fn();
const fetchCommerceStats = vi.fn();
const sendInvoiceReminder = vi.fn();
const commerceAiInvoiceReminder = vi.fn();

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
  usePathname: () => "/app/commerce/invoices",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => {} }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task_pow", markTaskCompleted: vi.fn() }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({ refreshWorkspace: async () => "biz_pow", getStoredBusinessId: () => "biz_pow", getCachedBusiness: () => null }));
vi.mock("@/lib/api", () => ({ apiDelete: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/lib/client", () => ({
  fetchInvoices: (...args: unknown[]) => fetchInvoices(...args),
  fetchCommerceStats: (...args: unknown[]) => fetchCommerceStats(...args),
  fetchContacts: async () => ({ data: { contacts: [] }, error: null }),
  fetchProducts: async () => ({ data: [], error: null }),
  getGmailStatus: async () => ({ data: { connected: false, email: null }, error: null }),
  updateInvoiceStatus: vi.fn(),
  markInvoicePaid: vi.fn(),
  resendInvoiceReceipt: vi.fn(),
  createInvoicePaymentLink: vi.fn(),
  sendInvoiceReminder: (...args: unknown[]) => sendInvoiceReminder(...args),
  commerceAiInvoiceReminder: (...args: unknown[]) => commerceAiInvoiceReminder(...args),
  getInvoice: vi.fn(),
  fetchInvoicePayments: vi.fn(async () => ({ data: { payments: [], paidAmount: 0, remaining: 0 }, error: null })),
}));
vi.mock("../components/commerce-hub", () => ({ CommerceHub: () => null }));
vi.mock("../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => null }));
vi.mock("../components/tax-summary-panel", () => ({ TaxSummaryPanel: () => null }));
vi.mock("../components/dunning-rules", () => ({ DunningRulesPanel: () => null }));
vi.mock("../components/invoice-mobile-actions", () => ({ InvoiceMobileActions: () => null }));
vi.mock("../components/invoice-templates/template-customizer", () => ({ TemplateCustomizer: () => null }));
vi.mock("../components/invoice-templates/template-renderer", () => ({ InvoiceTemplateRenderer: () => null }));
vi.mock("../components/invoice-timeline", () => ({ InvoiceTimeline: () => null }));
vi.mock("../components/time-log-widget", () => ({ TimeLogWidget: () => null }));
vi.mock("../components/attribution-editor", () => ({ AttributionEditor: () => null }));
vi.mock("../components/leverage-metrics-section", () => ({ LeverageMetricsSection: () => null }));

import * as commerceStatus from "@/lib/commerce-status";
import { computeCashPosition, getPipelineStage } from "@/lib/finance/utils";
import PaymentsTab, { OWED_STATUSES as PAYMENTS_TAB_OWED } from "../payments/payments-tab";
import InvoicesHubPage from "../invoices/page";
import { InvoiceStatCards } from "../invoices/components/invoice-stat-cards";
import { useFinancialSummary } from "../hooks/use-financial-summary";
import { useBillingStats } from "../hooks/use-billing-stats";
import { useActionQueue } from "../hooks/use-action-queue";
import { CommerceKpiStrip } from "../components/commerce-kpi-strip";
import { CommerceOverviewTab } from "../components/commerce-overview-tab";
import { BillingDetailModal } from "../components/billing-detail-modal";
import { ContactIntelligenceCard } from "../components/contact-intelligence-card";
import { CommerceInsightsTab } from "../insights/commerce-insights-tab";
import CollectionsPanel from "../billing/collections-panel";
import InvoicesPanel from "../invoices/invoices-panel";
import { formatAmount } from "../utils/commerce-utils";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date().toISOString();
const PAST_DUE = new Date(Date.now() - 20 * DAY).toISOString();
const NOT_YET_DUE = new Date(Date.now() + 20 * DAY).toISOString();

let seq = 0;
function payment(invoiceId: string, amount: number, status = "SUCCESSFUL"): PaymentRecord {
  seq += 1;
  return {
    id: `pay_pow_${seq}`,
    amount,
    status,
    currency: "TTD",
    provider: "manual",
    providerPaymentId: `pp_pow_${seq}`,
    createdAt: NOW,
    businessId: "biz_pow",
    invoiceId,
  };
}

function invoice(
  id: string,
  status: string,
  total: number,
  payments: PaymentRecord[] = [],
  over: Partial<Invoice> = {},
): Invoice {
  return {
    id,
    invoiceNumber: id.toUpperCase(),
    status,
    total,
    currency: "TTD",
    issueDate: NOW,
    dueDate: NOT_YET_DUE,
    contactId: null,
    contact: { firstName: "Pow", lastName: id, email: `${id}@example.test` },
    items: [],
    payments,
    ...over,
  };
}

beforeEach(() => {
  fetchCommerceStats.mockResolvedValue({ data: null, error: "offline" });
  fetchInvoices.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FU-PENDING-OWED-WEB (D-256): shared canonical status sets in @/lib/commerce-status", () => {
  it("PO-W01 RED-BEFORE: isInvoiceOpen counts PENDING, SENT, OVERDUE, and PARTIALLY_PAID and excludes non-owed statuses", () => {
    expect(commerceStatus.isInvoiceOpen("PENDING")).toBe(true);
    expect(commerceStatus.isInvoiceOpen("SENT")).toBe(true);
    expect(commerceStatus.isInvoiceOpen("OVERDUE")).toBe(true);
    expect(commerceStatus.isInvoiceOpen("PARTIALLY_PAID")).toBe(true);
    for (const closed of ["DRAFT", "PAID", "VOID", "FULLY_CREDITED", "FAILED"]) {
      expect(commerceStatus.isInvoiceOpen(closed), closed).toBe(false);
    }
  });

  it("PO-W02 RED-BEFORE: OWED_STATUSES lives in @/lib/commerce-status, is shared by payments-tab.tsx, and matches server OPEN_RECEIVABLE_STATUSES less PARTIALLY_CREDITED", () => {
    const shared = (commerceStatus as Record<string, unknown>).OWED_STATUSES as ReadonlySet<string> | undefined;
    expect(shared, "OWED_STATUSES exported from @/lib/commerce-status").toBeInstanceOf(Set);
    expect(PAYMENTS_TAB_OWED, "payments-tab.tsx re-exports the exact shared Set").toBe(shared);
    expect([...shared!].sort()).toEqual(["OVERDUE", "PARTIALLY_PAID", "PENDING", "SENT"]);

    const serverSource = readFileSync(
      resolve(__dirname, "../../../../../../server/src/modules/commerce/commerce-stats.service.ts"),
      "utf8",
    );
    const match = serverSource.match(/export const OPEN_RECEIVABLE_STATUSES\b\s*(?::[^=]*)?=\s*new Set\(\[([^\]]*)\]\)/);
    expect(match, "server OPEN_RECEIVABLE_STATUSES").not.toBeNull();
    const server = [...match![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(server.filter((s) => s !== "PARTIALLY_CREDITED").sort()).toEqual([...shared!].sort());
    expect(server).toContain("PARTIALLY_CREDITED");
    expect(PaymentsTab).toBeTypeOf("function");
  });

  it("PO-W03 RED-BEFORE: REMINDABLE_STATUSES / canRemindInvoice keep PENDING and DRAFT out while allowing SENT, OVERDUE, PARTIALLY_PAID", () => {
    const remindable = (commerceStatus as Record<string, unknown>).REMINDABLE_STATUSES as ReadonlySet<string> | undefined;
    const canRemindInvoice = (commerceStatus as Record<string, unknown>).canRemindInvoice as
      | ((s: string | null | undefined) => boolean)
      | undefined;
    expect(remindable).toBeInstanceOf(Set);
    expect(canRemindInvoice).toBeTypeOf("function");
    expect([...remindable!].sort()).toEqual(["OVERDUE", "PARTIALLY_PAID", "SENT"]);
    expect(canRemindInvoice!("SENT")).toBe(true);
    expect(canRemindInvoice!("OVERDUE")).toBe(true);
    expect(canRemindInvoice!("PARTIALLY_PAID")).toBe(true);
    for (const nonRemindable of ["PENDING", "DRAFT", "PAID", "VOID", "PARTIALLY_CREDITED", "FULLY_CREDITED", "FAILED", null, undefined]) {
      expect(canRemindInvoice!(nonRemindable), String(nonRemindable)).toBe(false);
    }
  });
});

describe("FU-PENDING-OWED-WEB (D-256): every web owed figure counts PENDING remaining balance and stays NaN-safe", () => {
  it("PO-W04 RED-BEFORE: invoices/page.tsx counts a PENDING invoice in Unpaid and shows its PENDING status filter count", async () => {
    const pending = invoice("inv_pend_page", "PENDING", 500, [payment("inv_pend_page", 100)]);
    const draft = invoice("inv_draft_page", "DRAFT", 900);
    fetchInvoices.mockResolvedValue({ data: [pending, draft], error: null });

    render(<InvoicesHubPage />);
    await waitFor(() => expect(screen.getByText("INV_PEND_PAGE")).toBeTruthy());

    const unpaidBtn = screen
      .getAllByText("Unpaid")
      .map((el) => el.closest("button"))
      .find((b) => b?.querySelector("p.text-2xl")) as HTMLElement;
    expect(unpaidBtn).toBeTruthy();
    const [unpaidValue, unpaidCount] = Array.from(unpaidBtn.querySelectorAll("p")).map((p) => p.textContent ?? "");
    expect(unpaidValue).toBe(formatAmount(400, "TTD"));
    expect(unpaidCount).toBe("1 invoice");

    const pendingTab = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Pending") && b.textContent?.includes("1"));
    expect(pendingTab, "Pending status filter tab with count 1").toBeTruthy();
  });

  it("PO-W05: invoices/page.tsx row action menu never offers 'Send reminder' on PENDING, but offers it on SENT", async () => {
    const pending = invoice("inv_pend_menu", "PENDING", 500);
    const sent = invoice("inv_sent_menu", "SENT", 250);
    fetchInvoices.mockResolvedValue({ data: [pending, sent], error: null });

    render(<InvoicesHubPage />);
    await waitFor(() => expect(screen.getByText("INV_PEND_MENU")).toBeTruthy());

    const pendingRow = screen.getByText("INV_PEND_MENU").closest("tr") as HTMLElement;
    const pendingRowBtns = within(pendingRow).getAllByRole("button");
    fireEvent.click(pendingRowBtns[pendingRowBtns.length - 1]);
    expect(screen.queryByText("Send reminder")).toBeNull();

    const sentRow = screen.getByText("INV_SENT_MENU").closest("tr") as HTMLElement;
    const sentRowBtns = within(sentRow).getAllByRole("button");
    fireEvent.click(sentRowBtns[sentRowBtns.length - 1]);
    expect(screen.getByText("Send reminder")).toBeTruthy();
  });

  it("PO-W06 RED-BEFORE: InvoiceStatCards counts a PENDING invoice remaining balance in Unpaid without double-counting OVERDUE or DRAFT", () => {
    const pending = invoice("inv_pend_card", "PENDING", 500, [payment("inv_pend_card", 100)]);
    const overdue = invoice("inv_over_card", "OVERDUE", 300);
    const draft = invoice("inv_draft_card", "DRAFT", 900);

    render(<InvoiceStatCards invoices={[pending, overdue, draft]} currency="TTD" />);

    const cardFor = (label: string) => {
      const btn = screen
        .getAllByText(label)
        .map((el) => el.closest("button"))
        .find((b) => b?.querySelector("p.text-xl")) as HTMLElement;
      const [val, cnt] = Array.from(btn.querySelectorAll("p")).map((p) => p.textContent ?? "");
      return { val, cnt };
    };

    expect(cardFor("Unpaid")).toEqual({ val: formatAmount(400, "TTD"), cnt: "1 invoice" });
    expect(cardFor("Overdue")).toEqual({ val: formatAmount(300, "TTD"), cnt: "1 invoice" });
    expect(cardFor("Drafts")).toEqual({ val: formatAmount(900, "TTD"), cnt: "1 invoice" });
  });

  it("PO-W07 RED-BEFORE (R2): useFinancialSummary nets payments on PENDING/PARTIALLY_PAID, counts past-due PENDING in overdue, and excludes DRAFT", () => {
    const pendingCurrent = invoice("inv_pend_fs1", "PENDING", 500, [payment("inv_pend_fs1", 100)], { dueDate: NOT_YET_DUE });
    const pendingPastDue = invoice("inv_pend_fs2", "PENDING", 300, [payment("inv_pend_fs2", 50)], { dueDate: PAST_DUE });
    const draft = invoice("inv_draft_fs", "DRAFT", 900);

    const { result } = renderHook(() => useFinancialSummary([pendingCurrent, pendingPastDue, draft], [] as Quote[]));

    expect(result.current.outstanding).toBe(650);
    expect(result.current.overdue).toBe(250);
    expect(result.current.draftCount).toBe(1);
  });

  it("PO-W08 RED-BEFORE (R2): useBillingStats counts remaining balance for PENDING and PARTIALLY_PAID in outstanding and aging buckets, excluding DRAFT", () => {
    const pending = invoice("inv_pend_bs", "PENDING", 500, [payment("inv_pend_bs", 100)], { dueDate: NOT_YET_DUE });
    const partialPastDue = invoice("inv_part_bs", "PARTIALLY_PAID", 250, [payment("inv_part_bs", 50)], { dueDate: PAST_DUE });
    const draft = invoice("inv_draft_bs", "DRAFT", 900);

    const { result } = renderHook(() => useBillingStats([pending, partialPastDue, draft], [] as Quote[]));

    expect(result.current.outstanding).toBe(600);
    expect(result.current.aging[0]).toEqual({ label: "Current", count: 1, amount: 400 });
    expect(result.current.aging[1]).toEqual({ label: "1–30 days", count: 1, amount: 200 });
  });

  it("PO-W09 RED-BEFORE (R2): CommerceKpiStrip client fallback nets payments for PENDING/PARTIALLY_PAID and guards NaN totals", () => {
    const pending = invoice("inv_pend_kpi", "PENDING", 500, [payment("inv_pend_kpi", 100)]);
    const partial = invoice("inv_part_kpi", "PARTIALLY_PAID", 250, [payment("inv_part_kpi", 50)]);
    const malformed = invoice("inv_nan_kpi", "PENDING", undefined as unknown as number);
    const draft = invoice("inv_draft_kpi", "DRAFT", 900);

    render(<CommerceKpiStrip businessId={null} invoices={[pending, partial, malformed, draft]} quotes={[]} products={[]} currency="TTD" />);

    const owedLabel = screen.getByText("Owed");
    const owedCard = owedLabel.closest("div.rounded-xl") as HTMLElement;
    expect(owedCard.textContent).toContain("TTD 600");
    expect(owedCard.textContent).not.toContain("NaN");
  });

  it("PO-W10 RED-BEFORE (R2): CommerceOverviewTab At a Glance 'Invoiced' stage nets payments matching RevenueHero and guards NaN totals", () => {
    const pending = invoice("inv_pend_ov", "PENDING", 500, [payment("inv_pend_ov", 100)]);
    const partial = invoice("inv_part_ov", "PARTIALLY_PAID", 250, [payment("inv_part_ov", 50)]);
    const malformed = invoice("inv_nan_ov", "SENT", undefined as unknown as number);
    const draft = invoice("inv_draft_ov", "DRAFT", 900);

    render(
      <CommerceOverviewTab
        businessId="biz_pow"
        invoices={[pending, partial, malformed, draft]}
        quotes={[]}
        recurring={[]}
        currency="TTD"
        loading={false}
        onNavigate={() => {}}
        onNewItem={() => {}}
      />,
    );

    const invoicedStage = screen.getByText("Invoiced").closest("div.flex.flex-col") as HTMLElement;
    expect(invoicedStage).toBeTruthy();
    expect(invoicedStage.textContent).toContain("TTD 600");
    expect(invoicedStage.textContent).not.toContain("NaN");
  });

  it("PO-W11 RED-BEFORE (R2): computeCashPosition nets payments on PENDING/PARTIALLY_PAID, excludes DRAFT/VOID/PAID, and guards NaN totals", () => {
    const invoices = [
      invoice("inv_pend_cp", "PENDING", 500, [payment("inv_pend_cp", 100)]),
      invoice("inv_part_cp", "PARTIALLY_PAID", 250, [payment("inv_part_cp", 50)]),
      invoice("inv_nan_cp", "PENDING", undefined as unknown as number),
      invoice("inv_draft_cp", "DRAFT", 900),
      invoice("inv_void_cp", "VOID", 400),
      invoice("inv_paid_cp", "PAID", 1000),
    ];

    const pos = computeCashPosition(invoices, [], "TTD");
    expect(pos.outstanding).toBe(600);
    expect(Number.isNaN(pos.outstanding)).toBe(false);
    expect(pos.cashOnHand).toBe(1000);
  });

  it("PO-W12 RED-BEFORE (R2): CollectionsPanel includes past-due PENDING remaining balance WITH Mark Paid and WITHOUT Send Reminder or AI Reminder", () => {
    const pendingPastDue = invoice("inv_pend_col", "PENDING", 500, [payment("inv_pend_col", 100)], { dueDate: PAST_DUE });
    const pendingCurrent = invoice("inv_pend_future", "PENDING", 300, [], { dueDate: NOT_YET_DUE });

    render(
      <CollectionsPanel
        invoices={[pendingPastDue, pendingCurrent]}
        quotes={[]}
        currency="TTD"
        businessId="biz_pow"
        contacts={[]}
        setInvoices={() => {}}
      />,
    );

    expect(screen.getByText("INV_PEND_COL")).toBeTruthy();
    expect(screen.queryByText("INV_PEND_FUTURE")).toBeNull();
    // Remaining owed (400), not gross total (500)
    expect(screen.getByText("Total Overdue").closest("div.rounded-xl")?.textContent).toContain("400");
    expect(screen.getAllByTitle("Mark Paid")).toHaveLength(1);
    expect(screen.queryByTitle("Send Reminder")).toBeNull();
    expect(screen.queryByTitle("AI Reminder")).toBeNull();
    cleanup();

    const sentPastDue = invoice("inv_sent_col", "SENT", 200, [], { dueDate: PAST_DUE });
    render(
      <CollectionsPanel
        invoices={[sentPastDue]}
        quotes={[]}
        currency="TTD"
        businessId="biz_pow"
        contacts={[]}
        setInvoices={() => {}}
      />,
    );
    expect(screen.getByText("INV_SENT_COL")).toBeTruthy();
    expect(screen.getAllByTitle("Send Reminder")).toHaveLength(1);
    expect(screen.getAllByTitle("AI Reminder")).toHaveLength(1);
  });

  it("PO-W13 RED-BEFORE (R2): useActionQueue includes remaining balance of past-due PENDING in overdue and non-overdue PENDING in awaiting payment", () => {
    const pendingPastDue = invoice("inv_pend_aq1", "PENDING", 500, [payment("inv_pend_aq1", 100)], { dueDate: PAST_DUE });
    const pendingCurrent = invoice("inv_pend_aq2", "PENDING", 400, [payment("inv_pend_aq2", 150)], { dueDate: NOT_YET_DUE });

    const { result } = renderHook(() =>
      useActionQueue([pendingPastDue, pendingCurrent], [] as Quote[], "TTD", vi.fn(), vi.fn()),
    );

    const overdueItem = result.current.find((i) => i.id === "overdue");
    expect(overdueItem, "overdue action item for past-due PENDING").toBeTruthy();
    expect(overdueItem!.label).toBe("1 overdue invoice");
    expect(overdueItem!.detail).toBe("TTD 400");

    const awaitingItem = result.current.find((i) => i.id === "pending");
    expect(awaitingItem, "awaiting payment action item includes PENDING").toBeTruthy();
    expect(awaitingItem!.label).toContain("TTD 650");
    expect(awaitingItem!.detail).toBe("2 invoices");
  });

  it("PO-W14 RED-BEFORE: InvoicesPanel counts PENDING in status filters and keeps Send reminder hidden for PENDING", () => {
    const pending = invoice("inv_pend_panel", "PENDING", 500, [], { issueDate: new Date(Date.now() - DAY).toISOString() });
    const sent = invoice("inv_sent_panel", "SENT", 200, [], { issueDate: NOW });

    render(
      <InvoicesPanel
        invoices={[pending, sent]}
        contacts={[]}
        products={[]}
        businessId="biz_pow"
        currency="TTD"
        loading={false}
        setInvoices={() => {}}
        setProducts={() => {}}
        gmailStatus={null}
      />,
    );

    const moreSelect = screen.getByLabelText("More status filters") as HTMLSelectElement;
    const optionTexts = Array.from(moreSelect.options).map((o) => o.textContent ?? "");
    expect(optionTexts.some((t) => /Pending\s*\(1\)/.test(t)), `More options: ${optionTexts.join(", ")}`).toBe(true);

    // Locate each row's menu trigger explicitly from its invoice number
    const rowMenuTrigger = (num: string) => {
      let el: HTMLElement | null = screen.getByText(num);
      while (el) {
        const trigger = within(el).queryByLabelText("More actions");
        if (trigger) return trigger;
        el = el.parentElement;
      }
      throw new Error(`More actions button not found for ${num}`);
    };

    const pendTrigger = rowMenuTrigger("INV_PEND_PANEL");
    fireEvent.click(pendTrigger);
    expect(screen.queryByText("Send reminder")).toBeNull();
    fireEvent.click(pendTrigger);

    const sentTrigger = rowMenuTrigger("INV_SENT_PANEL");
    fireEvent.click(sentTrigger);
    expect(screen.getByText("Send reminder")).toBeTruthy();
  });

  it("PO-W16 RED-BEFORE (R2): BillingDetailModal Client Intelligence Outstanding counts PENDING and PARTIALLY_PAID remaining balance", () => {
    const contactId = "ct_pow_modal";
    const pending = invoice("inv_pend_modal", "PENDING", 500, [payment("inv_pend_modal", 100)], { contactId });
    const partial = invoice("inv_part_modal", "PARTIALLY_PAID", 250, [payment("inv_part_modal", 50)], { contactId });
    const draft = invoice("inv_draft_modal", "DRAFT", 900, [], { contactId });

    render(
      <BillingDetailModal
        type="invoice"
        itemId={pending.id}
        number={pending.invoiceNumber!}
        status={pending.status}
        contactId={contactId}
        contact={{ firstName: "Pow", lastName: "Modal", email: "modal@example.test" }}
        total={Number(pending.total)}
        currency="TTD"
        items={[]}
        dateLabel1="Issue Date"
        dateValue1={NOW}
        dateLabel2="Due Date"
        dateValue2={NOT_YET_DUE}
        taxRate={0}
        actions={null}
        allInvoices={[pending, partial, draft]}
        onClose={() => {}}
      />,
    );

    const outBox = screen.getByText("Outstanding").closest("div.rounded-lg") as HTMLElement;
    expect(outBox).toBeTruthy();
    expect(outBox.textContent).toContain(formatAmount(600, "TTD"));
  });

  it("PO-W17 RED-BEFORE (R2): ContactIntelligenceCard Outstanding counts PENDING and PARTIALLY_PAID remaining balance", () => {
    const contactId = "ct_pow_card";
    const pending = invoice("inv_pend_ci", "PENDING", 500, [payment("inv_pend_ci", 100)], { contactId });
    const partial = invoice("inv_part_ci", "PARTIALLY_PAID", 250, [payment("inv_part_ci", 50)], { contactId });
    const draft = invoice("inv_draft_ci", "DRAFT", 900, [], { contactId });

    render(
      <ContactIntelligenceCard
        contactId={contactId}
        contactName="Pow Card"
        invoices={[pending, partial, draft]}
        currency="TTD"
      />,
    );

    const outBox = screen.getByText("Outstanding").closest("div.rounded-lg") as HTMLElement;
    expect(outBox).toBeTruthy();
    expect(outBox.textContent).toContain("600");
  });

  it("PO-W18 RED-BEFORE (R2): CommerceInsightsTab awaiting-payment count sums across OWED_STATUSES (not SENT only)", async () => {
    fetchCommerceStats.mockResolvedValue({
      data: {
        totalRevenue: 0,
        outstandingAmount: 750,
        overdueAmount: 0,
        quoteConversionRate: 0,
        invoiceStatusBreakdown: {
          PENDING: { count: 2, total: 500 },
          PARTIALLY_PAID: { count: 1, total: 250 },
          SENT: { count: 0, total: 0 },
          OVERDUE: { count: 0, total: 0 },
          DRAFT: { count: 0, total: 0 },
        },
        revenueTimeline: [],
        topClients: [],
        topProducts: [],
        paymentMethodBreakdown: [],
      },
      error: null,
    });

    render(<CommerceInsightsTab businessId="biz_pow" invoices={[]} quotes={[]} currency="TTD" />);
    await waitFor(() => expect(screen.getByText(/3 awaiting payment/)).toBeTruthy());
  });

  it("PO-W19 RED-BEFORE (R2): getPipelineStage does not misclassify PENDING as draft", () => {
    expect(getPipelineStage("PENDING")).not.toBe("draft");
    expect(getPipelineStage("PENDING")).toBe("sent");
  });

  it("PO-W20 (R3): invoiceRemainingOwed handles refunds, over-refund D-250 clamping, string totals, NaN totals, and non-owed statuses", () => {
    expect(commerceStatus.invoiceRemainingOwed({ status: "PENDING", total: "500", currency: "TTD", payments: [payment("r1", 200), payment("r1", -50, "REFUNDED")] })).toBe(350);
    // D-250 upper clamp: orphan refund exceeding paid never exceeds invoice total
    expect(commerceStatus.invoiceRemainingOwed({ status: "PENDING", total: 500, currency: "TTD", payments: [payment("r2", -100, "REFUNDED")] })).toBe(500);
    // Malformed totals stay 0 (never NaN)
    expect(commerceStatus.invoiceRemainingOwed({ status: "PENDING", total: undefined, currency: "TTD", payments: [] })).toBe(0);
    expect(commerceStatus.invoiceRemainingOwed({ status: "PENDING", total: "not-a-number", currency: "TTD", payments: [] })).toBe(0);
    // Non-owed statuses always return 0
    expect(commerceStatus.invoiceRemainingOwed({ status: "DRAFT", total: 500, currency: "TTD", payments: [] })).toBe(0);
    expect(commerceStatus.invoiceRemainingOwed({ status: "PAID", total: 500, currency: "TTD", payments: [] })).toBe(0);
  });

  it("PO-W21 RED-BEFORE (R3): InvoicesPanel forwards payments and currency in allInvoices so BillingDetailModal Client Intelligence nets remaining balance", async () => {
    const contactId = "ct_pow_wire";
    const pending = invoice("inv_pend_wire", "PENDING", 500, [payment("inv_pend_wire", 100)], { contactId });
    const partial = invoice("inv_part_wire", "PARTIALLY_PAID", 250, [payment("inv_part_wire", 50)], { contactId });

    render(
      <InvoicesPanel
        invoices={[pending, partial]}
        contacts={[]}
        products={[]}
        businessId="biz_pow"
        currency="TTD"
        loading={false}
        setInvoices={() => {}}
        setProducts={() => {}}
        gmailStatus={null}
      />,
    );

    // Click the pending invoice row to open BillingDetailModal
    fireEvent.click(screen.getByText("INV_PEND_WIRE"));
    const outLabel = await screen.findByText("Outstanding");
    const outBox = outLabel.closest("div.rounded-lg") as HTMLElement;
    expect(outBox.textContent).toContain(formatAmount(600, "TTD"));
    expect(outBox.textContent).not.toContain(formatAmount(750, "TTD"));
  });

  it("PO-W22 RED-BEFORE (R3): invoices/page.tsx and InvoiceStatCards stay NaN-safe and enforce D-250 upper clamp on over-refunded rows", async () => {
    const overRefunded = invoice("inv_overref_r3", "PENDING", 500, [payment("inv_overref_r3", -100, "REFUNDED")]);
    const malformed = invoice("inv_nan_r3", "PENDING", undefined as unknown as number);

    render(<InvoiceStatCards invoices={[overRefunded, malformed]} currency="TTD" />);
    const cardBtn = screen
      .getAllByText("Unpaid")
      .map((el) => el.closest("button"))
      .find((b) => b?.querySelector("p.text-xl")) as HTMLElement;
    expect(cardBtn.textContent).toContain(formatAmount(500, "TTD"));
    expect(cardBtn.textContent).not.toContain("NaN");
    cleanup();

    fetchInvoices.mockResolvedValue({ data: [overRefunded, malformed], error: null });
    render(<InvoicesHubPage />);
    await waitFor(() => expect(screen.getByText("INV_OVERREF_R3")).toBeTruthy());
    const pageUnpaidBtn = screen
      .getAllByText("Unpaid")
      .map((el) => el.closest("button"))
      .find((b) => b?.querySelector("p.text-2xl")) as HTMLElement;
    expect(pageUnpaidBtn.textContent).toContain(formatAmount(500, "TTD"));
    expect(pageUnpaidBtn.textContent).not.toContain("NaN");
  });

  it("PO-W23 RED-BEFORE (R3): CommerceOverviewTab RevenueActionCards overdue card nets partial payments and guards NaN totals", () => {
    const overduePartial = invoice("inv_over_act", "OVERDUE", 500, [payment("inv_over_act", 100)], { dueDate: PAST_DUE });
    const overdueNan = invoice("inv_over_nan", "OVERDUE", undefined as unknown as number, [], { dueDate: PAST_DUE });

    render(
      <CommerceOverviewTab
        businessId="biz_pow"
        invoices={[overduePartial, overdueNan]}
        quotes={[]}
        recurring={[]}
        currency="TTD"
        loading={false}
        onNavigate={() => {}}
        onNewItem={() => {}}
      />,
    );

    const overdueCardText = screen.getByText("2 overdue invoices").parentElement?.textContent ?? "";
    expect(overdueCardText).toContain("400");
    expect(overdueCardText).not.toContain("500");
    expect(overdueCardText).not.toContain("NaN");
  });

  it("PO-W24 RED-BEFORE (R3): CollectionsPanel renders 0% recovery rate (never NaN%) when overdue queue nets to 0", () => {
    const settledOverdue = invoice("inv_zero_col", "OVERDUE", 500, [payment("inv_zero_col", 500)], { dueDate: PAST_DUE });

    render(
      <CollectionsPanel
        invoices={[settledOverdue]}
        quotes={[]}
        currency="TTD"
        businessId="biz_pow"
        contacts={[]}
        setInvoices={() => {}}
      />,
    );

    expect(screen.getByText(/0% recovery rate/)).toBeTruthy();
    expect(screen.queryByText(/NaN%/)).toBeNull();
  });
});

describe("FU-PENDING-OWED-WEB (D-256): static single-source-of-truth guard", () => {
  it("PO-W15 RED-BEFORE: every migrated web reader imports OWED_STATUSES from @/lib/commerce-status and defines no private owed Set", () => {
    const migratedFiles = [
      "../payments/payments-tab.tsx",
      "../invoices/page.tsx",
      "../invoices/components/invoice-stat-cards.tsx",
      "../hooks/use-financial-summary.ts",
      "../hooks/use-billing-stats.ts",
      "../components/commerce-kpi-strip.tsx",
      "../components/commerce-overview-tab.tsx",
      "../components/billing-detail-modal.tsx",
      "../components/contact-intelligence-card.tsx",
      "../insights/commerce-insights-tab.tsx",
      "../../../../lib/finance/utils.ts",
      "../billing/collections-panel.tsx",
      "../hooks/use-action-queue.ts",
    ];
    for (const rel of migratedFiles) {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src, `${rel} must import OWED_STATUSES from commerce-status`).toMatch(
        /import\s+\{[^}]*\bOWED_STATUSES\b[^}]*\}\s+from\s+["'](?:@\/lib\/commerce-status|\.\.\/commerce-status)["']/,
      );
      expect(src, `${rel} must not declare a private OWED_STATUSES Set`).not.toMatch(
        /const\s+OWED_STATUSES\b\s*(?::[^=]*)?=\s*new\s+Set\(/,
      );
    }
  });
});
