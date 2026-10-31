import Dexie, { type Table } from "dexie";

export interface LocalContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  status: string;
  source?: string | null;
  tags: string[];
  companyName?: string | null;
  jobTitle?: string | null;
  city?: string | null;
  country?: string | null;
  preferredChannel?: string | null;
  bestChannel?: string | null;
  bestChannelConfidence?: number | null;
  bestTimeWindowJson?: {
    dayOfWeek: number;
    hourStart: number;
    hourEnd: number;
    tz: string;
    label: string;
    sampleCount: number;
  } | null;
  bestSignalUpdatedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  whatsappNumber?: string | null;
  department?: string | null;
  industry?: string | null;
  lifecycleStage?: string | null;
  sourceDetail?: string | null;
  notesInternal?: string | null;
  secondaryEmail?: string | null;
  secondaryPhone?: string | null;
  displayName?: string | null;
  segment?: string | null;
  language?: string | null;
  timezone?: string | null;
  state?: string | null;
  postalCode?: string | null;
  marketingOptIn?: boolean | null;
  doNotContact?: boolean | null;
  ageGroup?: string | null;
  relationshipType?: string | null;
  pipelineStage?: string | null;
  relationshipHealth?: string | null;
  lastContactedAt?: string | null;
  nextActionAt?: string | null;
  nextActionType?: string | null;
  priority?: string | null;
  favorite?: boolean | null;
  archivedAt?: string | null;

  custom?: Record<string, unknown> | null;
}

/**
 * The device-side contacts cache behind the contacts table (offline fallback).
 *
 * It holds customer rows at rest, so it is partitioned by WHO may read them:
 * every row is stored under the (user, business) pair it was fetched for, is
 * only ever read back for that same pair, and the whole store is deleted at
 * sign-out (`purgeContactsCache`, called from workspace.ts
 * clearStoredBusinessId). With no known user or business nothing is cached or
 * returned. CONTACTS-v1 section 5; review ST-2.
 */

/**
 * The pre-R0-15b store: one table shared by every user and business on the
 * device, never purged. It is never read; it is deleted the first time the
 * cache is opened and again at sign-out.
 */
const LEGACY_CONTACTS_DB_NAME = "keyflowos_contacts";
const CONTACTS_DB_NAME = "keyflowos_contacts_by_owner";
const LAST_SYNC_KEY_PREFIX = "kf_contacts_last_sync";

export interface ContactsCacheOwner {
  userId: string | null | undefined;
  businessId: string | null | undefined;
}

/**
 * The partition a cached row belongs to: the signed-in user AND the business
 * it was read from. Null (no caching) unless both are known. JSON-encoded so an
 * id containing the separator cannot make two owners collide.
 */
export function contactsCacheKey(owner: Partial<ContactsCacheOwner> | null | undefined): string | null {
  const userId = owner?.userId?.trim();
  const businessId = owner?.businessId?.trim();
  if (!userId || !businessId) return null;
  return JSON.stringify([userId, businessId]);
}

type CachedContactRow = LocalContact & { cacheKey: string };

class ContactsDatabase extends Dexie {
  contacts!: Table<CachedContactRow, [string, string]>;

  constructor() {
    super(CONTACTS_DB_NAME);
    this.version(1).stores({
      contacts: "[cacheKey+id], cacheKey",
    });
  }
}

let dbInstance: ContactsDatabase | null = null;
let legacyDropped: Promise<void> | null = null;

async function deleteDatabase(name: string): Promise<void> {
  try {
    await Dexie.delete(name);
  } catch {
    // Best effort: no IndexedDB (SSR, private mode) means nothing is stored.
  }
}

async function getDb(): Promise<ContactsDatabase> {
  if (!dbInstance) {
    dbInstance = new ContactsDatabase();
    legacyDropped = deleteDatabase(LEGACY_CONTACTS_DB_NAME);
  }
  const db = dbInstance;
  await legacyDropped;
  return db;
}

function stripCacheKey(row: CachedContactRow): LocalContact {
  const { cacheKey: _cacheKey, ...contact } = row;
  return contact;
}

/** Replaces the rows cached for this owner; other owners' rows are untouched. */
export async function cacheContacts(contacts: LocalContact[], owner: ContactsCacheOwner): Promise<void> {
  const cacheKey = contactsCacheKey(owner);
  if (!cacheKey) return;
  const db = await getDb();
  await db.contacts.where("cacheKey").equals(cacheKey).delete();
  await db.contacts.bulkPut(contacts.map((contact) => ({ ...contact, cacheKey })));
}

export async function getCachedContacts(owner: ContactsCacheOwner): Promise<LocalContact[]> {
  const cacheKey = contactsCacheKey(owner);
  if (!cacheKey) return [];
  const db = await getDb();
  const rows = await db.contacts.where("cacheKey").equals(cacheKey).toArray();
  return rows.map(stripCacheKey);
}

export async function getCachedCount(owner: ContactsCacheOwner): Promise<number> {
  const cacheKey = contactsCacheKey(owner);
  if (!cacheKey) return 0;
  const db = await getDb();
  return db.contacts.where("cacheKey").equals(cacheKey).count();
}

/** Drops this owner's rows, e.g. once the server has refused them the read. */
export async function clearCachedContacts(owner: ContactsCacheOwner): Promise<void> {
  const cacheKey = contactsCacheKey(owner);
  if (!cacheKey) return;
  const db = await getDb();
  await db.contacts.where("cacheKey").equals(cacheKey).delete();
}

/**
 * Sign-out: deletes the whole cache (every owner), the legacy store and every
 * last-sync stamp. Never throws.
 */
export async function purgeContactsCache(): Promise<void> {
  const db = dbInstance;
  dbInstance = null;
  legacyDropped = null;
  try {
    db?.close();
  } catch {
    // Already closed.
  }
  await deleteDatabase(CONTACTS_DB_NAME);
  await deleteDatabase(LEGACY_CONTACTS_DB_NAME);
  if (typeof window === "undefined") return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(LAST_SYNC_KEY_PREFIX)) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

function lastSyncStorageKey(owner: ContactsCacheOwner): string | null {
  const cacheKey = contactsCacheKey(owner);
  return cacheKey ? `${LAST_SYNC_KEY_PREFIX}:${cacheKey}` : null;
}

export async function getLastSyncTime(owner: ContactsCacheOwner): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const key = lastSyncStorageKey(owner);
  return key ? localStorage.getItem(key) : null;
}

export async function setLastSyncTime(owner: ContactsCacheOwner): Promise<void> {
  if (typeof window === "undefined") return;
  const key = lastSyncStorageKey(owner);
  if (key) localStorage.setItem(key, new Date().toISOString());
}
