/**
 * FU-CONTACT-PAGES-RAW-STATUS (CDC-4): the contact header printed the stored contact status ("LEAD") on its status
 * button, as each option of the status menu, and in the "Status updated to PROSPECT" toast. All three read in plain
 * words from lib/status-labels.ts; the code is still what is sent to the server.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const updateContact = vi.fn();
const toastSuccess = vi.fn();
let contactStatus = "LEAD";
vi.mock("next/navigation", () => ({ useParams: () => ({ contactId: "c_1" }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/lib/workspace", () => ({ getStoredBusinessId: () => "biz_1" }));
vi.mock("@/lib/client", () => ({ updateContact: (...a: unknown[]) => updateContact(...a) }));
vi.mock("@/components/contacts/contact-avatar", () => ({ ContactAvatar: () => null }));
vi.mock("@/app/app/crm/pipeline/hooks/use-contacts-data", () => ({ classifyContactsLoadError: () => null }));
vi.mock("../contact-detail-context", () => ({
  useContactDetailContext: () => ({
    contact: { id: "c_1", firstName: "Ada", lastName: "Lovelace", status: contactStatus, tags: [] },
    detail: null,
    loading: false,
    error: null,
  }),
}));

import ContactHeader from "../contact-header";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  contactStatus = "LEAD";
});

describe("contact header: the status in plain words", () => {
  it("a stored LEAD reads 'Lead' on the status button, never the code", () => {
    render(<ContactHeader />);
    expect(screen.getByRole("button", { name: "Lead" })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/\bLEAD\b/);
  });

  it("the status menu offers 'Lead', 'Prospect', 'Client' and 'Lost', never the codes", () => {
    render(<ContactHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Lead" }));
    for (const word of ["Prospect", "Client", "Lost"]) expect(screen.getByRole("button", { name: word })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Lead" })).toHaveLength(2);
    expect(document.body.textContent ?? "").not.toMatch(/\b(LEAD|PROSPECT|CLIENT|LOST)\b/);
  });

  it("choosing 'Prospect' sends the code PROSPECT and the toast says 'Status updated to Prospect'", async () => {
    updateContact.mockResolvedValue({ data: {}, error: null });
    render(<ContactHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Lead" }));
    fireEvent.click(screen.getByRole("button", { name: "Prospect" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Status updated to Prospect"));
    expect(updateContact).toHaveBeenCalledWith({ businessId: "biz_1", contactId: "c_1", status: "PROSPECT" });
  });

  it("control: choosing the current status sends nothing", () => {
    const { container } = render(<ContactHeader />);
    // The status button and the menu's options, found by place rather than by what they say.
    fireEvent.click(container.querySelector("button")!);
    const options = [...container.querySelectorAll("div.absolute button")];
    expect(options).toHaveLength(4);
    fireEvent.click(options[0]);
    expect(updateContact).not.toHaveBeenCalled();
  });

  it("a stored CLIENT reads 'Client' and is the checked option", () => {
    contactStatus = "CLIENT";
    render(<ContactHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Client" }));
    const options = screen.getAllByRole("button", { name: "Client" });
    expect(options[1]).toHaveClass("font-medium");
  });
});
