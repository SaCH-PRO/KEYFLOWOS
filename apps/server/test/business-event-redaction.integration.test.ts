/**
 * RR-BUSINESS-EVENT-REDACT (V1-72, D-261): BusinessEventService.emit / emitBatch
 * and ContactAuditService redact secret-named fields at the write, as the HTTP
 * interceptor already does for its own snapshots.
 *
 * Premise at main 9a7b5011: the interceptor runs its snapshots through
 * safeRedactedSnapshot (core/security/redaction.ts), but BusinessEventService
 * stores before, after and metadata exactly as given, emit's failure log prints
 * the input, the EventEmitter2 fan-out carries the raw copy, and
 * ContactAuditService.writeOrThrow stores the diffed before/after unredacted. A
 * caller passing a secret-named key (apiKey, accessToken, password, ...) put
 * the secret in business_events, in the logs and on the event bus.
 *
 * Contract proven here, against a REAL database (PrismaService over
 * DATABASE_URL; a real EventEmitter2; the Nest Logger tapped for the failure
 * case):
 *   - emit and emitBatch store '***REDACTED***' for every secret-named key in
 *     before, after and metadata (any depth, any casing) and leave every other
 *     value as given;
 *   - the 'business_event.created' listener receives the same redacted copy;
 *   - a create that fails logs the event's ids only, never its metadata or
 *     snapshots;
 *   - a ContactAuditService write whose before/after carries a secret-named key
 *     stores the marker, and names the field as changed;
 *   - negative control: an event with no secret-named key is stored exactly as
 *     today (deep-equal before, after and metadata), and an event with no
 *     snapshots stores none.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v72v_` prefix and is
 * hard-deleted by raw SQL (sqlLikePrefix) in beforeAll and afterAll. Cases
 * tagged RED-BEFORE fail at 9a7b5011.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sqlLikePrefix } from './helpers/sql-like.js';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { BusinessEventService } from '../src/modules/business-events/business-event.service';
import { ContactAuditService } from '../src/modules/crm/privacy/contact-audit.service';
import type { CreateBusinessEventInput } from '../src/modules/business-events/dto/create-business-event.dto';

const P = 'v72v_';
const REDACTED = '***REDACTED***';
const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  contact: `${P}contact`,
};

let db: any;
let app: { init: () => Promise<unknown>; close: () => Promise<unknown> } | undefined;
let prisma: PrismaService;
let events: EventEmitter2;
let service: BusinessEventService;
let audit: ContactAuditService;

async function cleanup() {
  await db.$executeRawUnsafe(`DELETE FROM contact_audit_entries WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM business_events WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
}

const base = (suffix: string, extra: Partial<CreateBusinessEventInput> = {}): CreateBusinessEventInput => ({
  businessId: ID.biz,
  eventType: `${P}event.${suffix}`,
  subjectType: 'integration',
  subjectId: `${P}subject_${suffix}`,
  actorType: 'system',
  actorId: `${P}actor`,
  action: 'update',
  source: 'api',
  ...extra,
});

async function storedEvent(suffix: string) {
  const rows = await db.businessEvent.findMany({ where: { businessId: ID.biz, eventType: `${P}event.${suffix}` } });
  expect(rows).toHaveLength(1);
  return rows[0];
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

  await cleanup();
  await db.user.create({ data: { id: ID.owner, email: `${P}owner@test.local`, role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: 'V72V Biz', ownerId: ID.owner } });
  await db.contact.create({ data: { id: ID.contact, businessId: ID.biz, firstName: 'V72V', lastName: 'Person' } });

  events = new EventEmitter2();
  service = new BusinessEventService(prisma, events);
  audit = new ContactAuditService(prisma);
}, 120_000);

afterAll(async () => {
  if (db) await cleanup();
  await app?.close();
});

describe('RR-BUSINESS-EVENT-REDACT: BusinessEventService redacts secret-named fields at the write', () => {
  it('RED-BEFORE: emit stores the marker for apiKey (metadata) and accessToken (after) and keeps route and name', async () => {
    await service.emit(base('emit', {
      metadata: { apiKey: 'sk-test-emit', route: '/x' },
      after: { accessToken: 'tok-emit', name: 'n' },
    }));
    const row = await storedEvent('emit');
    expect(row.metadata).toEqual({ apiKey: REDACTED, route: '/x' });
    expect(row.after).toEqual({ accessToken: REDACTED, name: 'n' });
    expect(JSON.stringify(row)).not.toMatch(/sk-test-emit|tok-emit/);
  });

  it('RED-BEFORE: emitBatch redacts every event of the batch, before included, at any depth and casing', async () => {
    await service.emitBatch([
      base('batch1', { before: { password: 'pw-1', title: 'old' }, after: { password: 'pw-2', title: 'new' } }),
      base('batch2', { metadata: { nested: { Gmail_Refresh_Token: 'rt-2', count: 3 }, route: '/y' } }),
    ]);
    const first = await storedEvent('batch1');
    expect(first.before).toEqual({ password: REDACTED, title: 'old' });
    expect(first.after).toEqual({ password: REDACTED, title: 'new' });
    const second = await storedEvent('batch2');
    expect(second.metadata).toEqual({ nested: { Gmail_Refresh_Token: REDACTED, count: 3 }, route: '/y' });
    expect(JSON.stringify([first, second])).not.toMatch(/pw-1|pw-2|rt-2/);
  });

  it("RED-BEFORE: the 'business_event.created' listener receives the redacted copy", async () => {
    const seen: unknown[] = [];
    events.on('business_event.created', (payload: unknown) => seen.push(payload));
    await service.emit(base('listener', { metadata: { clientSecret: 'cs-listen', route: '/z' } }));
    expect(seen).toHaveLength(1);
    expect((seen[0] as CreateBusinessEventInput).metadata).toEqual({ clientSecret: REDACTED, route: '/z' });
    expect(JSON.stringify(seen)).not.toMatch(/cs-listen/);
  });

  it('RED-BEFORE: a create that fails logs the ids of the event, never its metadata or snapshots', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      // The business does not exist: the foreign key refuses the row and emit swallows the failure.
      await service.emit(base('fail', {
        businessId: `${P}missing_business`,
        metadata: { apiKey: 'sk-test-fail', route: '/f' },
        after: { accessToken: 'tok-fail', name: 'n' },
      }));
      expect(errorSpy).toHaveBeenCalled();
      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toMatch(/sk-test-fail|tok-fail|apiKey|accessToken|"\/f"/);
      expect(logged).toMatch(new RegExp(`${P}missing_business`));
      expect(logged).toMatch(new RegExp(`${P}event\\.fail`));
    } finally {
      errorSpy.mockRestore();
    }
    const rows = await db.businessEvent.findMany({ where: { businessId: `${P}missing_business` } });
    expect(rows).toHaveLength(0);
  });

  it('negative control: an event with no secret-named key is stored exactly as given, and one without snapshots stores none', async () => {
    const before = { title: 'old', tags: ['a', 'b'], amount: 12.5, nested: { note: 'keep: me', flag: false } };
    const after = { title: 'new', tags: ['a'], amount: 13, nested: { note: 'still', flag: true } };
    const metadata = { route: '/crm/x', httpMethod: 'PATCH', ip: '10.0.0.1' };
    await service.emit(base('plain', { before, after, metadata }));
    const row = await storedEvent('plain');
    expect(row.before).toEqual(before);
    expect(row.after).toEqual(after);
    expect(row.metadata).toEqual(metadata);

    await service.emit(base('bare'));
    const bare = await storedEvent('bare');
    expect(bare.before).toBeNull();
    expect(bare.after).toBeNull();
    expect(bare.metadata).toBeNull();
  });
});

describe('RR-BUSINESS-EVENT-REDACT: review round 1, the event input is not rewritten and an unserialisable snapshot fails closed', () => {
  it("emit leaves the caller's input object as it was; the redacted copy is what is stored and fanned out", async () => {
    const metadata = { apiKey: 'sk-caller-keeps', route: '/k' };
    const input = base('callercopy', { metadata });
    await service.emit(input);
    expect(input.metadata).toBe(metadata);
    expect(metadata.apiKey).toBe('sk-caller-keeps');
    const row = await storedEvent('callercopy');
    expect(row.metadata).toEqual({ apiKey: REDACTED, route: '/k' });
  });

  it('a snapshot JSON cannot serialise (a BigInt) is dropped and the event is still written without it (recorded behaviour; on main the row was lost)', async () => {
    await service.emit(base('bigint', { after: { n: BigInt(1) } as unknown as Record<string, unknown>, metadata: { route: '/b' } }));
    const row = await storedEvent('bigint');
    expect(row.after).toBeNull();
    expect(row.metadata).toEqual({ route: '/b' });
  });
});

describe('RR-BUSINESS-EVENT-REDACT: ContactAuditService redacts the diffed before/after', () => {
  it('RED-BEFORE: a write whose before/after carries a secret-named key stores the marker and names the field as changed', async () => {
    await audit.writeOrThrow({
      businessId: ID.biz,
      contactId: ID.contact,
      action: 'updated',
      before: { firstName: 'V72V', gmailAccessToken: 'gat-old' },
      after: { firstName: 'V72V', gmailAccessToken: 'gat-new', email: `${P}new@test.local` },
    });
    const rows = await db.contactAuditEntry.findMany({ where: { businessId: ID.biz, contactId: ID.contact, action: 'updated' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].changedFields.sort()).toEqual(['email', 'gmailAccessToken']);
    expect(rows[0].before).toEqual({ gmailAccessToken: REDACTED });
    expect(rows[0].after).toEqual({ gmailAccessToken: REDACTED, email: `${P}new@test.local` });
    expect(JSON.stringify(rows)).not.toMatch(/gat-old|gat-new/);
  });

  it("review round 1: the caller's own objects are not rewritten: a nested secret in `after` is still in clear on the row the caller returns, and redacted only in the stored entry", async () => {
    const updated = { firstName: 'V72V', custom: { apiToken: 'live-token-stays', colour: 'blue' } };
    const existing = { firstName: 'V72V', custom: { apiToken: 'old-token-stays', colour: 'red' } };
    await audit.writeOrThrow({ businessId: ID.biz, contactId: ID.contact, action: 'restored', before: existing, after: updated });
    expect(updated.custom.apiToken).toBe('live-token-stays');
    expect(existing.custom.apiToken).toBe('old-token-stays');
    const rows = await db.contactAuditEntry.findMany({ where: { businessId: ID.biz, contactId: ID.contact, action: 'restored' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toEqual({ custom: { apiToken: REDACTED, colour: 'blue' } });
    expect(rows[0].before).toEqual({ custom: { apiToken: REDACTED, colour: 'red' } });
  });

  it('negative control: a write with no secret-named key stores its diff as today', async () => {
    await audit.writeOrThrow({
      businessId: ID.biz,
      contactId: ID.contact,
      action: 'created',
      after: { firstName: 'V72V', lastName: 'Person' },
    });
    const rows = await db.contactAuditEntry.findMany({ where: { businessId: ID.biz, contactId: ID.contact, action: 'created' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({});
    expect(rows[0].after).toEqual({ firstName: 'V72V', lastName: 'Person' });
  });
});
