/**
 * R0-CT-05-WEB-CONTACT-DENIAL-STATES — the contacts list.
 *
 * WHY this test exists: CONTACTS-v1 section 5 says "On inadequate permission,
 * show denial state; do not interpret 403 or 404 as empty customer data." The
 * list did exactly that. `fetchContacts` (lib/client.ts) does not throw on a
 * refused read: its `apiGet` resolves with the EMPTY FALLBACK LIST plus the
 * server's message, `{ data: { contacts: [], hasMore: false }, error: "No
 * access to this business" }`. `useContactsData` destructured `data` only, so
 * a member the server refused saw "No contacts yet" and an "Add contact"
 * button, as if the business had no customers.
 *
 * The client is real here and only `fetch` is stubbed, so the error shape
 * under test is the one the browser actually produces (a 403 body from
 * BusinessGuard, a 401 that the refresh cannot rescue, a 500).
 *
 * The harness wires the hook to the real list renderer the same way
 * pipeline-tab-content.tsx does (displayContacts / loading / loadError into
 * PipelineContactList) and triggers the first load the way
 * use-contacts-pipeline.ts does (loadContacts once a businessId is known).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, render, renderHook, screen, waitFor, cleanup } from "@testing-library/react";
import { useContactsData } from "../use-contacts-data";
import { PipelineContactList } from "../../pipeline-contact-list";
import type { ContactCardData } from "@/components/contacts";

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

const EMPTY_LIST = { contacts: [], nextCursor: null, hasMore: false };

type Answer = "forbidden" | "unauthorized" | "serverError" | "emptyOk";

const failures: Record<Exclude<Answer, "emptyOk">, () => Response> = {
  forbidden: () => jsonResponse(403, { statusCode: 403, message: "No access to this business", error: "Forbidden" }, "Forbidden"),
  unauthorized: () => jsonResponse(401, { statusCode: 401, message: "Authentication required", error: "Unauthorized" }, "Unauthorized"),
  serverError: () => jsonResponse(500, { statusCode: 500, message: "Internal server error" }, "Internal Server Error"),
};

/**
 * Route the stub by path. The list read is what the case varies; the poll and
 * favourites reads sit behind the same guards and fail the same way, so
 * nothing else on the screen can mask the list's state.
 */
function stubContactsApi(answer: Answer) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const known =
      pathname.endsWith("/contacts") || pathname.endsWith("/contacts/poll") || pathname.endsWith("/contacts/favorites");
    if (!known) return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
    if (answer !== "emptyOk") return failures[answer]();
    if (pathname.endsWith("/contacts/poll")) return jsonResponse(200, { lastUpdatedAt: null, totalCount: 0 });
    if (pathname.endsWith("/contacts/favorites")) return jsonResponse(200, []);
    return jsonResponse(200, EMPTY_LIST);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The list screen as pipeline-tab-content.tsx composes it. */
function ContactsListHarness() {
  const state = useContactsData();
  const { businessId, loadContacts } = state;
  useEffect(() => {
    if (businessId) void loadContacts();
  }, [businessId, loadContacts]);
  return (
    <PipelineContactList
      contacts={state.displayContacts as ContactCardData[]}
      loading={state.loading}
      loadError={state.loadError}
      hasMore={state.hasMore}
      activeListTab={state.activeListTab}
      selectedContactId={null}
      selectMode={state.selectMode}
      selectedIds={state.selectedIds}
      pinnedIds={state.pinnedIds}
      favoriteIds={state.favoriteIds}
      onSelectContact={() => {}}
      onToggleSelect={() => {}}
      onTogglePin={() => {}}
      onDelete={() => {}}
      onQuickAction={() => {}}
      onLoadMore={() => {}}
      onRetry={() => { void loadContacts(); }}
      onAddContact={() => {}}
    />
  );
}

async function loadOnce() {
  const hook = renderHook(() => useContactsData());
  await waitFor(() => expect(hook.result.current.businessId).toBe("biz_1"));
  await act(async () => {
    await hook.result.current.loadContacts();
  });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("useContactsData: a refused contacts read is a load error, not an empty list", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", "biz_1");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("403 'No access to this business': the hook exposes a denial load error and no contacts", async () => {
    stubContactsApi("forbidden");
    const { result } = await loadOnce();

    expect(result.current.loadError).toBeTruthy();
    expect(result.current.loadError).toMatch(/do not have access/i);
    expect(result.current.contacts).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it("401 the refresh cannot rescue: the hook exposes a denial load error", async () => {
    stubContactsApi("unauthorized");
    const { result } = await loadOnce();

    expect(result.current.loadError).toMatch(/do not have access/i);
    expect(result.current.contacts).toEqual([]);
  });

  it("500: the hook exposes a (non-denial) load error rather than an empty list", async () => {
    stubContactsApi("serverError");
    const { result } = await loadOnce();

    expect(result.current.loadError).toBeTruthy();
    expect(result.current.loadError).not.toMatch(/do not have access/i);
    expect(result.current.contacts).toEqual([]);
  });

  it("control: a successful empty read is not an error", async () => {
    stubContactsApi("emptyOk");
    const { result } = await loadOnce();

    expect(result.current.loadError).toBeNull();
    expect(result.current.contacts).toEqual([]);
  });
});

describe("contacts list screen: a 403/401 renders a denial, never 'No contacts yet'", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", "biz_1");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("403: shows the denial message and not the empty-state copy", async () => {
    stubContactsApi("forbidden");
    render(<ContactsListHarness />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/do not have access/i);
    expect(screen.queryByText("No contacts yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Add your first contact to get started")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add contact/i })).not.toBeInTheDocument();
  });

  it("401: shows the denial message and not the empty-state copy", async () => {
    stubContactsApi("unauthorized");
    render(<ContactsListHarness />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/do not have access/i);
    expect(screen.queryByText("No contacts yet")).not.toBeInTheDocument();
  });

  it("500: shows a load failure and not the empty-state copy", async () => {
    stubContactsApi("serverError");
    render(<ContactsListHarness />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load contacts/i);
    expect(screen.queryByText("No contacts yet")).not.toBeInTheDocument();
  });

  it("control: a successful empty read still shows 'No contacts yet'", async () => {
    stubContactsApi("emptyOk");
    render(<ContactsListHarness />);

    expect(await screen.findByText("No contacts yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/**
 * Known gaps outside this packet's write set (review F3, ST-2). Each is a
 * follow-up packet, recorded here so the denial invariant is not read as
 * holding for every contacts view. Not a regression: both predate the packet.
 */
describe("contacts views not yet covered by the denial state (follow-up)", () => {
  // F3: pipeline-tab-content.tsx passes loadError only to PipelineContactList.
  // FocusView ('Nothing needs attention'), DatabaseTable ('No contacts found')
  // and the kanban view read the same hook state and never see loadError.
  it.todo(
    "focus, table and kanban views render the denial on a 403/401 instead of their empty copy " +
      "(needs pipeline-tab-content.tsx, focus-view.tsx, database-table.tsx: outside the R0-CT-05 write set)",
  );

  // ST-2: use-database-state.ts loadServerContacts ignores `error`, then falls
  // back to the IndexedDB 'keyflowos_contacts' cache, which is keyed by neither
  // user nor business and is not purged on logout.
  it.todo(
    "table view: a refused read shows a denial, never rows from the unkeyed IndexedDB cache of another user or tenant " +
      "(needs use-database-state.ts and contacts-db.ts: outside the R0-CT-05 write set)",
  );
});
