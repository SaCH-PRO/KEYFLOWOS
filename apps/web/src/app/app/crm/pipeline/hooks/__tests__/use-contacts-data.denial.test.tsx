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
import { useDatabaseState } from "../use-database-state";
import { PipelineContactList } from "../../pipeline-contact-list";
import { PipelineTabContent } from "../../pipeline-tab-content";
import { useContactsPipeline } from "../../use-contacts-pipeline";
import type { ContactCardData } from "@/components/contacts";
import { cacheContacts, getCachedContacts, type LocalContact } from "@/lib/contacts-db";
import { setCachedUser } from "@/lib/workspace";

/**
 * The full contacts screen (R0-15b) needs a router, and the table view reads
 * the IndexedDB contact cache through Dexie. jsdom has no IndexedDB and
 * fake-indexeddb is not a dependency of apps/web, so Dexie is replaced by an
 * in-memory stand-in with the surface contacts-db.ts uses: databases by name,
 * tables by schema, primary keys (compound ones included), where/equals,
 * bulkPut, clear, Dexie.delete and Dexie.exists.
 */
const routerStub = vi.hoisted(() => ({
  push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerStub,
  usePathname: () => "/app/crm/contacts",
  useSearchParams: () => new URLSearchParams(),
}));

const fakeIdb = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const databases = new Map<string, Map<string, Map<string, Row>>>();

  function primaryKeyOf(spec: string): string[] {
    const first = spec.split(",")[0].trim().replace(/^(\+\+|&)/, "");
    return first.startsWith("[") ? first.slice(1, -1).split("+") : [first];
  }

  class FakeTable {
    constructor(
      private readonly dbName: string,
      private readonly tableName: string,
      private readonly keyPath: string[],
    ) {}
    private rows(): Map<string, Row> {
      let db = databases.get(this.dbName);
      if (!db) { db = new Map(); databases.set(this.dbName, db); }
      let table = db.get(this.tableName);
      if (!table) { table = new Map(); db.set(this.tableName, table); }
      return table;
    }
    private matching(predicate: (row: Row) => boolean) {
      return {
        toArray: async () => [...this.rows().values()].filter(predicate).map((r) => ({ ...r })),
        count: async () => [...this.rows().values()].filter(predicate).length,
        delete: async () => {
          const rows = this.rows();
          let n = 0;
          for (const [k, r] of [...rows]) if (predicate(r)) { rows.delete(k); n += 1; }
          return n;
        },
      };
    }
    where(field: string) {
      return { equals: (value: unknown) => this.matching((r) => r[field] === value) };
    }
    toArray() { return this.matching(() => true).toArray(); }
    count() { return this.matching(() => true).count(); }
    async clear() { this.rows().clear(); }
    async bulkPut(items: Row[]) {
      const rows = this.rows();
      for (const item of items) rows.set(JSON.stringify(this.keyPath.map((k) => item[k])), { ...item });
    }
  }

  class FakeDexie {
    constructor(readonly name: string) {}
    version(_n: number) {
      return {
        stores: (schema: Record<string, string>) => {
          for (const [table, spec] of Object.entries(schema)) {
            (this as unknown as Record<string, FakeTable>)[table] = new FakeTable(this.name, table, primaryKeyOf(spec));
          }
          if (!databases.has(this.name)) databases.set(this.name, new Map());
          return this;
        },
      };
    }
    close() {}
    static async delete(name: string) { databases.delete(name); }
    static async exists(name: string) { return databases.has(name); }
  }

  return { databases, FakeDexie };
});
vi.mock("dexie", () => ({ default: fakeIdb.FakeDexie, Dexie: fakeIdb.FakeDexie }));

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
 * R0-15b-WEB-CONTACT-VIEWS-DENIAL-CACHE (review F3, ST-2): the other contacts
 * views. pipeline-tab-content.tsx handed loadError to the list only, so
 * FocusView ('Nothing needs attention'), the table ('No contacts found') and the
 * kanban ('Drop contacts here') showed their empty copy on a refused read. The
 * table also fell back to an IndexedDB cache keyed by neither user nor
 * business, so a refused read could show another user's or another tenant's
 * contacts left on a shared device.
 *
 * The screen here is the real one: useContactsPipeline feeding
 * PipelineTabContent, the view picked the way the page picks it (the stored
 * kf_pipeline_view), only `fetch` stubbed.
 */
function ContactsScreenHarness() {
  const state = useContactsPipeline();
  return <PipelineTabContent state={state} />;
}

const VIEW_EMPTY_COPY = {
  focus: "Nothing needs attention",
  table: "No contacts found",
  kanban: "Drop contacts here",
} as const;

type ViewWithEmptyCopy = keyof typeof VIEW_EMPTY_COPY;

const ME = { userId: "user_a", businessId: "biz_1" };

function cachedContact(id: string, firstName: string): LocalContact {
  return { id, firstName, lastName: "Cached", email: `${id}@cache.example.test`, status: "CLIENT", tags: [] };
}

/** Rows this device holds from earlier sessions, under different owners. */
const OWN_ROW = cachedContact("c_own", "Ownrow");
const OTHER_USER_ROW = cachedContact("c_other_user", "Otheruser");
const OTHER_TENANT_ROW = cachedContact("c_other_tenant", "Othertenant");
const LEGACY_ROW = cachedContact("c_legacy", "Legacyrow");
const CACHED_NAMES = ["Ownrow", "Otheruser", "Othertenant", "Legacyrow"];

async function seedDeviceCache() {
  await cacheContacts([OWN_ROW], ME);
  await cacheContacts([OTHER_USER_ROW], { userId: "user_b", businessId: "biz_1" });
  await cacheContacts([OTHER_TENANT_ROW], { userId: "user_a", businessId: "biz_2" });
  // The unkeyed store an older build wrote. Added after the keyed writes so it
  // survives a build whose cacheContacts clears one shared table.
  let legacyDb = fakeIdb.databases.get("keyflowos_contacts");
  if (!legacyDb) {
    legacyDb = new Map();
    fakeIdb.databases.set("keyflowos_contacts", legacyDb);
  }
  let legacyTable = legacyDb.get("contacts");
  if (!legacyTable) {
    legacyTable = new Map();
    legacyDb.set("contacts", legacyTable);
  }
  legacyTable.set(JSON.stringify([LEGACY_ROW.id]), { ...LEGACY_ROW });
}

/**
 * Records every watched text that is EVER inserted into the document,
 * including rows rendered and withdrawn a tick later, so "never shown" is
 * asserted rather than "not shown at the end".
 */
function watchInsertedText(needles: string[]) {
  const seen = new Set<string>();
  const scan = (records: MutationRecord[]) => {
    for (const record of records) {
      const nodes = record.type === "characterData" ? [record.target] : Array.from(record.addedNodes);
      for (const node of nodes) {
        const text = node.textContent ?? "";
        for (const needle of needles) if (text.includes(needle)) seen.add(needle);
      }
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return {
    seen,
    stop() {
      scan(observer.takeRecords());
      observer.disconnect();
    },
  };
}

async function findDenialAlert(): Promise<HTMLElement> {
  return waitFor(() => {
    const alert = screen.getAllByRole("alert").find((el) => /do not have access/i.test(el.textContent ?? ""));
    if (!alert) throw new Error("no denial alert yet");
    return alert;
  });
}

/** Let in-flight reads (the table's own fetch, cache reads) settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe("contacts focus, table and kanban views: a 403/401 renders the denial, never the empty copy", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", "biz_1");
    setCachedUser({ id: ME.userId, email: "a@example.test" });
    fakeIdb.databases.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    await settle();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    fakeIdb.databases.clear();
  });

  const cases: Array<[ViewWithEmptyCopy, "forbidden" | "unauthorized"]> = [
    ["focus", "forbidden"],
    ["focus", "unauthorized"],
    ["table", "forbidden"],
    ["table", "unauthorized"],
    ["kanban", "forbidden"],
    ["kanban", "unauthorized"],
  ];

  it.each(cases)("%s view, %s: role=alert with the denial and no empty-state copy", async (view, answer) => {
    window.localStorage.setItem("kf_pipeline_view", view);
    stubContactsApi(answer);
    render(<ContactsScreenHarness />);

    const alert = await findDenialAlert();
    expect(alert).toHaveTextContent(/could not load contacts/i);
    await settle();
    expect(screen.queryByText(VIEW_EMPTY_COPY[view])).not.toBeInTheDocument();
  });

  it("table view, 403: never shows rows from the IndexedDB cache, whoever they were cached for", async () => {
    await seedDeviceCache();
    window.localStorage.setItem("kf_pipeline_view", "table");
    stubContactsApi("forbidden");

    const watch = watchInsertedText(CACHED_NAMES);
    render(<ContactsScreenHarness />);
    await findDenialAlert();
    await settle();
    watch.stop();

    expect([...watch.seen]).toEqual([]);
    expect(screen.queryByText(VIEW_EMPTY_COPY.table)).not.toBeInTheDocument();
  });

  it("table state, 403: no rows and no cache fallback, the denial is exposed, and this owner's cached rows are dropped", async () => {
    await seedDeviceCache();
    const fetchMock = stubContactsApi("forbidden");

    const { result } = renderHook(() => useDatabaseState({ businessId: ME.businessId, contacts: [], onRefresh: () => {} }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.serverLoading).toBe(false));
    await settle();

    const names = (rows: LocalContact[]) => rows.map((c) => c.firstName);
    expect(names(result.current.activeContacts)).toEqual([]);
    expect(names(result.current.filteredContacts)).toEqual([]);
    expect(result.current.usingCache).toBe(false);
    expect((result.current as { loadError?: string | null }).loadError).toMatch(/do not have access/i);
    await waitFor(async () => expect(await getCachedContacts(ME)).toEqual([]));
  });

  it("table state, 500 (not a denial): the offline fallback shows the cache of THIS user and business only", async () => {
    await seedDeviceCache();
    stubContactsApi("serverError");

    const { result } = renderHook(() => useDatabaseState({ businessId: ME.businessId, contacts: [], onRefresh: () => {} }));
    await waitFor(() => expect(result.current.activeContacts.map((c) => c.firstName)).toContain("Ownrow"));
    await settle();

    expect(result.current.activeContacts.map((c) => c.firstName)).toEqual(["Ownrow"]);
    expect(result.current.usingCache).toBe(true);
  });
});
