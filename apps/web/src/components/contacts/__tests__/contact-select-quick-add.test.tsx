/**
 * SWP-QUOTE-COMPOSER-CONTACT (BUG-095, BUG-096, BUG-097; journey D): the Sales composer's client field.
 *
 * At the base:
 *   - BUG-096: Quick Add Contact created the contact and set it as the value, but the field showed nothing chosen:
 *     the chip is looked up in the parent's contact list (or the search results), and the new contact is in neither;
 *   - BUG-097: a duplicate phone (409, "A contact with this phone number already exists in this business") was
 *     answered as { data: null, error } and the quick-add form did nothing: no word, as if the click was lost;
 *   - BUG-095: "Create Quote" with no client returned without a word and sent nothing (the member could not tell why).
 *
 *   CSQ-01  RED-BEFORE  quick add selects the new contact and the field shows it as chosen (its name in the chip)
 *   CSQ-02  RED-BEFORE  a duplicate phone (409) says the server's reason beside the button and in the refusal toast;
 *                       the form stays open with what was typed; nothing is selected
 *   CSQ-03  RED-BEFORE  the composer's Create Quote with no client says "Choose a client" at the client field and
 *                       sends nothing
 *   CSQ-04  control     choosing an existing contact from the list shows it as chosen
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const toastMock = vi.hoisted(() => {
  const fn = vi.fn() as unknown as ((...a: unknown[]) => void) & Record<string, ReturnType<typeof vi.fn>>;
  Object.assign(fn, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() });
  return fn;
});
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
const BIZ = "biz_csq";
vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: async () => "biz_csq",
  getStoredBusinessId: () => "biz_csq",
  getCachedBusiness: () => ({ id: "biz_csq", currency: "TTD" }),
}));
vi.mock("@/app/app/commerce/hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: { name: "Acme Bakery", primaryColor: "#F97316", secondaryColor: "#111" }, saveBranding: vi.fn(), savingBranding: false }),
}));

import { ContactSelect, type ContactSelectItem } from "../contact-select";
import { RevenueComposer } from "@/app/app/finance/components/revenue-composer";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, statusText: status < 400 ? "OK" : "Conflict", json: async () => JSON.parse(text) as unknown, text: async () => text } as unknown as Response;
}

const EXISTING: ContactSelectItem = { id: "ct_old", firstName: "Ada", lastName: "Customer", email: "ada@example.test" };
const DUPLICATE = "A contact with this phone number already exists in this business";

type Call = { method: string; path: string; body: Record<string, unknown> | null };
function installServer(opts: { createStatus?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, body });
    if (method === "POST" && url.pathname === `/crm/businesses/${BIZ}/contacts`) {
      if (opts.createStatus === 409) return jsonResponse(409, { statusCode: 409, message: DUPLICATE, error: "Conflict" });
      return jsonResponse(201, { id: "ct_new", firstName: body?.firstName, lastName: body?.lastName, phone: body?.phone, status: "LEAD" });
    }
    if (method === "GET" && url.pathname === `/crm/businesses/${BIZ}/contacts`) return jsonResponse(200, { contacts: [EXISTING] });
    return jsonResponse(200, {});
  }));
  return { calls, writes: () => calls.filter((c) => c.method !== "GET") };
}

/** A parent that keeps the chosen id, as the composer does. */
function Harness({ onPick }: { onPick?: (id: string) => void }) {
  const [value, setValue] = useState("");
  return <ContactSelect value={value} onChange={(id) => { setValue(id); onPick?.(id); }} contacts={[EXISTING]} label="Client" required />;
}

async function openQuickAdd() {
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("button", { name: /quick add contact/i }));
  fireEvent.change(screen.getByPlaceholderText("First name *"), { target: { value: "Kezia" } });
  fireEvent.change(screen.getByPlaceholderText("Last name"), { target: { value: "Baptiste" } });
  fireEvent.change(screen.getByPlaceholderText("Phone"), { target: { value: "+18687771234" } });
}

beforeEach(() => {
  window.localStorage.setItem("kf_token", "token-csq");
  window.localStorage.setItem("kf_business_id", BIZ);
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("SWP-QUOTE-COMPOSER-CONTACT: the client field", () => {
  it("CSQ-01 RED-BEFORE: quick add selects the new contact and the field shows it as chosen", async () => {
    installServer();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await openQuickAdd();
    fireEvent.click(screen.getByRole("button", { name: /add & select/i }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("ct_new"));
    expect(await screen.findByText("Kezia Baptiste")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
  });

  it("CSQ-02 RED-BEFORE: a duplicate phone says why, keeps the form and what was typed, and selects nothing", async () => {
    installServer({ createStatus: 409 });
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await openQuickAdd();
    fireEvent.click(screen.getByRole("button", { name: /add & select/i }));
    expect(await screen.findByText(DUPLICATE)).toBeInTheDocument();
    // The FAILURE-KIT refusal toast: the server's reason, under the one refusal id.
    expect(toastMock.error).toHaveBeenCalledWith(DUPLICATE, expect.objectContaining({ id: "kf-refusal" }));
    expect((screen.getByPlaceholderText("Phone") as HTMLInputElement).value).toBe("+18687771234");
    expect((screen.getByPlaceholderText("First name *") as HTMLInputElement).value).toBe("Kezia");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("CSQ-03 RED-BEFORE: the composer's Create Quote with no client says 'Choose a client' at the field and sends nothing", async () => {
    const server = installServer();
    // The composer opens a new quote when triggerNewQuote changes (the Sales page's New quote button).
    const composer = (trigger: number) => (
      <RevenueComposer
        businessId={BIZ} contacts={[EXISTING] as never} products={[]} currency="TTD"
        setQuotes={vi.fn()} setInvoices={vi.fn()} setProducts={vi.fn()} triggerNewQuote={trigger}
      />
    );
    const view = render(composer(0));
    view.rerender(composer(1));
    fireEvent.change(await screen.findByPlaceholderText("Item description"), { target: { value: "Wedding cake" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /create quote/i }));
    const alert = await screen.findByText(/choose a client/i);
    // Said at the client field: inside the ContactSelect that the "Client" label heads.
    const field = screen.getByText(/^Client/, { selector: "label" }).closest("div.relative") as HTMLElement;
    expect(field.contains(alert)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.writes()).toEqual([]);
  });

  it("CSQ-04 control: choosing an existing contact shows it as chosen", async () => {
    installServer();
    render(<Harness />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(await within(await screen.findByRole("listbox")).findByText("Ada Customer"));
    expect(await screen.findByText("Ada Customer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
  });
});
