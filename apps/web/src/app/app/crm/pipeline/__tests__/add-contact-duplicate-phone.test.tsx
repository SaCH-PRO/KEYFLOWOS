/**
 * SWP-CRM-SEARCH (browser sweep 2026-11-13, BUG-083) — the Customers "Add contact" full form warns
 * about a possible duplicate when the phone typed is a contact's phone written another way.
 *
 * The sweep: import Ravi as '868-555-0102', then add him again as '+1 868 555 0102': no
 * "Possible duplicate contact" dialog, and a second Ravi was saved. The form's duplicate check
 * (pipeline-tab-content.tsx, handleCheckDuplicates) searches the list for the typed phone and keeps
 * a result only when its phone has the same digits, so '18685550102' and '8685550102' were two
 * numbers. The server search now returns the contact for either spelling (SWP-CRM-SEARCH, server
 * half: apps/server/test/crm-search-tags-phone.integration.test.ts); this is the screen half.
 *
 * The screen is the real one: useContactsPipeline feeding PipelineTabContent, the toolbar's
 * "Add contact" door, the quick-add dialog's "Open full form", the real ContactForm and the real
 * lib/client.ts. Only `fetch` is stubbed; the list read answers the saved contact so the case
 * turns on how the screen compares the two spellings. Dexie is replaced by a no-op store (jsdom
 * has no IndexedDB), as in hooks/__tests__/use-contacts-data.denial.test.tsx.
 *
 * Cases tagged RED-BEFORE fail on the packet's source base: the dialog never opens and the form
 * POSTs the second contact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PipelineTabContent } from "../pipeline-tab-content";
import { useContactsPipeline } from "../use-contacts-pipeline";
import { setCachedUser } from "@/lib/workspace";

const routerStub = vi.hoisted(() => ({
  push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerStub,
  usePathname: () => "/app/crm/contacts",
  useSearchParams: () => new URLSearchParams(),
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

type Saved = { id: string; firstName: string; lastName: string; phone: string };

/**
 * Stub the contacts API with one saved contact. Every list read (the screen's first load and the
 * form's duplicate search) answers it; the search terms and any POST are recorded.
 */
function stubContactsApi(saved: Saved) {
  const searches: string[] = [];
  const posts: unknown[] = [];
  const row = {
    ...saved,
    businessId: BUSINESS,
    email: null,
    status: "LEAD",
    tags: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname, searchParams } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    if (pathname.endsWith(`/crm/businesses/${BUSINESS}/contacts`)) {
      if (method === "POST") {
        posts.push(init?.body ? JSON.parse(String(init.body)) : null);
        return jsonResponse(201, { ...row, id: "c_new", firstName: "Ravi", lastName: "Again" });
      }
      const search = searchParams.get("search");
      if (search !== null) searches.push(search);
      return jsonResponse(200, { contacts: [row], nextCursor: null, hasMore: false });
    }
    if (pathname.endsWith("/contacts/poll")) return jsonResponse(200, { lastUpdatedAt: null, totalCount: 1 });
    if (pathname.endsWith("/contacts/favorites")) return jsonResponse(200, []);
    return jsonResponse(404, { message: "Not stubbed" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { searches, posts };
}

function ContactsScreenHarness() {
  const state = useContactsPipeline();
  return <PipelineTabContent state={state} />;
}

/** Open the full "Add New Contact" form through the toolbar door and the quick-add dialog. */
async function openFullForm() {
  fireEvent.click(await screen.findByRole("button", { name: "Add contact" }));
  fireEvent.click(await screen.findByRole("button", { name: /Open full form/ }));
  await screen.findByText("Add New Contact");
}

/** Fill the full form and press its submit button. */
async function submitFullForm(firstName: string, phone: string) {
  fireEvent.change(document.getElementById("contact-form-firstName") as HTMLInputElement, { target: { value: firstName } });
  fireEvent.change(document.getElementById("contact-form-phone") as HTMLInputElement, { target: { value: phone } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add Contact" }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe("Customers > Add contact (full form): the duplicate check reads phone spellings as one number", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", BUSINESS);
    window.localStorage.setItem("kf_pipeline_view", "list");
    setCachedUser({ id: "user_a", email: "a@example.test" });
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

  it("RED-BEFORE: typing '+1 868 555 0102' for a contact saved as '868-555-0102' opens 'Possible duplicate contact' naming him, and nothing is saved", async () => {
    const api = stubContactsApi({ id: "c_ravi", firstName: "Ravi", lastName: "Persad", phone: "868-555-0102" });
    render(<ContactsScreenHarness />);
    await openFullForm();
    await submitFullForm("Ravi", "+1 868 555 0102");

    expect(await screen.findByText("Possible duplicate contact")).toBeInTheDocument();
    // The dialog names the saved contact (the list behind it shows the name too).
    expect(screen.getByText(/We found 1 similar contact\(s\): Ravi Persad\./)).toBeInTheDocument();
    expect(api.searches).toContain("+1 868 555 0102");
    expect(api.posts).toEqual([]);
  });

  it("RED-BEFORE: typing '868-555-0102' for a contact saved as '+1 868 555 0102' opens the dialog too", async () => {
    const api = stubContactsApi({ id: "c_asha", firstName: "Asha", lastName: "Singh", phone: "+1 868 555 0102" });
    render(<ContactsScreenHarness />);
    await openFullForm();
    await submitFullForm("Asha", "868-555-0102");

    expect(await screen.findByText("Possible duplicate contact")).toBeInTheDocument();
    // The dialog names the saved contact (the list behind it shows the name too).
    expect(screen.getByText(/We found 1 similar contact\(s\): Asha Singh\./)).toBeInTheDocument();
    expect(api.posts).toEqual([]);
  });

  it("CONTROL: the same spelling still opens the dialog", async () => {
    const api = stubContactsApi({ id: "c_ravi", firstName: "Ravi", lastName: "Persad", phone: "868-555-0102" });
    render(<ContactsScreenHarness />);
    await openFullForm();
    await submitFullForm("Ravi", "(868) 555-0102");

    expect(await screen.findByText("Possible duplicate contact")).toBeInTheDocument();
    expect(api.posts).toEqual([]);
  });

  it("CONTROL: another number the search happens to return is not a duplicate: no dialog, the contact is saved", async () => {
    const api = stubContactsApi({ id: "c_ravi", firstName: "Ravi", lastName: "Persad", phone: "868-555-0102" });
    render(<ContactsScreenHarness />);
    await openFullForm();
    await submitFullForm("Zed", "+1 868 555 0199");

    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(screen.queryByText("Possible duplicate contact")).not.toBeInTheDocument();
  });
});
