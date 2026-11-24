/**
 * FU-PENDING-OWED-WEB (owner rulings D-256, D-252): every web owed figure counts
 * PENDING invoices through one shared OWED_STATUSES constant in @/lib/commerce-status
 * pinned against the server's OPEN_RECEIVABLE_STATUSES (less PARTIALLY_CREDITED),
 * while reminder buttons still never appear for PENDING.
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
vi.mock("@/lib/workspace", () => ({ refreshWorkspace: async () => "biz_pow", getStoredBusinessId: () => "biz_pow" }));
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
vi.mock("../components/billing-detail-modal", () => ({ BillingDetailModal: () => null }));
vi.mock("../components/invoice-mobile-actions", () => ({ InvoiceMobileActions: () => null }));

import * as commerceStatus from "@/lib/commerce-status";
import { computeCashPosition } from "@/lib/finance/utils";
import PaymentsTab, { OWED_STATUSES as PAYMENTS_TAB_OWED } from "../payments/payments-tab";
import InvoicesHubPage from "../invoices/page";
import { InvoiceStatCards } from "../invoices/components/invoice-stat-cards";
import { useFinancialSummary } from "../hooks/use-financial-summary";
import { useBillingStats } from "../hooks/use-billing-stats";
import { useActionQueue } from "../hooks/use-action-queue";
import { CommerceKpiStrip } from "../components/commerce-kpi-strip";
import { CommerceOverviewTab } from "../components/commerce-overview-tab";
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
    // Ensure PaymentsTab import is live and clean
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

describe("FU-PENDING-OWED-WEB (D-256): every web owed figure counts PENDING invoices", () => {
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

    // Status tab for Pending must exist and count 1
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

  it("PO-W07 RED-BEFORE: useFinancialSummary counts PENDING (and past-due PENDING in overdue) and excludes DRAFT from outstanding", () => {
    const pendingCurrent = invoice("inv_pend_fs1", "PENDING", 500, [], { dueDate: NOT_YET_DUE });
    const pendingPastDue = invoice("inv_pend_fs2", "PENDING", 300, [], { dueDate: PAST_DUE });
    const draft = invoice("inv_draft_fs", "DRAFT", 900);

    const { result } = renderHook(() => useFinancialSummary([pendingCurrent, pendingPastDue, draft], [] as Quote[]));

    expect(result.current.outstanding).toBe(800);
    expect(result.current.overdue).toBe(300);
    expect(result.current.draftCount).toBe(1);
  });

  it("PO-W08 RED-BEFORE: useBillingStats counts PENDING and PARTIALLY_PAID in outstanding and aging buckets, excluding DRAFT", () => {
    const pending = invoice("inv_pend_bs", "PENDING", 500, [], { dueDate: NOT_YET_DUE });
    const partialPastDue = invoice("inv_part_bs", "PARTIALLY_PAID", 250, [], { dueDate: PAST_DUE });
    const draft = invoice("inv_draft_bs", "DRAFT", 900);

    const { result } = renderHook(() => useBillingStats([pending, partialPastDue, draft], [] as Quote[]));

    expect(result.current.outstanding).toBe(750);
    expect(result.current.aging[0]).toEqual({ label: "Current", count: 1, amount: 500 });
    expect(result.current.aging[1]).toEqual({ label: "1–30 days", count: 1, amount: 250 });
  });

  it("PO-W09 RED-BEFORE: CommerceKpiStrip client fallback counts PENDING and PARTIALLY_PAID in Owed", () => {
    const pending = invoice("inv_pend_kpi", "PENDING", 500);
    const partial = invoice("inv_part_kpi", "PARTIALLY_PAID", 250);
    const draft = invoice("inv_draft_kpi", "DRAFT", 900);

    render(<CommerceKpiStrip businessId={null} invoices={[pending, partial, draft]} quotes={[]} products={[]} currency="TTD" />);

    const owedLabel = screen.getByText("Owed");
    const owedCard = owedLabel.closest("div.rounded-xl") as HTMLElement;
    expect(owedCard.textContent).toContain("TTD 750");
  });

  it("PO-W10 RED-BEFORE: CommerceOverviewTab At a Glance 'Invoiced' stage counts PENDING and PARTIALLY_PAID and excludes DRAFT", () => {
    const pending = invoice("inv_pend_ov", "PENDING", 500);
    const partial = invoice("inv_part_ov", "PARTIALLY_PAID", 250);
    const draft = invoice("inv_draft_ov", "DRAFT", 900);

    render(
      <CommerceOverviewTab
        businessId="biz_pow"
        invoices={[pending, partial, draft]}
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
    expect(invoicedStage.textContent).toContain("TTD 750");
    expect(invoicedStage.textContent).toContain("2");
  });

  it("PO-W11 RED-BEFORE: computeCashPosition counts PENDING and PARTIALLY_PAID in outstanding and excludes DRAFT/VOID/PAID", () => {
    const invoices = [
      invoice("inv_pend_cp", "PENDING", 500),
      invoice("inv_part_cp", "PARTIALLY_PAID", 250),
      invoice("inv_draft_cp", "DRAFT", 900),
      invoice("inv_void_cp", "VOID", 400),
      invoice("inv_paid_cp", "PAID", 1000),
    ];

    const pos = computeCashPosition(invoices, [], "TTD");
    expect(pos.outstanding).toBe(750);
    expect(pos.cashOnHand).toBe(1000);
  });

  it("PO-W12 RED-BEFORE: CollectionsPanel includes past-due PENDING in overdue queue WITH Mark Paid and WITHOUT Send Reminder or AI Reminder", () => {
    const pendingPastDue = invoice("inv_pend_col", "PENDING", 500, [], { dueDate: PAST_DUE });
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
    expect(screen.getAllByTitle("Mark Paid")).toHaveLength(1);
    expect(screen.queryByTitle("Send Reminder")).toBeNull();
    expect(screen.queryByTitle("AI Reminder")).toBeNull();
    cleanup();

    // Positive control: past-due SENT still has Send Reminder and AI Reminder
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

  it("PO-W13 RED-BEFORE: useActionQueue includes past-due PENDING in overdue and non-overdue PENDING in awaiting payment", () => {
    const pendingPastDue = invoice("inv_pend_aq1", "PENDING", 500, [], { dueDate: PAST_DUE });
    const pendingCurrent = invoice("inv_pend_aq2", "PENDING", 400, [], { dueDate: NOT_YET_DUE });

    const { result } = renderHook(() =>
      useActionQueue([pendingPastDue, pendingCurrent], [] as Quote[], "TTD", vi.fn(), vi.fn()),
    );

    const overdueItem = result.current.find((i) => i.id === "overdue");
    expect(overdueItem, "overdue action item for past-due PENDING").toBeTruthy();
    expect(overdueItem!.label).toBe("1 overdue invoice");
    expect(overdueItem!.detail).toBe("TTD 500");

    const awaitingItem = result.current.find((i) => i.id === "pending");
    expect(awaitingItem, "awaiting payment action item includes PENDING").toBeTruthy();
    expect(awaitingItem!.label).toContain("TTD 900");
    expect(awaitingItem!.detail).toBe("2 invoices");
  });

  it("PO-W14 RED-BEFORE: InvoicesPanel counts PENDING in status filters and keeps Send reminder hidden for PENDING", () => {
    const pending = invoice("inv_pend_panel", "PENDING", 500);
    const sent = invoice("inv_sent_panel", "SENT", 200);

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

    // PENDING row overflow menu must never show "Send reminder"
    const actionButtons = screen.getAllByLabelText("More actions");
    expect(actionButtons.length).toBe(2);
    fireEvent.click(actionButtons[0]);
    expect(screen.queryByText("Send reminder")).toBeNull();
    // Close first menu and open SENT row overflow menu
    fireEvent.click(actionButtons[0]);
    fireEvent.click(actionButtons[1]);
    expect(screen.getByText("Send reminder")).toBeTruthy();
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
