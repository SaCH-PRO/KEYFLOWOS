/**
 * V1-52-QUOTE-PUBLIC-LINK (CF-16): the quotes panel hands the customer the
 * quote's public link without an email provider.
 *
 * At the packet base (pkt/V1-51-QUOTE-CONVERSION-JOURNEY-repair 60b2cc56) the
 * quote's link reached a customer only inside the Gmail send-email message.
 * The panel's "Share via WhatsApp" (quotes-panel.tsx:597-603 at this base)
 * opened wa.me with "Hi <name>, here is your quote <number> for <amount>..."
 * and no link, and there was no way to copy one.
 *
 * Contract pinned here (QuotesPanel mounted with the real client, fetch stubbed
 * at the network edge, no Gmail connected):
 *   - a SENT quote offers "Copy link": it POSTs
 *     /commerce/businesses/:b/quotes/:id/public-link and copies the url the
 *     server answers (the /quote/<token> page) to the clipboard;
 *   - "Share via WhatsApp" asks the server for the same link and the WhatsApp
 *     text carries it;
 *   - a DRAFT offers no "Copy link", and its WhatsApp share shows the server's
 *     refusal (409: send the quote first) instead of opening a message with no
 *     link; a converted quote offers no "Copy link";
 *   - nothing here calls a Gmail route or the email composer.
 *   - V1-52 review (CR-V152-2): a member without revenue write access is refused
 *     the link (403). Their WhatsApp share of a sent quote still opens with the
 *     quote's number and amount and no link (the pre-packet message), with a
 *     notice that the link needs write access; their Copy link shows the refusal.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

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
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => undefined }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task", markTaskCompleted: () => undefined }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../../hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: null, saveBranding: vi.fn(), savingBranding: false }),
}));
// The heavy modals are reduced to what the panel hands them: the detail modal shows its action bar.
vi.mock("../../components/billing-form-modal", () => ({ BillingFormModal: () => null }));
vi.mock("../../components/billing-detail-modal", () => ({
  BillingDetailModal: ({ actions }: { actions?: React.ReactNode }) => <div data-testid="quote-detail">{actions}</div>,
}));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => ({}) }));

import QuotesPanel from "../quotes-panel";
import type { Quote } from "@/lib/client";

const BIZ = "biz_v52";
const PUBLIC_URL = "https://app.keyflow.test/quote/tok_v52_sent";

function quote(id: string, fields: Partial<Quote>): Quote {
  return {
    id,
    quoteNumber: `QT-${id}`,
    status: "SENT",
    subtotal: 100,
    total: 100,
    currency: "TTD",
    issueDate: "2026-11-01T10:00:00.000Z",
    businessId: BIZ,
    contactId: "ct_v52",
    contact: { id: "ct_v52", firstName: "Ana", lastName: "Lee", email: "ana@example.test" } as Quote["contact"],
    items: [{ id: `${id}_i1`, description: "Service", quantity: 1, unitPrice: 100, total: 100 }] as Quote["items"],
    createdAt: "2026-11-01T10:00:00.000Z",
    ...fields,
  };
}

const SENT = quote("q_sent", { status: "SENT", viewToken: "tok_v52_sent" });
const DRAFT = quote("q_draft", { status: "DRAFT", viewToken: null });
const CONVERTED = quote("q_conv", { status: "ACCEPTED", invoiceId: "inv_v52", viewToken: "tok_v52_conv" });
// Quotes the server refuses with 403 (the member has revenue read access only).
const READ_SENT = quote("q_ro_sent", { status: "SENT" });
const READ_DRAFT = quote("q_ro_draft", { status: "DRAFT" });
const FORBIDDEN = "Insufficient permissions: revenue requires write access (you have read)";

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

type Call = { method: string; path: string };

function installServer() {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname });
    if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/quotes/q_sent/public-link`) {
      return jsonResponse(201, { token: "tok_v52_sent", url: PUBLIC_URL });
    }
    if (method === "POST" && url.pathname === `/commerce/businesses/${BIZ}/quotes/q_draft/public-link`) {
      return jsonResponse(409, {
        statusCode: 409,
        code: "quote_not_sent",
        message: "This quote is a draft: send it first, then share its link.",
      });
    }
    if (method === "POST" && /\/quotes\/q_ro_[a-z]+\/public-link$/.test(url.pathname)) {
      return jsonResponse(403, { statusCode: 403, message: FORBIDDEN });
    }
    return jsonResponse(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    linkCalls: () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/public-link")),
  };
}

function renderPanel(quotes: Quote[]) {
  return render(
    <QuotesPanel
      quotes={quotes}
      contacts={[]}
      products={[]}
      businessId={BIZ}
      loading={false}
      gmailStatus={{ connected: false, email: null }}
      setProducts={vi.fn()}
      setQuotes={vi.fn()}
      setInvoices={vi.fn()}
    />,
  );
}

/** Open the overflow menu of the only quote card on screen. */
function openMenu() {
  const buttons = screen.getAllByLabelText("More actions");
  expect(buttons.length).toBeGreaterThan(0);
  fireEvent.click(buttons[0]!);
}

let clipboardWrite: ReturnType<typeof vi.fn>;
let windowOpen: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clipboardWrite = vi.fn(async () => undefined);
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: clipboardWrite }, configurable: true });
  windowOpen = vi.fn(() => null);
  vi.stubGlobal("open", windowOpen);
  window.open = windowOpen as unknown as typeof window.open;
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.info.mockClear();
  composerOpen.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("V1-52 quotes panel: provider-free public link", () => {
  it("a SENT quote offers Copy link: it POSTs the public-link route and copies the server's /quote/<token> url", async () => {
    const server = installServer();
    renderPanel([SENT]);
    openMenu();
    fireEvent.click(screen.getByText("Copy link"));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    expect(clipboardWrite).toHaveBeenCalledWith(PUBLIC_URL);
    expect(new URL(PUBLIC_URL).pathname).toBe("/quote/tok_v52_sent");
    expect(server.linkCalls()).toEqual([{ method: "POST", path: `/commerce/businesses/${BIZ}/quotes/q_sent/public-link` }]);
    expect(toastMock.success).toHaveBeenCalled();
    // No email provider is involved: no Gmail route, no composer.
    expect(server.calls.some((c) => c.path.includes("/gmail"))).toBe(false);
    expect(composerOpen).not.toHaveBeenCalled();
  });

  it("the detail view of a SENT quote offers Copy link too", async () => {
    installServer();
    renderPanel([SENT]);
    openMenu();
    fireEvent.click(screen.getByText("View details"));
    const detail = await screen.findByTestId("quote-detail");
    fireEvent.click(within(detail).getByTitle("Copy link"));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(PUBLIC_URL));
  });

  it("Share via WhatsApp asks the server for the link and the WhatsApp text carries it", async () => {
    const server = installServer();
    renderPanel([SENT]);
    openMenu();
    fireEvent.click(screen.getByText("Share via WhatsApp"));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    const target = String(windowOpen.mock.calls[0]![0]);
    expect(target.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(target.slice("https://wa.me/?text=".length));
    expect(text).toContain(PUBLIC_URL);
    expect(text).toContain("QT-q_sent");
    expect(server.linkCalls()).toHaveLength(1);
    expect(server.calls.some((c) => c.path.includes("/gmail"))).toBe(false);
  });

  it("a DRAFT offers no Copy link, and its WhatsApp share shows the server's refusal instead of a message with no link", async () => {
    const server = installServer();
    renderPanel([DRAFT]);
    openMenu();
    expect(screen.queryByText("Copy link")).toBeNull();
    fireEvent.click(screen.getByText("Share via WhatsApp"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(String(toastMock.error.mock.calls[0]![0])).toContain("send it first");
    expect(windowOpen).not.toHaveBeenCalled();
    expect(server.linkCalls()).toHaveLength(1);
  });

  it("a quote converted to an invoice offers no Copy link", () => {
    installServer();
    renderPanel([CONVERTED]);
    openMenu();
    expect(screen.queryByText("Copy link")).toBeNull();
  });

  it("CR-V152-2: a member refused the link (403) still shares a sent quote on WhatsApp, with its number and amount and no link, and is told why", async () => {
    const server = installServer();
    renderPanel([READ_SENT]);
    openMenu();
    fireEvent.click(screen.getByText("Share via WhatsApp"));
    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    const target = String(windowOpen.mock.calls[0]![0]);
    expect(target.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(target.slice("https://wa.me/?text=".length));
    expect(text).toContain("Hi Ana Lee, here is your quote QT-q_ro_sent for");
    expect(text).not.toContain("/quote/");
    expect(text).not.toContain("http");
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    expect(String(toastMock.info.mock.calls[0]![0])).toContain("without the quote link");
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(server.linkCalls()).toEqual([{ method: "POST", path: `/commerce/businesses/${BIZ}/quotes/q_ro_sent/public-link` }]);
  });

  it("CR-V152-2: the same member's Copy link shows the refusal and copies nothing; their DRAFT share is refused as before", async () => {
    installServer();
    renderPanel([READ_SENT]);
    openMenu();
    fireEvent.click(screen.getByText("Copy link"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(String(toastMock.error.mock.calls[0]![0])).toContain("requires write access");
    expect(clipboardWrite).not.toHaveBeenCalled();
    cleanup();

    toastMock.error.mockClear();
    renderPanel([READ_DRAFT]);
    openMenu();
    fireEvent.click(screen.getByText("Share via WhatsApp"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(windowOpen).not.toHaveBeenCalled();
  });
});
