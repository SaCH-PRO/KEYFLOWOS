/**
 * W9-IDENTITY-BACKFILL-SCRIPT (owner ruling D-97, its residual SEC-W8RSC-3) —
 * against Postgres.
 *
 * RiscService.resolveUser maps a Google sub to a user only through
 * UserIdentity, which POST /identity/bootstrap began writing (from the VERIFIED
 * provider record) with W8-RISC-SIGNIN-CUTOFF. An account last signed in with
 * Google before that deploy has no row, so a RISC event for its sub matches no
 * user and ends no session. The operator script
 * apps/server/scripts/backfill-google-identities.ts closes that: it pages
 * GoTrue's admin user list (GET /auth/v1/admin/users, service-role key, through
 * SupabaseAdminService) to enumerate the users, reads each user's record
 * (GET /auth/v1/admin/users/{id}: the list carries no identities, review
 * CR-W9IBS-1), takes its identities[] with provider 'google' (never the
 * user-editable user_metadata) and writes the UserIdentity row bootstrap writes
 * for the local User with that id. Dry run by default (counts only), --apply
 * writes, idempotent; a sub already mapped to another local user is skipped as
 * a conflict (also in the race window, review SEC-W9IBS-2), and a GoTrue user
 * with no local User row is skipped. It counts the session-ending RISC events
 * that arrived before the backfill and that it does not replay (review
 * SEC-W9IBS-1).
 *
 * HOW IT IS DRIVEN (in process, real database, no provider traffic)
 * ----------------------------------------------------------------
 * The script's exported main(argv) runs with its defaults: the real
 * SupabaseAdminService (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY pinned to
 * fake values) over the installed auth-js, and the real @keyflow/db client.
 * A stubbed fetch serves GoTrue's two admin endpoints the way supabase/auth
 * builds them (review CR-W9IBS-1/CR-W9IBS-2): the user LIST
 * (GET /auth/v1/admin/users, models.FindUsersInAudience, no Eager load) answers
 * every user with `identities: null`; only the user RECORD
 * (GET /auth/v1/admin/users/{id}, models.findUser, Eager) carries them. It
 * records each request, serves Google's RISC discovery document and JWKS (a
 * test RSA key) to the real RiscService, and refuses everything else. Redis is
 * an in-memory map.
 *
 * FIXTURES: user ids are random UUIDs (a GoTrue user id is one, and auth-js's
 * getUserById refuses anything else); every other value carries the `v95b_`
 * prefix (user emails and names, Google subs, RISC event jtis). Hard-deleted by
 * raw SQL in FK order (by email prefix, sub prefix and jti prefix) in beforeAll
 * and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

const P = 'v95b_';

// Pinned BEFORE the repo-root .env is read (dotenv never overrides a key that
// is already present): a fake GoTrue the stubbed fetch answers, a fake
// service-role key, and a Google client id RISC accepts.
const GOTRUE_URL = 'http://gotrue.v95b.test';
const SERVICE_ROLE_KEY = 'v95b-service-role-key-not-real';
const GOOGLE_CLIENT = 'v95b-client.apps.googleusercontent.com';
const GOOGLE_ISSUER = 'https://accounts.google.com/';
const JWKS_URI = 'https://risc.v95b.test/certs';
const PINNED: Record<string, string> = {
  SUPABASE_URL: GOTRUE_URL,
  NEXT_PUBLIC_SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  GOOGLE_CLIENT_ID: GOOGLE_CLIENT,
  GOOGLE_CLIENT_IDS: '',
};
const savedEnv: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(PINNED)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Local users (their id is the GoTrue user id, as bootstrap creates them: a
 * UUID, which auth-js's getUserById insists on).
 */
const ID = {
  pre: randomUUID(), // signed in with Google before W8: no UserIdentity row (page 1)
  pre2: randomUUID(), // the same, on page 2
  emailOnly: randomUUID(), // email/password only
  metaOnly: randomUUID(), // email only, but user_metadata carries a Google-looking 'sub'
  taken: randomUUID(), // its google sub is already mapped to `holder`
  holder: randomUUID(), // holds that mapping (not in GoTrue's list)
  already: randomUUID(), // bootstrapped after W8: its row exists
  orphan: randomUUID(), // a GoTrue user with no local User row (never created)
  racer: randomUUID(), // SEC-W9IBS-2: claims a sub another writer maps meanwhile (not in GoTrue's list)
};
const EMAIL = {
  pre: `${P}pre@test.local`,
  pre2: `${P}pre2@test.local`,
  emailOnly: `${P}email-only@test.local`,
  metaOnly: `${P}meta-only@test.local`,
  taken: `${P}taken@test.local`,
  holder: `${P}holder@test.local`,
  already: `${P}already@test.local`,
  orphan: `${P}orphan@test.local`,
  racer: `${P}racer@test.local`,
};
const GSUB = {
  pre: `${P}gsub-pre`,
  pre2: `${P}gsub-pre2`,
  meta: `${P}gsub-meta`,
  taken: `${P}gsub-taken`,
  already: `${P}gsub-already`,
  orphan: `${P}gsub-orphan`,
  race: `${P}gsub-race`,
};
const LOCAL: (keyof typeof ID)[] = ['pre', 'pre2', 'emailOnly', 'metaOnly', 'taken', 'holder', 'already', 'racer'];

/** A GoTrue identity as GET /auth/v1/admin/users/{id} returns it (`id` is the provider's id, the Google sub). */
function identity(userId: string, provider: string, providerId: string, data: Record<string, unknown>) {
  return {
    identity_id: `${userId}-${provider}-identity`,
    id: providerId,
    user_id: userId,
    provider,
    identity_data: data,
    last_sign_in_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}
function gotrueUser(
  key: keyof typeof ID,
  identities: ReturnType<typeof identity>[],
  userMetadata: Record<string, unknown> = {},
) {
  return {
    id: ID[key],
    aud: 'authenticated',
    role: 'authenticated',
    email: EMAIL[key],
    app_metadata: { provider: identities[0]?.provider ?? 'email', providers: identities.map((i) => i.provider) },
    user_metadata: userMetadata,
    identities,
    created_at: '2026-01-01T00:00:00Z',
  };
}
const googleOf = (key: keyof typeof ID, sub: string) =>
  identity(ID[key], 'google', sub, { sub, email: EMAIL[key], email_verified: true, iss: 'https://accounts.google.com' });
const emailOf = (key: keyof typeof ID) => identity(ID[key], 'email', ID[key], { sub: ID[key], email: EMAIL[key] });

/** GoTrue's users (their records, identities loaded), PER_PAGE a page in the list: two pages, the second short. */
const PER_PAGE = 4;
const GOTRUE_USERS = [
  gotrueUser('pre', [googleOf('pre', GSUB.pre)]),
  gotrueUser('emailOnly', [emailOf('emailOnly')]),
  // user_metadata is user-editable at GoTrue (PUT /auth/v1/user): its 'sub' must never be mapped.
  gotrueUser('metaOnly', [emailOf('metaOnly')], {
    sub: GSUB.meta,
    provider_id: GSUB.meta,
    iss: 'https://accounts.google.com',
    email: EMAIL.metaOnly,
  }),
  gotrueUser('taken', [googleOf('taken', GSUB.taken)]),
  gotrueUser('orphan', [googleOf('orphan', GSUB.orphan)]),
  gotrueUser('already', [googleOf('already', GSUB.already)]),
  gotrueUser('pre2', [emailOf('pre2'), googleOf('pre2', GSUB.pre2)]),
];
/** The list order, by page. */
const PAGE_1: (keyof typeof ID)[] = ['pre', 'emailOnly', 'metaOnly', 'taken'];
const PAGE_2: (keyof typeof ID)[] = ['orphan', 'already', 'pre2'];

let db: any;
let risc: any;
let RISC_EVENT_TYPES: Record<string, string>;
let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let jtiSeq = 0;
/** What the first --apply printed (read again by the SEC-W9IBS-1 case). */
let applyOut = '';
const quietLogger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };

/** Every request the stubbed fetch saw for GoTrue. */
type GoTrueCall = { method: string; path: string; page: string | null; perPage: string | null; authorization: string | null; apikey: string | null };
const gotrueCalls: GoTrueCall[] = [];
/** A page number GoTrue answers with an error instead of users (the failure case). */
let failPage: number | null = null;
/** A user id whose record GoTrue answers with an error (CR-W9IBS-1). */
let failRecordOf: string | null = null;
/** Serve user records with `identities: null`, as the list does (CR-W9IBS-1: never read as 'no Google identity'). */
let recordIdentitiesNull = false;
const GOTRUE_ERROR_DETAIL = `${P}gotrue-error-detail`;
const LIST_PATH = '/auth/v1/admin/users';
const isListCall = (c: GoTrueCall) => c.path === LIST_PATH;
const listCall = (page: number): GoTrueCall => ({
  method: 'GET',
  path: LIST_PATH,
  page: String(page),
  perPage: String(PER_PAGE),
  authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  apikey: SERVICE_ROLE_KEY,
});
const recordCall = (key: keyof typeof ID): GoTrueCall => ({
  method: 'GET',
  path: `${LIST_PATH}/${ID[key]}`,
  page: null,
  perPage: null,
  authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  apikey: SERVICE_ROLE_KEY,
});

/** The in-memory Redis RiscService writes its cutoffs to. */
const redisStore = new Map<string, string>();
const redis = {
  get: async (k: string) => redisStore.get(k) ?? null,
  set: async (k: string, v: string) => {
    redisStore.set(k, String(v));
    return 'OK';
  },
  setex: async (k: string, _ttl: number, v: string) => {
    redisStore.set(k, String(v));
    return 'OK';
  },
  pttl: async (k: string) => (redisStore.has(k) ? 86_400_000 : -2),
  del: async (k: string) => (redisStore.delete(k) ? 1 : 0),
};

async function cleanup() {
  // This suite's users, by email prefix (their ids are UUIDs).
  const ownUsers = `SELECT id FROM users WHERE email LIKE ${sqlLikePrefix(P)}`;
  for (const sql of [
    `DELETE FROM risc_events WHERE jti LIKE ${sqlLikePrefix(P)} OR provider_subject LIKE ${sqlLikePrefix(P)} OR user_id IN (${ownUsers})`,
    `DELETE FROM user_identities WHERE provider_subject LIKE ${sqlLikePrefix(P)} OR user_id IN (${ownUsers})`,
    `DELETE FROM sessions WHERE user_id IN (${ownUsers})`,
    `DELETE FROM users WHERE email LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

/** The operator script under test (absent before this packet: RED by absence). */
async function script(): Promise<{
  main: (argv: string[], deps?: Record<string, unknown>) => Promise<number>;
  backfillGoogleIdentities: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
}> {
  return import('../scripts/backfill-google-identities');
}

/** Run the script's CLI entry with its default GoTrue client and database; returns the exit code and everything it printed. */
async function run(argv: string[]) {
  const { main } = await script();
  const lines: string[] = [];
  const log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  const code = await main(argv, { log, error: log, perPage: PER_PAGE });
  return { code, out: lines.join('\n') };
}

/** The google UserIdentity rows of this suite, ordered by sub. */
async function rows() {
  return db.userIdentity.findMany({
    where: { OR: [{ userId: { in: Object.values(ID) } }, { providerSubject: { startsWith: P } }] },
    select: { id: true, userId: true, provider: true, providerSubject: true, email: true, createdAt: true, updatedAt: true },
    orderBy: { providerSubject: 'asc' },
  });
}

/** A Google-signed (test key) RISC security event token, handed to the real RiscService. */
async function riscEvent(googleSub: string, eventType: string, reason?: string) {
  const jti = `${P}jti-${++jtiSeq}-${Date.now()}`;
  const subject = { subject_type: 'iss-sub', iss: GOOGLE_ISSUER, sub: googleSub };
  const token = await new SignJWT({ jti, events: { [eventType]: reason ? { subject, reason } : { subject } } })
    .setProtectedHeader({ alg: 'RS256', kid: 'v95b-key', typ: 'JWT' })
    .setIssuer(GOOGLE_ISSUER)
    .setAudience(GOOGLE_CLIENT)
    .setIssuedAt()
    .sign(keyPair.privateKey);
  const result = await risc.receiveEvent(token);
  const row = await db.riscEvent.findUnique({ where: { jti } });
  return { result, row };
}

/** Assert that nothing printed names a fixture (every email, sub and user id carries P) or the key. */
function expectCountsOnly(out: string) {
  expect(out).not.toContain(P);
  for (const id of Object.values(ID)) expect(out).not.toContain(id);
  expect(out).not.toContain(SERVICE_ROLE_KEY);
  expect(out).not.toMatch(/@/);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  keyPair = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'v95b-key', use: 'sig', alg: 'RS256' };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.href === 'https://accounts.google.com/.well-known/risc-configuration') {
      return new Response(JSON.stringify({ issuer: GOOGLE_ISSUER, jwks_uri: JWKS_URI }), { status: 200 });
    }
    if (url.href === JWKS_URI) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    if (url.origin === GOTRUE_URL) {
      const headers = new Headers((init?.headers ?? (input instanceof Request ? input.headers : undefined)) as HeadersInit | undefined);
      const call: GoTrueCall = {
        method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(),
        path: url.pathname,
        page: url.searchParams.get('page'),
        perPage: url.searchParams.get('per_page'),
        authorization: headers.get('authorization'),
        apikey: headers.get('apikey'),
      };
      gotrueCalls.push(call);
      // GET /auth/v1/admin/users/{id}: models.findUser, identities eager-loaded.
      const recordId = call.method === 'GET' && call.path.startsWith(`${LIST_PATH}/`) ? call.path.slice(LIST_PATH.length + 1) : null;
      if (recordId !== null) {
        if (failRecordOf !== null && recordId === failRecordOf) {
          return new Response(JSON.stringify({ code: 500, error_code: 'unexpected_failure', msg: GOTRUE_ERROR_DETAIL }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          });
        }
        const record = GOTRUE_USERS.find((u) => u.id === recordId);
        if (!record) {
          return new Response(JSON.stringify({ code: 404, error_code: 'user_not_found', msg: 'User not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(recordIdentitiesNull ? { ...record, identities: null } : record), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call.method !== 'GET' || call.path !== LIST_PATH) {
        return new Response(JSON.stringify({ code: 404, msg: 'not served by this stub' }), { status: 404 });
      }
      const page = Number(call.page);
      const perPage = Number(call.perPage);
      if (failPage !== null && page === failPage) {
        return new Response(JSON.stringify({ code: 401, error_code: 'bad_jwt', msg: GOTRUE_ERROR_DETAIL }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      // models.FindUsersInAudience: tx.Q() with no Eager(), so every listed user's identities are null.
      const users = GOTRUE_USERS.slice((page - 1) * perPage, page * perPage).map((u) => ({ ...u, identities: null }));
      return new Response(JSON.stringify({ users, aud: 'authenticated' }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-total-count': String(GOTRUE_USERS.length) },
      });
    }
    return new Response('no provider traffic in this suite', { status: 599 });
  });

  const { RiscService } = await import('../src/modules/risc/risc.service');
  ({ RISC_EVENT_TYPES } = await import('../src/modules/risc/risc.types'));
  risc = new RiscService(
    { client: db } as never,
    { isConfigured: () => true, getClient: () => ({ auth: { admin: {} } }), signOut: async () => false } as never,
    { audit: async () => undefined } as never,
    { on: () => undefined, emit: () => true } as never,
    redis as never,
  );
  (risc as { logger: unknown }).logger = quietLogger;

  await cleanup(); // in case a prior run aborted
  for (const key of LOCAL) {
    await db.user.create({ data: { id: ID[key], email: EMAIL[key], name: `${P}${key}` } });
  }
  // A sub already mapped to ANOTHER local user, and a row bootstrap already wrote.
  await db.userIdentity.create({ data: { userId: ID.holder, provider: 'google', providerSubject: GSUB.taken, email: EMAIL.holder } });
  await db.userIdentity.create({ data: { userId: ID.already, provider: 'google', providerSubject: GSUB.already, email: EMAIL.already } });
});

afterAll(async () => {
  await cleanup();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('W9-IDENTITY-BACKFILL-SCRIPT (D-97 residual SEC-W8RSC-3) — operator backfill of UserIdentity from GoTrue for pre-deploy Google users, against Postgres', () => {
  it('SEC-W8RSC-3 (D-97, W9-IDENTITY-BACKFILL-SCRIPT): a dry run pages GoTrue\'s admin user list (GET /auth/v1/admin/users, service-role key, two pages), writes nothing, and prints counts only — no email, Google sub, user id or key', async () => {
    // The residual: before any backfill, a RISC event for the pre-deploy Google user's sub ends nobody's session.
    const before = await riscEvent(GSUB.pre, RISC_EVENT_TYPES.SESSIONS_REVOKED);
    expect(before.row).toMatchObject({ userId: null, actionTaken: 'no_matching_user' });
    // Review SEC-W9IBS-1: more events Google sends before the backfill, each answered 202 and never sent again.
    // Session-ending (counted below once their sub resolves): tokens-revoked for pre, account-disabled/hijacking for pre2.
    for (const [sub, type, reason] of [
      [GSUB.pre, RISC_EVENT_TYPES.TOKENS_REVOKED, undefined],
      [GSUB.pre2, RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking'],
      // Not session-ending (never counted): verification, account-disabled for bulk-account.
      [GSUB.pre2, RISC_EVENT_TYPES.VERIFICATION, undefined],
      [GSUB.pre, RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'],
      // Session-ending, but its sub never resolves (no local User row): never counted.
      [GSUB.orphan, RISC_EVENT_TYPES.SESSIONS_REVOKED, undefined],
    ] as const) {
      expect((await riscEvent(sub, type, reason)).row).toMatchObject({ userId: null, actionTaken: 'no_matching_user' });
    }

    const seeded = await rows();
    gotrueCalls.length = 0;
    const { code, out } = await run([]);

    expect(code).toBe(0);
    // Review CR-W9IBS-1: the list (identities null, as GoTrue serves it) only enumerates the users; each
    // user's Google identity is read from its record, GET /auth/v1/admin/users/{id}, as bootstrap reads it.
    expect(gotrueCalls).toEqual([listCall(1), ...PAGE_1.map(recordCall), listCall(2), ...PAGE_2.map(recordCall)]);
    expect(await rows()).toEqual(seeded);

    expect(out).toMatch(/dry run/i);
    expect(out).toMatch(/gotrue_users_scanned\s+7\b/);
    expect(out).toMatch(/gotrue_pages_read\s+2\b/);
    expect(out).toMatch(/google_identities_found\s+5\b/);
    expect(out).toMatch(/users_without_google_identity\s+2\b/);
    expect(out).toMatch(/skipped_no_local_user\s+1\b/);
    expect(out).toMatch(/already_mapped\s+1\b/);
    expect(out).toMatch(/skipped_conflict_other_user\s+1\b/);
    expect(out).toMatch(/would_write\s+2\b/);
    expect(out).not.toMatch(/\bwritten\s+\d/);
    // SEC-W9IBS-1: the three session-ending events for pre and pre2 would resolve after --apply.
    expect(out).toMatch(/gotrue_user_records_read\s+7\b/);
    expect(out).toMatch(/unapplied_risc_events\s+3\b/);
    expect(out).toMatch(/unapplied_risc_accounts\s+2\b/);
    expectCountsOnly(out);
  });

  it("SEC-W8RSC-3 (D-97, W9-IDENTITY-BACKFILL-SCRIPT): --apply writes exactly the google identity of each GoTrue user with a local User row, in the UserIdentity shape bootstrap writes; the email-only user, a user_metadata-only 'sub', a sub mapped to another user and a GoTrue user with no local row are skipped and counted", async () => {
    gotrueCalls.length = 0;
    const { code, out } = await run(['--apply']);
    applyOut = out;

    expect(code).toBe(0);
    expect(gotrueCalls.filter(isListCall).map((c) => c.page)).toEqual(['1', '2']);
    expect((await rows()).map(({ userId, provider, providerSubject, email }: any) => ({ userId, provider, providerSubject, email }))).toEqual([
      { userId: ID.already, provider: 'google', providerSubject: GSUB.already, email: EMAIL.already },
      { userId: ID.pre, provider: 'google', providerSubject: GSUB.pre, email: EMAIL.pre },
      { userId: ID.pre2, provider: 'google', providerSubject: GSUB.pre2, email: EMAIL.pre2 },
      { userId: ID.holder, provider: 'google', providerSubject: GSUB.taken, email: EMAIL.holder },
    ]);
    // Never user_metadata, never a user without a local row, never an email identity.
    expect(await db.userIdentity.count({ where: { providerSubject: GSUB.meta } })).toBe(0);
    expect(await db.userIdentity.count({ where: { providerSubject: GSUB.orphan } })).toBe(0);
    expect(await db.userIdentity.count({ where: { userId: { in: [ID.emailOnly, ID.metaOnly, ID.taken] } } })).toBe(0);
    expect(await db.user.count({ where: { id: ID.orphan } })).toBe(0);

    expect(out).toMatch(/gotrue_users_scanned\s+7\b/);
    expect(out).toMatch(/skipped_no_local_user\s+1\b/);
    expect(out).toMatch(/already_mapped\s+1\b/);
    expect(out).toMatch(/skipped_conflict_other_user\s+1\b/);
    expect(out).toMatch(/\bwritten\s+2\b/);
    expect(out).toMatch(/\bfailed\s+0\b/);
    expect(out).not.toMatch(/would_write/);
    expectCountsOnly(out);
  });

  it('SEC-W9IBS-1 (D-97 residual SEC-W8RSC-3, W9-IDENTITY-BACKFILL-SCRIPT): a session-ending RISC event that arrived before the backfill is not replayed by --apply (the account holds no sign-in cutoff), so the --apply report counts such events and their accounts — not the verification, bulk-account or unresolved ones — and tells the operator to act on them', async () => {
    // Each was answered 202, so Google sends none again: the events stay as stored, and nothing applied their cutoff.
    const missed = await db.riscEvent.findMany({
      where: { jti: { startsWith: P }, providerSubject: { in: [GSUB.pre, GSUB.pre2] } },
      select: { userId: true, actionTaken: true },
    });
    expect(missed).toHaveLength(5);
    for (const row of missed) expect(row).toEqual({ userId: null, actionTaken: 'no_matching_user' });
    for (const who of ['pre', 'pre2'] as const) {
      const user = await db.user.findUnique({ where: { id: ID[who] }, select: { metaData: true } });
      expect((user?.metaData as Record<string, unknown> | null)?.signInCutoffAt).toBeUndefined();
    }

    // The --apply report names them, counts only: sessions-revoked + tokens-revoked (pre), account-disabled/hijacking (pre2).
    expect(applyOut).toMatch(/unapplied_risc_events\s+3\b/);
    expect(applyOut).toMatch(/unapplied_risc_accounts\s+2\b/);
    expect(applyOut).toMatch(/no sign-in cutoff was applied/i);
    expect(applyOut).toContain('docs/development/risc-setup.md');
    expectCountsOnly(applyOut);

    // The query that doc gives the operator lists exactly those events and accounts.
    const doc = readFileSync(path.resolve(__dirname, '../../../docs/development/risc-setup.md'), 'utf8');
    const sql = doc.split('### RISC events that arrived before the backfill')[1]?.match(/```sql\n([\s\S]*?)```/)?.[1];
    expect(sql).toBeTruthy();
    const listed = ((await db.$queryRawUnsafe(sql as string)) as { user_id: string }[]).filter((r) => Object.values(ID).includes(r.user_id));
    expect(listed).toHaveLength(3);
    expect(new Set(listed.map((r) => r.user_id))).toEqual(new Set([ID.pre, ID.pre2]));
  });

  it('SEC-W8RSC-3 (D-97, W9-IDENTITY-BACKFILL-SCRIPT): a second --apply is idempotent — it writes nothing, every row keeps its id and timestamps, and the counts say so', async () => {
    const first = await rows();
    const { code, out } = await run(['--apply']);

    expect(code).toBe(0);
    expect(await rows()).toEqual(first);
    expect(out).toMatch(/\bwritten\s+0\b/);
    expect(out).toMatch(/already_mapped\s+3\b/);
    expect(out).toMatch(/skipped_conflict_other_user\s+1\b/);
    expect(out).toMatch(/skipped_no_local_user\s+1\b/);
    expectCountsOnly(out);
  });

  it('SEC-W8RSC-3 (D-97, W9-IDENTITY-BACKFILL-SCRIPT): after the backfill a RISC sessions-revoked event for a backfilled Google sub resolves that user and records the durable sign-in cutoff; the conflicting sub still resolves its holder and the orphan sub nobody', async () => {
    for (const who of ['pre', 'pre2'] as const) {
      const { result, row } = await riscEvent(GSUB[who], RISC_EVENT_TYPES.SESSIONS_REVOKED);
      expect(result).toEqual({ status: 202, processed: true });
      expect(row).toMatchObject({ userId: ID[who], providerSubject: GSUB[who], actionTaken: 'sessions_terminated' });
      const user = await db.user.findUnique({ where: { id: ID[who] }, select: { metaData: true } });
      expect(typeof (user?.metaData as Record<string, unknown> | null)?.signInCutoffAt).toBe('number');
    }

    expect((await riscEvent(GSUB.taken, RISC_EVENT_TYPES.VERIFICATION)).row).toMatchObject({ userId: ID.holder });
    expect((await riscEvent(GSUB.orphan, RISC_EVENT_TYPES.SESSIONS_REVOKED)).row).toMatchObject({ userId: null, actionTaken: 'no_matching_user' });
    expect((await riscEvent(GSUB.meta, RISC_EVENT_TYPES.SESSIONS_REVOKED)).row).toMatchObject({ userId: null, actionTaken: 'no_matching_user' });
  });

  it('SEC-W8RSC-3 (D-97, W9-IDENTITY-BACKFILL-SCRIPT): a GoTrue page that answers an error stops the walk with exit 1 — never read as the end of the list — and prints the status, not the provider\'s message', async () => {
    failPage = 2;
    try {
      gotrueCalls.length = 0;
      const { code, out } = await run([]);
      expect(code).toBe(1);
      expect(gotrueCalls).toEqual([listCall(1), ...PAGE_1.map(recordCall), listCall(2)]);
      expect(out).toMatch(/401/);
      expect(out).not.toMatch(/would_write/);
      expect(out).not.toContain(GOTRUE_ERROR_DETAIL);
      expectCountsOnly(out);
    } finally {
      failPage = null;
    }
  });

  it('SEC-W8RSC-3 (D-97, W9-IDENTITY-BACKFILL-SCRIPT): an unknown argument is refused with exit 2 before GoTrue is read', async () => {
    gotrueCalls.length = 0;
    const { code } = await run(['--aply']);
    expect(code).toBe(2);
    expect(gotrueCalls).toEqual([]);
  });

  it("CR-W9IBS-1 (D-97 residual SEC-W8RSC-3, W9-IDENTITY-BACKFILL-SCRIPT): a user record whose identities are not loaded (null, as GoTrue's list serves them) stops the run with exit 1 — it is never counted as a user without a Google identity", async () => {
    recordIdentitiesNull = true;
    try {
      gotrueCalls.length = 0;
      const { code, out } = await run([]);
      expect(code).toBe(1);
      expect(gotrueCalls).toEqual([listCall(1), recordCall('pre')]);
      expect(out).toMatch(/identities not loaded/i);
      expect(out).not.toMatch(/users_without_google_identity/);
      expect(out).not.toMatch(/would_write/);
      expectCountsOnly(out);
    } finally {
      recordIdentitiesNull = false;
    }
  });

  it("CR-W9IBS-1 (D-97 residual SEC-W8RSC-3, W9-IDENTITY-BACKFILL-SCRIPT): a user record GoTrue answers with an error stops the run with exit 1 and prints the status, not the provider's message", async () => {
    failRecordOf = ID.taken;
    try {
      gotrueCalls.length = 0;
      const { code, out } = await run(['--apply']);
      expect(code).toBe(1);
      expect(gotrueCalls).toEqual([listCall(1), ...PAGE_1.map(recordCall)]);
      expect(out).toMatch(/500/);
      expect(out).not.toContain(GOTRUE_ERROR_DETAIL);
      expect(out).not.toMatch(/unapplied_risc_events/);
      expectCountsOnly(out);
    } finally {
      failRecordOf = null;
    }
  });

  it("SEC-W9IBS-2 (D-97 residual SEC-W8RSC-3, W9-IDENTITY-BACKFILL-SCRIPT): a row another writer creates for the sub after the pre-read (the race window) is never re-pointed by --apply's upsert: it keeps its holder, email and timestamps, and is counted as a conflict, not as written", async () => {
    const { backfillGoogleIdentities } = await script();
    // Another writer (bootstrap of the sub's holder) maps the sub after the backfill's pre-read saw no row.
    const held = await db.userIdentity.create({
      data: { userId: ID.holder, provider: 'google', providerSubject: GSUB.race, email: EMAIL.holder },
    });
    const admin = {
      listUsersPage: async (page: number) => (page === 1 ? [{ id: ID.racer, identities: null }] : []),
      getUserRecord: async (id: string) => ({ id, identities: id === ID.racer ? [googleOf('racer', GSUB.race)] : [] }),
    };
    // The real client, except that the pre-read finds no row: the window between it and the upsert.
    const raceDb = {
      user: db.user,
      riscEvent: db.riscEvent,
      userIdentity: { findMany: async () => [], upsert: (args: unknown) => db.userIdentity.upsert(args) },
    };

    const counts = await backfillGoogleIdentities({ admin, db: raceDb, apply: true, perPage: 10 });

    expect(counts).toMatchObject({ googleIdentitiesFound: 1, skippedConflictOtherUser: 1, written: 0, failed: 0 });
    expect(await db.userIdentity.findUnique({ where: { id: held.id } })).toEqual(held);
    expect(await db.userIdentity.count({ where: { userId: ID.racer } })).toBe(0);
  });

  it("SEC-W9IBS-1 (D-97 residual SEC-W8RSC-3, W9-IDENTITY-BACKFILL-SCRIPT): the unapplied RISC event count reads every matching risc_events row, past @keyflow/db's 1000-row findMany cap", async () => {
    const EXTRA = 1005;
    await db.riscEvent.createMany({
      data: Array.from({ length: EXTRA }, (_, i) => ({
        jti: `${P}bulk-${i}`,
        eventType: RISC_EVENT_TYPES.SESSIONS_REVOKED,
        providerSubject: GSUB.pre,
        userId: null,
        actionTaken: 'no_matching_user',
        payload: { reason: null, state: null },
        processedAt: new Date(),
      })),
    });

    const { code, out } = await run([]);

    expect(code).toBe(0);
    // The three from before the backfill (two for pre, one for pre2), plus these.
    expect(out).toMatch(new RegExp(`unapplied_risc_events\\s+${3 + EXTRA}\\b`));
    expect(out).toMatch(/unapplied_risc_accounts\s+2\b/);
    expectCountsOnly(out);
  });
});
