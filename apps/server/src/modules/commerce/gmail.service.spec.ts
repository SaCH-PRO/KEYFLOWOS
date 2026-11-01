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
 * owner rule (OWNER membership, Business.ownerId, SUPER_ADMIN).
 */
import 'reflect-metadata';
import { createHmac } from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GmailService } from './gmail.service';

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
 * business.findFirst answer the owner rule from `state`; connectorAccount keeps
 * the rows it was given in memory, so a staged row can be confirmed.
 */
function fakePrisma(state: { memberships?: Record<string, string>; ownerId?: string; claimLoses?: boolean } = {}) {
  const calls: Call[] = [];
  const pending: any[] = [];
  // Scalar equality on every key but OR; an OR of { settings: { path: ['userId'], equals } } and
  // { createdAt: { lt } } is evaluated against the row, as Postgres would.
  const matchesOr = (row: any, or: any[] | undefined) =>
    !or || or.some((c) =>
      (c.settings ? row.settings?.[c.settings.path[0]] === c.settings.equals : true) &&
      (c.createdAt ? row.createdAt < c.createdAt.lt : true));
  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => k === 'OR' || row[k] === v) && matchesOr(row, where?.OR);
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
        return args.where.ownerId === state.ownerId && args.where.id === BIZ ? { id: BIZ } : null;
      },
      update: async (args: any) => {
        calls.push({ model: 'business', method: 'update', args });
        return { id: args.where.id, ...args.data };
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
      deleteMany: async (args: any) => {
        calls.push({ model: 'connectorAccount', method: 'deleteMany', args });
        if (state.claimLoses && args.where.id) return { count: 0 };
        const before = pending.length;
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (matches(pending[i], args.where)) pending.splice(i, 1);
        }
        return { count: before - pending.length };
      },
    },
  };
  const writes = () => calls.filter((c) => WRITE_METHODS.has(c.method));
  return { prisma: { client } as any, calls, pending, writes };
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

  it('[R0-CMF5-U05] RED-BEFORE: assertConnectAuthority admits the OWNER membership, the distinguished owner and SUPER_ADMIN; it refuses STAFF and ADMIN with 403 GMAIL_OWNER_ONLY and no actor with 401', async () => {
    const { prisma } = fakePrisma({ memberships: { [OWNER.id]: 'OWNER', [STAFF.id]: 'STAFF', [ADMIN.id]: 'ADMIN' }, ownerId: DIST_OWNER.id });
    const gmail = new GmailService(prisma) as any;
    expect(typeof gmail.assertConnectAuthority).toBe('function');
    await expect(gmail.assertConnectAuthority(BIZ, OWNER)).resolves.toBeUndefined();
    await expect(gmail.assertConnectAuthority(BIZ, DIST_OWNER)).resolves.toBeUndefined();
    await expect(gmail.assertConnectAuthority(BIZ, SUPER)).resolves.toBeUndefined();
    for (const actor of [STAFF, ADMIN]) {
      const err = await gmail.assertConnectAuthority(BIZ, actor).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'GMAIL_OWNER_ONLY' });
    }
    await expect(gmail.assertConnectAuthority(BIZ, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('[R0-CMF5-U06] RED-BEFORE: confirmPendingConnection checks the owner rule before it reads any pending row; a refused member reads and writes nothing', async () => {
    const { prisma, calls, writes } = fakePrisma({ memberships: { [STAFF.id]: 'STAFF' } });
    const gmail = new GmailService(prisma) as any;
    const err = await gmail.confirmPendingConnection(BIZ, STAFF, 'gmc_whatever').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(calls.filter((c) => c.model === 'connectorAccount')).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('[R0-CMF5-U07] RED-BEFORE: confirmPendingConnection refuses (404 GMAIL_PENDING_NOT_FOUND, no Business write) a pending id of another user, of another business, past its window, unknown, or claimed by a concurrent confirmation', async () => {
    stubGoogle();
    const expectNotFound = async (gmail: any, businessId: string, actor: any, pendingId: string, writes: () => Call[]) => {
      const err = await gmail.confirmPendingConnection(businessId, actor, pendingId).catch((e: unknown) => e);
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

    await expect(gmail.confirmPendingConnection(BIZ, OWNER, pendingId)).resolves.toEqual({ connected: true, email: 'owner8@gmail.test' });
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
});
