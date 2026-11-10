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
 * SupabaseAdminService), reads each user's identities[] with provider 'google'
 * (never the user-editable user_metadata) and writes the UserIdentity row
 * bootstrap writes for the local User with that id. Dry run by default (counts
 * only), --apply writes, idempotent; a sub already mapped to another local user
 * is skipped as a conflict, and a GoTrue user with no local User row is skipped.
 *
 * HOW IT IS DRIVEN (in process, real database, no provider traffic)
 * ----------------------------------------------------------------
 * The script's exported main(argv) runs with its defaults: the real
 * SupabaseAdminService (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY pinned to
 * fake values) over the installed auth-js, and the real @keyflow/db client.
 * A stubbed fetch serves GoTrue's two-page user list and records each request;
 * it also serves Google's RISC discovery document and JWKS (a test RSA key) to
 * the real RiscService, and refuses everything else. Redis is an in-memory map.
 *
 * FIXTURES: every row carries the `v95b_` prefix (users by id and email, their
 * identities by user id or sub, RISC events by jti); hard-deleted by raw SQL in
 * FK order in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
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

/** Local users (their id is the GoTrue user id, as bootstrap creates them). */
const ID = {
  pre: `${P}u_pre`, // signed in with Google before W8: no UserIdentity row (page 1)
  pre2: `${P}u_pre2`, // the same, on page 2
  emailOnly: `${P}u_email_only`, // email/password only
  metaOnly: `${P}u_meta_only`, // email only, but user_metadata carries a Google-looking 'sub'
  taken: `${P}u_taken`, // its google sub is already mapped to `holder`
  holder: `${P}u_holder`, // holds that mapping (not in GoTrue's list)
  already: `${P}u_already`, // bootstrapped after W8: its row exists
  orphan: `${P}u_orphan`, // a GoTrue user with no local User row (never created)
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
};
const GSUB = {
  pre: `${P}gsub-pre`,
  pre2: `${P}gsub-pre2`,
  meta: `${P}gsub-meta`,
  taken: `${P}gsub-taken`,
  already: `${P}gsub-already`,
  orphan: `${P}gsub-orphan`,
};
const LOCAL: (keyof typeof ID)[] = ['pre', 'pre2', 'emailOnly', 'metaOnly', 'taken', 'holder', 'already'];

/** A GoTrue identity as GET /auth/v1/admin/users returns it (`id` is the provider's id, the Google sub). */
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

/** GoTrue's user list, PER_PAGE users a page: two pages, the second short. */
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

let db: any;
let risc: any;
let RISC_EVENT_TYPES: Record<string, string>;
let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let jtiSeq = 0;
const quietLogger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };

/** Every request the stubbed fetch saw for GoTrue. */
type GoTrueCall = { method: string; path: string; page: string | null; perPage: string | null; authorization: string | null; apikey: string | null };
const gotrueCalls: GoTrueCall[] = [];
/** A page number GoTrue answers with an error instead of users (the failure case). */
let failPage: number | null = null;
const GOTRUE_ERROR_DETAIL = `${P}gotrue-error-detail`;

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
  for (const sql of [
    `DELETE FROM risc_events WHERE jti LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${sqlLikePrefix(P)} OR provider_subject LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM sessions WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

/** The operator script under test (absent before this packet: RED by absence). */
async function script(): Promise<{ main: (argv: string[], deps?: Record<string, unknown>) => Promise<number> }> {
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
    where: { OR: [{ userId: { startsWith: P } }, { providerSubject: { startsWith: P } }] },
    select: { id: true, userId: true, provider: true, providerSubject: true, email: true, createdAt: true, updatedAt: true },
    orderBy: { providerSubject: 'asc' },
  });
}

/** A Google-signed (test key) RISC security event token, handed to the real RiscService. */
async function riscEvent(googleSub: string, eventType: string) {
  const jti = `${P}jti-${++jtiSeq}-${Date.now()}`;
  const token = await new SignJWT({ jti, events: { [eventType]: { subject: { subject_type: 'iss-sub', iss: GOOGLE_ISSUER, sub: googleSub } } } })
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
      if (call.method !== 'GET' || call.path !== '/auth/v1/admin/users') {
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
      const users = GOTRUE_USERS.slice((page - 1) * perPage, page * perPage);
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

    const seeded = await rows();
    gotrueCalls.length = 0;
    const { code, out } = await run([]);

    expect(code).toBe(0);
    expect(gotrueCalls).toEqual([
      { method: 'GET', path: '/auth/v1/admin/users', page: '1', perPage: String(PER_PAGE), authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
      { method: 'GET', path: '/auth/v1/admin/users', page: '2', perPage: String(PER_PAGE), authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
    ]);
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
    expectCountsOnly(out);
  });

  it("SEC-W8RSC-3 (D-97, W9-IDENTITY-BACKFILL-SCRIPT): --apply writes exactly the google identity of each GoTrue user with a local User row, in the UserIdentity shape bootstrap writes; the email-only user, a user_metadata-only 'sub', a sub mapped to another user and a GoTrue user with no local row are skipped and counted", async () => {
    gotrueCalls.length = 0;
    const { code, out } = await run(['--apply']);

    expect(code).toBe(0);
    expect(gotrueCalls.map((c) => c.page)).toEqual(['1', '2']);
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
      expect(gotrueCalls.map((c) => c.page)).toEqual(['1', '2']);
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
});
