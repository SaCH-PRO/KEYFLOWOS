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
 * Review round 1: a consumed job is swept only once its last download is 15
 * minutes old (resolveDownload signs a 5-minute URL before it marks the job
 * consumed); a job whose objects storage refuses gets ONE
 * forget_storage_cleanup_failed entry, later failures only warn, and jobs with
 * such an entry are ordered after the others so they never starve the batch;
 * when storage is not configured at all the sweep skips the cycle without
 * writing anything. The fixtures are due only for the instant of this suite's
 * own cycles (makeDue / makeLive, as the purge suites do): another suite's
 * global cycle running beside this one must not find them.
 *
 * runPurgeCycle is global: it purges every due forget request and repairs
 * every legacy purge in the shared database, and the purge suites make their
 * requests due for the instant of their own cycle. So this suite's service
 * instance has purgeOne and repairLegacyPurges stubbed to no-ops: its cycles
 * read the due list (harmless) and run the export sweep, and never purge or
 * repair another suite's rows while running beside it.
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
  cJustConsumed: `${P}cJustConsumed`,
  cOther: `${P}cOther`,
  jExpired: `${P}jExpired`,
  jConsumed: `${P}jConsumed`,
  jFresh: `${P}jFresh`,
  jRecent: `${P}jRecent`,
  jFail: `${P}jFail`,
  jJustConsumed: `${P}jJustConsumed`,
  jOther: `${P}jOther`,
};
const ALL_JOBS = [ID.jExpired, ID.jConsumed, ID.jFresh, ID.jRecent, ID.jFail, ID.jJustConsumed, ID.jOther];
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

/** The fixtures take their due shapes only for the instant of a cycle of this suite. */
async function makeDue() {
  const set = (id: string, sql: string) => db.$executeRawUnsafe(`UPDATE contact_export_jobs SET ${sql} WHERE id = $1`, id);
  await set(ID.jExpired, `expires_at = now() - interval '2 days'`);
  await set(ID.jFail, `expires_at = now() - interval '3 days'`);
  await set(ID.jRecent, `expires_at = now() - interval '1 hour'`);
  await set(ID.jConsumed, `download_count = 1, consumed_at = now() - interval '1 hour', last_downloaded_at = now() - interval '1 hour'`);
  await set(ID.jJustConsumed, `download_count = 1, consumed_at = now() - interval '2 minutes', last_downloaded_at = now() - interval '2 minutes'`);
}
async function makeLive() {
  await db.$executeRawUnsafe(
    `UPDATE contact_export_jobs SET expires_at = now() + interval '5 days', download_count = 0, consumed_at = NULL, last_downloaded_at = NULL WHERE business_id LIKE ${sqlLikePrefix(P)}`,
  );
}
async function snapshot() {
  return Object.fromEntries((await db.contactExportJob.findMany({ where: { id: { in: ALL_JOBS } } })).map((j: any) => [j.id, j]));
}

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
  // This instance never purges or repairs another suite's rows (see the header).
  vi.spyOn(privacy as any, 'purgeOne').mockResolvedValue(false);
  vi.spyOn(privacy as any, 'repairLegacyPurges').mockResolvedValue(0);

  await cleanup();
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.bizA, name: 'V72X Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V72X Biz B', ownerId: ID.owner } });
  for (const [c, biz] of [
    [ID.cExpired, ID.bizA], [ID.cConsumed, ID.bizA], [ID.cFresh, ID.bizA], [ID.cRecent, ID.bizA], [ID.cFail, ID.bizA],
    [ID.cJustConsumed, ID.bizA], [ID.cOther, ID.bizB],
  ] as const) {
    await db.contact.create({ data: { id: c, businessId: biz, firstName: 'V72X', lastName: c.slice(P.length) } });
  }
  // Seeded live; makeDue() gives each its shape for the instant of a cycle:
  // jExpired expired two days ago; jConsumed's one download used an hour ago;
  // jJustConsumed's two minutes ago (inside the 15-minute grace); jRecent
  // expired an hour ago (inside the 24h grace); jFail expired three days ago
  // and the storage refuses its keys on the first cycle; jFresh and jOther
  // (another business) stay live.
  const live = Date.now() + 5 * DAY;
  await db.contactExportJob.createMany({
    data: [
      job(ID.jExpired, ID.bizA, ID.cExpired, { expiresAt: new Date(live) }),
      job(ID.jConsumed, ID.bizA, ID.cConsumed, { expiresAt: new Date(live) }),
      job(ID.jFresh, ID.bizA, ID.cFresh, { expiresAt: new Date(live) }),
      job(ID.jRecent, ID.bizA, ID.cRecent, { expiresAt: new Date(live) }),
      job(ID.jFail, ID.bizA, ID.cFail, { expiresAt: new Date(live) }),
      job(ID.jJustConsumed, ID.bizA, ID.cJustConsumed, { expiresAt: new Date(live) }),
      job(ID.jOther, ID.bizB, ID.cOther, { expiresAt: new Date(live) }),
    ],
  });
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  await app?.close();
});

describe('RR-RETENTION-EXPIRED-EXPORTS: the purge cycle sweeps expired and consumed export bundles', () => {
  let dueBefore: Record<string, any>;

  it('control: with object storage not configured the sweep skips the cycle and writes nothing', async () => {
    await makeDue();
    try {
      const entriesBefore = await db.contactAuditEntry.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } });
      const spy = vi.spyOn(privacy as any, 's3').mockImplementation(() => { throw new Error('S3_BUCKET not configured for contact export storage'); });
      const warn = vi.spyOn((privacy as any).logger, 'warn');
      try {
        await privacy.runPurgeCycle();
      } finally {
        spy.mockRestore();
      }
      const warned = warn.mock.calls.map((c: any[]) => String(c[0]));
      warn.mockRestore();
      expect(await db.contactAuditEntry.count({ where: { businessId: { in: [ID.bizA, ID.bizB] } } })).toBe(entriesBefore);
      expect(warned.filter((w) => w.includes('export') && w.includes('not configured'))).toHaveLength(1);
    } finally {
      await makeLive();
    }
  });

  it('RED-BEFORE: one cycle deletes both objects of the expired job and of the consumed job, and nothing else; the storage failure is recorded', async () => {
    await makeDue();
    try {
      dueBefore = await snapshot();
      const firstCycle = await cycleWith(new Set(keysOf(ID.jFail)));

      // RED at 9a7b5011: nothing is ever sent to storage.
      expect([...firstCycle].sort()).toEqual([...keysOf(ID.jExpired), ...keysOf(ID.jConsumed)].sort());

      // the rows are kept, every field unchanged
      const after = await snapshot();
      expect(Object.keys(after).sort()).toEqual(Object.keys(dueBefore).sort());
      for (const id of ALL_JOBS) expect(after[id], id).toEqual(dueBefore[id]);

      // one export_bundle_deleted entry per swept job, naming job, contact and keys
      for (const [jobId, contactId] of [[ID.jExpired, ID.cExpired], [ID.jConsumed, ID.cConsumed]]) {
        const entries = await deletedEntries(jobId);
        expect(entries, jobId).toHaveLength(1);
        expect(entries[0]).toMatchObject({ businessId: ID.bizA, contactId, entityType: 'contact_export_job', entityId: jobId });
        expect(entries[0].contactHash).toBe(audit.hashContact(ID.bizA, contactId));
        expect(entries[0].after).toMatchObject({ jsonKey: keysOf(jobId)[0], zipKey: keysOf(jobId)[1] });
      }
      // the untouched jobs: no entry of either kind (live, inside the 24h grace, inside the 15-minute consumed grace, another business)
      for (const jobId of [ID.jFresh, ID.jRecent, ID.jJustConsumed, ID.jOther]) {
        expect(await deletedEntries(jobId), jobId).toHaveLength(0);
        expect(await failedEntries(jobId), jobId).toHaveLength(0);
      }
      // the refused job: kept, one failure entry with its keys, no deleted entry
      expect(await deletedEntries(ID.jFail)).toHaveLength(0);
      const failed = await failedEntries(ID.jFail);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ businessId: ID.bizA, contactId: ID.cFail, entityType: 'contact_export_job', entityId: ID.jFail });
      expect([...failed[0].after.failedKeys].sort()).toEqual([...keysOf(ID.jFail)].sort());
    } finally {
      await makeLive();
    }
  });

  it('a job the storage keeps refusing is retried every cycle but recorded once; the cycle that succeeds sweeps it and records it', async () => {
    await makeDue();
    try {
      // makeDue stamps expires_at from the clock, so the row is compared with its shape of this instant
      const dueNow = await snapshot();
      const secondCycle = await cycleWith(new Set(keysOf(ID.jFail)));
      expect(secondCycle).toEqual([]);
      expect(await failedEntries(ID.jFail)).toHaveLength(1);
      expect(await deletedEntries(ID.jFail)).toHaveLength(0);

      const thirdCycle = await cycleWith();
      expect([...thirdCycle].sort()).toEqual([...keysOf(ID.jFail)].sort());
      expect(await deletedEntries(ID.jFail)).toHaveLength(1);
      expect(await failedEntries(ID.jFail)).toHaveLength(1);
      expect(await db.contactExportJob.findUnique({ where: { id: ID.jFail } })).toEqual(dueNow[ID.jFail]);
    } finally {
      await makeLive();
    }
  });

  it('a further cycle sends nothing: a swept job is never swept again, and every row stays', async () => {
    await makeDue();
    try {
      expect(await cycleWith()).toEqual([]);
      expect(await deletedEntries(ID.jExpired)).toHaveLength(1);
      expect(await deletedEntries(ID.jConsumed)).toHaveLength(1);
      expect(await db.contactExportJob.count({ where: { id: { in: ALL_JOBS } } })).toBe(ALL_JOBS.length);
    } finally {
      await makeLive();
    }
  });

  it('negative control: with the schedulers opted in for test, DISABLE_FORGET_SCHEDULER=true starts no interval, and without it one starts (and is cleared)', () => {
    const prev = { opt: process.env.ENABLE_SCHEDULERS_IN_TEST, flag: process.env.DISABLE_FORGET_SCHEDULER };
    process.env.ENABLE_SCHEDULERS_IN_TEST = '1';
    try {
      process.env.DISABLE_FORGET_SCHEDULER = 'true';
      const off = new ContactPrivacyService(prisma, audit);
      const log = vi.spyOn((off as any).logger, 'log');
      off.onModuleInit();
      expect((off as any).intervalRef).toBeNull();
      expect(log.mock.calls.map((c: any[]) => String(c[0])).some((m) => m.includes('disabled via env'))).toBe(true);
      log.mockRestore();
      off.onModuleDestroy();

      delete process.env.DISABLE_FORGET_SCHEDULER;
      const on = new ContactPrivacyService(prisma, audit);
      on.onModuleInit();
      try {
        expect((on as any).intervalRef).not.toBeNull();
      } finally {
        on.onModuleDestroy();
      }
      expect((on as any).intervalRef).toBeNull();
    } finally {
      if (prev.opt === undefined) delete process.env.ENABLE_SCHEDULERS_IN_TEST; else process.env.ENABLE_SCHEDULERS_IN_TEST = prev.opt;
      if (prev.flag === undefined) delete process.env.DISABLE_FORGET_SCHEDULER; else process.env.DISABLE_FORGET_SCHEDULER = prev.flag;
    }
  });
});
