/**
 * RR-RETENTION-EXPIRED-EXPORTS (V1-72, D-261): expired or consumed contact
 * export bundles are deleted from object storage by the privacy scheduler, not
 * kept forever.
 *
 * Premise at main 9a7b5011: a contact export writes a JSON and a ZIP bundle
 * holding the person's full data to object storage with a 7-day link and one
 * download; after expiry or consumption resolveDownload refuses, but nothing
 * deletes the objects or the row. The only bundle deletes were the forget
 * purge's. So every export ever made stayed in the bucket.
 *
 * Contract proven here against a REAL database (PrismaService over
 * DATABASE_URL, the real ContactAuditService and ContactPrivacyService; object
 * storage stood in by a recording `send` behind the service's own s3() hook,
 * as the purge suite does; no real provider traffic):
 *   - a job whose link expired more than 24h ago, or whose downloads are used
 *     up, gets exactly one DeleteObject per stored key in one purge cycle; its
 *     row still exists with every field unchanged; one export_bundle_deleted
 *     audit entry names the job, its contact and its keys;
 *   - an unexpired, unconsumed job of the same business, a job expired less
 *     than 24h ago, and another business's job are untouched;
 *   - a DeleteObject failure keeps the row, writes no export_bundle_deleted
 *     entry and one forget_storage_cleanup_failed entry naming the job and the
 *     failed keys; the next cycle retries it;
 *   - a second cycle sends nothing (the sweep is idempotent through the audit
 *     entry, no schema change);
 *   - with DISABLE_FORGET_SCHEDULER=true no interval starts.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v72x_` prefix and is
 * hard-deleted by raw SQL (sqlLikePrefix) in beforeAll and afterAll. Cases
 * tagged RED-BEFORE fail at 9a7b5011 (no DeleteObject is ever sent).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { ContactAuditService } from '../src/modules/crm/privacy/contact-audit.service';
import { ContactPrivacyService } from '../src/modules/crm/privacy/contact-privacy.service';

const P = 'v72x_';
const DAY = 86_400_000;
const ID = {
  owner: `${P}owner`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  cExpired: `${P}cExpired`,
  cConsumed: `${P}cConsumed`,
  cFresh: `${P}cFresh`,
  cRecent: `${P}cRecent`,
  cFail: `${P}cFail`,
  cOther: `${P}cOther`,
  jExpired: `${P}jExpired`,
  jConsumed: `${P}jConsumed`,
  jFresh: `${P}jFresh`,
  jRecent: `${P}jRecent`,
  jFail: `${P}jFail`,
  jOther: `${P}jOther`,
};
const keysOf = (job: string) => [`private/contact-exports/${P}/${job}/1.json`, `private/contact-exports/${P}/${job}/1.zip`];

let db: any;
let app: { init: () => Promise<unknown>; close: () => Promise<unknown> } | undefined;
let prisma: PrismaService;
let audit: ContactAuditService;
let privacy: ContactPrivacyService;

async function cleanup() {
  await db.$executeRawUnsafe(`DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM contact_export_jobs WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
}

/** A recording stand-in for object storage: every DeleteObject key, in order; `refuse` makes those keys fail. */
function storageStub(refuse: Set<string> = new Set()) {
  const deleted: string[] = [];
  const send = vi.fn(async (cmd: { constructor: { name: string }; input: { Key?: string } }) => {
    const key = cmd.input.Key ?? '';
    if (cmd.constructor.name !== 'DeleteObjectCommand') throw new Error(`v72x: unexpected ${cmd.constructor.name}`);
    if (refuse.has(key)) throw new Error('v72x: AccessDenied');
    deleted.push(key);
    return {};
  });
  const spy = vi.spyOn(privacy as any, 's3').mockReturnValue({ client: { send }, bucket: 'v72x-bucket' });
  return { deleted, send, restore: () => spy.mockRestore() };
}

async function cycleWith(refuse?: Set<string>) {
  const storage = storageStub(refuse);
  try {
    await privacy.runPurgeCycle();
  } finally {
    storage.restore();
  }
  return storage.deleted;
}

const job = (id: string, businessId: string, contactId: string, extra: Record<string, unknown>) => ({
  id,
  businessId,
  contactId,
  token: `${P}tok_${id}`,
  jsonKey: keysOf(id)[0],
  zipKey: keysOf(id)[1],
  ...extra,
});

async function deletedEntries(jobId: string) {
  return db.contactAuditEntry.findMany({ where: { action: 'export_bundle_deleted', entityType: 'contact_export_job', entityId: jobId } });
}
async function failedEntries(jobId: string) {
  return db.contactAuditEntry.findMany({ where: { action: 'forget_storage_cleanup_failed', entityId: jobId } });
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { PrismaService: PrismaServiceClass } = await import('../src/core/prisma/prisma.service');
  const moduleRef = await Test.createTestingModule({ providers: [PrismaServiceClass] }).compile();
  app = moduleRef;
  await moduleRef.init();
  prisma = moduleRef.get(PrismaServiceClass);
  audit = new ContactAuditService(prisma);
  privacy = new ContactPrivacyService(prisma, audit);

  await cleanup();
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V72X Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V72X Biz B', ownerId: ID.owner } });
  for (const [c, biz] of [
    [ID.cExpired, ID.bizA], [ID.cConsumed, ID.bizA], [ID.cFresh, ID.bizA], [ID.cRecent, ID.bizA], [ID.cFail, ID.bizA], [ID.cOther, ID.bizB],
  ] as const) {
    await db.contact.create({ data: { id: c, businessId: biz, firstName: 'V72X', lastName: c.slice(P.length) } });
  }
  const now = Date.now();
  await db.contactExportJob.createMany({
    data: [
      // expired two days ago, never downloaded
      job(ID.jExpired, ID.bizA, ID.cExpired, { expiresAt: new Date(now - 2 * DAY) }),
      // link still valid, but its one download is used up
      job(ID.jConsumed, ID.bizA, ID.cConsumed, { expiresAt: new Date(now + 5 * DAY), downloadCount: 1, maxDownloads: 1, consumedAt: new Date(now - 3600_000), lastDownloadedAt: new Date(now - 3600_000) }),
      // live: valid for five more days, not downloaded
      job(ID.jFresh, ID.bizA, ID.cFresh, { expiresAt: new Date(now + 5 * DAY) }),
      // expired one hour ago: inside the 24h grace, not yet swept
      job(ID.jRecent, ID.bizA, ID.cRecent, { expiresAt: new Date(now - 3600_000) }),
      // expired, and the storage will refuse its keys on the first cycle
      job(ID.jFail, ID.bizA, ID.cFail, { expiresAt: new Date(now - 3 * DAY) }),
      // another business's live job
      job(ID.jOther, ID.bizB, ID.cOther, { expiresAt: new Date(now + 5 * DAY) }),
    ],
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  await app?.close();
});

describe('RR-RETENTION-EXPIRED-EXPORTS: the purge cycle sweeps expired and consumed export bundles', () => {
  let before: Record<string, any>;
  let firstCycle: string[];

  it('RED-BEFORE: one cycle deletes both objects of the expired job and of the consumed job, and nothing else; the storage failure is recorded and retried', async () => {
    before = Object.fromEntries((await db.contactExportJob.findMany({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).map((j: any) => [j.id, j]));
    firstCycle = await cycleWith(new Set(keysOf(ID.jFail)));

    // RED at 9a7b5011: nothing is ever sent to storage.
    expect([...firstCycle].sort()).toEqual([...keysOf(ID.jExpired), ...keysOf(ID.jConsumed)].sort());

    // the rows are kept, every field unchanged
    const after = Object.fromEntries((await db.contactExportJob.findMany({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).map((j: any) => [j.id, j]));
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const id of Object.keys(before)) expect(after[id], id).toEqual(before[id]);

    // one export_bundle_deleted entry per swept job, naming job, contact and keys
    for (const [jobId, contactId] of [[ID.jExpired, ID.cExpired], [ID.jConsumed, ID.cConsumed]]) {
      const entries = await deletedEntries(jobId);
      expect(entries, jobId).toHaveLength(1);
      expect(entries[0]).toMatchObject({ businessId: ID.bizA, contactId, entityType: 'contact_export_job', entityId: jobId });
      expect(entries[0].contactHash).toBe(audit.hashContact(ID.bizA, contactId));
      expect(entries[0].after).toMatchObject({ jsonKey: keysOf(jobId)[0], zipKey: keysOf(jobId)[1] });
    }
    // the untouched jobs: no entry of either kind
    for (const jobId of [ID.jFresh, ID.jRecent, ID.jOther]) {
      expect(await deletedEntries(jobId), jobId).toHaveLength(0);
      expect(await failedEntries(jobId), jobId).toHaveLength(0);
    }
  });

  it('the job whose objects the storage refused is kept, recorded as a cleanup failure with its keys, and swept by the next cycle', async () => {
    expect(await deletedEntries(ID.jFail)).toHaveLength(0);
    const failed = await failedEntries(ID.jFail);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ businessId: ID.bizA, contactId: ID.cFail, entityId: ID.jFail });
    expect([...failed[0].after.failedKeys].sort()).toEqual([...keysOf(ID.jFail)].sort());

    const secondCycle = await cycleWith();
    expect([...secondCycle].sort()).toEqual([...keysOf(ID.jFail)].sort());
    expect(await deletedEntries(ID.jFail)).toHaveLength(1);
    expect(await db.contactExportJob.findUnique({ where: { id: ID.jFail } })).toEqual(before[ID.jFail]);
  });

  it('a further cycle sends nothing: a swept job is never swept again, and the live jobs stay', async () => {
    const thirdCycle = await cycleWith();
    expect(thirdCycle).toEqual([]);
    expect(await deletedEntries(ID.jExpired)).toHaveLength(1);
    expect(await deletedEntries(ID.jConsumed)).toHaveLength(1);
    expect(await db.contactExportJob.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(6);
  });

  it('negative control: with DISABLE_FORGET_SCHEDULER=true no interval starts (and NODE_ENV=test disables schedulers anyway)', () => {
    const prev = process.env.DISABLE_FORGET_SCHEDULER;
    process.env.DISABLE_FORGET_SCHEDULER = 'true';
    try {
      const svc = new ContactPrivacyService(prisma, audit);
      svc.onModuleInit();
      expect((svc as any).intervalRef).toBeNull();
      svc.onModuleDestroy();
    } finally {
      if (prev === undefined) delete process.env.DISABLE_FORGET_SCHEDULER;
      else process.env.DISABLE_FORGET_SCHEDULER = prev;
    }
  });
});
