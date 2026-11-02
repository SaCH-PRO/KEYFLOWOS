/**
 * R0-15c-WEB-CUSTOM-FIELDS-TENANT: the structured custom fields on the contact
 * screens read the SELECTED business, never the demo tenant.
 *
 * WHY this test exists (M09, CR-R025-4): the contact panel
 * (contact-detail-info.tsx) and the contact form (contact-form.tsx) mounted
 * ContactCustomFields without a businessId, so fetchCustomFieldDefinitions
 * (lib/client.ts) fell back to DEFAULT_BUSINESS_ID "biz_demo". The R0-25 live
 * run caught the browser calling GET /crm/businesses/biz_demo/custom-field-
 * definitions and the API refusing it (403): nothing leaked, but a member's
 * structured fields never loaded, and a silent demo-tenant default hides every
 * missing-business bug behind it (CONTACTS-v1 section 5, BUILD-MAP M09).
 *
 * The components are rendered for real on the real client; only `fetch`, the
 * Next router and the compose context are stubbed. The stub answers the way
 * BusinessGuard does: a business the member does not belong to gets 403 "No
 * access to this business" before any handler runs, so a read sent to the
 * demo tenant can never pass for a read of the member's own business.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { ContactCustomFields } from "../contact-custom-fields";
import { ContactDetailInfo } from "../contact-detail-info";
import { ContactForm } from "../contact-form";
import type { ContactDetailData } from "../contact-detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/crm/pipeline",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

// The panel's quick actions open the email composer; nothing here composes.
vi.mock("@/components/email/compose-context", () => ({
  useCompose: () => ({ open: vi.fn(), close: vi.fn(), isOpen: false }),
}));

/** The business the member selected (stored as kf_business_id, R0-18). */
const SELECTED = "biz_selected";
/** A second business the member also belongs to (the business a screen was handed). */
const HANDED = "biz_handed";
const DEMO = "biz_demo";

const DEFINITIONS = [
  {
    id: "cfd_1",
    businessId: SELECTED,
    name: "membershipTier",
    label: "Membership tier",
    type: "TEXT",
    description: null,
    placeholder: null,
    options: null,
    defaultValue: null,
    required: false,
    order: 1,
    archivedAt: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
  },
];

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

const forbidden = () =>
  jsonResponse(403, { statusCode: 403, message: "No access to this business", error: "Forbidden" }, "Forbidden");

/**
 * Stub the API as the guards answer it for a member of `memberOf`. Returns
 * every pathname the browser asked for.
 */
function stubApi(memberOf: string[] = [SELECTED, HANDED]) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    requested.push(pathname);
    const tenant = pathname.match(/\/businesses\/([^/]+)\//)?.[1];
    if (tenant && !memberOf.includes(decodeURIComponent(tenant))) return forbidden();
    if (tenant && pathname.endsWith(`/crm/businesses/${tenant}/custom-field-definitions`)) {
      return jsonResponse(200, DEFINITIONS.map((d) => ({ ...d, businessId: decodeURIComponent(tenant) })));
    }
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    requested,
    definitionReads: () => requested.filter((p) => p.endsWith("/custom-field-definitions")),
    namingDemo: () => requested.filter((p) => p.includes(`/businesses/${DEMO}`)),
  };
}

const definitionsPath = (businessId: string) => `/crm/businesses/${businessId}/custom-field-definitions`;

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ContactCustomFields reads the selected business, never biz_demo", () => {
  it("control: a businessId it is handed is the business it reads", async () => {
    const api = stubApi();
    render(<ContactCustomFields businessId={HANDED} />);

    expect(await screen.findByText("Membership tier")).toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(HANDED)]);
    expect(api.namingDemo()).toEqual([]);
  });

  it("mounted without a businessId, it reads the business the member selected", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(<ContactCustomFields />);

    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]));
    expect(await screen.findByText("Membership tier")).toBeInTheDocument();
    expect(api.namingDemo()).toEqual([]);
  });

  it("with no business selected at all, it sends no request (no demo-tenant fallback) and does not spin forever", async () => {
    const api = stubApi();
    render(<ContactCustomFields />);

    await waitFor(() => expect(screen.queryByText("Loading custom fields...")).not.toBeInTheDocument());
    expect(api.requested).toEqual([]);
  });

  it("mounted without values (as the contact form mounts it), it settles instead of re-rendering forever", async () => {
    // `values = {}` as a parameter default is a new object on every render, and
    // the effect that copies `values` into local state depends on it: each
    // render scheduled the next one. React reports it as "Maximum update depth
    // exceeded"; in the browser the form's custom fields never stop rendering.
    // The spy passes through: a silenced console turns the loop into one that
    // never yields, and the run hangs instead of failing.
    const errors = vi.spyOn(console, "error");
    stubApi();
    render(<ContactCustomFields businessId={HANDED} />);

    expect(await screen.findByText("Membership tier")).toBeInTheDocument();
    const loops = errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("Maximum update depth"));
    expect(loops).toEqual([]);
  });

  it("control: switching the business re-reads the new one and only ever names a selected business", async () => {
    const api = stubApi();
    const { rerender } = render(<ContactCustomFields businessId={SELECTED} />);
    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]));

    rerender(<ContactCustomFields businessId={HANDED} />);
    await waitFor(() =>
      expect(api.definitionReads()).toEqual([definitionsPath(SELECTED), definitionsPath(HANDED)]),
    );
    expect(api.namingDemo()).toEqual([]);
  });
});

const contact = {
  id: "c_1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  department: "Research",
} as unknown as ContactDetailData;

const typedValues = [
  {
    id: "cfv_1",
    definitionId: "cfd_1",
    value: "Gold",
    definition: { name: "membershipTier", label: "Membership tier", type: "TEXT", description: null, placeholder: null },
  },
];

/** Open the panel's "More details" section, where the typed custom fields render. */
function openMoreDetails() {
  fireEvent.click(screen.getByRole("button", { name: /More details/ }));
}

describe("the contact panel (ContactDetailInfo) reads custom fields from the selected business", () => {
  it("mounted as ContactDetail mounts it (no businessId), it reads the selected business and shows the value", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(<ContactDetailInfo contact={contact} customFieldValues={typedValues} />);
    openMoreDetails();

    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]));
    expect(await screen.findByText("Gold")).toBeInTheDocument();
    expect(api.namingDemo()).toEqual([]);
  });

  it("given the business by its parent, it reads that business", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(<ContactDetailInfo contact={contact} customFieldValues={typedValues} businessId={HANDED} />);
    openMoreDetails();

    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(HANDED)]));
    expect(await screen.findByText("Gold")).toBeInTheDocument();
    expect(api.namingDemo()).toEqual([]);
  });
});

describe("the contact form (ContactForm) reads custom fields from the selected business", () => {
  const editing = { firstName: "Ada", lastName: "Lovelace" };

  it("editing a contact (structured custom fields open) without a businessId, it reads the selected business", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(<ContactForm onSubmit={vi.fn()} onCancel={vi.fn()} initialValues={editing} />);

    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]));
    expect(await screen.findByText("Membership tier")).toBeInTheDocument();
    expect(api.namingDemo()).toEqual([]);
  });

  it("given the business by its parent, it reads that business", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    render(<ContactForm onSubmit={vi.fn()} onCancel={vi.fn()} initialValues={editing} businessId={HANDED} />);

    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(HANDED)]));
    expect(await screen.findByText("Membership tier")).toBeInTheDocument();
    expect(api.namingDemo()).toEqual([]);
  });
});
