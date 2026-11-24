/**
 * MOUNT-QUOTES (SWP-QUOTE-LINK-SEND, BUG-101): the Send Quote compose names
 * the business, carries the customer's link, and sends through the document's
 * own route when the caller gives one.
 *
 * At main 9a7b5011 the composer applied the Send Quote template's body only
 * (the subject stayed whatever the caller passed, "Quote <n>", naming no
 * business), the body said "approve directly via the link in the document"
 * with no link anywhere, and every send went to the raw Gmail route, so a
 * quote email never carried the /quote/<token> link and never moved the quote
 * to SENT on the server.
 *
 * THE RULE: with a quote context and no subject, the composer's subject is the
 * template's, "Quote #<n> from <business>"; the body carries context.link
 * when the caller knows it, else says the link to view and accept is in the
 * email; a prefill with `send` is sent through it, one call per recipient,
 * with the subject, the html body and its plain text, never through the Gmail
 * route, and its subject is fixed; an error it answers is shown and keeps the
 * composer open. Other contexts are untouched.
 *
 *   CTA-01  RED-BEFORE  quote context, no subject: subject "Quote #Q-7 from Acme Bakery", body carries the link;
 *                       the text handed to `send` does not (review SEC-MQ-1: the request body is audited)
 *   CTA-02  RED-BEFORE  `send` is called per recipient with subject, htmlBody and text; onSent then onClose; no Gmail call
 *   CTA-03  control     an invoice context without `send` goes to the Gmail route with the caller's subject, as before
 *   CTA-04  RED-BEFORE  a quote context with no link says the link is in the email and carries no URL
 *   CTA-05  RED-BEFORE  `send` answering an error shows it and leaves the composer open
 *   CTA-06  RED-BEFORE  the subject is fixed when `send` is given
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as unknown as ((...args: unknown[]) => unknown) & Record<string, ReturnType<typeof vi.fn>>;
  fn.success = vi.fn();
  fn.error = vi.fn();
  fn.info = vi.fn();
  return fn;
});
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_v1mq" }));

import { ComposeModal, type ComposePrefill } from "../compose-modal";

type Call = { method: string; path: string; body: Record<string, unknown> | null };
function installServer() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    const text = JSON.stringify(url.pathname.endsWith("/contacts") ? { contacts: [] } : { messageId: "m1" });
    return { ok: true, status: 200, json: async () => JSON.parse(text) as unknown, text: async () => text } as unknown as Response;
  }));
  return { calls };
}

type SendDraft = { to: string; subject: string; htmlBody: string; text: string };
type Prefill = ComposePrefill & { onSent?: () => void; send?: (draft: SendDraft) => Promise<{ error?: string | null }> };

const quoteContext = (link: string | null) => ({
  type: "quote" as const,
  recordNumber: "Q-7",
  amount: "1,066.00",
  currency: "TTD",
  contactName: "Ana Lee",
  businessName: "Acme Bakery",
  ...(link ? { link } : {}),
});

function open(prefill: Prefill, handlers: { onClose?: () => void; onSent?: () => void } = {}) {
  const onClose = handlers.onClose ?? vi.fn();
  const onSent = handlers.onSent ?? vi.fn();
  render(<ComposeModal open onClose={onClose} prefill={prefill} onSent={onSent} />);
  return { onClose, onSent };
}

const subjectInput = () => screen.getByPlaceholderText("What's this email about?") as HTMLInputElement;
const sendButton = () => screen.getByRole("button", { name: /^send email$/i });

beforeEach(() => {
  toastMock.error.mockClear();
  toastMock.success.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MOUNT-QUOTES: the Send Quote compose", () => {
  it("CTA-01 RED-BEFORE: a quote context with no subject takes the template's subject, naming the business, and the body carries the link", async () => {
    installServer();
    const send = vi.fn(async (_d: SendDraft) => ({}));
    open({ to: "ana@example.test", context: quoteContext("https://app.keyflow.test/quote/tok_v1mq"), send });
    expect(subjectInput().value).toBe("Quote #Q-7 from Acme Bakery");
    fireEvent.click(sendButton());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const draft = send.mock.calls[0]![0];
    expect(draft.subject).toBe("Quote #Q-7 from Acme Bakery");
    expect(draft.htmlBody).toContain('href="https://app.keyflow.test/quote/tok_v1mq"');
    expect(draft.htmlBody).toContain("Q-7");
    expect(draft.htmlBody).toContain("Ana Lee");
    // Review SEC-MQ-1: the text that goes to the document's route (and so into
    // the audited request body) never carries the bearer link; the route adds
    // the link itself. The member still sees it in the composer body.
    expect(draft.text).not.toContain("https://app.keyflow.test/quote/tok_v1mq");
    expect(draft.text).not.toMatch(/https?:\/\//);
    expect(draft.text).not.toMatch(/view and accept it here/i);
    expect(draft.text).not.toMatch(/<[a-z/]/i);
    expect(draft.text).toMatch(/Hi Ana Lee,\n/);
    expect(draft.text).toMatch(/Q-7/);
  });

  it("CTA-02 RED-BEFORE: `send` is called once per recipient and nothing goes to the Gmail route; onSent then onClose", async () => {
    const server = installServer();
    const order: string[] = [];
    const send = vi.fn(async (d: SendDraft) => { order.push(`send:${d.to}`); return {}; });
    const { onClose, onSent } = open(
      { to: ["ana@example.test", "bo@example.test"], context: quoteContext(null), send },
      { onClose: vi.fn(() => { order.push("close"); }), onSent: vi.fn(() => { order.push("sent"); }) },
    );
    fireEvent.click(sendButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["send:ana@example.test", "send:bo@example.test", "sent", "close"]);
    expect(server.calls.filter((c) => c.path.includes("/gmail/"))).toEqual([]);
  });

  it("CTA-03 control: an invoice context without `send` goes to the Gmail route with the caller's subject, as before", async () => {
    const server = installServer();
    const { onClose } = open({ to: "ana@example.test", subject: "Invoice INV-1", context: { type: "invoice", recordNumber: "INV-1", amount: "10.00", currency: "TTD", businessName: "Acme Bakery" } });
    expect(subjectInput().value).toBe("Invoice INV-1");
    expect(subjectInput().disabled).toBe(false);
    fireEvent.click(sendButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const gmail = server.calls.filter((c) => c.method === "POST" && c.path === "/commerce/businesses/biz_v1mq/gmail/messages/send");
    expect(gmail).toHaveLength(1);
    expect(gmail[0]!.body).toMatchObject({ to: "ana@example.test", subject: "Invoice INV-1" });
    expect(String(gmail[0]!.body!.htmlBody)).toContain("INV-1");
  });

  it("CTA-04 RED-BEFORE: a quote context with no link says the link to view and accept is in the email, and carries no URL", async () => {
    installServer();
    const send = vi.fn(async (_d: SendDraft) => ({}));
    open({ to: "ana@example.test", context: quoteContext(null), send });
    fireEvent.click(sendButton());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const draft = send.mock.calls[0]![0];
    expect(draft.text).toMatch(/view and accept/i);
    expect(draft.htmlBody).not.toMatch(/https?:\/\//);
    expect(draft.htmlBody).not.toMatch(/in the document/i);
  });

  it("CTA-05 RED-BEFORE: an error `send` answers is shown and the composer stays open", async () => {
    installServer();
    const send = vi.fn(async (_d: SendDraft) => ({ error: "Gmail is not connected for this business" }));
    const { onClose, onSent } = open({ to: "ana@example.test", context: quoteContext(null), send });
    fireEvent.click(sendButton());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Gmail is not connected for this business"));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
  });

  it("CTA-06 RED-BEFORE: the subject is fixed when the document's own route sends (it sets the subject)", () => {
    installServer();
    open({ to: "ana@example.test", context: quoteContext(null), send: vi.fn(async () => ({})) });
    expect(subjectInput().disabled).toBe(true);
    expect(subjectInput().value).toBe("Quote #Q-7 from Acme Bakery");
  });
});
