/**
 * V1-45b-CREATE-IDEMPOTENCY-HTTP (owner ruling D-15): the Sales > Quotes
 * panel's quote create sends one Idempotency-Key per open of the quote form,
 * minted with crypto.randomUUID and kept in a ref, on every save of that open,
 * so a save retried after a lost response is answered with the quote the first
 * one created. The next open of the form mints a new key.
 *
 * At the base (int/trial-O 9f09d6c8) no form minted a key, and a failed create
 * closed and reset the form, so the operator re-entered the quote and a create
 * whose response was lost became two quotes. A failed create now leaves the
 * form open for the retry.
 *
 * The panel is mounted with its real hooks and the real client; fetch is
 * stubbed at the network edge. The form modal is reduced to its submit and
 * close buttons (the panel's own handler runs).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn(), useModuleEvent: () => undefined }));
vi.mock("@/lib/resume-task-registry", () => ({ registerInterruptedTask: () => "task", markTaskCompleted: () => undefined }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../../hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: null, saveBranding: vi.fn(), savingBranding: false }),
}));
vi.mock("../../components/billing-form-modal", () => ({
  BillingFormModal: ({ open, onSubmit, onClose }: { open: boolean; onSubmit: () => void; onClose: () => void }) =>
    open ? (
      <div>
        <button onClick={onSubmit}>Save quote</button>
        <button onClick={onClose}>Close quote form</button>
      </div>
    ) : null,
}));
vi.mock("../../components/billing-detail-modal", () => ({ BillingDetailModal: () => null }));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => ({}) }));

import QuotesPanel from "../quotes-panel";
import type { Quote } from "@/lib/client";

const BIZ = "biz_v45b_q";
const CREATE_PATH = `/commerce/businesses/${BIZ}/quotes`;

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

type Call = { method: string; path: string; key: string | null; body: Record<string, unknown> | null };

function installServer(answers: Array<() => Promise<Response>>) {
  const calls: Call[] = [];
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, path: url.pathname, key: new Headers(init?.headers).get("Idempotency-Key"), body });
      if (method === "POST" && url.pathname === CREATE_PATH) {
        const answer = answers[Math.min(index, answers.length - 1)]!;
        index += 1;
        return answer();
      }
      return jsonResponse(200, {});
    }),
  );
  return { creates: () => calls.filter((c) => c.method === "POST" && c.path === CREATE_PATH) };
}

const createdQuote = (): Quote =>
  ({
    id: "q_v45b",
    quoteNumber: "QT-0001",
    status: "DRAFT",
    subtotal: 100,
    total: 100,
    currency: "TTD",
    issueDate: "2026-11-09T10:00:00.000Z",
    businessId: BIZ,
    contactId: "ct_v45b",
    items: [],
    createdAt: "2026-11-09T10:00:00.000Z",
  }) as unknown as Quote;

const prefillItems = [{ id: "li_q1", productId: "", description: "Consultation", quantity: "1", unitPrice: "100" }];

function Panel({ token, onQuotes }: { token: number; onQuotes: (quotes: Quote[]) => void }) {
  const [quotes, setQuotes] = React.useState<Quote[]>([]);
  React.useEffect(() => onQuotes(quotes), [quotes, onQuotes]);
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
      prefillContactId="ct_v45b"
      prefillItems={prefillItems}
      prefillToken={token}
    />
  );
}

describe("V1-45b quotes-panel: the quote create carries one Idempotency-Key per form open", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-v45b");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("a failed save leaves the form open and its retry reuses the key; the next open mints a new one", async () => {
    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `0000000${++n}-cccc-4ccc-8ccc-cccccccccccc` as `${string}-${string}-${string}-${string}-${string}`,
    );
    const server = installServer([
      async () => jsonResponse(502, { message: "Bad gateway" }),
      async () => jsonResponse(201, createdQuote()),
      async () => jsonResponse(201, createdQuote()),
    ]);
    let listed: Quote[] = [];
    const onQuotes = (quotes: Quote[]) => { listed = quotes; };
    const { rerender } = render(<Panel token={1} onQuotes={onQuotes} />);

    fireEvent.click(await screen.findByRole("button", { name: "Save quote" }));
    await waitFor(() => expect(server.creates()).toHaveLength(1));
    // The failed save keeps the form (and its key) for the retry.
    fireEvent.click(await screen.findByRole("button", { name: "Save quote" }));
    await waitFor(() => expect(server.creates()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save quote" })).toBeNull());

    rerender(<Panel token={2} onQuotes={onQuotes} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save quote" }));
    await waitFor(() => expect(server.creates()).toHaveLength(3));

    const keys = server.creates().map((c) => c.key);
    expect(keys[0], "the first save sends a key").toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(keys[1], "the retry of the same open reuses it").toBe(keys[0]);
    expect(keys[2], "the next open mints a new one").toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(keys[2]).not.toBe(keys[0]);
    for (const c of server.creates()) expect(c.body).not.toHaveProperty("idempotencyKey");
    // A replay answers the same quote: it is listed once.
    await waitFor(() => expect(listed.map((q) => q.id)).toEqual(["q_v45b"]));
  });

  it("closing the form drops its key: the next open mints a new one", async () => {
    let n = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `0000000${++n}-dddd-4ddd-8ddd-dddddddddddd` as `${string}-${string}-${string}-${string}-${string}`,
    );
    const server = installServer([async () => jsonResponse(502, { message: "Bad gateway" })]);
    const onQuotes = () => undefined;
    const { rerender } = render(<Panel token={1} onQuotes={onQuotes} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save quote" }));
    await waitFor(() => expect(server.creates()).toHaveLength(1));
    fireEvent.click(await screen.findByRole("button", { name: "Close quote form" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save quote" })).toBeNull());

    rerender(<Panel token={2} onQuotes={onQuotes} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save quote" }));
    await waitFor(() => expect(server.creates()).toHaveLength(2));
    const [a, b] = server.creates().map((c) => c.key);
    expect(a).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(b).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(b).not.toBe(a);
  });
});
