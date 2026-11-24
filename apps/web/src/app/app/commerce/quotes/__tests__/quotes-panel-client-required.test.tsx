/**
 * SWP-QUOTE-COMPOSER-CONTACT, review round 1 (correctness MAJOR-2; BUG-095 on the Sales > Quotes tab): the quotes
 * tab opens its own builder from "New Quote" (the button journey D presses) and "Create Your First Quote". At the base
 * its save returned with no word when no client was chosen, so nothing happened and nothing was said.
 *
 * The builder is reduced to what the panel hands it (as quotes-panel-mounted.test.tsx does): open, the client error
 * it is told to show at the client field, a client choice, and a submit. That the real builder says the error at the
 * field is proven by contact-select-quick-add.test.tsx CSQ-03.
 *
 *   QPC-01  RED-BEFORE  New Quote, no client, Create: the panel hands the builder "Choose a client for this quote." and
 *                       sends nothing
 *   QPC-02  RED-BEFORE  choosing a client clears it
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

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
/** The builder, reduced to what the panel hands it: open, the client error, a client choice and a submit. */
vi.mock("../../components/billing-form-modal", () => ({
  BillingFormModal: ({ open, contactError, onContactChange, onSubmit }: {
    open: boolean; contactError?: string | null; onContactChange: (id: string) => void; onSubmit: () => void;
  }) =>
    open ? (
      <div data-testid="quote-builder">
        <button type="button" onClick={() => onContactChange("ct_qpc")}>Choose Ada</button>
        {contactError ? <p role="alert" data-testid="client-field-error">{contactError}</p> : null}
        <button type="button" onClick={onSubmit}>Create Quote</button>
      </div>
    ) : null,
}));
vi.mock("../../components/billing-detail-modal", () => ({ BillingDetailModal: () => null }));
vi.mock("../../components/invoice-drive-uploader", () => ({ InvoiceDriveUploader: () => null, buildTemplateData: () => ({}) }));

import QuotesPanel from "../quotes-panel";
import type { Quote, Invoice } from "@/lib/client";

const BIZ = "biz_qpc";

type Call = { method: string; path: string };
function installServer() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), path: url.pathname });
    const text = "{}";
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}), text: async () => text } as unknown as Response;
  }));
  return { writes: () => calls.filter((c) => c.method !== "GET") };
}

function Holder() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [, setInvoices] = useState<Invoice[]>([]);
  return (
    <QuotesPanel
      quotes={quotes} contacts={[]} products={[]} businessId={BIZ} loading={false}
      gmailStatus={{ connected: false, email: null }}
      setProducts={vi.fn()} setQuotes={setQuotes} setInvoices={setInvoices}
    />
  );
}

beforeEach(() => {
  window.localStorage.setItem("kf_token", "token-qpc");
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SWP-QUOTE-COMPOSER-CONTACT: the quotes tab's own New Quote", () => {
  it("QPC-01 RED-BEFORE: Create with no client hands the builder 'Choose a client for this quote.' and sends nothing", async () => {
    const server = installServer();
    render(<Holder />);
    fireEvent.click(screen.getAllByRole("button", { name: "New Quote" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Create Quote" }));
    expect(await screen.findByTestId("client-field-error")).toHaveTextContent("Choose a client for this quote.");
    await new Promise((r) => setTimeout(r, 50));
    expect(server.writes()).toEqual([]);
  });

  it("QPC-02 RED-BEFORE: choosing a client clears the client error", async () => {
    installServer();
    render(<Holder />);
    fireEvent.click(screen.getAllByRole("button", { name: "New Quote" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Create Quote" }));
    await screen.findByTestId("client-field-error");
    fireEvent.click(screen.getByRole("button", { name: "Choose Ada" }));
    await waitFor(() => expect(screen.queryByTestId("client-field-error")).toBeNull());
  });
});
