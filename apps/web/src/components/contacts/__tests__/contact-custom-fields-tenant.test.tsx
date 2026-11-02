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
import { Profiler, type ReactNode, type ReactElement } from "react";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { ContactCustomFields } from "../contact-custom-fields";
import { ContactDetailInfo } from "../contact-detail-info";
import { ContactForm } from "../contact-form";
import type { ContactDetailData } from "../contact-detail";
import { selectBusiness, setStoredBusinessId } from "@/lib/workspace";

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

type Definition = (typeof DEFINITIONS)[number];

interface StubOptions {
  /** The definitions a business answers with (default: DEFINITIONS, the same label for every business). */
  definitionsOf?: (businessId: string) => Array<Omit<Definition, "options"> & { options: unknown }>;
  /** Businesses whose definitions answer only once their gate opens (a read still in flight). */
  held?: Record<string, Promise<void>>;
}

/**
 * Stub the API as the guards answer it for a member of `memberOf`. Returns
 * every pathname the browser asked for.
 */
function stubApi(memberOf: string[] = [SELECTED, HANDED], options: StubOptions = {}) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    requested.push(pathname);
    const tenant = pathname.match(/\/businesses\/([^/]+)\//)?.[1];
    if (tenant && !memberOf.includes(decodeURIComponent(tenant))) return forbidden();
    if (tenant && pathname.endsWith(`/crm/businesses/${tenant}/custom-field-definitions`)) {
      const business = decodeURIComponent(tenant);
      await options.held?.[business];
      const definitions = options.definitionsOf?.(business) ?? DEFINITIONS;
      return jsonResponse(200, definitions.map((d) => ({ ...d, businessId: business })));
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

/** A label per business, so the screen shows WHICH business's definitions it holds. */
const fieldOf = (businessId: string) => `Tier of ${businessId}`;
const labelledPerBusiness = (businessId: string) => [
  { ...DEFINITIONS[0], id: `cfd_${businessId}`, name: `tier_${businessId}`, label: fieldOf(businessId) },
];

/** A read held in flight until `open()`. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open: () => act(async () => { open(); }) };
}

/**
 * More commits than any settled mount of the fields needs (a handful: mount,
 * the read answering, a switch). A render loop crosses it at once.
 */
const COMMIT_BOUND = 50;

/**
 * Render with a loop guard. Under act a loop of effect-driven updates never
 * yields, so no test timeout can interrupt it and the file hangs instead of
 * failing. The Profiler counts the subtree's commits and, past the bound,
 * throws: React tears the root down (which ends the loop) and act rethrows, so
 * the test that rendered the loop FAILS, by name.
 */
function renderFields(ui: ReactElement) {
  let commits = 0;
  const onRender = () => {
    commits += 1;
    if (commits > COMMIT_BOUND) throw new Error(`render loop: ContactCustomFields committed ${commits} times`);
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Profiler id="contact-custom-fields" onRender={onRender}>{children}</Profiler>
  );
  return { ...render(ui, { wrapper }), commits: () => commits };
}

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
    renderFields(<ContactCustomFields businessId={HANDED} />);

    expect(await screen.findByText("Membership tier")).toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(HANDED)]);
    expect(api.namingDemo()).toEqual([]);
  });

  it("mounted without a businessId, it reads the business the member selected", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi();
    renderFields(<ContactCustomFields />);

    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]));
    expect(await screen.findByText("Membership tier")).toBeInTheDocument();
    expect(api.namingDemo()).toEqual([]);
  });

  it("with no business selected at all, it sends no request (no demo-tenant fallback) and does not spin forever", async () => {
    const api = stubApi();
    renderFields(<ContactCustomFields />);

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
    const view = renderFields(<ContactCustomFields businessId={HANDED} />);

    expect(await screen.findByText("Membership tier")).toBeInTheDocument();
    const loops = errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("Maximum update depth"));
    expect(loops).toEqual([]);
    // The loop itself, counted rather than inferred from a warning: once the
    // read has answered, time passing commits nothing more.
    const settled = view.commits();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(view.commits()).toBe(settled);
    expect(settled).toBeLessThanOrEqual(COMMIT_BOUND);
  });

  it("control: switching the business re-reads the new one and only ever names a selected business", async () => {
    const api = stubApi();
    const { rerender } = renderFields(<ContactCustomFields businessId={SELECTED} />);
    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]));

    rerender(<ContactCustomFields businessId={HANDED} />);
    await waitFor(() =>
      expect(api.definitionReads()).toEqual([definitionsPath(SELECTED), definitionsPath(HANDED)]),
    );
    expect(api.namingDemo()).toEqual([]);
  });
});

/**
 * Review findings SEC-R015c-1 and SEC-R015c-2 of the first review round (the
 * second round's findings of the same ids are at the end). Every production screen mounts
 * the fields WITHOUT a businessId (contact-detail.tsx, pipeline-tab-content.tsx),
 * so the business read is the stored selection, and that selection can move
 * while the panel or form stays mounted. Each business answers with its own
 * label here, so the screen shows WHICH business's definitions it holds.
 */
describe("ContactCustomFields follows the business while mounted and never shows the previous one's fields", () => {
  it("while a newly handed business is read, the previous business's fields are hidden (the stale guard)", async () => {
    const handedRead = gate();
    const api = stubApi(undefined, { definitionsOf: labelledPerBusiness, held: { [HANDED]: handedRead.opened } });
    const { rerender } = renderFields(<ContactCustomFields businessId={SELECTED} />);
    expect(await screen.findByText(fieldOf(SELECTED))).toBeInTheDocument();

    rerender(<ContactCustomFields businessId={HANDED} />);
    await waitFor(() =>
      expect(api.definitionReads()).toEqual([definitionsPath(SELECTED), definitionsPath(HANDED)]),
    );
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();
    expect(screen.getByText("Loading custom fields...")).toBeInTheDocument();

    await handedRead.open();
    expect(await screen.findByText(fieldOf(HANDED))).toBeInTheDocument();
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();
  });

  it("mounted without a businessId, a switch of the selected business (selectBusiness) re-reads it and hides the previous fields meanwhile", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const switchedRead = gate();
    const api = stubApi(undefined, { definitionsOf: labelledPerBusiness, held: { [HANDED]: switchedRead.opened } });
    renderFields(<ContactCustomFields />);
    expect(await screen.findByText(fieldOf(SELECTED))).toBeInTheDocument();

    act(() => { selectBusiness(HANDED); });
    await waitFor(() =>
      expect(api.definitionReads()).toEqual([definitionsPath(SELECTED), definitionsPath(HANDED)]),
    );
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();

    await switchedRead.open();
    expect(await screen.findByText(fieldOf(HANDED))).toBeInTheDocument();
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();
    expect(api.namingDemo()).toEqual([]);
  });

  it("a sign-in or switch in another tab (a `storage` event) is followed", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi(undefined, { definitionsOf: labelledPerBusiness });
    renderFields(<ContactCustomFields />);
    expect(await screen.findByText(fieldOf(SELECTED))).toBeInTheDocument();

    act(() => {
      window.localStorage.setItem("kf_business_id", HANDED);
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", oldValue: SELECTED, newValue: HANDED }));
    });
    expect(await screen.findByText(fieldOf(HANDED))).toBeInTheDocument();
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(SELECTED), definitionsPath(HANDED)]);
  });

  it("a rewrite of the stored business that announces nothing (refreshWorkspace correcting a stale id) is followed at the next render", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi(undefined, { definitionsOf: labelledPerBusiness });
    const { rerender } = renderFields(<ContactCustomFields />);
    expect(await screen.findByText(fieldOf(SELECTED))).toBeInTheDocument();

    setStoredBusinessId(HANDED);
    rerender(<ContactCustomFields />);
    expect(await screen.findByText(fieldOf(HANDED))).toBeInTheDocument();
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(SELECTED), definitionsPath(HANDED)]);
  });

  it("control: a business handed by the parent stays the business read when the stored selection moves (the binding SEC-R015c-1 asks the parents to pass)", async () => {
    // A screen bound to its own business (the pipeline writes to the business it
    // captured at mount) hands it down; a later switch of kf_business_id, here or
    // in another tab, must not move the fields to another business's definitions.
    window.localStorage.setItem("kf_business_id", SELECTED);
    const api = stubApi(undefined, { definitionsOf: labelledPerBusiness });
    renderFields(<ContactCustomFields businessId={HANDED} />);
    expect(await screen.findByText(fieldOf(HANDED))).toBeInTheDocument();

    act(() => { selectBusiness(SELECTED); });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "kf_business_id", oldValue: HANDED, newValue: SELECTED }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByText(fieldOf(HANDED))).toBeInTheDocument();
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();
    expect(api.definitionReads()).toEqual([definitionsPath(HANDED)]);
  });

  it("an answer for the business the screen moved away from arrives late and is dropped", async () => {
    window.localStorage.setItem("kf_business_id", SELECTED);
    const previousRead = gate();
    const api = stubApi(undefined, { definitionsOf: labelledPerBusiness, held: { [SELECTED]: previousRead.opened } });
    renderFields(<ContactCustomFields />);
    await waitFor(() => expect(api.definitionReads()).toEqual([definitionsPath(SELECTED)]));

    act(() => { selectBusiness(HANDED); });
    expect(await screen.findByText(fieldOf(HANDED))).toBeInTheDocument();

    // The previous business's read answers only now.
    await previousRead.open();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByText(fieldOf(SELECTED))).not.toBeInTheDocument();
    expect(screen.getByText(fieldOf(HANDED))).toBeInTheDocument();
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

  it("editing keeps the contact's stored typed values: they show, and changing one field submits the others unchanged (R015c-CR-1)", async () => {
    // Once the fields render (they read the right business now), the form must
    // hand them the stored values. Without them every stored value showed blank,
    // and one click on a MULTI_SELECT option submitted only that option: the
    // server upserts per key, so the stored selection was overwritten.
    window.localStorage.setItem("kf_business_id", SELECTED);
    const interests = {
      ...DEFINITIONS[0],
      id: "cfd_2",
      name: "interests",
      label: "Interests",
      type: "MULTI_SELECT",
      order: 2,
      options: { options: [{ label: "Alpha", value: "a" }, { label: "Beta", value: "b" }, { label: "Gamma", value: "c" }] },
    };
    stubApi(undefined, { definitionsOf: () => [DEFINITIONS[0], interests] });
    const onSubmit = vi.fn(async (_data: unknown, _customFieldValues?: Record<string, unknown>) => {});
    render(
      <ContactForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        initialValues={editing}
        initialCustomFieldValues={{ membershipTier: "Gold", interests: ["a", "b"] }}
      />,
    );

    expect(await screen.findByDisplayValue("Gold")).toBeInTheDocument();
    const option = (label: string) => screen.getByText(label).closest("button") as HTMLButtonElement;
    expect(option("Alpha")).toHaveClass("bg-primary");
    expect(option("Beta")).toHaveClass("bg-primary");
    expect(option("Gamma")).not.toHaveClass("bg-primary");

    fireEvent.click(option("Gamma"));
    fireEvent.click(screen.getByText("Save Changes").closest("button") as HTMLButtonElement);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ membershipTier: "Gold", interests: ["a", "b", "c"] });
  });
});

describe("follow-ups outside this web write set", () => {
  // SEC-R015c-3 (review, confirmed against a real database): the form now sends
  // typed customFieldValues keyed by the selected business's definition NAMES,
  // and ContactCustomFieldValueService.setValuesForContact
  // (apps/server/src/modules/crm/contact-custom-field-value.service.ts) resolves
  // those names with no businessId, while names are unique only per business.
  // A contact can be bound to another business's definition (label, description
  // and options then disclosed on the contact's detail). The fix scopes that
  // lookup to the contact's business: a server packet, not this web one.
  it.todo("server: a contact's typed custom-field names resolve only against its own business's definitions (SEC-R015c-3)");

  // SEC-R015c-1 (second review round, confirmed by running): the screens that know their
  // business do not hand it down, so the fields read kf_business_id instead of
  // the business the screen is bound to. ContactDetail receives businessId and
  // passes it to ContactDetailTabs but not to ContactDetailInfo
  // (contact-detail.tsx, the <ContactDetailInfo> mount); the pipeline mounts
  // ContactForm without the businessId it captured at mount and submits to
  // (pipeline-tab-content.tsx, the <ContactForm> mount; use-contacts-data.ts,
  // use-contact-actions.ts handleSubmitContact). Once the stored selection moves
  // (a sign-in in another tab), the form shows one business's definitions and
  // submits their names to the other. Both components here already honour a
  // handed businessId over the selection (the "given the business by its
  // parent" cases and the control above); the missing line is in each parent,
  // outside this write set.
  it.todo("ContactDetail hands its businessId to ContactDetailInfo, so the panel reads the bound business's definitions, not kf_business_id (SEC-R015c-1)");
  it.todo("the pipeline mounts ContactForm with the businessId its submit writes to, so the form never shows another business's definitions (SEC-R015c-1)");

  // SEC-R015c-2 (second review round, confirmed by running): the page that manages the
  // definitions (app/app/settings/custom-fields/page.tsx) calls
  // fetchCustomFieldDefinitions(undefined) and create/update/archive/restore/
  // delete without a businessId; lib/client.ts defaults every one of them to
  // DEFAULT_BUSINESS_ID ("biz_demo"). A member gets 403 (so nobody can create the
  // definitions these screens now read); a SUPER_ADMIN, whom BusinessGuard lets
  // into any business, writes the demo tenant's definitions instead of the
  // selected business's. The fix is in that page and in lib/client.ts (drop the
  // biz_demo default so a missing business no longer compiles): outside this
  // write set.
  it.todo("settings/custom-fields reads and writes the selected business's definitions and never names biz_demo; the client's custom-field-definition functions require a businessId (SEC-R015c-2)");
});
