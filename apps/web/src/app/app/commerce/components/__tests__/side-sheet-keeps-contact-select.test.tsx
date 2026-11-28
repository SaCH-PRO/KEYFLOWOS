/**
 * P263 R3 (P269 folded in): the recurring schedule builder's ContactSelect lost its search text and its quick-add
 * draft when the SideSheet's layout flipped (a resize or rotation remounted the panel and every child in it). The
 * children are now kept mounted across the flip: what was typed in the search, and in an open Quick Add form, is still
 * there, and focus is still in the field being typed in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: async () => "biz_p263",
  getStoredBusinessId: () => "biz_p263",
  getCachedBusiness: () => ({ id: "biz_p263", currency: "TTD" }),
}));

import { SideSheet } from "../side-sheet";
import { ContactSelect, type ContactSelectItem } from "@/components/contacts";

const ADA: ContactSelectItem = { id: "ct_ada", firstName: "Ada", lastName: "Customer", email: "ada@example.test" };

let phone = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();
const original = window.matchMedia;
beforeEach(() => {
  phone = false;
  listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() { return phone && /max-width/.test(query); },
    media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  // Nothing leaves the test: every read answers an empty list.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ contacts: [] }), text: async () => '{"contacts":[]}' }) as unknown as Response));
});
afterEach(() => {
  cleanup();
  window.matchMedia = original;
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
async function flip(toPhone: boolean) {
  phone = toPhone;
  act(() => { for (const fn of [...listeners]) fn({ matches: toPhone } as MediaQueryListEvent); });
  await settle();
}
const layout = () => (screen.getByRole("dialog").getAttribute("class") ?? "").includes("rounded-t-2xl") ? "phone" : "desktop";

function Builder() {
  const [contactId, setContactId] = useState("");
  return (
    <SideSheet open onClose={() => {}} title="New Recurring Schedule">
      <ContactSelect value={contactId} onChange={(id) => setContactId(id)} contacts={[ADA]} label="Contact" required />
    </SideSheet>
  );
}

describe("P263 R3: a ContactSelect in the sheet keeps what was typed across a layout flip", () => {
  it("the search text: desktop -> phone -> desktop, still typed, and focus still in the search", async () => {
    render(<Builder />);
    await settle();
    const search = screen.getByRole("combobox") as HTMLInputElement;
    search.focus();
    fireEvent.change(search, { target: { value: "Ad" } });
    await flip(true);
    expect(layout(), "the flip did not reach the sheet").toBe("phone");
    expect((screen.getByRole("combobox") as HTMLInputElement).value, "the search text was lost on the flip to phone").toBe("Ad");
    await flip(false);
    expect((screen.getByRole("combobox") as HTMLInputElement).value, "the search text was lost on the flip back").toBe("Ad");
    expect(document.activeElement, "focus left the search").toBe(screen.getByRole("combobox"));
  });
  it("the Quick Add draft: the form stays open with what was typed, and focus stays in the field", async () => {
    render(<Builder />);
    await settle();
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("button", { name: /quick add contact/i }));
    fireEvent.change(screen.getByPlaceholderText("First name *"), { target: { value: "Kezia" } });
    const phoneField = screen.getByPlaceholderText("Phone") as HTMLInputElement;
    phoneField.focus();
    fireEvent.change(phoneField, { target: { value: "+1868777" } });
    await flip(true);
    expect(screen.queryByPlaceholderText("First name *"), "the Quick Add form closed on the flip").not.toBeNull();
    expect((screen.getByPlaceholderText("First name *") as HTMLInputElement).value, "the first name was lost").toBe("Kezia");
    expect((screen.getByPlaceholderText("Phone") as HTMLInputElement).value, "the phone was lost").toBe("+1868777");
    expect(document.activeElement, "focus left the phone field").toBe(screen.getByPlaceholderText("Phone"));
  });
});
