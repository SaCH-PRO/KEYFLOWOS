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
  createdAt?: string | null;
  updatedAt?: string | null;
  addressLine1?: string | null;
  whatsappNumber?: string | null;
  department?: string | null;
  industry?: string | null;
  lifecycleStage?: string | null;
  sourceDetail?: string | null;
  notesInternal?: string | null;
}

class ContactsDatabase extends Dexie {
  contacts!: Table<LocalContact, string>;

  constructor() {
    super("keyflowos_contacts");
    this.version(1).stores({
      contacts: "id, firstName, lastName, email, phone, status, companyName, city, country, createdAt",
    });
  }
}

let dbInstance: ContactsDatabase | null = null;

function getDb(): ContactsDatabase {
  if (!dbInstance) {
    dbInstance = new ContactsDatabase();
  }
  return dbInstance;
}

export async function cacheContacts(contacts: LocalContact[]): Promise<void> {
  const db = getDb();
  await db.contacts.clear();
  await db.contacts.bulkPut(contacts);
}

export async function getCachedContacts(): Promise<LocalContact[]> {
  const db = getDb();
  return db.contacts.toArray();
}

export async function getCachedCount(): Promise<number> {
  const db = getDb();
  return db.contacts.count();
}

export async function getLastSyncTime(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("kf_contacts_last_sync");
}

export async function setLastSyncTime(): Promise<void> {
  if (typeof window === "undefined") return;
  localStorage.setItem("kf_contacts_last_sync", new Date().toISOString());
}
