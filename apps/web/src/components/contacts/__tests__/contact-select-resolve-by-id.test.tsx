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
 * The real lib/client transport; only fetch is stubbed, with the GlobalHttpExceptionFilter's bodies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/commerce",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

import { ContactSelect, type ContactSelectItem } from "../contact-select";
import BookingForm from "@/app/app/bookings/components/booking-form";

const BIZ = "biz_csr";
const loaded: ContactSelectItem[] = Array.from({ length: 60 }, (_, i) => ({
  id: `c_csr_${i + 1}`,
  firstName: `Loaded${i + 1}`,
  lastName: "Customer",
  status: "LEAD",
}));
const OLDER_ID = "c_csr_61";

type Answer = { status: number; body: unknown };
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
function Harness({ initial, onChange }: { initial: string; onChange: (id: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ContactSelect value={value} onChange={(id) => { setValue(id); onChange(id); }} contacts={loaded} label="Client" />
      <output data-testid="chosen">{value}</output>
    </>
  );
}

const onChange = vi.fn();

beforeEach(() => {
  window.localStorage.setItem("kf_token", "token-csr");
  window.localStorage.setItem("kf_business_id", BIZ);
  detail = { status: 200, body: detailBody(OLDER_ID, "Maria", "Lopez") };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
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
});
