/**
 * R0-07 / R0-CMF5-GMAIL-CONNECT-BINDING — GmailService's connect rule (pure: a
 * recording fake Prisma client and a stubbed fetch, no database, no network).
 * The real-database proof over HTTP, with the review's reproduction of R0-07
 * ST-2 and ST-3, is test/gmail-connect-binding.integration.test.ts.
 *
 * RED-BEFORE (pkt/R0-CMF4-SEND-EMAIL-ORDER-repair at acfda3e6): the signed
 * OAuth state named only the business, and the callback's
 * saveGmailCredentials(businessId, code) wrote the exchanged tokens straight to
 * Business.gmail*, so whoever completed consent linked their mailbox. There was
 * no owner rule in the service and no confirmation step.
 *
 * Pinned here: the state carries the initiating user; the callback's
 * stagePendingConnection refuses a state with no user before any Google call
 * and otherwise stores a PENDING connector_accounts row (tokens encrypted,
 * bound to user, business and nonce) and writes nothing to Business;
 * confirmPendingConnection checks the owner rule first, then that the pending
 * row is this business's, this user's and inside its window, claims it (single
 * use), and only then writes Business.gmail*. assertConnectAuthority is the
 * owner rule (an OWNER membership and SUPER_ADMIN; the recorded owner,
 * Business.ownerId, only while it holds that OWNER membership: owner rulings
 * D-104, D-116).
 *
 * Review repairs (U10-U14): the confirmation names the previewed mailbox
 * (ST-CMF5-2); staging refuses a request whose tenant is not the state's
 * business (ST-CMF5-3); confirm and disconnect write their audit row in the
 * change's transaction (ST-CMF5-4); expired pending rows are swept and a
 * disconnect removes every pending row (ST-CMF5-5).
 *
 * Review 2 repairs (U15-U18): verifyState accepts only a purpose gmail state
 * (SEC-CMF5-R2); a consent with no refresh token never pairs a new mailbox with
 * the replaced one's refresh token (SEC-CMF5-R3); confirm and disconnect lock
 * the business row first (SEC-CMF5-R4); a Google Suite grant writes the gmail
 * connector status and activity row on confirmation (CMF5R-1).
 */
import 'reflect-metadata';
import { createHmac } from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GmailService } from './gmail.service';
import { runWithTenant } from '../../core/tenant/tenant-context';

const BIZ = 'biz_gmail_1';
const OWNER = { id: 'u_owner', role: 'USER' };
const DIST_OWNER = { id: 'u_dist_owner', role: 'USER' };
const STAFF = { id: 'u_staff', role: 'USER' };
const ADMIN = { id: 'u_admin', role: 'USER' };
const SUPER = { id: 'u_super', role: 'SUPER_ADMIN' };

const ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: 'unit-client-id',
  GOOGLE_CLIENT_SECRET: 'unit-client-secret',
  GMAIL_REDIRECT_URI: 'http://localhost:3001/api/commerce/gmail/callback',
  GOOGLE_STATE_SECRET: 'unit-state-secret',
};
const ENV_KEYS = [...Object.keys(ENV), 'GOOGLE_REDIRECT_URI'];
const saved: Record<string, string | undefined> = {};

const WRITE_METHODS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
interface Call { model: string; method: string; args: any }

/**
 * A Prisma client that records every model call. membership.findUnique and
 * business.findFirst answer the owner rule from `state` (business.findFirst
 * honours a members.some { userId, role } filter against state.memberships, as
 * Postgres would); connectorAccount keeps
 * the rows it was given in memory, so a staged row can be confirmed.
 */
function fakePrisma(state: { memberships?: Record<string, string>; ownerId?: string; claimLoses?: boolean; currentEmail?: string; currentRefresh?: string } = {}) {
  const calls: Call[] = [];
  const pending: any[] = [];
  // Scalar equality on every key but OR; an OR of { settings: { path: ['userId'], equals } } and
  // { createdAt: { lt } } is evaluated against the row, as Postgres would.
  const matchesOr = (row: any, or: any[] | undefined) =>
    !or || or.some((c) =>
      (c.settings ? row.settings?.[c.settings.path[0]] === c.settings.equals : true) &&
      (c.createdAt ? row.createdAt < c.createdAt.lt : true));
  // `{ in: [...] }` is the sweep's id list (R0-CMF5 review ST-CMF5-5).
  const matchesValue = (value: any, v: any) =>
    v && typeof v === 'object' && Array.isArray(v.in) ? v.in.includes(value) : value === v;
  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => k === 'OR' || matchesValue(row[k], v)) && matchesOr(row, where?.OR);
  const audit: any[] = [];
  const client: any = {
    membership: {
      findUnique: async (args: any) => {
        calls.push({ model: 'membership', method: 'findUnique', args });
        const role = state.memberships?.[args.where.userId_businessId.userId];
        return role ? { role } : null;
      },
    },
    business: {
      findFirst: async (args: any) => {
        calls.push({ model: 'business', method: 'findFirst', args });
        if (args.where.ownerId !== state.ownerId || args.where.id !== BIZ) return null;
        // Owner rulings D-104, D-116: the recorded-owner arm names a Membership
        // (members.some), and its role when it gives one; answered from
        // state.memberships as Postgres would answer the relation filter.
        const some = args.where.members?.some;
        if (some) {
          const role = state.memberships?.[some.userId];
          if (!role || (some.role !== undefined && some.role !== role)) return null;
        }
        return { id: BIZ };
      },
      findUnique: async (args: any) => {
        calls.push({ model: 'business', method: 'findUnique', args });
        return { id: args.where.id, gmailEmail: state.currentEmail ?? null, gmailRefreshToken: state.currentEmail ? (state.currentRefresh ?? 'ref') : null };
      },
      update: async (args: any) => {
        calls.push({ model: 'business', method: 'update', args });
        return { id: args.where.id, ...args.data };
      },
    },
    teamActivityLog: {
      create: async (args: any) => {
        calls.push({ model: 'teamActivityLog', method: 'create', args });
        audit.push(args.data);
        return args.data;
      },
    },
    // Review 2 CMF5R-1: the gmail connector's status and activity rows.
    connectorStatus: {
      upsert: async (args: any) => {
        calls.push({ model: 'connectorStatus', method: 'upsert', args });
        return args.create;
      },
    },
    connectorActivityLog: {
      create: async (args: any) => {
        calls.push({ model: 'connectorActivityLog', method: 'create', args });
        return args.data;
      },
    },
    connectorAccount: {
      create: async (args: any) => {
        calls.push({ model: 'connectorAccount', method: 'create', args });
        const row = { createdAt: new Date(), ...args.data };
        pending.push(row);
        return row;
      },
      findFirst: async (args: any) => {
        calls.push({ model: 'connectorAccount', method: 'findFirst', args });
        return pending.find((r) => matches(r, args.where)) ?? null;
      },
      findMany: async (args: any) => {
        calls.push({ model: 'connectorAccount', method: 'findMany', args });
        return pending.filter((r) => matches(r, args.where));
      },
      deleteMany: async (args: any) => {
        calls.push({ model: 'connectorAccount', method: 'deleteMany', args });
        if (state.claimLoses && typeof args.where.id === 'string') return { count: 0 };
        const before = pending.length;
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (matches(pending[i], args.where)) pending.splice(i, 1);
        }
        return { count: before - pending.length };
      },
    },
  };
  // The transaction runs on the same recording client (calls keep their order).
  client.$transaction = async (fn: (tx: any) => Promise<unknown>) => {
    calls.push({ model: '$transaction', method: 'begin', args: null });
    return fn(client);
  };
  // Review 2 SEC-CMF5-R4: a tagged-template raw query (the row lock), recorded with its SQL and values.
  client.$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ model: '$queryRaw', method: 'raw', args: { sql: strings.join('?'), values } });
    return [];
  };
  const writes = () => calls.filter((c) => WRITE_METHODS.has(c.method));
  return { prisma: { client } as any, calls, pending, writes, audit };
}

const fetchCalls: string[] = [];
function stubGoogle(account = { access: 'acc_tok_1', refresh: 'ref_tok_1', email: 'mailbox@gmail.test' }) {
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (body.get('code') !== 'good-code') return new Response('{"error":"invalid_grant"}', { status: 400 });
      return new Response(JSON.stringify({ access_token: account.access, refresh_token: account.refresh, expires_in: 3600 }), { status: 200 });
    }
    if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
      return new Response(JSON.stringify({ email: account.email }), { status: 200 });
    }
    throw new Error(`unit: unexpected fetch ${url}`);
  });
}

function stateClaims(url: string) {
  const state = new URL(url).searchParams.get('state') as string;
  const decoded = Buffer.from(state, 'base64').toString('utf8');
  const at = decoded.lastIndexOf('.');
  return { state, payload: decoded.slice(0, at), signature: decoded.slice(at + 1), claims: JSON.parse(decoded.slice(0, at)) };
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  delete process.env.GOOGLE_REDIRECT_URI;
  Object.assign(process.env, ENV);
  fetchCalls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('GmailService — the Gmail connection is bound to the owner who started it (R0-CMF5)', () => {
  it('[R0-CMF5-U01] RED-BEFORE: getAuthUrl signs a state that names the initiating user, the business, a nonce, a 10-minute expiry and purpose gmail', () => {
    const { prisma } = fakePrisma();
    const gmail = new GmailService(prisma);
    const { payload, signature, claims } = stateClaims(gmail.getAuthUrl(BIZ, OWNER.id));
    expect(signature).toBe(createHmac('sha256', ENV.GOOGLE_STATE_SECRET).update(payload).digest('hex'));
    expect(claims).toMatchObject({ businessId: BIZ, userId: OWNER.id, purpose: 'gmail' });
    expect(claims.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(Math.abs(claims.exp - (Date.now() + 10 * 60 * 1000))).toBeLessThan(2000);
  });

  it('[R0-CMF5-U02] verifyState keeps R0-07: a state is accepted once, a replay, an expired state and a bad signature are refused', () => {
    const { prisma } = fakePrisma();
    const gmail = new GmailService(prisma);
    const { state } = stateClaims(gmail.getAuthUrl(BIZ, OWNER.id));
    expect(gmail.verifyState(state)).toMatchObject({ businessId: BIZ, userId: OWNER.id });
    expect(gmail.verifyState(state)).toBeNull();

    const sign = (claims: object, secret = ENV.GOOGLE_STATE_SECRET) => {
      const payload = JSON.stringify(claims);
      return Buffer.from(`${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`).toString('base64');
    };
    expect(gmail.verifyState(sign({ businessId: BIZ, userId: OWNER.id, nonce: 'n-expired', exp: Date.now() - 1, purpose: 'gmail' }))).toBeNull();
    expect(gmail.verifyState(sign({ businessId: BIZ, userId: OWNER.id, nonce: 'n-forged', exp: Date.now() + 60_000, purpose: 'gmail' }, 'other'))).toBeNull();
  });

  it('[R0-CMF5-U03] RED-BEFORE: stagePendingConnection refuses a state that names no user before any Google call or write', async () => {
    stubGoogle();
    const { prisma, writes } = fakePrisma();
    const gmail = new GmailService(prisma) as any;
    expect(typeof gmail.stagePendingConnection).toBe('function');
    await expect(gmail.stagePendingConnection({ businessId: BIZ, nonce: 'n1', exp: Date.now() + 60_000, purpose: 'gmail' }, 'good-code'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(fetchCalls).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('[R0-CMF5-U04] RED-BEFORE: stagePendingConnection exchanges the code and stores one PENDING GMAIL connection (tokens encrypted, bound to user, business and nonce, 15-minute window); it replaces the user\'s older pending one and writes nothing to Business', async () => {
    stubGoogle();
    const { prisma, calls, pending } = fakePrisma();
    const gmail = new GmailService(prisma) as any;
    const state = { businessId: BIZ, userId: OWNER.id, nonce: 'n-stage', exp: Date.now() + 60_000, purpose: 'gmail' as const };
    const first = await gmail.stagePendingConnection(state, 'good-code');
    const second = await gmail.stagePendingConnection({ ...state, nonce: 'n-stage-2' }, 'good-code');
    expect(first.pendingId).toMatch(/^[A-Za-z0-9_-]{24,}$/);
    expect(second.pendingId).not.toBe(first.pendingId);

    expect(pending).toHaveLength(1);
    const row = pending[0];
    expect(row).toMatchObject({ id: second.pendingId, businessId: BIZ, provider: 'GOOGLE', service: 'GMAIL', status: 'PENDING', accountEmail: 'mailbox@gmail.test' });
    expect(row.accessTokenEncrypted).toMatch(/^enc:v1:/);
    expect(row.refreshTokenEncrypted).toMatch(/^enc:v1:/);
    expect(row.settings).toMatchObject({ userId: OWNER.id, nonce: 'n-stage-2' });
    const window = Date.parse(row.settings.pendingExpiresAt) - Date.now();
    expect(window).toBeGreaterThan(14 * 60 * 1000);
    expect(window).toBeLessThanOrEqual(15 * 60 * 1000);

    expect(calls.filter((c) => c.model === 'business')).toEqual([]);
    for (const c of calls.filter((x) => x.model === 'connectorAccount' && x.method !== 'create')) {
      expect(c.args.where.businessId, `${c.method} names the business`).toBe(BIZ);
    }
    expect(fetchCalls).toEqual([
      'https://oauth2.googleapis.com/token', 'https://www.googleapis.com/oauth2/v2/userinfo',
      'https://oauth2.googleapis.com/token', 'https://www.googleapis.com/oauth2/v2/userinfo',
    ]);
  });

  it('[R0-CMF5-U05] RED-BEFORE: assertConnectAuthority admits an OWNER membership and SUPER_ADMIN; it refuses STAFF, ADMIN and the recorded owner (Business.ownerId) holding only ADMIN or no membership (owner rulings D-104, D-116) with 403 GMAIL_OWNER_ONLY, and no actor with 401', async () => {
    const expectOwnerOnly = async (gmail: any, actor: any, label: string) => {
      const err = await gmail.assertConnectAuthority(BIZ, actor).catch((e: unknown) => e);
      expect(err, label).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse(), label).toMatchObject({ code: 'GMAIL_OWNER_ONLY' });
    };
    // Owner ruling D-116 (W11-D116-CONNECTION-OWNER): the recorded owner holding an ADMIN membership is an ADMIN.
    const { prisma } = fakePrisma({
      memberships: { [OWNER.id]: 'OWNER', [STAFF.id]: 'STAFF', [ADMIN.id]: 'ADMIN', [DIST_OWNER.id]: 'ADMIN' },
      ownerId: DIST_OWNER.id,
    });
    const gmail = new GmailService(prisma) as any;
    expect(typeof gmail.assertConnectAuthority).toBe('function');
    await expect(gmail.assertConnectAuthority(BIZ, OWNER)).resolves.toBeUndefined();
    await expect(gmail.assertConnectAuthority(BIZ, SUPER)).resolves.toBeUndefined();
    for (const [actor, label] of [[STAFF, 'STAFF'], [ADMIN, 'ADMIN'], [DIST_OWNER, 'recorded owner holding ADMIN']] as const) {
      await expectOwnerOnly(gmail, actor, label);
    }
    // Owner ruling D-104: the recorded owner with no membership row is refused too.
    const { prisma: noMembership } = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' }, ownerId: DIST_OWNER.id });
    await expectOwnerOnly(new GmailService(noMembership), DIST_OWNER, 'recorded owner with no membership');
    await expect(gmail.assertConnectAuthority(BIZ, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('[R0-CMF5-U06] RED-BEFORE: confirmPendingConnection checks the owner rule before it reads any pending row; a refused member reads and writes nothing', async () => {
    const { prisma, calls, writes } = fakePrisma({ memberships: { [STAFF.id]: 'STAFF' } });
    const gmail = new GmailService(prisma) as any;
    const err = await gmail.confirmPendingConnection(BIZ, STAFF, 'gmc_whatever', 'mailbox@gmail.test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(calls.filter((c) => c.model === 'connectorAccount')).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('[R0-CMF5-U07] RED-BEFORE: confirmPendingConnection refuses (404 GMAIL_PENDING_NOT_FOUND, no Business write) a pending id of another user, of another business, past its window, unknown, or claimed by a concurrent confirmation', async () => {
    stubGoogle();
    const expectNotFound = async (gmail: any, businessId: string, actor: any, pendingId: string, writes: () => Call[]) => {
      const err = await gmail.confirmPendingConnection(businessId, actor, pendingId, 'mailbox@gmail.test').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'GMAIL_PENDING_NOT_FOUND' });
      expect(writes().filter((c) => c.model === 'business')).toEqual([]);
    };
    const state = { businessId: BIZ, userId: OWNER.id, nonce: 'n-u07', exp: Date.now() + 60_000, purpose: 'gmail' as const };

    const a = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' } });
    const ga = new GmailService(a.prisma) as any;
    const { pendingId } = await ga.stagePendingConnection(state, 'good-code');
    await expectNotFound(ga, BIZ, SUPER, pendingId, a.writes);        // another user (the platform bypass passes the owner rule, not the binding)
    await expectNotFound(ga, 'biz_other', SUPER, pendingId, a.writes); // another business
    await expectNotFound(ga, BIZ, OWNER, 'gmc_unknown', a.writes);

    a.pending[0].settings = { ...a.pending[0].settings, pendingExpiresAt: new Date(Date.now() - 1000).toISOString() };
    await expectNotFound(ga, BIZ, OWNER, pendingId, a.writes);         // past its window

    const b = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' }, claimLoses: true });
    const gb = new GmailService(b.prisma) as any;
    const staged = await gb.stagePendingConnection({ ...state, nonce: 'n-u07b' }, 'good-code');
    await expectNotFound(gb, BIZ, OWNER, staged.pendingId, b.writes); // the claim (deleteMany on id + PENDING) found nothing
  });

  it('[R0-CMF5-U08] RED-BEFORE: confirmPendingConnection by the initiating owner claims the pending row, then writes the decrypted tokens, mailbox and expiry to Business.gmail*', async () => {
    stubGoogle({ access: 'acc_tok_8', refresh: 'ref_tok_8', email: 'owner8@gmail.test' });
    const { prisma, calls, pending } = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' } });
    const gmail = new GmailService(prisma) as any;
    const { pendingId } = await gmail.stagePendingConnection(
      { businessId: BIZ, userId: OWNER.id, nonce: 'n-u08', exp: Date.now() + 60_000, purpose: 'gmail' }, 'good-code');

    await expect(gmail.confirmPendingConnection(BIZ, OWNER, pendingId, 'owner8@gmail.test')).resolves.toEqual({ connected: true, email: 'owner8@gmail.test' });
    expect(pending).toEqual([]);
    const claim = calls.findIndex((c) => c.model === 'connectorAccount' && c.method === 'deleteMany' && c.args.where.id === pendingId);
    const write = calls.findIndex((c) => c.model === 'business' && c.method === 'update');
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(calls[claim].args.where).toMatchObject({ id: pendingId, businessId: BIZ, status: 'PENDING' });
    expect(write).toBeGreaterThan(claim);
    expect(calls[write].args).toMatchObject({
      where: { id: BIZ },
      data: { gmailEmail: 'owner8@gmail.test', gmailAccessToken: 'acc_tok_8', gmailRefreshToken: 'ref_tok_8' },
    });
    expect(calls[write].args.data.gmailTokenExpiry).toBeInstanceOf(Date);
  });

  it('[R0-CMF5-U09] RED-BEFORE: saveGmailCredentials, which linked a mailbox in the unauthenticated callback, is gone', () => {
    const { prisma } = fakePrisma();
    expect((new GmailService(prisma) as any).saveGmailCredentials).toBeUndefined();
  });

  it('[R0-CMF5-U10] ST-CMF5-3: stagePendingConnection under another business\'s tenant (the request\'s TenantInterceptor scope) refuses before any Google call or write; under the state\'s own tenant it stages', async () => {
    stubGoogle();
    const { prisma, writes } = fakePrisma();
    const gmail = new GmailService(prisma) as any;
    const state = { businessId: BIZ, userId: OWNER.id, nonce: 'n-u10', exp: Date.now() + 60_000, purpose: 'gmail' as const };
    const err = await runWithTenant('biz_other', OWNER.id, () => gmail.stagePendingConnection(state, 'good-code')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'GMAIL_STATE_TENANT_MISMATCH' });
    expect(fetchCalls).toEqual([]);
    expect(writes()).toEqual([]);
    const staged = await runWithTenant(BIZ, OWNER.id, () => gmail.stagePendingConnection(state, 'good-code'));
    expect(staged.pendingId).toMatch(/^gmc_/);
  });

  it('[R0-CMF5-U11] ST-CMF5-2: previewPendingConnection shows the bound owner the staged mailbox and consumes nothing; confirmPendingConnection naming another mailbox is 409 GMAIL_PENDING_EMAIL_MISMATCH with no claim and no Business write, and naming it in any letter case activates it', async () => {
    stubGoogle({ access: 'acc_tok_11', refresh: 'ref_tok_11', email: 'Stranger11@gmail.test' });
    const { prisma, writes, pending } = fakePrisma({ memberships: { [OWNER.id]: 'OWNER', [STAFF.id]: 'STAFF' } });
    const gmail = new GmailService(prisma) as any;
    const { pendingId } = await gmail.stagePendingConnection(
      { businessId: BIZ, userId: OWNER.id, nonce: 'n-u11', exp: Date.now() + 60_000, purpose: 'gmail' }, 'good-code');
    const before = writes().length;

    await expect(gmail.previewPendingConnection(BIZ, OWNER, pendingId)).resolves.toMatchObject({ pendingId, email: 'Stranger11@gmail.test' });
    await expect(gmail.previewPendingConnection(BIZ, STAFF, pendingId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(gmail.previewPendingConnection(BIZ, SUPER, pendingId)).rejects.toBeInstanceOf(NotFoundException);

    const err = await gmail.confirmPendingConnection(BIZ, OWNER, pendingId, 'owner@gmail.test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'GMAIL_PENDING_EMAIL_MISMATCH' });
    expect(writes().length).toBe(before);
    expect(pending.map((r) => r.id)).toEqual([pendingId]);

    await expect(gmail.confirmPendingConnection(BIZ, OWNER, pendingId, ' stranger11@GMAIL.test ')).resolves.toEqual({ connected: true, email: 'Stranger11@gmail.test' });
  });

  it('[R0-CMF5-U12] ST-CMF5-4: confirm writes Business.gmail* and one audit row naming the actor inside one transaction (gmail_connected, or gmail_replaced with the replaced mailbox); disconnect clears the mailbox and writes gmail_disconnected; a refused disconnect writes nothing', async () => {
    stubGoogle({ access: 'acc_tok_12', refresh: 'ref_tok_12', email: 'next12@gmail.test' });
    const { prisma, calls, audit, writes } = fakePrisma({ memberships: { [OWNER.id]: 'OWNER', [STAFF.id]: 'STAFF' }, currentEmail: 'current12@gmail.test' });
    const gmail = new GmailService(prisma) as any;
    const { pendingId } = await gmail.stagePendingConnection(
      { businessId: BIZ, userId: OWNER.id, nonce: 'n-u12', exp: Date.now() + 60_000, purpose: 'gmail' }, 'good-code');
    await gmail.confirmPendingConnection(BIZ, OWNER, pendingId, 'next12@gmail.test');

    const begin = calls.findIndex((c) => c.model === '$transaction');
    const claim = calls.findIndex((c) => c.model === 'connectorAccount' && c.method === 'deleteMany' && c.args.where.id === pendingId);
    const update = calls.findIndex((c) => c.model === 'business' && c.method === 'update');
    const log = calls.findIndex((c) => c.model === 'teamActivityLog');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin).toBeLessThan(claim);
    expect(claim).toBeLessThan(update);
    expect(update).toBeLessThan(log);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      businessId: BIZ, userId: OWNER.id, module: 'commerce', action: 'gmail_replaced', entityType: 'gmail_mailbox',
      meta: { email: 'next12@gmail.test', previousEmail: 'current12@gmail.test', actorStanding: 'OWNER' },
    });
    expect(JSON.stringify(audit)).not.toContain('acc_tok_12');
    expect(JSON.stringify(audit)).not.toContain('ref_tok_12');

    const beforeRefusal = writes().length;
    await expect(gmail.disconnectGmail(BIZ, STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(gmail.disconnectGmail(BIZ, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(writes().length).toBe(beforeRefusal);

    await gmail.disconnectGmail(BIZ, SUPER);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ userId: SUPER.id, action: 'gmail_disconnected', meta: { previousEmail: 'current12@gmail.test', actorStanding: 'SUPER_ADMIN' } });
  });

  it('[R0-CMF5-U13] ST-CMF5-5: a disconnect removes every PENDING Gmail row of the business, so a consent staged before it cannot be confirmed after it', async () => {
    stubGoogle();
    const { prisma, pending } = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' } });
    const gmail = new GmailService(prisma) as any;
    const { pendingId } = await gmail.stagePendingConnection(
      { businessId: BIZ, userId: OWNER.id, nonce: 'n-u13', exp: Date.now() + 60_000, purpose: 'gmail' }, 'good-code');
    expect(pending).toHaveLength(1);
    await gmail.disconnectGmail(BIZ, OWNER);
    expect(pending).toEqual([]);
    const err = await gmail.confirmPendingConnection(BIZ, OWNER, pendingId, 'mailbox@gmail.test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
  });

  it('[R0-CMF5-U14] ST-CMF5-5: getGmailStatus sweeps this business\'s pending rows past their window (by age or by pendingExpiresAt) and keeps fresh ones; the sweep names the business', async () => {
    stubGoogle();
    const { prisma, pending, calls } = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' } });
    const gmail = new GmailService(prisma) as any;
    pending.push(
      { id: 'gmc_old', businessId: BIZ, provider: 'GOOGLE', service: 'GMAIL', status: 'PENDING', createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000), settings: { purpose: 'gmail-connect', userId: STAFF.id, pendingExpiresAt: new Date(Date.now() + 60_000).toISOString() } },
      { id: 'gmc_late', businessId: BIZ, provider: 'GOOGLE', service: 'GMAIL', status: 'PENDING', createdAt: new Date(), settings: { purpose: 'gmail-connect', userId: ADMIN.id, pendingExpiresAt: new Date(Date.now() - 1000).toISOString() } },
      { id: 'gmc_fresh', businessId: BIZ, provider: 'GOOGLE', service: 'GMAIL', status: 'PENDING', createdAt: new Date(), settings: { purpose: 'gmail-connect', userId: OWNER.id, pendingExpiresAt: new Date(Date.now() + 60_000).toISOString() } },
      { id: 'gmc_other_biz', businessId: 'biz_other', provider: 'GOOGLE', service: 'GMAIL', status: 'PENDING', createdAt: new Date(0), settings: {} },
    );
    await gmail.getGmailStatus(BIZ);
    expect(pending.map((r) => r.id).sort()).toEqual(['gmc_fresh', 'gmc_other_biz']);
    for (const c of calls.filter((x) => x.model === 'connectorAccount')) {
      expect(c.args.where.businessId, `${c.method} names the business`).toBe(BIZ);
    }
  });

  it('[R0-CMF5-U15] review 2 SEC-CMF5-R2: verifyState accepts only a state minted for this callback (purpose gmail): a correctly signed, unexpired, unused Google Suite state (purpose google-suite, or none) is refused even when it names a user', () => {
    const { prisma } = fakePrisma();
    const gmail = new GmailService(prisma);
    const sign = (claims: object) => {
      const payload = JSON.stringify(claims);
      return Buffer.from(`${payload}.${createHmac('sha256', ENV.GOOGLE_STATE_SECRET).update(payload).digest('hex')}`).toString('base64');
    };
    const claims = { businessId: BIZ, userId: STAFF.id, exp: Date.now() + 60_000 };
    expect(gmail.verifyState(sign({ ...claims, services: ['calendar'], nonce: 'n-u15-suite', purpose: 'google-suite' }))).toBeNull();
    expect(gmail.verifyState(sign({ ...claims, services: ['calendar'], nonce: 'n-u15-none' }))).toBeNull();
    expect(gmail.verifyState(sign({ ...claims, nonce: 'n-u15-other', purpose: 'crm' }))).toBeNull();
    expect(gmail.verifyState(sign({ ...claims, nonce: 'n-u15-gmail', purpose: 'gmail' }))).toMatchObject({ businessId: BIZ, userId: STAFF.id, purpose: 'gmail' });
  });

  it('[R0-CMF5-U16] review 2 SEC-CMF5-R3: a pending connection whose consent returned no refresh token replaces nothing: with another mailbox stored, or none, confirm is 409 GMAIL_PENDING_NO_REFRESH_TOKEN with no claim and no Business write; for the stored mailbox itself the stored refresh token stays', async () => {
    const noRefresh = { access_token: 'acc_tok_16', expires_in: 3600 };
    const binding = { businessId: BIZ, userId: OWNER.id, nonce: 'n-u16' };

    for (const currentEmail of ['current16@gmail.test', undefined]) {
      const f = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' }, currentEmail });
      const gmail = new GmailService(f.prisma) as any;
      const { pendingId } = await gmail.stagePendingTokens(binding, 'next16@gmail.test', noRefresh);
      const before = f.writes().length;
      const err = await gmail.confirmPendingConnection(BIZ, OWNER, pendingId, 'next16@gmail.test').catch((e: unknown) => e);
      expect(err, `stored mailbox: ${String(currentEmail)}`).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: 'GMAIL_PENDING_NO_REFRESH_TOKEN' });
      expect(f.writes().length).toBe(before);
      expect(f.pending.map((r) => r.id)).toEqual([pendingId]);
    }

    const same = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' }, currentEmail: 'Current16@gmail.test', currentRefresh: 'ref_stored_16' });
    const gmail = new GmailService(same.prisma) as any;
    const { pendingId } = await gmail.stagePendingTokens(binding, 'current16@gmail.test', noRefresh);
    await expect(gmail.confirmPendingConnection(BIZ, OWNER, pendingId, 'current16@gmail.test')).resolves.toEqual({ connected: true, email: 'current16@gmail.test' });
    const update = same.calls.find((c) => c.model === 'business' && c.method === 'update');
    expect(update?.args.data).toMatchObject({ gmailEmail: 'current16@gmail.test', gmailAccessToken: 'acc_tok_16' });
    expect([undefined, 'ref_stored_16']).toContain(update?.args.data.gmailRefreshToken);
  });

  it('[R0-CMF5-U17] review 2 SEC-CMF5-R4: confirm and disconnect each lock the business row first in their transaction (SELECT ... FOR NO KEY UPDATE on businesses), before they touch a pending row or the mailbox, so the two never take their locks in opposite orders', async () => {
    stubGoogle();
    const { prisma, calls } = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' } });
    const gmail = new GmailService(prisma) as any;
    const { pendingId } = await gmail.stagePendingConnection(
      { businessId: BIZ, userId: OWNER.id, nonce: 'n-u17', exp: Date.now() + 60_000, purpose: 'gmail' }, 'good-code');

    const runs: Array<[string, () => Promise<unknown>]> = [
      ['confirm', () => gmail.confirmPendingConnection(BIZ, OWNER, pendingId, 'mailbox@gmail.test')],
      ['disconnect', () => gmail.disconnectGmail(BIZ, OWNER)],
    ];
    for (const [name, run] of runs) {
      const from = calls.length;
      await run();
      const made = calls.slice(from);
      const begin = made.findIndex((c) => c.model === '$transaction');
      expect(begin, `${name} runs in a transaction`).toBeGreaterThanOrEqual(0);
      const first = made[begin + 1];
      expect(first, `${name}: the first statement in the transaction`).toMatchObject({ model: '$queryRaw' });
      expect(first.args.sql).toMatch(/FROM\s+businesses\s+WHERE\s+id\s*=\s*\?\s+FOR\s+NO\s+KEY\s+UPDATE/i);
      expect(first.args.values).toEqual([BIZ]);
    }
  });

  it('[R0-CMF5-U18] review 2 CMF5R-1: a pending connection the Google Suite staged (origin google-suite, with its live Gmail check) writes the gmail connector status and one connector activity row in the confirmation\'s transaction (connected with intake on, or error with the check\'s message); one the commerce callback staged writes neither, as on the base', async () => {
    const tokens = { access_token: 'acc_tok_18', refresh_token: 'ref_tok_18', expires_in: 3600 };
    const binding = { businessId: BIZ, userId: OWNER.id, nonce: 'n-u18' };
    const confirmStaged = async (origin: unknown) => {
      const f = fakePrisma({ memberships: { [OWNER.id]: 'OWNER' } });
      const gmail = new GmailService(f.prisma) as any;
      const { pendingId } = await gmail.stagePendingTokens(binding, 'suite18@gmail.test', tokens, origin);
      const settings = f.pending[0].settings;
      await gmail.confirmPendingConnection(BIZ, OWNER, pendingId, 'suite18@gmail.test');
      const begin = f.calls.findIndex((c) => c.model === '$transaction');
      const upserts = f.calls.filter((c) => c.model === 'connectorStatus');
      const activity = f.calls.filter((c) => c.model === 'connectorActivityLog');
      return { f, settings, begin, upserts, activity };
    };

    const ok = await confirmStaged({ source: 'google-suite', verification: { ok: true, account: 'suite18@gmail.test', error: null } });
    expect(ok.settings).toMatchObject({ origin: 'google-suite', verification: { ok: true } });
    expect(JSON.stringify(ok.settings)).not.toContain('acc_tok_18');
    expect(ok.upserts).toHaveLength(1);
    expect(ok.f.calls.indexOf(ok.upserts[0])).toBeGreaterThan(ok.begin);
    expect(ok.begin).toBeGreaterThanOrEqual(0);
    expect(ok.upserts[0].args).toMatchObject({
      where: { businessId_connectorType: { businessId: BIZ, connectorType: 'gmail' } },
      create: { businessId: BIZ, connectorType: 'gmail', status: 'connected', connectedAccount: 'suite18@gmail.test', intakeEnabled: true, lastError: null },
      update: { status: 'connected', connectedAccount: 'suite18@gmail.test', lastError: null },
    });
    expect(ok.activity).toHaveLength(1);
    expect(ok.f.calls.indexOf(ok.activity[0])).toBeGreaterThan(ok.begin);
    expect(ok.activity[0].args.data).toMatchObject({ businessId: BIZ, connectorType: 'gmail', action: 'connect', status: 'success' });
    expect(JSON.stringify(ok.activity[0].args)).not.toContain('acc_tok_18');

    const failed = await confirmStaged({ source: 'google-suite', verification: { ok: false, account: null, error: 'Gmail API 403: disabled' } });
    expect(failed.upserts[0].args.create).toMatchObject({ status: 'error', connectedAccount: 'suite18@gmail.test', lastError: 'Gmail API 403: disabled' });
    expect(failed.upserts[0].args.update).toMatchObject({ status: 'error', lastError: 'Gmail API 403: disabled' });
    expect(failed.activity[0].args.data).toMatchObject({ connectorType: 'gmail', action: 'connect', status: 'failure' });

    const commerce = await confirmStaged(undefined);
    expect(commerce.settings.origin).toBeUndefined();
    expect(commerce.upserts).toEqual([]);
    expect(commerce.activity).toEqual([]);
  });
});

/**
 * R0-CMF6c: getValidAccessToken's refresh write is a compare-and-set. A fake
 * client whose business reads answer from a script (outside the transaction:
 * the read that decides to refresh; inside it: the re-read under the business
 * row lock), recording every call; Google's refresh_token grant answers
 * `acc_for_<refresh token>`.
 */
function refreshFake(script: { outer: any[]; locked: any[] }) {
  const calls: Call[] = [];
  let inTx = false;
  const client: any = {
    business: {
      findUnique: async (args: any) => {
        calls.push({ model: 'business', method: inTx ? 'findUnique:locked' : 'findUnique', args });
        const next = (inTx ? script.locked : script.outer).shift();
        if (next === undefined) throw new Error(`unit: unscripted business read (${inTx ? 'locked' : 'outer'})`);
        return next;
      },
      update: async (args: any) => {
        calls.push({ model: 'business', method: 'update', args });
        return { id: args.where.id, ...args.data };
      },
      updateMany: async (args: any) => {
        calls.push({ model: 'business', method: 'updateMany', args });
        return { count: 1 };
      },
    },
  };
  client.$transaction = async (fn: (tx: any) => Promise<unknown>) => {
    calls.push({ model: '$transaction', method: 'begin', args: null });
    inTx = true;
    try {
      return await fn(client);
    } finally {
      inTx = false;
    }
  };
  client.$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ model: '$queryRaw', method: 'raw', args: { sql: strings.join('?'), values } });
    return [];
  };
  return { prisma: { client } as any, calls, writes: () => calls.filter((c) => WRITE_METHODS.has(c.method)) };
}

const refreshGrants: string[] = [];
function stubRefreshGrant() {
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = String(input);
    const body = new URLSearchParams(String(init?.body ?? ''));
    if (url === 'https://oauth2.googleapis.com/token' && body.get('grant_type') === 'refresh_token') {
      refreshGrants.push(String(body.get('refresh_token')));
      return new Response(JSON.stringify({ access_token: `acc_for_${body.get('refresh_token')}`, expires_in: 3600 }), { status: 200 });
    }
    throw new Error(`unit: unexpected fetch ${url}`);
  });
}

describe('GmailService — a refreshed Gmail access token is written back only onto the connection it was refreshed for (R0-CMF6c)', () => {
  const expired = (email: string | null, refresh: string | null) => ({
    gmailEmail: email, gmailAccessToken: 'acc_stale', gmailRefreshToken: refresh, gmailTokenExpiry: new Date(Date.now() - 60 * 60 * 1000),
  });
  const live = (email: string, refresh: string, access: string) => ({
    gmailEmail: email, gmailAccessToken: access, gmailRefreshToken: refresh, gmailTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
  });

  beforeEach(() => {
    refreshGrants.length = 0;
    stubRefreshGrant();
  });

  it('[R0-CMF6c-U19] the write is made in a transaction whose first statement is the business row lock, after a re-read showing the refresh token and mailbox the refresh used, through business.update (the token-encryption extension encrypts it; never updateMany)', async () => {
    const f = refreshFake({ outer: [expired('a@gmail.test', 'ref_a')], locked: [{ gmailEmail: 'a@gmail.test', gmailRefreshToken: 'ref_a' }] });
    const gmail = new GmailService(f.prisma) as any;
    await expect(gmail.getValidAccessToken(BIZ)).resolves.toBe('acc_for_ref_a');
    expect(refreshGrants).toEqual(['ref_a']);
    const begin = f.calls.findIndex((c) => c.model === '$transaction');
    expect(begin).toBeGreaterThan(0);
    expect(f.calls[begin + 1]).toMatchObject({ model: '$queryRaw' });
    expect(f.calls[begin + 1].args.sql).toMatch(/FROM\s+businesses\s+WHERE\s+id\s*=\s*\?\s+FOR\s+NO\s+KEY\s+UPDATE/i);
    expect(f.calls[begin + 1].args.values).toEqual([BIZ]);
    expect(f.calls[begin + 2]).toMatchObject({ model: 'business', method: 'findUnique:locked', args: { where: { id: BIZ } } });
    expect(f.writes()).toEqual([f.calls[begin + 3]]);
    expect(f.writes()[0]).toMatchObject({
      method: 'update',
      args: { where: { id: BIZ }, data: { gmailAccessToken: 'acc_for_ref_a', gmailTokenExpiry: expect.any(Date) } },
    });
  });

  it('[R0-CMF6c-U20] a lost race writes nothing and reads again, once: a disconnect is 503 "Gmail not connected"; another mailbox (or a re-consent) with a live token gives that token; two lost races in a row are "Gmail not connected" after two refreshes and no write', async () => {
    const notConnected = { response: { code: 'provider_not_configured', service: 'gmail', message: 'Gmail not connected' } };

    const off = refreshFake({ outer: [expired('a@gmail.test', 'ref_a'), expired(null, null)], locked: [{ gmailEmail: null, gmailRefreshToken: null }] });
    await expect((new GmailService(off.prisma) as any).getValidAccessToken(BIZ)).rejects.toMatchObject(notConnected);
    expect(off.writes()).toEqual([]);
    expect(refreshGrants).toEqual(['ref_a']);

    refreshGrants.length = 0;
    const swapped = refreshFake({
      outer: [expired('a@gmail.test', 'ref_a'), live('b@gmail.test', 'ref_b', 'acc_b')],
      locked: [{ gmailEmail: 'b@gmail.test', gmailRefreshToken: 'ref_b' }],
    });
    await expect((new GmailService(swapped.prisma) as any).getValidAccessToken(BIZ)).resolves.toBe('acc_b');
    expect(swapped.writes()).toEqual([]);
    expect(refreshGrants).toEqual(['ref_a']);

    refreshGrants.length = 0;
    const reconsented = refreshFake({
      outer: [expired('a@gmail.test', 'ref_a'), live('a@gmail.test', 'ref_a2', 'acc_a2')],
      locked: [{ gmailEmail: 'a@gmail.test', gmailRefreshToken: 'ref_a2' }],
    });
    await expect((new GmailService(reconsented.prisma) as any).getValidAccessToken(BIZ)).resolves.toBe('acc_a2');
    expect(reconsented.writes()).toEqual([]);

    refreshGrants.length = 0;
    const churn = refreshFake({
      outer: [expired('a@gmail.test', 'ref_a'), expired('b@gmail.test', 'ref_b')],
      locked: [{ gmailEmail: 'b@gmail.test', gmailRefreshToken: 'ref_b' }, { gmailEmail: 'c@gmail.test', gmailRefreshToken: 'ref_c' }],
    });
    await expect((new GmailService(churn.prisma) as any).getValidAccessToken(BIZ)).rejects.toMatchObject(notConnected);
    expect(churn.writes()).toEqual([]);
    expect(refreshGrants).toEqual(['ref_a', 'ref_b']);
  });
});
