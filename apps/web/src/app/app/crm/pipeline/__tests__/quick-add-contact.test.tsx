/**
 * SWP-CONTACT-QUICKADD (browser sweep 2026-11-13, BUG-009, BUG-034, BUG-035): Customers > "Add contact".
 *
 * The sweep, on the quick-add dialog:
 *   - BUG-009: a refused save (a member without crm write, a duplicate) closed the dialog, emptied what was typed and
 *     said nothing: lib/client.ts createContact answers { data: null, error } rather than throwing, so the screen's
 *     catch never ran and the dialog reset as if it had saved;
 *   - BUG-034: the dialog's Company field was never sent;
 *   - BUG-035: a first name alone was saved as "<name> User": createContact filled in lastName "User".
 *
 * The screen is the real one: useContactsPipeline feeding PipelineTabContent, the toolbar's "Add contact" door, the
 * quick-add dialog, the full ContactForm behind "Open full form", the real lib/client.ts and the real failure kit.
 * Only `fetch` is stubbed (and sonner, to read the toasts); Dexie is a no-op store as in
 * add-contact-duplicate-phone.test.tsx.
 *
 * Every entry point that adds a customer from this screen is covered: the toolbar door, the contacts page's "n"
 * shortcut and its ?new link (both dispatch kf:open-quick-add-contact, which opens the same dialog) and the full form behind "Open full form". The composer's
 * customer picker (components/contacts/contact-select.tsx) already says its refusals (SWP-QUOTE-COMPOSER-CONTACT);
 * its POST body is covered here for BUG-035, since it goes through the same createContact.
 *
 * Cases tagged RED-BEFORE fail on the packet's base; CONTROL cases pass on both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { PipelineTabContent } from "../pipeline-tab-content";
import { useContactsPipeline } from "../use-contacts-pipeline";
import { setCachedUser } from "@/lib/workspace";
import { createContact } from "@/lib/client";

const routerStub = vi.hoisted(() => ({
  push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerStub,
  usePathname: () => "/app/crm/contacts",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

/** A Dexie stand-in that stores nothing (the screen's contact cache is not under test here). */
const fakeDexie = vi.hoisted(() => {
  class NoopTable {
    where() { return { equals: () => this.matching() }; }
    matching() { return { toArray: async () => [], count: async () => 0, delete: async () => 0 }; }
    async toArray() { return []; }
    async count() { return 0; }
    async clear() {}
    async bulkPut() {}
  }
  class FakeDexie {
    constructor(readonly name: string) {}
    version() {
      return {
        stores: (schema: Record<string, string>) => {
          for (const table of Object.keys(schema)) (this as unknown as Record<string, NoopTable>)[table] = new NoopTable();
          return this;
        },
      };
    }
    close() {}
    static async delete() {}
    static async exists() { return false; }
  }
  return { FakeDexie };
});
vi.mock("dexie", () => ({ default: fakeDexie.FakeDexie, Dexie: fakeDexie.FakeDexie }));

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

const BUSINESS = "biz_1";
/** ModuleScopeGuard's sentence (apps/server core/auth/module-scope.guard.ts), which only a 403 carries. */
const SCOPE_SENTENCE = "Insufficient permissions: crm requires write access (you have read)";
const DUPLICATE = "A contact with this email already exists in this business";

type PostAnswer = { status: number; body: unknown };

/**
 * Stub the contacts API: an empty list, and each POST answered by `answer` (a 201 with the new contact by default).
 * Every POST body is recorded.
 */
function stubContactsApi(answer: PostAnswer | null = null) {
  const posts: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (pathname.endsWith(`/crm/businesses/${BUSINESS}/contacts`)) {
      if (method === "POST") {
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        posts.push(body);
        if (answer) return jsonResponse(answer.status, answer.body);
        return jsonResponse(201, {
          id: `c_${posts.length}`, businessId: BUSINESS, firstName: body.firstName, lastName: body.lastName ?? null,
          email: body.email ?? null, phone: body.phone ?? null, status: "LEAD", tags: [],
          createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z",
        });
      }
      return jsonResponse(200, { contacts: [], nextCursor: null, hasMore: false });
    }
    if (pathname.endsWith("/contacts/poll")) return jsonResponse(200, { lastUpdatedAt: null, totalCount: 0 });
    if (pathname.endsWith("/contacts/favorites")) return jsonResponse(200, []);
    if (pathname.endsWith("/saved-views")) return jsonResponse(200, []);
    return jsonResponse(404, { message: "Not stubbed" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { posts };
}

function ContactsScreenHarness() {
  const state = useContactsPipeline();
  return <PipelineTabContent state={state} />;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

/** Open the quick-add dialog through the toolbar door and return it. */
async function openQuickAdd(): Promise<HTMLElement> {
  // The toolbar door is the "Add contact" button with aria-expanded (a closing dialog's own submit button of the same
  // name can still be in the DOM during its exit animation).
  await screen.findAllByRole("button", { name: "Add contact" });
  const door = screen.getAllByRole("button", { name: "Add contact" }).find((b) => b.hasAttribute("aria-expanded"));
  if (!door) throw new Error("no toolbar 'Add contact' door");
  fireEvent.click(door);
  return screen.findByRole("dialog", { name: "Add contact" });
}

function fill(dialog: HTMLElement, placeholder: string, value: string) {
  fireEvent.change(within(dialog).getByPlaceholderText(placeholder), { target: { value } });
}

async function pressSave(dialog: HTMLElement) {
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Add contact" }));
  });
  await settle();
}

describe("Customers > Add contact (SWP-CONTACT-QUICKADD: BUG-009, BUG-034, BUG-035)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", BUSINESS);
    window.localStorage.setItem("kf_pipeline_view", "list");
    setCachedUser({ id: "user_a", email: "a@example.test" });
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    await settle();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("RED-BEFORE (BUG-009): a member without crm write is told why, and the dialog stays open with what was typed", async () => {
    const api = stubContactsApi({ status: 403, body: { statusCode: 403, message: SCOPE_SENTENCE, error: "Forbidden" } });
    render(<ContactsScreenHarness />);
    const dialog = await openQuickAdd();
    fill(dialog, "Jane", "Kavita");
    fill(dialog, "jane@example.com", "kavita@example.test");
    await pressSave(dialog);

    expect(api.posts).toHaveLength(1);
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const [said] = vi.mocked(toast.error).mock.calls.at(-1) ?? [];
    expect(String(said)).toMatch(/^You can't add customers in this business: it needs crm write access\./);
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    const kept = screen.getByRole("dialog", { name: "Add contact" });
    expect(within(kept).getByPlaceholderText("Jane")).toHaveValue("Kavita");
    expect(within(kept).getByPlaceholderText("jane@example.com")).toHaveValue("kavita@example.test");
    // The reason is shown in the dialog as well, beside the button.
    expect(within(kept).getByRole("alert")).toHaveTextContent(/needs crm write access/);
  });

  it("RED-BEFORE (BUG-009): a duplicate (409) is said in the server's words, and the dialog stays open with what was typed", async () => {
    stubContactsApi({ status: 409, body: { statusCode: 409, message: DUPLICATE, error: "Conflict" } });
    render(<ContactsScreenHarness />);
    const dialog = await openQuickAdd();
    fill(dialog, "Jane", "Kavita");
    fill(dialog, "jane@example.com", "kavita@example.test");
    await pressSave(dialog);

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(String(vi.mocked(toast.error).mock.calls.at(-1)?.[0])).toBe(DUPLICATE);
    const kept = screen.getByRole("dialog", { name: "Add contact" });
    expect(within(kept).getByPlaceholderText("Jane")).toHaveValue("Kavita");
    expect(within(kept).getByRole("alert")).toHaveTextContent(DUPLICATE);
  });

  it("RED-BEFORE (BUG-009): the dialog opened by the contacts page's 'n' shortcut (kf:open-quick-add-contact) keeps the form and says why too", async () => {
    stubContactsApi({ status: 409, body: { statusCode: 409, message: DUPLICATE, error: "Conflict" } });
    render(<ContactsScreenHarness />);
    await screen.findByRole("button", { name: "Add contact" });
    await act(async () => { window.dispatchEvent(new Event("kf:open-quick-add-contact")); });
    const dialog = await screen.findByRole("dialog", { name: "Add contact" });
    fill(dialog, "Jane", "Kavita");
    await pressSave(dialog);

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(within(screen.getByRole("dialog", { name: "Add contact" })).getByPlaceholderText("Jane")).toHaveValue("Kavita");
  });

  it("RED-BEFORE (BUG-034): Company is sent as companyName", async () => {
    const api = stubContactsApi();
    render(<ContactsScreenHarness />);
    const dialog = await openQuickAdd();
    fill(dialog, "Jane", "Kavita");
    fireEvent.click(within(dialog).getByRole("button", { name: "More fields" }));
    fill(dialog, "Acme Co.", "Persad Catering Ltd");
    await pressSave(dialog);

    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0].companyName).toBe("Persad Catering Ltd");
  });

  it("RED-BEFORE (BUG-035): a first name alone sends no last name (no invented 'User')", async () => {
    const api = stubContactsApi();
    render(<ContactsScreenHarness />);
    const dialog = await openQuickAdd();
    fill(dialog, "Jane", "Kavita");
    await pressSave(dialog);

    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0].firstName).toBe("Kavita");
    expect(api.posts[0]).not.toHaveProperty("lastName");
    expect(JSON.stringify(api.posts[0])).not.toContain("User");
  });

  it("RED-BEFORE (BUG-035): lib/client.ts createContact itself invents no last name, for every caller", async () => {
    const api = stubContactsApi();
    await createContact({ businessId: BUSINESS, firstName: "Ravi" });
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]).not.toHaveProperty("lastName");
  });

  it("RED-BEFORE (BUG-009, the full form behind 'Open full form'): a refused save says why and the form stays open", async () => {
    const api = stubContactsApi({ status: 409, body: { statusCode: 409, message: DUPLICATE, error: "Conflict" } });
    render(<ContactsScreenHarness />);
    const dialog = await openQuickAdd();
    fireEvent.click(within(dialog).getByRole("button", { name: /Open full form/ }));
    await screen.findByText("Add New Contact");
    fireEvent.change(document.getElementById("contact-form-firstName") as HTMLInputElement, { target: { value: "Kavita" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add Contact" }));
    });
    await settle();

    await waitFor(() => expect(api.posts).toHaveLength(1));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(String(vi.mocked(toast.error).mock.calls.at(-1)?.[0])).toBe(DUPLICATE);
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(screen.getByText("Add New Contact")).toBeInTheDocument();
    expect(document.getElementById("contact-form-firstName")).toHaveValue("Kavita");
  });

  it("RED-BEFORE (review MINOR-1): after a refusal, changing a field clears the old reason; the next refusal shows again", async () => {
    stubContactsApi({ status: 409, body: { statusCode: 409, message: DUPLICATE, error: "Conflict" } });
    render(<ContactsScreenHarness />);
    const dialog = await openQuickAdd();
    fill(dialog, "Jane", "Kavita");
    fill(dialog, "jane@example.com", "kavita@example.test");
    await pressSave(dialog);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(DUPLICATE);

    fill(dialog, "jane@example.com", "kavita.p@example.test");
    expect(within(dialog).queryByRole("alert"), "the reason was for the old email").not.toBeInTheDocument();
    await pressSave(dialog);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(DUPLICATE);
  });

  it("RED-BEFORE (review M4, MINOR-1): a dialog closed after a refusal and opened again keeps the draft but not the old reason", async () => {
    stubContactsApi({ status: 409, body: { statusCode: 409, message: DUPLICATE, error: "Conflict" } });
    render(<ContactsScreenHarness />);
    const dialog = await openQuickAdd();
    fill(dialog, "Jane", "Kavita");
    await pressSave(dialog);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(DUPLICATE);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add contact" })).not.toBeInTheDocument());
    const again = await openQuickAdd();
    expect(within(again).getByPlaceholderText("Jane"), "closing keeps the draft (as before)").toHaveValue("Kavita");
    expect(within(again).queryByRole("alert"), "no stale reason on a fresh open").not.toBeInTheDocument();
  });

  it("RED-BEFORE (journey C1, the header's New > Contact): an open request made before the toolbar mounts (the page's ?action=new) still opens the dialog", async () => {
    // contacts/page.tsx turns ?action=new (the header New menu's Contact, the mobile button, the checklist) into this
    // request on its first effect, before the contact list has loaded and the toolbar that listens for it has mounted.
    stubContactsApi();
    // What the page does today: window.dispatchEvent(new Event("kf:open-quick-add-contact")) in a setTimeout(0).
    await act(async () => { window.dispatchEvent(new Event("kf:open-quick-add-contact")); });
    render(<ContactsScreenHarness />);
    expect(await screen.findByRole("dialog", { name: "Add contact" })).toBeInTheDocument();
  });

  it("CONTROL: a saved contact closes the dialog, says it was added, and sends what was typed", async () => {
    const api = stubContactsApi();
    render(<ContactsScreenHarness />);
    const dialog = await openQuickAdd();
    fill(dialog, "Jane", "Kavita");
    fill(dialog, "Doe", "Persad");
    fill(dialog, "+1 868 000 0000", "868-555-0102");
    await pressSave(dialog);

    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]).toMatchObject({ firstName: "Kavita", lastName: "Persad", phone: "868-555-0102" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add contact" })).not.toBeInTheDocument());
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Kavita added");
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});
