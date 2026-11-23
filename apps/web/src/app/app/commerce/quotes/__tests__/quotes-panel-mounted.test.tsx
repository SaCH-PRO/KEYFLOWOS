/**
 * MOUNT-QUOTES (D-150 hubs, D-153 whatsapp): Sales > Quotes is quotes-panel.tsx,
 * and the panel's edit, send, convert and detail behave as journey D expects.
 *
 * At main 9a7b5011 the panel (kept current through V1-51..V1-53b) was mounted
 * nowhere: Sales showed FinancePipeline instead, whose accepted quotes offered
 * no Convert (BUG-003), whose drafts no Edit (BUG-045), whose rows no WhatsApp
 * or Copy link (BUG-044), and whose bulk Status > Void deleted (BUG-033). The
 * panel's own send opened the generic composer with subject "Quote <n>", no
 * business name and no customer link (BUG-101), and its "Send Quote" flipped a
 * draft to SENT without sending anything; its detail printed the stored code
 * ("ACCEPTED"), said "Expiry Date", and kept the snapshot it opened with.
 *
 * THE RULE:
 *   - the Quotes tab of /app/commerce is QuotesPanel over the shell's quotes;
 *   - a quote email goes through the server's quote send route (POST
 *     quotes/:id/send-email), which carries the customer's /quote/<token> link,
 *     reserves the token on a DRAFT and moves it to SENT only after Gmail took
 *     the message; the composer shows the Send Quote template, its subject
 *     names the business, and a sent quote's link is in the body;
 *   - the detail reads the quote from the list (so an Accept, an extension or
 *     a refresh is what it shows), says "Expires", and Duplicate leaves it for
 *     the builder;
 *   - ticking a row never opens the detail; the bulk bar's statuses are Send
 *     All and Reject All, never Void.
 *
 *   QPM-01  RED-BEFORE  the Quotes door mounts the panel: "Search quotes...", "New Quote", the rows
 *   QPM-02  pin         Edit on a draft opens the builder in edit mode and PATCHes the quote (notes kept)
 *   QPM-03  pin         ticking a row's checkbox selects it and opens no detail; the card does; the row is a
 *                       list item holding its checkbox (review F2c, journey D9's rowOf)
 *   QPM-04  pin         the bulk bar's Status menu offers Send All and Reject All only
 *   QPM-05  pin         Convert on an accepted quote posts the quote's own tax, discount and notes; the
 *                       convert form is a dialog (review F2b, journey D6)
 *   QPM-06  RED-BEFORE  the detail is given "Expires" for its second date
 *   QPM-07  RED-BEFORE  the detail prints the status in plain words and the total formatted
 *   QPM-08  RED-BEFORE  the detail re-reads the quote from the list
 *   QPM-09  RED-BEFORE  Duplicate from the detail closes it and opens the builder with the copy
 *   QPM-10  RED-BEFORE  Send via email on a sent quote opens the composer with the template context
 *                       (business name, the token link) and a send that posts to send-email
 *   QPM-11  RED-BEFORE  the detail's Send Quote on a draft sends by email (no bare status flip)
 *   QPM-13  RED-BEFORE  the row's Convert is named even with its label hidden; the auto-convert toggle no longer
 *                       answers to /convert/i (journey D6 on a phone flipped the toggle instead of converting)
 *   QPM-12  RED-BEFORE  the detail's envelope offers Send via email for a draft or sent quote only, as the row
 *                       menu does (review SEC-MQ-3: an accepted quote's accept link is not re-emailed from here)
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

const composerOpen = vi.hoisted(() => vi.fn());
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: composerOpen }) }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/lib/use-return-navigation", () => ({ useReturnNavigation: () => ({ getReturnLabel: () => "Back", navigateBack: vi.fn() }) }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => undefined }));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: () => {} }));
vi.mock("@/hooks/use-plan", () => ({ usePlan: () => ({ checkLimit: () => ({ allowed: true }) }) }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task", markTaskCompleted: () => undefined }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("../../hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({
    businessData: { name: "Acme Bakery", primaryColor: "#F97316", secondaryColor: "#111111" },
    saveBranding: vi.fn(),
    savingBranding: false,
  }),
}));
/** The builder, reduced to what the panel hands it: open, edit mode, the notes, and a submit. */
vi.mock("../../components/billing-form-modal", () => ({
  BillingFormModal: ({ open, isEditing, notes, onNotesChange, onSubmit }: {
    open: boolean; isEditing: boolean; notes: string; onNotesChange: (v: string) => void; onSubmit: () => void;
  }) =>
    open ? (
      <div data-testid="quote-builder" data-editing={String(isEditing)}>
        <input aria-label="Builder notes" value={notes} onChange={(e) => onNotesChange(e.target.value)} />
        <button type="button" onClick={onSubmit}>Save builder</button>
      </div>
    ) : null,
}));
/** The detail, reduced to the props under test, with the real one kept for QPM-07. */
vi.mock("../../components/billing-detail-modal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/billing-detail-modal")>();
  return {
    RealBillingDetailModal: actual.BillingDetailModal,
    BillingDetailModal: ({ status, dateLabel2, total, currency, notes, actions }: {
      status: string; dateLabel2: string; total: number; currency: string; notes?: string | null; actions?: React.ReactNode;
    }) => (
      <div data-testid="quote-detail" data-status={status} data-date-label-2={dateLabel2} data-total={`${currency} ${total}`} data-notes={notes ?? ""}>
        {actions}
      </div>
    ),
  };
});
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => ({}) }));

// The page's other children, for QPM-01 (as commerce-no-pipeline-tab.test.tsx stubs them).
vi.mock("@/components/guide/keyflow-unified-shell", () => ({ KeyflowUnifiedShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/workspace-shell", () => ({
  WorkspaceShell: ({ tabs, activeTab, onTabChange, children }: {
    tabs: Array<{ key: string; label: string }>; activeTab: string; onTabChange: (k: string) => void; children: React.ReactNode;
  }) => (
    <div data-testid="shell" data-active-tab={activeTab}>
      {tabs.map((t) => <button key={t.key} role="tab" type="button" onClick={() => onTabChange(t.key)}>{t.label}</button>)}
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/skeleton", () => ({ ListPageSkeleton: () => <div>loading</div>, SkeletonList: () => <div>loading</div> }));
vi.mock("@/components/ui/workspace-error", () => ({ WorkspaceError: () => <div>error</div> }));
vi.mock("@/components/ui/mobile-action-sheet", () => ({ MobileActionSheet: () => null }));
vi.mock("@/components/layout/flow-quick-launcher", () => ({ FlowQuickLauncher: () => null }));
const shellData = vi.hoisted(() => ({ quotes: [] as unknown[] }));
vi.mock("../../hooks/use-commerce-shell", () => ({
  useCommerceShell: () => ({
    businessId: "biz_v1mq", businessCurrency: "TTD", workspaceLoading: false, workspaceError: null,
    products: [], setProducts: vi.fn(), invoices: [], setInvoices: vi.fn(),
    quotes: shellData.quotes, setQuotes: vi.fn(), contacts: [], loading: false, error: null,
    integrations: { gmailStatus: { connected: false, email: null } },
  }),
}));
vi.mock("../../hooks/use-billing-workspace", () => ({
  useBillingWorkspace: () => ({
    pendingPrefill: null, prefillForContact: vi.fn(), clearPrefill: vi.fn(),
    triggerNewQuote: 0, triggerNewInvoice: 0, triggerNewSchedule: 0,
    setTriggerNewQuote: vi.fn(), setTriggerNewInvoice: vi.fn(), setTriggerNewSchedule: vi.fn(),
  }),
}));
vi.mock("../../payments/payments-tab", () => ({ default: () => <div data-testid="tab-collections" /> }));
vi.mock("../../../finance/components/finance-pipeline", () => ({ FinancePipeline: () => <div data-testid="tab-pipeline" /> }));
vi.mock("../../../finance/components/revenue-composer", () => ({ RevenueComposer: () => null }));
vi.mock("../../recurring/recurring-panel", () => ({ default: () => <div data-testid="tab-recurring" /> }));
vi.mock("../../components/commerce-overview-tab", () => ({ CommerceOverviewTab: () => <div data-testid="tab-snapshot" /> }));
vi.mock("../../components/tab-frame", () => ({ TabFrame: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../../components/commerce-kpi-strip", () => ({ CommerceKpiStrip: () => null }));
vi.mock("../../components/revenue-record-drawer", () => ({ RevenueRecordDrawer: () => null }));
vi.mock("../../components/commerce-banners", () => ({ CommerceBanners: () => null }));
vi.mock("../../components/commerce-header-right", () => ({ CommerceHeaderRight: () => null }));
vi.mock("../../components/revenue-action-menu", () => ({ RevenueActionMenu: () => null }));
vi.mock("../../components/standalone-payment-recorder", () => ({ StandalonePaymentRecorder: () => null }));

import QuotesPanel from "../quotes-panel";
import CommercePage from "../../page";
import * as detailModule from "../../components/billing-detail-modal";
import type { Quote, Invoice } from "@/lib/client";

const BIZ = "biz_v1mq";
const PUBLIC_URL = "https://app.keyflow.test/quote/tok_v1mq_sent";
const NOTES = "50% deposit to confirm the date";

function quote(id: string, fields: Partial<Quote>): Quote {
  return {
    id,
    quoteNumber: `QT-${id}`,
    status: "SENT",
    subtotal: 1040,
    taxRate: 12.5,
    taxAmount: 130,
    discountType: "PERCENT",
    discountValue: 10,
    discountAmount: 104,
    total: 1066,
    currency: "TTD",
    issueDate: "2026-11-01T10:00:00.000Z",
    expiryDate: "2027-01-01T10:00:00.000Z",
    businessId: BIZ,
    contactId: "ct_v1mq",
    contact: { id: "ct_v1mq", firstName: "Ana", lastName: "Lee", email: "ana@example.test" } as Quote["contact"],
    items: [
      { id: `${id}_i1`, description: "Wedding cake, 3 tier", quantity: 1, unitPrice: 800, total: 800 },
      { id: `${id}_i2`, description: "Cupcakes", quantity: 24, unitPrice: 10, total: 240 },
    ] as Quote["items"],
    notes: NOTES,
    createdAt: "2026-11-01T10:00:00.000Z",
    ...fields,
  };
}
const DRAFT = quote("q_draft", { status: "DRAFT" });
const SENT = quote("q_sent", { status: "SENT" });
const ACCEPTED = quote("q_acc", { status: "ACCEPTED" });

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, statusText: status >= 400 ? "Error" : "OK", json: async () => JSON.parse(text) as unknown, text: async () => text } as unknown as Response;
}

type Call = { method: string; path: string; body: Record<string, unknown> | null };

function installServer() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    const m = url.pathname.match(/^\/commerce\/businesses\/biz_v1mq\/quotes\/([^/]+)(\/.*)?$/);
    if (m && method === "PATCH" && !m[2]) {
      const q = [DRAFT, SENT, ACCEPTED].find((x) => x.id === m[1])!;
      return jsonResponse(200, { ...q, notes: body?.notes ?? q.notes });
    }
    if (m && method === "POST" && m[2] === "/public-link") {
      return jsonResponse(201, { token: "tok_v1mq_sent", url: PUBLIC_URL });
    }
    if (m && method === "POST" && m[2] === "/send-email") {
      const q = [DRAFT, SENT, ACCEPTED].find((x) => x.id === m[1])!;
      return jsonResponse(201, { success: true, quote: { ...q, status: "SENT", viewToken: "tok_v1mq_new" } });
    }
    if (m && method === "POST" && m[2] === "/convert") {
      return jsonResponse(201, { id: "inv_v1mq_1", invoiceNumber: "INV-V1MQ-1", status: "DRAFT", total: 1066, currency: "TTD", items: [], notes: body?.notes ?? null });
    }
    if (method === "PATCH" && /^\/commerce\/quotes\/[^/]+\/status\//.test(url.pathname)) {
      const id = url.pathname.split("/")[3];
      const q = [DRAFT, SENT, ACCEPTED].find((x) => x.id === id)!;
      return jsonResponse(200, { ...q, status: url.pathname.endsWith("/sent") ? "SENT" : "ACCEPTED" });
    }
    return jsonResponse(200, {});
  }));
  return {
    calls,
    of: (pred: (c: Call) => boolean) => calls.filter(pred),
  };
}

/** The panel over quotes held in state, as the commerce page holds them; the state is reachable for QPM-08. */
const holder: { quotes: Quote[]; setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>; invoices: Invoice[] } = {
  quotes: [], setQuotes: () => {}, invoices: [],
};
function Holder({ initial }: { initial: Quote[] }) {
  const [quotes, setQuotes] = useState<Quote[]>(initial);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  useEffect(() => {
    holder.quotes = quotes;
    holder.setQuotes = setQuotes;
    holder.invoices = invoices;
  }, [quotes, invoices]);
  return (
    <QuotesPanel
      quotes={quotes}
      contacts={[]}
      products={[]}
      businessId={BIZ}
      loading={false}
      gmailStatus={{ connected: true, email: "owner@acme.test" }}
      setProducts={vi.fn()}
      setQuotes={setQuotes}
      setInvoices={setInvoices}
    />
  );
}
const renderPanel = (quotes: Quote[]) => render(<Holder initial={quotes} />);

function openMenu(index = 0) {
  const buttons = screen.getAllByLabelText("More actions");
  fireEvent.click(buttons[index]!);
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app/commerce");
  composerOpen.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
  shellData.quotes = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MOUNT-QUOTES: Sales > Quotes mounts the quotes panel", () => {
  it("QPM-01 RED-BEFORE: the Quotes door mounts the panel over the shell's quotes", () => {
    installServer();
    shellData.quotes = [DRAFT, SENT, ACCEPTED];
    window.history.replaceState({}, "", "/app/commerce?tab=pipeline&view=quotes");
    render(<CommercePage />);
    expect(screen.getByTestId("shell").getAttribute("data-active-tab")).toBe("quotes");
    expect(screen.getByPlaceholderText("Search quotes...")).toBeInTheDocument();
    expect(screen.getByLabelText("New Quote")).toBeInTheDocument();
    for (const q of [DRAFT, SENT, ACCEPTED]) expect(screen.getAllByText(q.quoteNumber).length).toBeGreaterThan(0);
    expect(screen.queryByPlaceholderText("Search records...")).toBeNull();
    expect(screen.queryByTestId("tab-pipeline")).toBeNull();
  });

  it("QPM-02: Edit on a draft opens the builder in edit mode with the quote's notes and PATCHes the quote", async () => {
    const server = installServer();
    renderPanel([DRAFT]);
    openMenu();
    fireEvent.click(screen.getByText("Edit"));
    const builder = screen.getByTestId("quote-builder");
    expect(builder.getAttribute("data-editing")).toBe("true");
    const notes = within(builder).getByLabelText("Builder notes") as HTMLInputElement;
    expect(notes.value).toBe(NOTES);
    fireEvent.change(notes, { target: { value: "Deposit 40% to confirm" } });
    fireEvent.click(within(builder).getByText("Save builder"));
    await waitFor(() => expect(server.of((c) => c.method === "PATCH" && c.path === `/commerce/businesses/${BIZ}/quotes/q_draft`)).toHaveLength(1));
    const patch = server.of((c) => c.method === "PATCH")[0]!.body!;
    expect(patch).toMatchObject({ contactId: "ct_v1mq", notes: "Deposit 40% to confirm", taxRate: 12.5, discountType: "PERCENT", discountValue: 10 });
    expect((patch.items as unknown[]).length).toBe(2);
    await waitFor(() => expect(holder.quotes[0]!.notes).toBe("Deposit 40% to confirm"));
    expect(screen.queryByTestId("quote-builder")).toBeNull();
  });

  it("QPM-03: ticking a row's checkbox selects it and opens no detail; the card itself opens the detail", () => {
    installServer();
    renderPanel([DRAFT]);
    const box = screen.getByLabelText(`Select quote ${DRAFT.quoteNumber}`) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(screen.queryByTestId("quote-detail")).toBeNull();
    // The bulk bar is up (its Status menu), and nothing else opened.
    expect(screen.getByRole("button", { name: /^status$/i })).toBeInTheDocument();
    fireEvent.click(screen.getAllByText(DRAFT.quoteNumber)[0]!);
    expect(screen.getByTestId("quote-detail")).toBeInTheDocument();
    // Review round 1 (F2c): the row is a list item that holds its own checkbox,
    // so a row found by its number (journey D's rowOf) can be ticked.
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByRole("checkbox")).toBe(box);
    expect(within(rows[0]!).getAllByText(DRAFT.quoteNumber).length).toBeGreaterThan(0);
  });

  it("QPM-04: the bulk bar's Status menu offers Send All and Reject All only (no Void, nothing that deletes)", () => {
    installServer();
    renderPanel([DRAFT, SENT]);
    fireEvent.click(screen.getByLabelText(`Select quote ${DRAFT.quoteNumber}`));
    fireEvent.click(screen.getByRole("button", { name: /^status$/i }));
    const menuButtons = screen.getAllByRole("button").map((b) => b.textContent?.trim()).filter((t) => t === "Send All" || t === "Reject All" || /void/i.test(t ?? ""));
    expect(menuButtons).toEqual(["Send All", "Reject All"]);
    expect(screen.queryByRole("button", { name: /void/i })).toBeNull();
  });

  it("QPM-05: Convert on an accepted quote posts the quote's own tax, discount and notes (deposit terms)", async () => {
    const server = installServer();
    renderPanel([ACCEPTED]);
    openMenu();
    fireEvent.click(screen.getByText("Convert to invoice"));
    // Review round 1 (F2b): the convert form is a dialog (journey D's D6 presses the dialog's Create Invoice).
    const dialog = screen.getByRole("dialog", { name: /convert quote to invoice/i });
    const notes = within(dialog).getByPlaceholderText("Payment terms or notes...") as HTMLTextAreaElement;
    expect(notes.value).toBe(NOTES);
    fireEvent.click(screen.getByRole("button", { name: "Create Invoice" }));
    await waitFor(() => expect(server.of((c) => c.path.endsWith("/quotes/q_acc/convert"))).toHaveLength(1));
    expect(server.of((c) => c.path.endsWith("/convert"))[0]!.body).toEqual({ taxRate: 12.5, discountType: "PERCENT", discountValue: 10, notes: NOTES });
    await waitFor(() => expect(holder.invoices.map((i) => i.id)).toEqual(["inv_v1mq_1"]));
    expect(holder.quotes[0]!.invoiceId).toBe("inv_v1mq_1");
    expect(screen.getByText("Converted")).toBeInTheDocument();
  });

  it("QPM-06 RED-BEFORE: the detail is given 'Expires' for its second date", () => {
    installServer();
    renderPanel([SENT]);
    fireEvent.click(screen.getAllByText(SENT.quoteNumber)[0]!);
    expect(screen.getByTestId("quote-detail").getAttribute("data-date-label-2")).toBe("Expires");
  });

  it("QPM-07 RED-BEFORE: the real detail prints the status in plain words and the total formatted", () => {
    installServer();
    const Real = (detailModule as unknown as { RealBillingDetailModal: typeof detailModule.BillingDetailModal }).RealBillingDetailModal;
    render(
      <Real
        type="quote"
        number="QT-q_acc"
        status="ACCEPTED"
        contact={ACCEPTED.contact ?? null}
        contactId="ct_v1mq"
        businessId={BIZ}
        total={1066}
        currency="TTD"
        items={ACCEPTED.items as Array<{ id?: string; description?: string | null; quantity?: number; unitPrice?: number; total?: number }>}
        dateLabel1="Issue Date"
        dateValue1={ACCEPTED.issueDate}
        dateLabel2="Expires"
        dateValue2={ACCEPTED.expiryDate ?? null}
        taxRate={12.5}
        discountType="PERCENT"
        discountValue={10}
        notes={NOTES}
        allInvoices={[]}
        actions={<span />}
        onClose={() => {}}
      />,
    );
    expect(screen.queryAllByText("ACCEPTED")).toEqual([]);
    expect(screen.getAllByText("Accepted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TTD 1,066.00").length).toBeGreaterThan(0);
    // The detail lays its dates out twice (the compact and the full panes).
    expect(screen.getAllByText("Expires").length).toBeGreaterThan(0);
  });

  it("QPM-08 RED-BEFORE: the detail re-reads the quote from the list, so an accept or a refresh is what it shows", () => {
    installServer();
    renderPanel([SENT]);
    fireEvent.click(screen.getAllByText(SENT.quoteNumber)[0]!);
    expect(screen.getByTestId("quote-detail").getAttribute("data-status")).toBe("SENT");
    act(() => {
      holder.setQuotes((prev) => prev.map((q) => (q.id === SENT.id ? { ...q, status: "ACCEPTED", total: 999, notes: "refreshed" } : q)));
    });
    const detail = screen.getByTestId("quote-detail");
    expect(detail.getAttribute("data-status")).toBe("ACCEPTED");
    expect(detail.getAttribute("data-total")).toBe("TTD 999");
    expect(detail.getAttribute("data-notes")).toBe("refreshed");
  });

  it("QPM-09 RED-BEFORE: Duplicate from the detail closes it and opens the builder with the copy", () => {
    installServer();
    renderPanel([ACCEPTED]);
    fireEvent.click(screen.getAllByText(ACCEPTED.quoteNumber)[0]!);
    fireEvent.click(within(screen.getByTestId("quote-detail")).getByTitle("Duplicate quote"));
    expect(screen.queryByTestId("quote-detail")).toBeNull();
    const builder = screen.getByTestId("quote-builder");
    expect(builder.getAttribute("data-editing")).toBe("false");
    expect((within(builder).getByLabelText("Builder notes") as HTMLInputElement).value).toBe(NOTES);
  });

  it("QPM-10 RED-BEFORE: Send via email on a sent quote opens the composer with the Send Quote context and a send that posts to send-email", async () => {
    const server = installServer();
    renderPanel([SENT]);
    openMenu();
    fireEvent.click(screen.getByText("Send via email"));
    await waitFor(() => expect(composerOpen).toHaveBeenCalledTimes(1));
    const prefill = composerOpen.mock.calls[0]![0] as {
      to?: string; subject?: string; context?: Record<string, unknown>;
      send?: (d: { to: string; subject: string; htmlBody: string; text: string }) => Promise<{ error?: string | null }>;
      onSent?: () => void;
    };
    expect(prefill.to).toBe("ana@example.test");
    // The template names the business and carries the link; the subject is the template's, not "Quote <n>".
    expect(prefill.subject).toBeUndefined();
    expect(prefill.context).toMatchObject({ type: "quote", recordNumber: "QT-q_sent", businessName: "Acme Bakery", contactName: "Ana Lee", link: PUBLIC_URL, amount: "1,066.00", currency: "TTD" });
    expect(server.of((c) => c.path.endsWith("/quotes/q_sent/public-link"))).toHaveLength(1);
    expect(typeof prefill.send).toBe("function");
    const result = await prefill.send!({ to: "ana@example.test", subject: "Quote #QT-q_sent from Acme Bakery", htmlBody: "<p>Hi Ana</p>", text: "Hi Ana" });
    expect(result).toEqual({});
    const sends = server.of((c) => c.path.endsWith("/quotes/q_sent/send-email"));
    expect(sends).toHaveLength(1);
    expect(sends[0]!.body).toEqual({ recipientEmail: "ana@example.test", message: "Hi Ana" });
    // No raw Gmail send, no bare status flip.
    expect(server.of((c) => c.path.includes("/gmail/"))).toEqual([]);
    expect(server.of((c) => /\/status\//.test(c.path))).toEqual([]);
  });

  it("QPM-11 RED-BEFORE: the detail's Send Quote on a draft sends by email through the server (which carries the link and moves it to SENT); no bare status flip", async () => {
    const server = installServer();
    renderPanel([DRAFT]);
    fireEvent.click(screen.getAllByText(DRAFT.quoteNumber)[0]!);
    fireEvent.click(within(screen.getByTestId("quote-detail")).getByRole("button", { name: /send quote/i }));
    await waitFor(() => expect(composerOpen).toHaveBeenCalledTimes(1));
    expect(server.of((c) => /\/status\/sent$/.test(c.path))).toEqual([]);
    const prefill = composerOpen.mock.calls[0]![0] as {
      context?: Record<string, unknown>;
      send?: (d: { to: string; subject: string; htmlBody: string; text: string }) => Promise<{ error?: string | null }>;
    };
    // A draft has no link yet: the server mints it when it sends.
    expect(prefill.context).toMatchObject({ type: "quote", recordNumber: "QT-q_draft", businessName: "Acme Bakery" });
    expect(prefill.context?.link).toBeFalsy();
    expect(server.of((c) => c.path.endsWith("/public-link"))).toEqual([]);
    await prefill.send!({ to: "ana@example.test", subject: "s", htmlBody: "<p>See attached</p>", text: "See attached" });
    expect(server.of((c) => c.path.endsWith("/quotes/q_draft/send-email"))).toHaveLength(1);
    await waitFor(() => expect(holder.quotes[0]!.status).toBe("SENT"));
  });

  it("QPM-12 RED-BEFORE: the detail's envelope offers Send via email for a draft or sent quote only", () => {
    installServer();
    for (const [q, offered] of [[DRAFT, true], [SENT, true], [ACCEPTED, false]] as const) {
      renderPanel([q]);
      fireEvent.click(screen.getAllByText(q.quoteNumber)[0]!);
      const detail = screen.getByTestId("quote-detail");
      expect(within(detail).queryByTitle("Send via email") !== null, q.status).toBe(offered);
      cleanup();
    }
  });

  it("QPM-13 RED-BEFORE: the row's Convert is named Convert even where its label is hidden, and no other control on the panel answers to /convert/i (journey D6 on a phone)", () => {
    installServer();
    renderPanel([ACCEPTED]);
    const row = screen.getAllByRole("listitem")[0]!;
    // The smart call to action carries an accessible name (its text is hidden under sm:).
    expect(within(row).getByRole("button", { name: "Convert" })).toBeInTheDocument();
    // Journey D finds a row's action by /convert/i on the page once the menu is open; the
    // auto-convert preference toggle used to be the only match on a phone and got flipped.
    expect(screen.getAllByRole("button", { name: /convert/i }).map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim())).toEqual(["Convert"]);
    openMenu();
    expect(screen.getAllByRole("button", { name: /convert/i }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Convert to invoice")).toBeInTheDocument();
  });
});
