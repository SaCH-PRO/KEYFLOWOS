/**
 * RR-DB-CRYPTO-KEY-CENSUS (V1-72; rulings D-261, D-262, D-174):
 * Read-only census of which key every stored `enc:v1:` token was encrypted under,
 * so the packages/db production key guard can be landed on evidence.
 *
 * REAL Postgres (DATABASE_URL), zero writes by the census, zero provider traffic.
 *
 *   V72T-01  Premise & fallback detection: a ChannelConnection token seeded with all
 *            three key vars unset (encrypted under the in-repo dev fallback) cannot be
 *            read once CONNECTOR_CREDENTIALS_KEY is set, even though
 *            DiagnosticsService.checkTokenEncryptionKeySource() reports 'pass'.
 *            The census reports that row as 'fallback' with its id and column.
 *   V72T-02  Active key ('current'): a row written under the active key is counted as
 *            'current' and omitted from non-current id lists.
 *   V72T-03  Unprefixed ('plaintext'): raw unprefixed values across multiple encrypted
 *            models (ChannelConnection.token, Webhook.secret) are reported as 'plaintext'
 *            with their ids and columns.
 *   V72T-04  core/crypto divergence ('core-chain'): a value encrypted by core/crypto
 *            under DRIVE_TOKEN_ENCRYPTION_SECRET alone is reported as 'core-chain' with
 *            its id and column, both when CONNECTOR_CREDENTIALS_KEY or JWT_SECRET is set
 *            and when only DRIVE_TOKEN_ENCRYPTION_SECRET is set (while fallback rows
 *            remain 'fallback', never falsely reported as 'current').
 *   V72T-05  Corrupted ciphertext ('undecryptable'): tampered and truncated enc:v1:
 *            values are reported as 'undecryptable' with their ids and columns.
 *   V72T-06  classifyStoredToken contract: exported from @keyflow/db, returns ONLY one
 *            of the five labels, never returns a plaintext or key, and never reports a
 *            fallback-encrypted row as 'current' when no key env var is set.
 *   V72T-07  Zero leakage & CLI refusal: formatted report and JSON output contain zero
 *            token plaintexts, zero key material, zero enc:v1: ciphertext, and zero
 *            DATABASE_URL; CLI refuses --apply with exit code 2.
 *   V72T-08  Zero writes proof: SQL statement tap verifies SET TRANSACTION READ ONLY
 *            precedes all SELECTs, every table query is a SELECT, and Postgres enforces
 *            read-only transactions (SQLSTATE 25006).
 *   V72T-09  Coverage & diagnostics detail: the column list walked by the census equals
 *            ENCRYPTED_FIELDS 1:1; checkTokenEncryptionKeySource() preserves 'pass'/'warn'/'fail'
 *            behavior while naming apps/server/scripts/token-encryption-key-census.ts in detail.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';
import { encryptToken as encryptCoreToken } from '../src/core/crypto/token-crypto';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 60_000, hookTimeout: 300_000 });

const P = 'v72t_';
const CIPHER_PREFIX = ['enc', 'v1', ''].join(':');
const DEV_FALLBACK_LITERAL = ['dev', 'only', 'local', 'key', 'not', 'for', 'production'].join('-');
const ENV_KEYS = [
  'CONNECTOR_CREDENTIALS_KEY',
  'CREDENTIALS_ENCRYPTION_KEY',
  'JWT_SECRET',
  'DRIVE_TOKEN_ENCRYPTION_SECRET',
  'NODE_ENV',
] as const;

const savedSuiteEnv: Record<string, string | undefined> = {};
const savedTestEnv: Record<string, string | undefined> = {};

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  ccFallback: `${P}cc_fallback`,
  ccCurrent: `${P}cc_current`,
  ccPlaintext: `${P}cc_plaintext`,
  ccCoreChain: `${P}cc_corechain`,
  ccCorrupted: `${P}cc_corrupted`,
  whPlaintext: `${P}wh_plaintext`,
};

// Built at runtime from fragments so no secret-shaped literal lives in source.
const SECRET_ACTIVE = [P, 'active', 'connector', 'key', '9101'].join('-');
const SECRET_JWT = [P, 'jwt', 'chain', 'key', '9102'].join('-');
const SECRET_DRIVE = [P, 'drive', 'core', 'chain', 'key', '9103'].join('-');

const TOKENS = {
  fallback: [P, 'tok', 'fallback', 'canary', 'a1'].join('_'),
  current: [P, 'tok', 'current', 'canary', 'b2'].join('_'),
  plaintext: [P, 'tok', 'plaintext', 'canary', 'c3'].join('_'),
  coreChain: [P, 'tok', 'corechain', 'canary', 'd4'].join('_'),
  webhookPlain: [P, 'tok', 'webhook', 'canary', 'e5'].join('_'),
};

type TokenLabel = 'plaintext' | 'current' | 'fallback' | 'core-chain' | 'undecryptable';
type NonCurrentLabel = Exclude<TokenLabel, 'current'>;

interface ColumnCensusResult {
  model: string;
  field: string;
  column: string;
  table: string;
  dbColumn: string;
  scanned: number;
  counts: Record<TokenLabel, number>;
  nonCurrentIds: Record<NonCurrentLabel, string[]>;
}

interface CensusReport {
  keySource: string | null;
  coreChainVarSet: boolean;
  pageSize: number;
  columns: ColumnCensusResult[];
  totals: Record<TokenLabel, number>;
}

interface CensusModule {
  runTokenEncryptionKeyCensus: (
    prisma: unknown,
    opts?: { pageSize?: number; encryptedFields?: Record<string, readonly string[]> },
  ) => Promise<CensusReport>;
  formatCensusReport: (report: CensusReport) => string;
  main: (
    argv: string[],
    deps?: { db?: unknown; log?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void },
  ) => Promise<number>;
}

let dbMod: Record<string, unknown>;
let db: any;
let encryptedFields: Record<string, readonly string[]>;
let DiagnosticsServiceCtor: any;

function clearKeyEnvs() {
  delete process.env.CONNECTOR_CREDENTIALS_KEY;
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.DRIVE_TOKEN_ENCRYPTION_SECRET;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

async function cleanup() {
  if (!db) return;
  for (const sql of [
    `DELETE FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhooks WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function loadCensusModule(): Promise<CensusModule> {
  const scriptPath = '../scripts/token-encryption-key-census';
  return (await import(scriptPath)) as CensusModule;
}

function getClassifyStoredToken(): (value: string) => TokenLabel {
  const fn = dbMod?.classifyStoredToken;
  expect(typeof fn, 'classifyStoredToken must be exported from @keyflow/db').toBe('function');
  return fn as (value: string) => TokenLabel;
}

function makeDiagnosticsService(): any {
  return new DiagnosticsServiceCtor({} as any, {} as any, {} as any, {} as any);
}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedSuiteEnv[k] = process.env[k];
  expect(process.env.DATABASE_URL, 'DATABASE_URL must name the local test database').toBeTruthy();

  dbMod = (await import('@keyflow/db')) as unknown as Record<string, unknown>;
  db = dbMod.db;
  encryptedFields = dbMod.ENCRYPTED_FIELDS as Record<string, readonly string[]>;
  const diagMod = await import('../src/modules/diagnostics/diagnostics.service');
  DiagnosticsServiceCtor = diagMod.DiagnosticsService;

  await cleanup();

  // Seed owning user & business (cleanup remains raw SQL via sqlLikePrefix).
  await db.user.create({
    data: {
      id: ID.owner,
      email: `${P}owner@example.invalid`,
      name: `${P}Census Owner`,
    },
  });
  await db.business.create({
    data: {
      id: ID.biz,
      name: `${P}Census Test Business`,
      ownerId: ID.owner,
      slug: `${P}census-biz`,
    },
  });

  // 1. Seed a ChannelConnection token with ALL 3 key vars unset (encrypted under the in-repo dev fallback).
  clearKeyEnvs();
  await db.channelConnection.create({
    data: {
      id: ID.ccFallback,
      businessId: ID.biz,
      provider: 'GOOGLE',
      label: `${P}fallback-conn`,
      token: TOKENS.fallback,
    },
  });

  // 2. Seed a ChannelConnection token under the active CONNECTOR_CREDENTIALS_KEY.
  clearKeyEnvs();
  process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;
  await db.channelConnection.create({
    data: {
      id: ID.ccCurrent,
      businessId: ID.biz,
      provider: 'GOOGLE',
      label: `${P}current-conn`,
      token: TOKENS.current,
    },
  });

  // 3. Seed unprefixed plaintext rows via raw SQL on ChannelConnection and Webhook.
  await db.$executeRawUnsafe(
    `INSERT INTO channel_connections (id, business_id, provider, label, token, created_at, updated_at)
     VALUES ($1, $2, 'GOOGLE', $3, $4, now(), now())`,
    ID.ccPlaintext,
    ID.biz,
    `${P}plaintext-conn`,
    TOKENS.plaintext,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO webhooks (id, business_id, name, url, events, secret, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'https://example.invalid/hook', ARRAY['invoice.paid'], $4, true, now(), now())`,
    ID.whPlaintext,
    ID.biz,
    `${P}plaintext-webhook`,
    TOKENS.webhookPlain,
  );

  // 4. Seed a value encrypted by core/crypto under DRIVE_TOKEN_ENCRYPTION_SECRET alone.
  clearKeyEnvs();
  process.env.DRIVE_TOKEN_ENCRYPTION_SECRET = SECRET_DRIVE;
  const coreCiphertext = encryptCoreToken(TOKENS.coreChain);
  expect(coreCiphertext).toBeTruthy();
  expect(coreCiphertext!.startsWith(CIPHER_PREFIX)).toBe(true);
  await db.$executeRawUnsafe(
    `INSERT INTO channel_connections (id, business_id, provider, label, token, created_at, updated_at)
     VALUES ($1, $2, 'WHATSAPP', $3, $4, now(), now())`,
    ID.ccCoreChain,
    ID.biz,
    `${P}corechain-conn`,
    coreCiphertext,
  );

  // 5. Seed corrupted enc:v1: values (bit-flipped valid ciphertext in token, truncated payload in refresh_token).
  const rawBuf = Buffer.from(coreCiphertext!.slice(CIPHER_PREFIX.length), 'base64');
  rawBuf[rawBuf.length - 1] ^= 0xff;
  const tamperedCiphertext = CIPHER_PREFIX + rawBuf.toString('base64');
  const truncatedCiphertext = `${CIPHER_PREFIX}dG9vLXNob3J0`;
  await db.$executeRawUnsafe(
    `INSERT INTO channel_connections (id, business_id, provider, label, token, refresh_token, created_at, updated_at)
     VALUES ($1, $2, 'META', $3, $4, $5, now(), now())`,
    ID.ccCorrupted,
    ID.biz,
    `${P}corrupted-conn`,
    tamperedCiphertext,
    truncatedCiphertext,
  );

  restoreEnv(savedSuiteEnv);
});

beforeEach(() => {
  for (const k of ENV_KEYS) savedTestEnv[k] = process.env[k];
});

afterEach(() => {
  restoreEnv(savedTestEnv);
});

afterAll(async () => {
  restoreEnv(savedSuiteEnv);
  await cleanup();
});

describe('RR-DB-CRYPTO-KEY-CENSUS (V1-72)', () => {
  it('[V72T-01] premise + fallback detection: diagnostics reads pass while fallback row fails active decrypt, and census reports it as fallback with id and column', async () => {
    clearKeyEnvs();
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;

    // Raw stored fallback token has enc:v1: prefix and is not plaintext.
    const rawRows: Array<{ token: string | null }> = await db.$queryRawUnsafe(
      'SELECT token FROM channel_connections WHERE id = $1',
      ID.ccFallback,
    );
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0].token?.startsWith(CIPHER_PREFIX)).toBe(true);
    expect(rawRows[0].token).not.toContain(TOKENS.fallback);

    // Witness reads 'pass' because CONNECTOR_CREDENTIALS_KEY is set NOW.
    const diag = makeDiagnosticsService();
    const check = await diag.checkTokenEncryptionKeySource();
    expect(check.status).toBe('pass');

    // Reading the fallback row through Prisma throws because the active key cannot decrypt it.
    await expect(
      db.channelConnection.findUnique({ where: { id: ID.ccFallback } }),
    ).rejects.toThrow();

    // Census classifies the row as 'fallback' with its id and column.
    const { runTokenEncryptionKeyCensus } = await loadCensusModule();
    const report = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });
    const ccToken = report.columns.find((c) => c.column === 'ChannelConnection.token');
    expect(ccToken).toBeDefined();
    expect(ccToken!.counts.fallback).toBeGreaterThanOrEqual(1);
    expect(ccToken!.nonCurrentIds.fallback).toContain(ID.ccFallback);
  });

  it('[V72T-02] active-key row is counted as current and excluded from non-current id lists', async () => {
    clearKeyEnvs();
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;

    const { runTokenEncryptionKeyCensus } = await loadCensusModule();
    const report = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });
    const ccToken = report.columns.find((c) => c.column === 'ChannelConnection.token');
    expect(ccToken).toBeDefined();
    expect(ccToken!.counts.current).toBeGreaterThanOrEqual(1);

    const allNonCurrent = [
      ...ccToken!.nonCurrentIds.plaintext,
      ...ccToken!.nonCurrentIds.fallback,
      ...ccToken!.nonCurrentIds['core-chain'],
      ...ccToken!.nonCurrentIds.undecryptable,
    ];
    expect(allNonCurrent).not.toContain(ID.ccCurrent);
  });

  it('[V72T-03] unprefixed values across multiple models are reported as plaintext with id and column', async () => {
    clearKeyEnvs();
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;

    const { runTokenEncryptionKeyCensus } = await loadCensusModule();
    const report = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });

    const ccToken = report.columns.find((c) => c.column === 'ChannelConnection.token');
    expect(ccToken).toBeDefined();
    expect(ccToken!.counts.plaintext).toBeGreaterThanOrEqual(1);
    expect(ccToken!.nonCurrentIds.plaintext).toContain(ID.ccPlaintext);

    const whSecret = report.columns.find((c) => c.column === 'Webhook.secret');
    expect(whSecret).toBeDefined();
    expect(whSecret!.counts.plaintext).toBeGreaterThanOrEqual(1);
    expect(whSecret!.nonCurrentIds.plaintext).toContain(ID.whPlaintext);
  });

  it('[V72T-04] value written by core/crypto under DRIVE_TOKEN_ENCRYPTION_SECRET alone is reported as core-chain', async () => {
    const { runTokenEncryptionKeyCensus } = await loadCensusModule();

    // Case A: CONNECTOR_CREDENTIALS_KEY + DRIVE_TOKEN_ENCRYPTION_SECRET both set.
    clearKeyEnvs();
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;
    process.env.DRIVE_TOKEN_ENCRYPTION_SECRET = SECRET_DRIVE;
    const reportA = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });
    const ccTokenA = reportA.columns.find((c) => c.column === 'ChannelConnection.token');
    expect(ccTokenA).toBeDefined();
    expect(ccTokenA!.counts['core-chain']).toBeGreaterThanOrEqual(1);
    expect(ccTokenA!.nonCurrentIds['core-chain']).toContain(ID.ccCoreChain);

    // Case B: JWT_SECRET + DRIVE_TOKEN_ENCRYPTION_SECRET (exact chain divergence).
    clearKeyEnvs();
    process.env.JWT_SECRET = SECRET_JWT;
    process.env.DRIVE_TOKEN_ENCRYPTION_SECRET = SECRET_DRIVE;
    const reportB = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });
    const ccTokenB = reportB.columns.find((c) => c.column === 'ChannelConnection.token');
    expect(ccTokenB).toBeDefined();
    expect(ccTokenB!.nonCurrentIds['core-chain']).toContain(ID.ccCoreChain);
    expect(ccTokenB!.nonCurrentIds.fallback).toContain(ID.ccFallback);

    // Case C: ONLY DRIVE_TOKEN_ENCRYPTION_SECRET set (all 3 packages/db vars unset).
    // Fallback row MUST still be reported as 'fallback', NEVER falsely as 'current'!
    clearKeyEnvs();
    process.env.DRIVE_TOKEN_ENCRYPTION_SECRET = SECRET_DRIVE;
    const reportC = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });
    const ccTokenC = reportC.columns.find((c) => c.column === 'ChannelConnection.token');
    expect(ccTokenC).toBeDefined();
    expect(ccTokenC!.nonCurrentIds['core-chain']).toContain(ID.ccCoreChain);
    expect(ccTokenC!.nonCurrentIds.fallback).toContain(ID.ccFallback);
    expect(ccTokenC!.counts.current).toBe(0);
  });

  it('[V72T-05] corrupted and truncated enc:v1: values are reported as undecryptable with id and column', async () => {
    clearKeyEnvs();
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;
    process.env.DRIVE_TOKEN_ENCRYPTION_SECRET = SECRET_DRIVE;

    const { runTokenEncryptionKeyCensus } = await loadCensusModule();
    const report = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });

    const ccToken = report.columns.find((c) => c.column === 'ChannelConnection.token');
    expect(ccToken).toBeDefined();
    expect(ccToken!.counts.undecryptable).toBeGreaterThanOrEqual(1);
    expect(ccToken!.nonCurrentIds.undecryptable).toContain(ID.ccCorrupted);

    const ccRefresh = report.columns.find((c) => c.column === 'ChannelConnection.refreshToken');
    expect(ccRefresh).toBeDefined();
    expect(ccRefresh!.counts.undecryptable).toBeGreaterThanOrEqual(1);
    expect(ccRefresh!.nonCurrentIds.undecryptable).toContain(ID.ccCorrupted);
  });

  it('[V72T-06] classifyStoredToken returns only valid labels and never classifies fallback as current when env is unset', async () => {
    const classifyStoredToken = getClassifyStoredToken();
    const validLabels = new Set<TokenLabel>(['plaintext', 'current', 'fallback', 'core-chain', 'undecryptable']);

    const rows: Array<{ id: string; token: string }> = await db.$queryRawUnsafe(
      `SELECT id, token FROM channel_connections WHERE id IN ($1, $2, $3, $4, $5)`,
      ID.ccFallback,
      ID.ccCurrent,
      ID.ccPlaintext,
      ID.ccCoreChain,
      ID.ccCorrupted,
    );
    const byId = new Map(rows.map((r) => [r.id, r.token]));

    // With all 3 key vars unset: fallback row MUST be 'fallback', NOT 'current'.
    clearKeyEnvs();
    expect(classifyStoredToken(byId.get(ID.ccFallback)!)).toBe('fallback');
    expect(classifyStoredToken(byId.get(ID.ccPlaintext)!)).toBe('plaintext');
    expect(classifyStoredToken(byId.get(ID.ccCorrupted)!)).toBe('undecryptable');

    // With CONNECTOR_CREDENTIALS_KEY + DRIVE_TOKEN_ENCRYPTION_SECRET set: all 5 labels distinguished.
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;
    process.env.DRIVE_TOKEN_ENCRYPTION_SECRET = SECRET_DRIVE;
    expect(classifyStoredToken(byId.get(ID.ccFallback)!)).toBe('fallback');
    expect(classifyStoredToken(byId.get(ID.ccCurrent)!)).toBe('current');
    expect(classifyStoredToken(byId.get(ID.ccPlaintext)!)).toBe('plaintext');
    expect(classifyStoredToken(byId.get(ID.ccCoreChain)!)).toBe('core-chain');
    expect(classifyStoredToken(byId.get(ID.ccCorrupted)!)).toBe('undecryptable');

    for (const val of byId.values()) {
      const label = classifyStoredToken(val);
      expect(validLabels.has(label)).toBe(true);
    }
  });

  it('[V72T-07] report and formatted output leak zero token plaintexts or key material, and CLI refuses --apply', async () => {
    clearKeyEnvs();
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;
    process.env.DRIVE_TOKEN_ENCRYPTION_SECRET = SECRET_DRIVE;

    const { runTokenEncryptionKeyCensus, formatCensusReport, main } = await loadCensusModule();
    const report = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });
    const formatted = formatCensusReport(report);
    const serialized = JSON.stringify(report);

    for (const output of [formatted, serialized]) {
      for (const secret of [
        TOKENS.fallback,
        TOKENS.current,
        TOKENS.plaintext,
        TOKENS.coreChain,
        TOKENS.webhookPlain,
        SECRET_ACTIVE,
        SECRET_JWT,
        SECRET_DRIVE,
        DEV_FALLBACK_LITERAL,
        CIPHER_PREFIX,
        process.env.DATABASE_URL ?? '',
      ]) {
        if (secret) expect(output).not.toContain(secret);
      }
    }

    // Formatted output includes non-current ids and excludes current id.
    expect(formatted).toContain(ID.ccFallback);
    expect(formatted).toContain(ID.ccPlaintext);
    expect(formatted).toContain(ID.ccCoreChain);
    expect(formatted).toContain(ID.ccCorrupted);
    expect(formatted).not.toContain(ID.ccCurrent);

    // CLI has NO --apply flag and refuses it with exit code 2.
    const logs: string[] = [];
    const errors: string[] = [];
    const exitCode = await main(['--apply'], {
      db,
      log: (...a) => logs.push(a.join(' ')),
      error: (...a) => errors.push(a.join(' ')),
    });
    expect(exitCode).toBe(2);
    expect(errors.join('\n')).toMatch(/read-only|--apply/i);
  });

  it('[V72T-08] census issues zero writes: runs inside SET TRANSACTION READ ONLY with SELECT-only statements', async () => {
    clearKeyEnvs();
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;
    process.env.DRIVE_TOKEN_ENCRYPTION_SECRET = SECRET_DRIVE;

    const statements: Array<{ op: string; sql: string }> = [];
    let usedTransaction = false;

    const wrapClient = (client: any) => ({
      $queryRawUnsafe(sql: string, ...params: unknown[]) {
        statements.push({ op: '$queryRawUnsafe', sql });
        return client.$queryRawUnsafe(sql, ...params);
      },
      $executeRawUnsafe(sql: string, ...params: unknown[]) {
        statements.push({ op: '$executeRawUnsafe', sql });
        return client.$executeRawUnsafe(sql, ...params);
      },
      $queryRaw(...args: unknown[]) {
        statements.push({ op: '$queryRaw', sql: String(args[0]) });
        return client.$queryRaw(...args);
      },
      $executeRaw(...args: unknown[]) {
        statements.push({ op: '$executeRaw', sql: String(args[0]) });
        return client.$executeRaw(...args);
      },
    });

    const tappedDb = {
      ...wrapClient(db),
      $transaction(fn: (tx: unknown) => Promise<unknown>, opts?: unknown) {
        usedTransaction = true;
        return db.$transaction((tx: unknown) => fn(wrapClient(tx)), opts);
      },
    };

    const { runTokenEncryptionKeyCensus } = await loadCensusModule();
    await runTokenEncryptionKeyCensus(tappedDb, { pageSize: 2 });

    expect(usedTransaction, 'census must run inside a read-only transaction').toBe(true);
    expect(statements.length, 'census must execute read queries').toBeGreaterThan(20);
    expect(statements[0].sql.trim().toUpperCase()).toBe('SET TRANSACTION READ ONLY');

    const dataStatements = statements.slice(1);
    for (const stmt of dataStatements) {
      const normalized = stmt.sql.trim().toUpperCase();
      expect(normalized, `unexpected non-SELECT statement: ${stmt.sql}`).toMatch(/^SELECT\s/);
      expect(normalized).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|MERGE)\b/);
    }

    // Prove Postgres itself enforces SET TRANSACTION READ ONLY on this connection.
    await expect(
      db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe(
          `UPDATE channel_connections SET label = 'should-fail' WHERE id = $1`,
          ID.ccFallback,
        );
      }),
    ).rejects.toThrow(/read-only transaction|25006/i);
  });

  it('[V72T-09] walked columns equal ENCRYPTED_FIELDS 1:1 and diagnostics detail names the census script without changing status behavior', async () => {
    clearKeyEnvs();
    process.env.CONNECTOR_CREDENTIALS_KEY = SECRET_ACTIVE;

    const { runTokenEncryptionKeyCensus } = await loadCensusModule();
    const report = await runTokenEncryptionKeyCensus(db, { pageSize: 2 });

    const expectedColumns = Object.entries(encryptedFields).flatMap(([model, fields]) =>
      fields.map((field) => `${model}.${field}`),
    );
    expect(report.columns.map((c) => c.column)).toEqual(expectedColumns);

    const diag = makeDiagnosticsService();

    // Key set -> status 'pass', detail names the census as the other half before the guard.
    const passCheck = await diag.checkTokenEncryptionKeySource();
    expect(passCheck.name).toBe('Token Encryption Key Source');
    expect(passCheck.status).toBe('pass');
    expect(passCheck.detail).toContain('apps/server/scripts/token-encryption-key-census.ts');
    expect(passCheck.detail?.toLowerCase()).toContain('key-source');

    // No key set in non-prod -> status 'warn', detail still warns against landing the guard and names the census.
    clearKeyEnvs();
    process.env.NODE_ENV = 'test';
    const warnCheck = await diag.checkTokenEncryptionKeySource();
    expect(warnCheck.status).toBe('warn');
    expect(warnCheck.detail).toContain('apps/server/scripts/token-encryption-key-census.ts');

    // No key set in prod -> status 'fail'.
    process.env.NODE_ENV = 'production';
    const failCheck = await diag.checkTokenEncryptionKeySource();
    expect(failCheck.status).toBe('fail');
    expect(failCheck.detail).toContain('apps/server/scripts/token-encryption-key-census.ts');
  });
});
