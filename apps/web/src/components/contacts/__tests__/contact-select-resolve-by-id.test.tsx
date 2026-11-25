/**
 * WEDGE-WA-INBOUND-CAPTURE review repairs COR-2 and SEC-WAW-2 (the customer field of New quote and New booking).
 *
 * "+ New > From WhatsApp" opens New quote (/app/commerce?tab=quotes&contactId=<id>) and New booking
 * (/app/bookings?contactId=<id>) with the customer the capture found or created. Both forms choose the customer with
 * ContactSelect, which named only an id that was in the list the screen loaded (Sales loads 50 customers, newest
 * first; Bookings 200) or in its own search results. An existing customer found by their WhatsApp number but older
 * than the loaded page was chosen in the form's state and shown as nothing (COR-2); and a crafted ?contactId (another
 * business's customer, or a private one this member may not open) stayed in the form as a hidden id (SEC-WAW-2).
 *
 * Now an id in no list is read by id through the guarded client call (fetchContactDetail: GET
 * /crm/businesses/:b/contacts/:id, the member's own visibility applies) and shown; refused, not found or unreadable,
 * the selection is cleared, so no id the member cannot see stays in the form.
 *
 *   CSR-01 60 customers loaded, the chosen id is the 61st: its name shows, read by id from this business.
 *   CSR-02 the read is refused (403, a private customer this member may not open): the selection is cleared.
 *   CSR-03 not found (404: another business's id, or deleted): the selection is cleared.
 *   CSR-04 guard: an id in the loaded list is shown without any read.
 *   CSR-05 New booking's form (booking-form.tsx) uses the same field: its 61st customer shows by name.
 *
 * Review round 2 (correctness NEW-1 MAJOR, NEW-2; security NEW-1): the field cleared the chosen id on ANY failed read,
 * so a network error, a 429 or a 5xx cleared a real customer, and Book Now then booked with no customer. Only the
 * server's word that this member cannot have this customer clears it: a 403 or 404, or a reply naming another id. An
 * id that came from a saved record (editing a quote, invoice or schedule: the parent says savedRecord) is never
 * cleared. Anything else keeps the id and says the customer could not be loaded, with a retry. While the parent's
 * list is still loading (contactsLoading) nothing is read.
 *   CSR-06 a thrown fetch (network) keeps the id, says so, and Retry reads again and shows the name.
 *   CSR-07 a 503 keeps the id; CSR-08 a 429 keeps it; CSR-09 an unreadable reply (no contact) keeps it.
 *   CSR-10 a reply naming another id clears it.
 *   CSR-11 bookings: the list is [] and loading, the read is not sent; the list arrives holding the id: the name shows
 *          from the list, the id is kept, and no read was ever sent (NEW-2).
 *   CSR-12 bookings, the list arrives without the id after a failed read: the id is kept; the list then holds it: the
 *          name shows and the failure note goes.
 *   CSR-13 New booking's form: a network failure, then Book Now sends the customer's id.
 *   CSR-14 an existing quote's customer survives a 403 on the read (BillingFormModal editing passes savedRecord), and
 *          the field says the member cannot see their details.
 *   CSR-15 (pin) New booking's sheet hands the page's loading flag down: BookingSideSheet and BookingForm read nothing
 *          while the list loads, and show the customer from the list once it arrives.
 * The read rejecting outright (lib/api's apiGet never does today) is pinned in contact-select-read-throws.test.tsx.
 *
 * The real lib/client transport; only fetch is stubbed, with the GlobalHttpExceptionFilter's bodies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/app/app/commerce/hooks/use-business-preview", () => ({
  useBusinessPreview: () => ({ businessData: { name: "CSR Bakery", primaryColor: "#F97316", secondaryColor: "#111" }, saveBranding: vi.fn(), savingBranding: false }),
}));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

import { ContactSelect, type ContactSelectItem } from "../contact-select";
import BookingForm from "@/app/app/bookings/components/booking-form";
import BookingSideSheet from "@/app/app/bookings/components/booking-side-sheet";
import { BillingFormModal } from "@/app/app/commerce/components/billing-form-modal";

const BIZ = "biz_csr";
const loaded: ContactSelectItem[] = Array.from({ length: 60 }, (_, i) => ({
  id: `c_csr_${i + 1}`,
  firstName: `Loaded${i + 1}`,
  lastName: "Customer",
  status: "LEAD",
}));
const OLDER_ID = "c_csr_61";

type Answer = { status: number; body: unknown } | "network";
let detail: Answer;
const fetchMock = vi.fn();

function detailBody(id: string, firstName: string, lastName: string) {
  return {
    contact: { id, firstName, lastName, email: null, phone: "+18687771234", whatsappNumber: "+18687771234", status: "CLIENT" },
    events: [],
    notes: [],
    tasks: [],
  };
}

const detailCalls = () =>
  fetchMock.mock.calls.filter(([url]) => new URL(String(url), "http://localhost").pathname.startsWith(`/crm/businesses/${BIZ}/contacts/`));

/** A parent that keeps the chosen id, as the quote and booking forms do. */
function Harness({
  initial,
  onChange,
  contacts = loaded,
  contactsLoading,
  savedRecord,
}: {
  initial: string;
  onChange: (id: string) => void;
  contacts?: ContactSelectItem[];
  contactsLoading?: boolean;
  savedRecord?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const Select = ContactSelect as unknown as (p: Record<string, unknown>) => React.ReactElement;
  return (
    <>
      <Select
        value={value}
        onChange={(id: string) => { setValue(id); onChange(id); }}
        contacts={contacts}
        contactsLoading={contactsLoading}
        savedRecord={savedRecord}
        label="Client"
      />
      <output data-testid="chosen">{value}</output>
    </>
  );
}

const WAIT = { timeout: 8_000 };
const unavailableNote = () => screen.findByText(/couldn.t load this customer/i, {}, WAIT);

const onChange = vi.fn();

beforeEach(() => {
  window.localStorage.setItem("kf_token", "token-csr");
  window.localStorage.setItem("kf_business_id", BIZ);
  detail = { status: 200, body: detailBody(OLDER_ID, "Maria", "Lopez") };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(String(url), "http://localhost").pathname;
    if (path.endsWith("/document-templates")) {
      return new Response(JSON.stringify({ templates: [], branding: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (detail === "network") throw new TypeError("Failed to fetch");
    const text = JSON.stringify(detail.body);
    return new Response(text, { status: detail.status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  onChange.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("COR-2 / SEC-WAW-2: the customer field names a chosen customer outside the loaded page, or lets it go", () => {
  it("CSR-01 the 61st customer, past the 60 loaded, shows by name, read by id from this business", async () => {
    render(<Harness initial={OLDER_ID} onChange={onChange} />);
    expect(await screen.findByText("Maria Lopez")).toBeInTheDocument();
    expect(detailCalls().map(([url]) => new URL(String(url)).pathname)).toEqual([`/crm/businesses/${BIZ}/contacts/${OLDER_ID}`]);
    expect(screen.getByTestId("chosen")).toHaveTextContent(OLDER_ID);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("CSR-02 a refused read (a private customer this member may not open) clears the selection", async () => {
    detail = { status: 403, body: { statusCode: 403, message: "You do not have access to this contact", error: "Forbidden" } };
    render(<Harness initial="c_csr_private" onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(""));
    expect(screen.getByTestId("chosen")).toBeEmptyDOMElement();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("CSR-03 not found (another business's id, or deleted) clears the selection", async () => {
    detail = { status: 404, body: { statusCode: 404, message: "Contact not found", error: "Not Found" } };
    render(<Harness initial="c_other_business" onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(""));
    expect(screen.getByTestId("chosen")).toBeEmptyDOMElement();
  });

  it("CSR-04 guard: an id in the loaded list shows with no read", async () => {
    render(<Harness initial="c_csr_7" onChange={onChange} />);
    expect(screen.getByText("Loaded7 Customer")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(detailCalls()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("CSR-05 New booking's form shows its 61st customer by name", async () => {
    render(
      <BookingForm
        services={[]}
        staff={[]}
        contacts={loaded as never}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        formError={null}
        defaultContactId={OLDER_ID}
      />,
    );
    expect(await screen.findByText("Maria Lopez")).toBeInTheDocument();
  });

  it("CSR-06 a thrown fetch keeps the id, says so, and Retry reads again and shows the name", async () => {
    detail = "network";
    render(<Harness initial={OLDER_ID} onChange={onChange} />);
    expect(await unavailableNote()).toBeInTheDocument();
    expect(screen.getByTestId("chosen")).toHaveTextContent(OLDER_ID);
    expect(onChange).not.toHaveBeenCalled();
    detail = { status: 200, body: detailBody(OLDER_ID, "Maria", "Lopez") };
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("Maria Lopez", {}, WAIT)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load this customer/i)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  }, 20_000);

  for (const [label, answer] of [
    ["CSR-07 a 503", { status: 503, body: { statusCode: 503, message: "Service Unavailable" } }],
    ["CSR-08 a 429", { status: 429, body: { statusCode: 429, message: "Too Many Requests" } }],
    ["CSR-09 an unreadable reply (no contact)", { status: 200, body: { unexpected: true } }],
  ] as const) {
    it(`${label} keeps the id and says the customer could not be loaded`, async () => {
      detail = answer;
      render(<Harness initial={OLDER_ID} onChange={onChange} />);
      expect(await unavailableNote()).toBeInTheDocument();
      expect(screen.getByTestId("chosen")).toHaveTextContent(OLDER_ID);
      expect(onChange).not.toHaveBeenCalled();
    }, 20_000);
  }

  it("CSR-10 a reply naming another id clears it", async () => {
    detail = { status: 200, body: detailBody("c_someone_else", "Other", "Person") };
    render(<Harness initial={OLDER_ID} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(""), WAIT);
    expect(screen.queryByText("Other Person")).toBeNull();
  });

  it("CSR-11 bookings: nothing is read while the list loads; the list arrives holding the id and shows it (NEW-2)", async () => {
    const { rerender } = render(<Harness initial={OLDER_ID} onChange={onChange} contacts={[]} contactsLoading />);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(detailCalls()).toEqual([]);
    const arrived = [...loaded, { id: OLDER_ID, firstName: "Maria", lastName: "Lopez", status: "CLIENT" }];
    rerender(<Harness initial={OLDER_ID} onChange={onChange} contacts={arrived} contactsLoading={false} />);
    expect(await screen.findByText("Maria Lopez")).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(detailCalls()).toEqual([]);
    expect(screen.getByTestId("chosen")).toHaveTextContent(OLDER_ID);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("CSR-12 a failed read while the list lacks the id keeps it; the list then holds it: the name shows, the note goes", async () => {
    detail = "network";
    const { rerender } = render(<Harness initial={OLDER_ID} onChange={onChange} contacts={[]} />);
    expect(await unavailableNote()).toBeInTheDocument();
    const arrived = [...loaded, { id: OLDER_ID, firstName: "Maria", lastName: "Lopez", status: "CLIENT" }];
    rerender(<Harness initial={OLDER_ID} onChange={onChange} contacts={arrived} />);
    expect(await screen.findByText("Maria Lopez")).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load this customer/i)).toBeNull();
    expect(screen.getByTestId("chosen")).toHaveTextContent(OLDER_ID);
    expect(onChange).not.toHaveBeenCalled();
  }, 20_000);

  it("CSR-13 New booking's form: a network failure, then Book Now sends the customer's id", async () => {
    detail = "network";
    const onSubmit = vi.fn();
    render(
      <BookingForm
        services={[{ id: "svc_1", name: "Fitting", durationMins: 30, price: 50, currency: "TTD" }] as never}
        staff={[{ id: "stf_1", name: "Ana" }] as never}
        contacts={loaded as never}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        formError={null}
        defaultDate="2026-12-01"
        defaultTime="10:00"
        defaultContactId={OLDER_ID}
      />,
    );
    expect(await unavailableNote()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /fitting/i }));
    fireEvent.click(screen.getByRole("radio", { name: /ana/i }));
    fireEvent.click(screen.getByRole("button", { name: /book now/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ contactId: OLDER_ID }));
  }, 20_000);

  it("CSR-14 an existing quote's customer survives a 403 on the read, and the field says why it shows no name", async () => {
    detail = { status: 403, body: { statusCode: 403, message: "Insufficient permissions: crm requires read access (you have none)", error: "Forbidden" } };
    const onContactChange = vi.fn();
    const Modal = BillingFormModal as unknown as (p: Record<string, unknown>) => React.ReactElement;
    render(
      <Modal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        docType="quote"
        isEditing
        contacts={[]}
        products={[]}
        currency="TTD"
        contactId="c_saved_quote_customer"
        onContactChange={onContactChange}
        dateValue=""
        onDateChange={vi.fn()}
        items={[{ id: "i1", productId: "", description: "Cake", quantity: "1", unitPrice: "100" }]}
        onAddItem={vi.fn()}
        onRemoveItem={vi.fn()}
        onUpdateItem={vi.fn()}
        onSelectProduct={vi.fn()}
        taxRate="0"
        onTaxRateChange={vi.fn()}
        discountType="PERCENT"
        onDiscountTypeChange={vi.fn()}
        discountValue=""
        onDiscountValueChange={vi.fn()}
        notes=""
        onNotesChange={vi.fn()}
        businessId={BIZ}
      />,
    );
    await waitFor(() => expect(detailCalls().length).toBeGreaterThan(0), WAIT);
    expect(await screen.findByText(/can.t see this customer/i, {}, WAIT)).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(onContactChange).not.toHaveBeenCalledWith("");
  }, 20_000);

  it("CSR-15 New booking's sheet reads nothing while the page's list loads, then shows the customer from the list", async () => {
    const Sheet = BookingSideSheet as unknown as (p: Record<string, unknown>) => React.ReactElement;
    const props = { open: true, services: [], staff: [], onSubmit: vi.fn(), onClose: vi.fn(), formError: null, defaultContactId: OLDER_ID };
    const { rerender } = render(<Sheet {...props} contacts={[]} contactsLoading />);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(detailCalls()).toEqual([]);
    const arrived = [...loaded, { id: OLDER_ID, firstName: "Maria", lastName: "Lopez", status: "CLIENT" }];
    rerender(<Sheet {...props} contacts={arrived} contactsLoading={false} />);
    expect((await screen.findAllByText(/Maria Lopez/)).length).toBeGreaterThan(0);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(detailCalls()).toEqual([]);
  });
});
