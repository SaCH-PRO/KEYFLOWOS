/**
 * R0-15b-WEB-CONTACT-VIEWS-DENIAL-CACHE (review ST-2): the IndexedDB contact
 * cache behind the contacts table.
 *
 * WHY this test exists: lib/contacts-db.ts kept ONE Dexie database,
 * 'keyflowos_contacts', for every user and every business on the device. It
 * was written whenever the table had rows and read back whenever the server
 * gave none, and nothing deleted it at sign-out. On a shared device the next
 * person to open the table, or the same person in another business, could be
 * shown contacts they were never allowed to read.
 *
 * The invariants pinned here:
 *   - the cache key carries the user id AND the business id, and there is no
 *     key (so no caching) when either is unknown;
 *   - rows cached for (userA, bizA) are never returned for (userB, bizA) or
 *     (userA, bizB), and writing one owner's rows never erases another's;
 *   - the sign-out path (lib/workspace.ts clearStoredBusinessId, called by the
 *     app shell's logout and by RequireAuth on a dead session) purges the cache;
 *   - the legacy unkeyed 'keyflowos_contacts' store is never read and is deleted.
 *
 * fake-indexeddb is not a dependency of apps/web and jsdom has no IndexedDB, so
 * Dexie is replaced by an in-memory stand-in with the surface contacts-db.ts
 * uses (databases by name, tables by schema, compound primary keys,
 * where/equals, bulkPut, clear, Dexie.delete, Dexie.exists).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as contactsDb from "../contacts-db";
import type { LocalContact } from "../contacts-db";
import { clearStoredBusinessId, setCachedUser } from "../workspace";

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

  /** What the pre-R0-15b build left on a device: one table, rows keyed by id. */
  function seedLegacyStore(rows: Row[]) {
    const table = new Map<string, Row>();
    for (const row of rows) table.set(JSON.stringify([row.id]), { ...row });
    databases.set("keyflowos_contacts", new Map([["contacts", table]]));
  }

  return { databases, FakeDexie, seedLegacyStore };
});
vi.mock("dexie", () => ({ default: fakeIdb.FakeDexie, Dexie: fakeIdb.FakeDexie }));

const LEGACY_DB = "keyflowos_contacts";

const A_IN_BIZ_A = { userId: "user_A", businessId: "biz_A" };
const B_IN_BIZ_A = { userId: "user_B", businessId: "biz_A" };
const A_IN_BIZ_B = { userId: "user_A", businessId: "biz_B" };

function contact(id: string, firstName: string): LocalContact {
  return { id, firstName, status: "CLIENT", tags: [] };
}

const firstNames = (rows: LocalContact[]) => rows.map((c) => c.firstName).sort();

/**
 * Typed access to the R0-15b functions, resolved at call time so a build that
 * lacks one fails the case that needs it rather than the whole file.
 */
const api = contactsDb as unknown as {
  contactsCacheKey: (owner: { userId?: string | null; businessId?: string | null }) => string | null;
  purgeContactsCache: () => Promise<void>;
};

async function resetDevice() {
  fakeIdb.databases.clear();
  window.localStorage.clear();
  if (typeof api.purgeContactsCache === "function") await api.purgeContactsCache();
  fakeIdb.databases.clear();
}

describe("contacts IndexedDB cache: keyed by user and business", () => {
  beforeEach(resetDevice);
  afterEach(resetDevice);

  it("the cache key includes the user id and the business id, and there is no key when either is unknown", () => {
    const key = api.contactsCacheKey(A_IN_BIZ_A);
    expect(key).toEqual(expect.any(String));
    expect(key).toContain("user_A");
    expect(key).toContain("biz_A");

    expect(api.contactsCacheKey(B_IN_BIZ_A)).not.toBe(key);
    expect(api.contactsCacheKey(A_IN_BIZ_B)).not.toBe(key);
    // A separator in an id must not let two owners collide.
    expect(api.contactsCacheKey({ userId: "u:1", businessId: "b" })).not.toBe(
      api.contactsCacheKey({ userId: "u", businessId: "1:b" }),
    );

    expect(api.contactsCacheKey({ userId: null, businessId: "biz_A" })).toBeNull();
    expect(api.contactsCacheKey({ userId: "user_A", businessId: null })).toBeNull();
    expect(api.contactsCacheKey({ userId: "", businessId: "" })).toBeNull();
  });

  it("rows cached for (userA, bizA) are not returned for (userB, bizA) or (userA, bizB)", async () => {
    await contactsDb.cacheContacts([contact("c1", "Alice")], A_IN_BIZ_A);

    expect(firstNames(await contactsDb.getCachedContacts(A_IN_BIZ_A))).toEqual(["Alice"]);
    expect(await contactsDb.getCachedContacts(B_IN_BIZ_A)).toEqual([]);
    expect(await contactsDb.getCachedContacts(A_IN_BIZ_B)).toEqual([]);
    expect(await contactsDb.getCachedCount(B_IN_BIZ_A)).toBe(0);
    expect(await contactsDb.getCachedCount(A_IN_BIZ_A)).toBe(1);
  });

  it("writing one owner's rows neither erases nor leaks into another owner's", async () => {
    await contactsDb.cacheContacts([contact("c1", "Alice")], A_IN_BIZ_A);
    await contactsDb.cacheContacts([contact("c2", "Bob"), contact("c1", "Shadow")], B_IN_BIZ_A);
    await contactsDb.cacheContacts([contact("c3", "Carol")], A_IN_BIZ_B);

    expect(firstNames(await contactsDb.getCachedContacts(A_IN_BIZ_A))).toEqual(["Alice"]);
    expect(firstNames(await contactsDb.getCachedContacts(B_IN_BIZ_A))).toEqual(["Bob", "Shadow"]);
    expect(firstNames(await contactsDb.getCachedContacts(A_IN_BIZ_B))).toEqual(["Carol"]);

    // A re-sync replaces the owner's own rows only.
    await contactsDb.cacheContacts([contact("c4", "Dave")], A_IN_BIZ_A);
    expect(firstNames(await contactsDb.getCachedContacts(A_IN_BIZ_A))).toEqual(["Dave"]);
    expect(firstNames(await contactsDb.getCachedContacts(B_IN_BIZ_A))).toEqual(["Bob", "Shadow"]);
  });

  it("nothing is cached or returned when the owner is unknown", async () => {
    await contactsDb.cacheContacts([contact("c1", "Alice")], { userId: null, businessId: "biz_A" });
    await contactsDb.cacheContacts([contact("c2", "Bob")], A_IN_BIZ_A);

    expect(await contactsDb.getCachedContacts({ userId: null, businessId: "biz_A" })).toEqual([]);
    expect(await contactsDb.getCachedContacts({ userId: "user_A", businessId: undefined })).toEqual([]);
    expect(firstNames(await contactsDb.getCachedContacts(A_IN_BIZ_A))).toEqual(["Bob"]);
  });

  it("the last-sync time is per owner too", async () => {
    await contactsDb.setLastSyncTime(A_IN_BIZ_A);
    expect(await contactsDb.getLastSyncTime(A_IN_BIZ_A)).toEqual(expect.any(String));
    expect(await contactsDb.getLastSyncTime(B_IN_BIZ_A)).toBeNull();
  });

  it("the legacy unkeyed 'keyflowos_contacts' store is ignored and deleted", async () => {
    fakeIdb.seedLegacyStore([{ ...contact("c9", "Mallory") }]);
    expect(await fakeIdb.FakeDexie.exists(LEGACY_DB)).toBe(true);

    expect(await contactsDb.getCachedContacts(A_IN_BIZ_A)).toEqual([]);
    expect(await contactsDb.getCachedCount(A_IN_BIZ_A)).toBe(0);
    expect(await fakeIdb.FakeDexie.exists(LEGACY_DB)).toBe(false);
  });
});

describe("contacts IndexedDB cache: purged at sign-out", () => {
  beforeEach(async () => {
    await resetDevice();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDevice();
  });

  it("clearStoredBusinessId (the logout and dead-session path) purges every owner's cached rows and sync times", async () => {
    window.localStorage.setItem("kf_token", "token-a");
    window.localStorage.setItem("kf_business_id", "biz_A");
    setCachedUser({ id: "user_A", email: "a@example.test" });
    await contactsDb.cacheContacts([contact("c1", "Alice")], A_IN_BIZ_A);
    await contactsDb.cacheContacts([contact("c2", "Bob")], B_IN_BIZ_A);
    await contactsDb.setLastSyncTime(A_IN_BIZ_A);
    fakeIdb.seedLegacyStore([{ ...contact("c9", "Mallory") }]);

    clearStoredBusinessId();

    await vi.waitFor(() => {
      expect([...fakeIdb.databases.keys()]).toEqual([]);
    });
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith("kf_contacts_last_sync"))).toEqual([]);
    expect(await contactsDb.getCachedContacts(A_IN_BIZ_A)).toEqual([]);
    expect(await contactsDb.getCachedContacts(B_IN_BIZ_A)).toEqual([]);
  });

  it("purgeContactsCache removes the keyed store and the legacy store", async () => {
    await contactsDb.cacheContacts([contact("c1", "Alice")], A_IN_BIZ_A);
    fakeIdb.seedLegacyStore([{ ...contact("c9", "Mallory") }]);

    await api.purgeContactsCache();

    expect([...fakeIdb.databases.keys()]).toEqual([]);
    expect(await contactsDb.getCachedContacts(A_IN_BIZ_A)).toEqual([]);
  });
});
