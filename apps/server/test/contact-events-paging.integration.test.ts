/**
 * FU-TIMELINE-EVENTS-PAGING (P66, owner rulings D-284, D-277, D-100):
 * Real-Postgres + real CrmController HTTP proof for cursor pagination on
 * `GET /crm/businesses/:businessId/contacts/:contactId/events`.
 *
 * Proves:
 *   CEP-01: Default call (no limit/cursor/paged) returns raw ContactEvent[]
 *           of newest 20 visible events (unchanged); paged calls (?limit=20,
 *           ?limit=20&cursor=..., ?paged=true) walk all 45 visible events
 *           once each in exact (createdAt DESC, id DESC) order — including
 *           identical-millisecond ties across a page boundary — then
 *           nextCursor: null, hasMore: false.
 *   CEP-02: D-100 zero-leakage — a member without revenue read paging a
 *           contact with 45 visible events + 18 interleaved & trailing money
 *           events receives zero money events, exact page sizes [20, 20, 5],
 *           and nextCursor: null on page 3 (even with 5 trailing money rows),
 *           with opaque cursors that encode only the last returned visible
 *           row's (createdAt, id) and reveal zero withheld counts or IDs.
 *           Owner receives all 63 events across [20, 20, 20, 3].
 *   CEP-03: Exact page-size boundary — 20 visible events followed by 4 older
 *           withheld money events yields hasMore: false, nextCursor: null for
 *           a non-revenue member (no empty trailing page), while owner sees
 *           hasMore: true and gets the 4 money events on page 2.
 *   CEP-04: Bounded limit (1..200) and malformed query validation — limit=200
 *           succeeds; limit=201/0/-1/1.5/abc/empty, malformed/empty/tampered
 *           cursors, and invalid paged flag return 400.
 *   CEP-05: Tenant isolation (403 cross-tenant), PRIVATE contact visibility
 *           (404 for non-owner member), and resilience when the event named
 *           by a cursor is deleted before the next page is fetched.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { db } from '@keyflow/db';
import { configureNestApp } from '../src/app-bootstrap';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { BusinessGuard } from '../src/core/auth/business.guard';
import { ModuleScopeGuard } from '../src/core/auth/module-scope.guard';
import { CrmRateLimitGuard } from '../src/modules/crm/guards/rate-limit.guard';
import { CrmController } from '../src/modules/crm/crm.controller';
import { CrmService } from '../src/modules/crm/crm.service';
import { CrmTimelineService } from '../src/modules/crm/crm-timeline.service';
import { CrmCacheService } from '../src/modules/crm/crm-cache.service';
import { sqlLikePrefix } from './helpers/sql-like.js';

const P = 'v95e_';
const HEADER = 'x-test-user-id';

const ID = {
  biz: `${P}biz`,
  bizOther: `${P}biz_other`,
  owner: `${P}owner`,
  noRevStaff: `${P}staff_norev`,
  otherOwner: `${P}other_owner`,
  c45: `${P}contact_45`,
  cMix: `${P}contact_mix`,
  cNoMoney: `${P}contact_nomoney`,
  cExact20: `${P}contact_exact20`,
  cPrivate: `${P}contact_private`,
  cDeleteCursor: `${P}contact_delcursor`,
};

async function cleanup() {
  await db.contactEvent.deleteMany({ where: { id: { startsWith: P } } });
  await db.contactNote.deleteMany({ where: { id: { startsWith: P } } });
  await db.$executeRawUnsafe(`DELETE FROM contacts WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.membership.deleteMany({ where: { id: { startsWith: P } } });
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.user.deleteMany({ where: { id: { startsWith: P } } });
}

describe('FU-TIMELINE-EVENTS-PAGING (P66, D-284, D-100)', () => {
  let app: any;
  let c45OrderedIds: string[] = [];
  let cMixVisibleOrderedIds: string[] = [];
  let cMixAllOrderedIds: string[] = [];
  let cMixMoneyIdSet: Set<string> = new Set();

  beforeAll(async () => {
    await cleanup();

    await db.user.createMany({
      data: [
        { id: ID.owner, email: `${P}owner@test.local`, name: 'v95e Owner', role: 'USER' },
        { id: ID.noRevStaff, email: `${P}norev@test.local`, name: 'v95e Staff NoRev', role: 'USER' },
        { id: ID.otherOwner, email: `${P}other@test.local`, name: 'v95e Other Owner', role: 'USER' },
      ],
    });
    await db.business.createMany({
      data: [
        { id: ID.biz, name: 'v95e Biz', slug: `${P}biz`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizOther, name: 'v95e Other Biz', slug: `${P}biz_other`, ownerId: ID.otherOwner, currency: 'TTD' },
      ],
    });
    await db.membership.createMany({
      data: [
        { id: `${P}m_owner`, businessId: ID.biz, userId: ID.owner, role: 'OWNER' },
        {
          id: `${P}m_norev`,
          businessId: ID.biz,
          userId: ID.noRevStaff,
          role: 'STAFF',
          permissionScopes: { crm: 'read', crm_view: 'all', revenue: 'none' },
        },
        { id: `${P}m_other`, businessId: ID.bizOther, userId: ID.otherOwner, role: 'OWNER' },
      ],
    });

    await db.contact.createMany({
      data: [
        { id: ID.c45, businessId: ID.biz, firstName: 'FortyFive', lastName: 'Events', visibility: 'TEAM', ownerId: ID.owner },
        { id: ID.cMix, businessId: ID.biz, firstName: 'Mixed', lastName: 'Money', visibility: 'TEAM', ownerId: ID.owner },
        { id: ID.cNoMoney, businessId: ID.biz, firstName: 'Clean', lastName: 'NoMoney', visibility: 'TEAM', ownerId: ID.owner },
        { id: ID.cExact20, businessId: ID.biz, firstName: 'Exact', lastName: 'Twenty', visibility: 'TEAM', ownerId: ID.owner },
        { id: ID.cPrivate, businessId: ID.biz, firstName: 'Secret', lastName: 'Private', visibility: 'PRIVATE', ownerId: ID.owner },
        { id: ID.cDeleteCursor, businessId: ID.biz, firstName: 'Cursor', lastName: 'Deleted', visibility: 'TEAM', ownerId: ID.owner },
      ],
    });

    // 1) Seed 45 visible events on c45, with indices 18..22 sharing the exact same createdAt millisecond
    //    so identical-timestamp tie-breaking (id DESC) spans the page 1 / page 2 boundary (index 19 -> 20).
    const baseMs = Date.parse('2026-10-01T12:00:00.000Z');
    const tieMs = baseMs - 20_000;
    const c45Rows: Array<{ id: string; businessId: string; contactId: string; type: string; data: any; createdAt: Date }> = [];
    for (let i = 0; i < 45; i++) {
      // Pad index so lex order of ids matches descending recency (044 newest .. 000 oldest)
      const rank = 44 - i;
      const id = `${P}c45_${String(rank).padStart(3, '0')}`;
      const ts = i >= 18 && i <= 22 ? new Date(tieMs) : new Date(baseMs - i * 1_000);
      c45Rows.push({
        id,
        businessId: ID.biz,
        contactId: ID.c45,
        type: 'note.created',
        data: { body: `visible event ${rank}` },
        createdAt: ts,
      });
    }
    await db.contactEvent.createMany({ data: c45Rows });
    c45OrderedIds = [...c45Rows]
      .sort((a, b) => (b.createdAt.getTime() - a.createdAt.getTime()) || (b.id > a.id ? 1 : -1))
      .map((r) => r.id);

    // 2) Seed cMix (45 visible events + 13 interleaved money events + 5 trailing older money events = 63 total)
    //    and cNoMoney (the exact same 45 visible timestamps with 0 money events).
    const cMixRows: Array<{ id: string; businessId: string; contactId: string; type: string; data: any; createdAt: Date }> = [];
    const cNoMoneyRows: Array<{ id: string; businessId: string; contactId: string; type: string; data: any; createdAt: Date }> = [];
    const moneyTemplates = [
      { type: 'invoice.paid', data: { amount: 250, currency: 'TTD', invoiceNumber: 'INV-1' } },
      { type: 'invoice.payment_recorded', data: { amount: 120, totalPaid: 120, invoiceTotal: 250 } },
      { type: 'store_order.paid', data: { total: 450, orderNumber: 'ORD-1' } },
      { type: 'deal.won', data: { title: 'Big Deal', value: 900 } },
    ];
    let moneySeq = 0;
    for (let i = 0; i < 45; i++) {
      const rank = 44 - i;
      const ts = new Date(baseMs - i * 2_000);
      cMixRows.push({
        id: `${P}cmix_vis_${String(rank).padStart(3, '0')}`,
        businessId: ID.biz,
        contactId: ID.cMix,
        type: 'note.created',
        data: { body: `mix visible ${rank}` },
        createdAt: ts,
      });
      cNoMoneyRows.push({
        id: `${P}cnom_vis_${String(rank).padStart(3, '0')}`,
        businessId: ID.biz,
        contactId: ID.cNoMoney,
        type: 'note.created',
        data: { body: `clean visible ${rank}` },
        createdAt: ts,
      });
      // Interleave 13 money events among the 45 visible events
      if (i % 3 === 1 && moneySeq < 13) {
        const tpl = moneyTemplates[moneySeq % moneyTemplates.length];
        const mId = `${P}cmix_mon_${String(17 - moneySeq).padStart(3, '0')}`;
        cMixMoneyIdSet.add(mId);
        cMixRows.push({
          id: mId,
          businessId: ID.biz,
          contactId: ID.cMix,
          type: tpl.type,
          data: tpl.data,
          createdAt: new Date(ts.getTime() - 500),
        });
        moneySeq += 1;
      }
    }
    // Add 5 trailing money events strictly older than the 45th visible event
    for (let t = 0; t < 5; t++) {
      const tpl = moneyTemplates[t % moneyTemplates.length];
      const mId = `${P}cmix_mon_tail_${String(4 - t).padStart(3, '0')}`;
      cMixMoneyIdSet.add(mId);
      cMixRows.push({
        id: mId,
        businessId: ID.biz,
        contactId: ID.cMix,
        type: tpl.type,
        data: tpl.data,
        createdAt: new Date(baseMs - (50 + t) * 2_000),
      });
    }
    await db.contactEvent.createMany({ data: [...cMixRows, ...cNoMoneyRows] });
    const sortDesc = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) =>
      (b.createdAt.getTime() - a.createdAt.getTime()) || (b.id > a.id ? 1 : -1);
    cMixAllOrderedIds = [...cMixRows].sort(sortDesc).map((r) => r.id);
    cMixVisibleOrderedIds = cMixRows.filter((r) => !cMixMoneyIdSet.has(r.id)).sort(sortDesc).map((r) => r.id);

    // 3) Seed cExact20: exactly 20 visible events + 4 older money events
    const cExactRows: Array<{ id: string; businessId: string; contactId: string; type: string; data: any; createdAt: Date }> = [];
    for (let i = 0; i < 20; i++) {
      cExactRows.push({
        id: `${P}cex_vis_${String(19 - i).padStart(3, '0')}`,
        businessId: ID.biz,
        contactId: ID.cExact20,
        type: 'call.logged',
        data: { outcome: 'answered' },
        createdAt: new Date(baseMs - i * 1_000),
      });
    }
    for (let j = 0; j < 4; j++) {
      cExactRows.push({
        id: `${P}cex_mon_${String(3 - j).padStart(3, '0')}`,
        businessId: ID.biz,
        contactId: ID.cExact20,
        type: 'invoice.paid',
        data: { amount: 100 + j },
        createdAt: new Date(baseMs - (30 + j) * 1_000),
      });
    }
    await db.contactEvent.createMany({ data: cExactRows });

    // 4) Seed cPrivate (2 events) and cDeleteCursor (5 events)
    await db.contactEvent.createMany({
      data: [
        { id: `${P}cpriv_01`, businessId: ID.biz, contactId: ID.cPrivate, type: 'note.created', data: { body: 'private' }, createdAt: new Date(baseMs) },
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `${P}cdel_${String(4 - i).padStart(3, '0')}`,
          businessId: ID.biz,
          contactId: ID.cDeleteCursor,
          type: 'note.created',
          data: { body: `del ${4 - i}` },
          createdAt: new Date(baseMs - i * 1_000),
        })),
      ],
    });

    const prismaStub = { client: db } as unknown as PrismaService;
    const timeline = new CrmTimelineService(
      prismaStub,
      { emit: () => true } as unknown as EventEmitter2,
      {} as any,
      {} as any,
      {} as any,
    );
    const crmStub = {
      listContactEvents: (params: any) => timeline.listContactEvents(params),
      listContactEventsPage: (params: any) => (timeline as any).listContactEventsPage(params),
    };

    const ref = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [
        { provide: PrismaService, useValue: prismaStub },
        AuthGuard,
        BusinessGuard,
        ModuleScopeGuard,
        CrmRateLimitGuard,
        { provide: CrmService, useValue: crmStub },
        { provide: CrmTimelineService, useValue: timeline },
        { provide: CrmCacheService, useValue: { get: async () => null, set: async () => undefined, invalidate: async () => undefined } },
        { provide: EventEmitter2, useValue: { emit: () => true } },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    app = ref.createNestApplication();
    app.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const found = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (found) req.user = { id: found.id, email: found.email, role: found.role };
      }
      next();
    });
    configureNestApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    await cleanup();
  });

  function getEvents(user: string, contactId: string, query = '', biz = ID.biz) {
    return request(app.getHttpServer())
      .get(`/crm/businesses/${biz}/contacts/${contactId}/events${query}`)
      .set(HEADER, user);
  }

  it('[CEP-01] RED-BEFORE: default call stays an array of 20 newest events; paged reads walk all 45 events once each in (createdAt DESC, id DESC) order across identical-timestamp ties, then nextCursor null', async () => {
    // Default call: unchanged raw array of newest 20 events.
    const def = await getEvents(ID.owner, ID.c45);
    expect(def.status).toBe(200);
    expect(Array.isArray(def.body)).toBe(true);
    expect(def.body).toHaveLength(20);
    expect(def.body.map((e: any) => e.id)).toEqual(c45OrderedIds.slice(0, 20));

    // Paged walkthrough: 20 + 20 + 5 = 45, then nextCursor: null, hasMore: false.
    const p1 = await getEvents(ID.owner, ID.c45, '?limit=20');
    expect(p1.status).toBe(200);
    expect(p1.body.events).toHaveLength(20);
    expect(p1.body.hasMore).toBe(true);
    expect(typeof p1.body.nextCursor).toBe('string');
    expect(p1.body.nextCursor.length).toBeGreaterThan(0);

    const p2 = await getEvents(ID.owner, ID.c45, `?limit=20&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
    expect(p2.status).toBe(200);
    expect(p2.body.events).toHaveLength(20);
    expect(p2.body.hasMore).toBe(true);
    expect(typeof p2.body.nextCursor).toBe('string');
    expect(p2.body.nextCursor).not.toBe(p1.body.nextCursor);

    const p3 = await getEvents(ID.owner, ID.c45, `?limit=20&cursor=${encodeURIComponent(p2.body.nextCursor)}`);
    expect(p3.status).toBe(200);
    expect(p3.body.events).toHaveLength(5);
    expect(p3.body.hasMore).toBe(false);
    expect(p3.body.nextCursor).toBeNull();

    const walkedIds = [...p1.body.events, ...p2.body.events, ...p3.body.events].map((e: any) => e.id);
    expect(walkedIds).toEqual(c45OrderedIds);
    expect(new Set(walkedIds).size).toBe(45);

    // ?paged=true without explicit limit defaults to 20.
    const pagedDef = await getEvents(ID.owner, ID.c45, '?paged=true');
    expect(pagedDef.status).toBe(200);
    expect(pagedDef.body.events).toHaveLength(20);
    expect(pagedDef.body.hasMore).toBe(true);
    expect(typeof pagedDef.body.nextCursor).toBe('string');
  });

  it('[CEP-02] RED-BEFORE: D-100 zero-leakage — member without revenue read receives zero money events, identical page sizes [20, 20, 5], no trailing cursor for withheld money tail, and opaque cursors revealing zero withheld counts or IDs', async () => {
    async function walkAll(user: string, contactId: string) {
      const pages: Array<{ ids: string[]; nextCursor: string | null; hasMore: boolean }> = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const qs = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
        const res = await getEvents(user, contactId, qs);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        pages.push({
          ids: res.body.events.map((e: any) => e.id),
          nextCursor: res.body.nextCursor,
          hasMore: res.body.hasMore,
        });
        if (!res.body.nextCursor) break;
        cursor = res.body.nextCursor;
      }
      return pages;
    }

    const noRevMixPages = await walkAll(ID.noRevStaff, ID.cMix);
    const noRevCleanPages = await walkAll(ID.noRevStaff, ID.cNoMoney);

    // Identical page sizes [20, 20, 5] and termination flags whether 0 or 18 money rows exist.
    expect(noRevMixPages.map((p) => p.ids.length)).toEqual([20, 20, 5]);
    expect(noRevCleanPages.map((p) => p.ids.length)).toEqual([20, 20, 5]);
    expect(noRevMixPages.map((p) => p.hasMore)).toEqual([true, true, false]);
    expect(noRevMixPages[2].nextCursor).toBeNull();

    const noRevIds = noRevMixPages.flatMap((p) => p.ids);
    expect(noRevIds).toEqual(cMixVisibleOrderedIds);
    for (const id of noRevIds) {
      expect(cMixMoneyIdSet.has(id)).toBe(false);
    }

    // Opaque cursors must never contain withheld IDs or skip/offset/withheld counters.
    for (let i = 0; i < 2; i++) {
      const c = noRevMixPages[i].nextCursor!;
      const decoded = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
      expect(Object.keys(decoded).sort()).toEqual(['createdAt', 'id']);
      expect(decoded.id).toBe(noRevMixPages[i].ids[noRevMixPages[i].ids.length - 1]);
      expect(cMixMoneyIdSet.has(decoded.id)).toBe(false);
    }

    // Owner sees all 63 events (45 visible + 18 money) across 4 pages [20, 20, 20, 3].
    const ownerPages = await walkAll(ID.owner, ID.cMix);
    expect(ownerPages.map((p) => p.ids.length)).toEqual([20, 20, 20, 3]);
    expect(ownerPages[3].hasMore).toBe(false);
    expect(ownerPages[3].nextCursor).toBeNull();
    expect(ownerPages.flatMap((p) => p.ids)).toEqual(cMixAllOrderedIds);
  });

  it('[CEP-03] RED-BEFORE: exact 20-event boundary with trailing withheld money rows returns hasMore false & nextCursor null for non-revenue member, while owner gets page 2', async () => {
    const noRev = await getEvents(ID.noRevStaff, ID.cExact20, '?limit=20');
    expect(noRev.status).toBe(200);
    expect(noRev.body.events).toHaveLength(20);
    expect(noRev.body.hasMore).toBe(false);
    expect(noRev.body.nextCursor).toBeNull();

    const ownerP1 = await getEvents(ID.owner, ID.cExact20, '?limit=20');
    expect(ownerP1.status).toBe(200);
    expect(ownerP1.body.events).toHaveLength(20);
    expect(ownerP1.body.hasMore).toBe(true);
    expect(typeof ownerP1.body.nextCursor).toBe('string');

    const ownerP2 = await getEvents(ID.owner, ID.cExact20, `?limit=20&cursor=${encodeURIComponent(ownerP1.body.nextCursor)}`);
    expect(ownerP2.status).toBe(200);
    expect(ownerP2.body.events).toHaveLength(4);
    expect(ownerP2.body.hasMore).toBe(false);
    expect(ownerP2.body.nextCursor).toBeNull();
  });

  it('[CEP-04] RED-BEFORE: limit=200 succeeds; over-max/invalid limits, malformed cursors, and invalid paged values answer 400', async () => {
    const maxOk = await getEvents(ID.owner, ID.c45, '?limit=200');
    expect(maxOk.status).toBe(200);
    expect(maxOk.body.events).toHaveLength(45);
    expect(maxOk.body.hasMore).toBe(false);
    expect(maxOk.body.nextCursor).toBeNull();

    for (const badLimit of ['201', '0', '-5', '1.5', 'abc', '']) {
      const res = await getEvents(ID.owner, ID.c45, `?limit=${encodeURIComponent(badLimit)}`);
      expect(res.status, `limit=${badLimit} must be 400`).toBe(400);
    }

    const validP1 = await getEvents(ID.owner, ID.c45, '?limit=20');
    expect(validP1.status).toBe(200);
    const validCursor = validP1.body.nextCursor as string;
    const validDecoded = JSON.parse(Buffer.from(validCursor, 'base64url').toString('utf8'));
    // Pad validCursor to len % 4 === 1 (dangling 6-bit tail) by taking a multiple-of-4 prefix or encoding one
    const lenMod0Cursor = Buffer.from(JSON.stringify({ createdAt: '2026-10-01T12:00:00.000Z', id: 'abc' })).toString('base64url');
    // Flip a low unused padding bit on a len % 4 === 3 cursor
    const lenMod3Cursor = Buffer.from(JSON.stringify({ createdAt: '2026-10-01T12:00:00.000Z', id: 'abcd' })).toString('base64url');
    const b64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const lastIdx = b64Alphabet.indexOf(lenMod3Cursor[lenMod3Cursor.length - 1]);
    const flippedPaddingCursor = lenMod3Cursor.slice(0, -1) + b64Alphabet[lastIdx ^ 1];

    const badCursors = [
      '',
      'not-valid-base64!!!',
      Buffer.from('{}').toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: 'abc' })).toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '2026-10-01T12:00:00.000Z', id: '' })).toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '2026-10-01T12:00:00.000Z', id: 'abc', extra: 1 })).toString('base64url'),
      // SEC-P66-1 / COR-P66-1: extended 6-digit ISO years and year 0000 must answer 400 (never 500)
      Buffer.from(JSON.stringify({ createdAt: '+010000-01-01T00:00:00.000Z', id: 'abc' })).toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '-000001-01-01T00:00:00.000Z', id: 'abc' })).toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '0000-01-01T00:00:00.000Z', id: 'abc' })).toString('base64url'),
      // SEC-P66-2: unpaired UTF-16 surrogate and ASCII C0/DEL control chars in id must answer 400 (never 500)
      Buffer.from('{"createdAt":"2026-10-01T12:00:00.000Z","id":"\\uD800"}').toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '2026-10-01T12:00:00.000Z', id: 'a\u0001b' })).toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '2026-10-01T12:00:00.000Z', id: 'a\u007fb' })).toString('base64url'),
      // COR-P66-2: non-canonical base64url (len%4===1, flipped padding bits) & non-canonical JSON framing
      `${lenMod0Cursor}A`,
      flippedPaddingCursor,
      Buffer.from(` ${JSON.stringify(validDecoded)} `).toString('base64url'),
      Buffer.from(JSON.stringify({ id: validDecoded.id, createdAt: validDecoded.createdAt })).toString('base64url'),
    ];
    for (const badCursor of badCursors) {
      const res = await getEvents(ID.owner, ID.c45, `?cursor=${encodeURIComponent(badCursor)}`);
      expect(res.status, `cursor=${badCursor} must be 400, got ${res.status}`).toBe(400);
    }

    // Duplicate query params and invalid paged values must answer 400
    for (const badQuery of [
      '?paged=bogus',
      '?limit=10&limit=20',
      `?cursor=${encodeURIComponent(validCursor)}&cursor=${encodeURIComponent(validCursor)}`,
      '?paged=true&paged=1',
    ]) {
      const res = await getEvents(ID.owner, ID.c45, badQuery);
      expect(res.status, `query=${badQuery} must be 400, got ${res.status}`).toBe(400);
    }
  });

  it('[CEP-05] RED-BEFORE: cross-tenant (403) and PRIVATE contact visibility (404) stay enforced on paged reads; deleting cursor row mid-walk still returns remaining rows cleanly', async () => {
    const crossTenant = await getEvents(ID.otherOwner, ID.c45, '?limit=20', ID.biz);
    expect(crossTenant.status).toBe(403);

    const privDenied = await getEvents(ID.noRevStaff, ID.cPrivate, '?limit=20');
    expect(privDenied.status).toBe(404);

    // Walk cDeleteCursor with limit=2, delete the cursor row between page 1 and page 2.
    const p1 = await getEvents(ID.owner, ID.cDeleteCursor, '?limit=2');
    expect(p1.status).toBe(200);
    expect(p1.body.events.map((e: any) => e.id)).toEqual([`${P}cdel_004`, `${P}cdel_003`]);
    expect(p1.body.hasMore).toBe(true);

    await db.contactEvent.delete({ where: { id: `${P}cdel_003` } });

    const p2 = await getEvents(ID.owner, ID.cDeleteCursor, `?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
    expect(p2.status).toBe(200);
    expect(p2.body.events.map((e: any) => e.id)).toEqual([`${P}cdel_002`, `${P}cdel_001`]);
    expect(p2.body.hasMore).toBe(true);

    const p3 = await getEvents(ID.owner, ID.cDeleteCursor, `?limit=2&cursor=${encodeURIComponent(p2.body.nextCursor)}`);
    expect(p3.status).toBe(200);
    expect(p3.body.events.map((e: any) => e.id)).toEqual([`${P}cdel_000`]);
    expect(p3.body.hasMore).toBe(false);
    expect(p3.body.nextCursor).toBeNull();
  });
});
