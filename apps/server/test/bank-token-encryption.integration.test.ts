/**
 * RR-BANK-TOKEN-ENCRYPT (V1-72; owner rulings D-261, D-262): BankConnection.accessToken is encrypted at rest.
 * REAL database (DATABASE_URL), no provider traffic.
 *
 * WHAT WAS WRONG
 *
 * The token-encryption extension (packages/db/src/middleware/token-encryption.ts) encrypted the provider token
 * columns of Business, SocialConnection, ChannelConnection and Webhook. BankConnection.accessToken, a bank
 * provider's access token, was stored as given by BankConnectionService.create / update: the service stripped it
 * from responses, but the column held plaintext, so a database dump held the token. The secret-column gate never
 * scanned it (its name scan was anchored on the start of the field name).
 *
 *   V72S-01  POST bank-connections (settings admin) with an accessToken: the raw column starts with 'enc:v1:' and
 *            is not the plaintext; the response, GET one and GET list omit accessToken.
 *   V72S-02  BankConnectionService.create: same, for the service door the plan names.
 *   V72S-03  reads through the extended client (findFirst, findUnique, findMany) return the plaintext.
 *   V72S-04  PATCH (and service update) with a new token stores ciphertext of the new token; a PATCH without
 *            accessToken leaves the stored ciphertext byte-identical.
 *   V72S-05  a pre-existing plaintext row (raw SQL insert) still reads back as plaintext, and the service's
 *            other writes (status, sync) work on it.
 *   V72S-06  the operator script (apps/server/scripts/encrypt-bank-connection-tokens.ts, run with tsx as the
 *            operator runs it): its dry run lists exactly the plaintext rows (ids only, never a token) and writes
 *            nothing; --apply encrypts them through the extension (each reads back as its old plaintext); a second
 *            dry run reports zero, and a second --apply rewrites nothing. Null, empty and already encrypted rows
 *            are never touched.
 *   V72S-07  --apply re-checks each row: a row whose token changed between the scan and the write is skipped
 *            (changed_since_read), not overwritten.
 *   V72S-08  tenancy is unchanged: another business's owner cannot read, change or delete the connection.
 *   V72S-09  no other Prisma door stores or hands back the wrong form: createMany, createManyAndReturn,
 *            updateMany, updateManyAndReturn and the `{ set }` update form store ciphertext; findUniqueOrThrow,
 *            findFirstOrThrow and the AndReturn forms read the plaintext.
 *   V72S-10  (review repair SEC-V72S-2) an input token that already looks like ciphertext ('enc:v1:...') is
 *            encrypted like any other value: it is stored as ciphertext and reads back as given, and the
 *            connection's routes keep answering (they used to store it as given, then fail to decrypt it).
 *   V72S-11  (review repairs SEC-V72S-1, COR-V72S-1) --apply refuses (exit 2, nothing written) when no key
 *            variable is set (it would encrypt with the in-repo dev key) and when the @keyflow/db build it
 *            loads does not encrypt BankConnection.accessToken (a stale build would write the plaintext back).
 *   V72S-12  (review round 2: SEC-V72S-R2-2/3) a stored value in the ciphertext form that does not decrypt
 *            with the loaded key is counted as undecryptable (not already_encrypted), listed by id and never
 *            rewritten; an unknown argument is not echoed back.
 *   V72S-13  (review round 3: SEC-V72S-R3-1, COR-V72S-R3-1/2) the decrypt probe counts only a decrypt failure as
 *            undecryptable: a database error exits 1 with nothing written, a row deleted after the scan is
 *            neither decrypted nor undecryptable; and --apply with nothing to encrypt exits 0 even when every
 *            stored ciphertext is undecryptable.
 *   V72S-14  (review round 4: SEC-V72S-R4-1, COR-V72S-R4-1/2/3) the probe counts an error as undecryptable only
 *            on a positive crypto signal (the GCM authentication failure, an ERR_CRYPTO_* code); any other error,
 *            a raw driver error included, exits 1; the dry run refuses too with a @keyflow/db build that does not
 *            encrypt the column (its counts would be wrong); and deleting a row that does not decrypt succeeds
 *            (the delete result is not decrypted).
 *   V72S-15  (orchestrator A1) --apply refuses (exit 2, nothing written) unless the loaded key decrypts at least
 *            one stored ciphertext of any encrypted model, searched across the whole database and not only the
 *            --business scope: a wrong key (JWT_SECRET while the API ran on CONNECTOR_CREDENTIALS_KEY) no longer
 *            seals every row under itself. The dry run still reports the key variable it would use. The proof
 *            samples the newest ciphertext of each column first and prints how many sampled values decrypted and
 *            failed; the refusal says how to get past it (write one token through the API). Runs on a business
 *            with no ciphertext in scope, so the exit code alone tells it from the old scoped check.
 *
 * Owner question OQ-4 (does production hold plaintext bank tokens today) is open; nothing here reads production.
 */
import 'reflect-metadata';
import path from 'path';
import { spawn } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

/** The key variable as it was before this file loaded anything (COR-V72S-R2-2), restored in afterAll. */
const KEY_VAR = 'CONNECTOR_CREDENTIALS_KEY';
const previousKey = process.env[KEY_VAR];

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const P = 'v72s_';
const HEADER = 'x-v72s-user';
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..', '..');
const SCRIPT = 'scripts/encrypt-bank-connection-tokens.ts';
const SCRIPT_TIMEOUT_MS = 120_000;

/**
 * A local test key (built at run time, never a production key), set before anything in this file encrypts: the
 * operator script refuses --apply without a key in the environment, and the suite must read what it writes.
 * Restored in afterAll.
 */
process.env[KEY_VAR] = [P, 'local', 'test', 'key'].join('-');

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  owner2: `${P}owner2`,
  biz2: `${P}biz2`,
  /** The script's own business: only seeded rows, so its counts are exact. */
  bizScript: `${P}bizscript`,
  /** V72S-12's business: a row that does not decrypt. */
  bizScript2: `${P}bizscript2`,
  /** V72S-13 and V72S-14's business. */
  bizScript3: `${P}bizscript3`,
  /** V72S-15's business: only the plaintext row, so no ciphertext in scope (orchestrator A1's case). */
  bizScript4: `${P}bizscript4`,
};

/** A token built from fragments at run time, so no secret-shaped literal sits in the source. */
const token = (...parts: string[]) => [P, ...parts, String(Date.now())].join('_');
const CIPHER_PREFIX = ['enc', 'v1', ''].join(':');

let db: any;
let app: any;
let service: any;
let runWithTenant: <T>(businessId: string, userId: string, fn: () => T) => T;

async function cleanup() {
  for (const sql of [
    `DELETE FROM bank_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

const http = () => request(app.getHttpServer());
const url = (biz: string, id?: string) => `/finance/businesses/${biz}/bank-connections${id ? `/${id}` : ''}`;
const said = (res: any) => JSON.stringify(res.body ?? {});

/** The stored column, read with raw SQL (no extension). */
async function stored(id: string): Promise<string | null> {
  const rows: Array<{ access_token: string | null }> = await db.$queryRawUnsafe(
    'SELECT access_token FROM bank_connections WHERE id = $1',
    id,
  );
  expect(rows, `bank connection ${id} exists`).toHaveLength(1);
  return rows[0].access_token;
}

/** A bank-type financial account (with its chart account) for a business, written directly. */
async function account(biz: string, name: string): Promise<string> {
  const coa = await db.chartOfAccount.create({ data: { businessId: biz, name: `${name} COA`, type: 'ASSET' } });
  const fa = await db.financialAccount.create({ data: { businessId: biz, chartOfAccountId: coa.id, name, type: 'BANK' } });
  return fa.id as string;
}

/** A bank connection row inserted with raw SQL, the token stored exactly as given (a pre-existing row). */
async function rawRow(biz: string, accountId: string, id: string, accessToken: string | null): Promise<string> {
  await db.$executeRawUnsafe(
    `INSERT INTO bank_connections (id, business_id, financial_account_id, provider, access_token, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'plaid', $4, 'DISCONNECTED', now(), now())`,
    id,
    biz,
    accountId,
    accessToken,
  );
  return id;
}

function expectNoToken(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/accessToken|access_token/);
  expect(text).not.toContain(CIPHER_PREFIX);
  expect(text).not.toContain(`${P}_`);
}

interface Run { code: number | null; out: string; err: string }

/** The operator's run: tsx with the scripts tsconfig, from apps/server, DATABASE_URL only. */
function runScript(args: string[], dropKeys = false, extraEnv: Record<string, string> = {}): Promise<Run> {
  return new Promise((ok, fail) => {
    const withKeys: NodeJS.ProcessEnv = {
      PATH: [path.join(SERVER_DIR, 'node_modules', '.bin'), path.join(REPO_ROOT, 'node_modules', '.bin'), process.env.PATH ?? ''].join(':'),
      HOME: process.env.HOME ?? '/tmp',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      ...(process.env.CONNECTOR_CREDENTIALS_KEY ? { CONNECTOR_CREDENTIALS_KEY: process.env.CONNECTOR_CREDENTIALS_KEY } : {}),
      ...(process.env.CREDENTIALS_ENCRYPTION_KEY ? { CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY } : {}),
      ...(process.env.JWT_SECRET ? { JWT_SECRET: process.env.JWT_SECRET } : {}),
    };
    const env: NodeJS.ProcessEnv = { ...withKeys };
    if (dropKeys) for (const k of ['CONNECTOR_CREDENTIALS_KEY', 'CREDENTIALS_ENCRYPTION_KEY', 'JWT_SECRET']) delete env[k];
    Object.assign(env, extraEnv);
    const child = spawn('tsx', ['--tsconfig', 'scripts/tsconfig.json', SCRIPT, ...args], {
      cwd: SERVER_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), SCRIPT_TIMEOUT_MS - 5_000);
    child.stdout.setEncoding('utf8').on('data', (s: string) => (out += s));
    child.stderr.setEncoding('utf8').on('data', (s: string) => (err += s));
    child.once('error', fail);
    child.once('close', (code) => {
      clearTimeout(timer);
      ok({ code, out, err });
    });
  });
}

const countOf = (out: string, label: string): number => {
  const m = new RegExp(`^\\s*${label}\\s+(\\d+)\\s*$`, 'm').exec(out);
  if (!m) throw new Error(`no "${label}" count in:\n${out}`);
  return Number(m[1]);
};
/** The `  <id>  plaintext` lines of a dry run. */
const listedIds = (out: string): string[] =>
  [...out.matchAll(/^\s+(\S+)\s+plaintext\s*$/gm)].map((m) => m[1]).sort();

beforeAll(async () => {
  expect(process.env.DATABASE_URL, 'DATABASE_URL must name the local test database').toBeTruthy();
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenantMod = await import('../src/core/tenant/tenant-context');
  runWithTenant = tenantMod.runWithTenant;
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenantMod.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { FinanceController } = await import('../src/modules/finance/finance.controller');
  const { BankConnectionService } = await import('../src/modules/finance/bank-connection.service');

  // FinanceController's collaborators off the bank-connection routes.
  const stubs = await Promise.all([
    import('../src/modules/finance/receivables.service').then((m) => m.ReceivablesService),
    import('../src/modules/finance/ledger-balance.service').then((m) => m.LedgerBalanceService),
    import('../src/modules/finance/finance-overview.service').then((m) => m.FinanceOverviewService),
    import('../src/modules/finance/finance-accounts.service').then((m) => m.FinanceAccountsService),
    import('../src/modules/finance/finance-tax-rate.service').then((m) => m.FinanceTaxRateService),
    import('../src/modules/finance/finance-settings.service').then((m) => m.FinanceSettingsService),
    import('../src/modules/finance/bank-import.service').then((m) => m.BankImportService),
    import('../src/modules/finance/statement-source.service').then((m) => m.StatementSourceService),
    import('../src/modules/finance/bank-matching.service').then((m) => m.BankMatchingService),
    import('../src/modules/finance/bank-rule.service').then((m) => m.BankRuleService),
    import('../src/modules/finance/recurring-journal-entry.service').then((m) => m.RecurringJournalEntryService),
    import('../src/modules/finance/reconciliation.service').then((m) => m.ReconciliationService),
    import('../src/modules/finance/tax-liability.service').then((m) => m.TaxLiabilityService),
    import('../src/modules/finance/accountant-export.service').then((m) => m.AccountantExportService),
    import('../src/modules/finance/finance-intelligence.service').then((m) => m.FinanceIntelligenceService),
    import('../src/modules/finance/accountant-export-email.service').then((m) => m.AccountantExportEmailService),
    import('../src/modules/finance/posting.service').then((m) => m.PostingService),
    import('../src/modules/finance/safe-to-spend.service').then((m) => m.SafeToSpendService),
    import('../src/modules/finance/cashflow-forecast.service').then((m) => m.CashflowForecastService),
    import('../src/modules/finance/money-moves.service').then((m) => m.MoneyMovesService),
    import('../src/modules/finance/cash-reserve.service').then((m) => m.CashReserveService),
    import('../src/modules/finance/credit-note.service').then((m) => m.CreditNoteService),
    import('../src/modules/finance/accounting-period.service').then((m) => m.AccountingPeriodService),
    import('../src/modules/finance/finance-coa.service').then((m) => m.FinanceCoaService),
    import('../src/modules/finance/chart-of-accounts-seeder.service').then((m) => m.ChartOfAccountsSeederService),
    import('../src/modules/finance/exchange-rate.service').then((m) => m.ExchangeRateService),
    import('../src/modules/finance/fixed-asset.service').then((m) => m.FixedAssetService),
  ]);

  const moduleRef = await Test.createTestingModule({
    controllers: [FinanceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      BankConnectionService,
      ...stubs.map((t) => ({ provide: t, useValue: {} })),
    ],
  }).compile();
  service = moduleRef.get(BankConnectionService);

  app = moduleRef.createNestApplication({ logger: false });
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalInterceptors(new TenantInterceptor(moduleRef.get(PrismaService)));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  await cleanup();
  for (const [uid, bid] of [[ID.owner, ID.biz], [ID.owner2, ID.biz2], [ID.owner, ID.bizScript], [ID.owner, ID.bizScript2], [ID.owner, ID.bizScript3], [ID.owner, ID.bizScript4]] as const) {
    if (!(await db.user.findUnique({ where: { id: uid } }))) {
      await db.user.create({ data: { id: uid, email: `${P}${uid.slice(P.length)}@test.local`, name: uid, role: 'USER' } });
    }
    await db.business.create({ data: { id: bid, name: `V72S ${bid}`, slug: bid, ownerId: uid, currency: 'TTD' } });
    await db.membership.create({ data: { id: `${P}m_${bid.slice(P.length)}`, userId: uid, businessId: bid, role: 'OWNER' } });
  }
}, 180_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (previousKey === undefined) delete process.env[KEY_VAR];
  else process.env[KEY_VAR] = previousKey;
});

describe('BankConnection.accessToken is encrypted at rest (RR-BANK-TOKEN-ENCRYPT, V1-72)', () => {
  it('[V72S-01] POST bank-connections stores ciphertext; POST, GET one and GET list never carry the token', async () => {
    const fa = await account(ID.biz, 'V72S HTTP bank');
    const plain = token('http', 'access');
    const res = await http().post(url(ID.biz)).set(HEADER, ID.owner).send({ financialAccountId: fa, provider: 'plaid', providerItemId: `${P}item1`, accessToken: plain });
    expect(res.status, said(res)).toBe(201);
    expectNoToken(res.body);
    const id = res.body.id as string;

    const raw = await stored(id);
    expect(raw, 'the stored column is ciphertext').toMatch(new RegExp(`^${CIPHER_PREFIX}`));
    expect(raw).not.toContain(plain);

    const one = await http().get(url(ID.biz, id)).set(HEADER, ID.owner);
    expect(one.status, said(one)).toBe(200);
    expect(one.body.id).toBe(id);
    expectNoToken(one.body);
    const list = await http().get(url(ID.biz)).set(HEADER, ID.owner);
    expect(list.status, said(list)).toBe(200);
    expect(list.body.items.map((i: any) => i.id)).toContain(id);
    expectNoToken(list.body);

    // The extended client decrypts it for server-side use.
    expect((await db.bankConnection.findFirst({ where: { id, businessId: ID.biz } })).accessToken).toBe(plain);
  });

  it('[V72S-02] BankConnectionService.create with accessToken stores ciphertext and returns no token', async () => {
    const fa = await account(ID.biz, 'V72S service bank');
    const plain = ['plain', 'bank', 'token'].join('-');
    const created = await service.create(ID.biz, { financialAccountId: fa, provider: 'plaid', accessToken: plain });
    expect(created).not.toHaveProperty('accessToken');
    const raw = await stored(created.id);
    expect(raw).not.toBe(plain);
    expect(raw?.startsWith(CIPHER_PREFIX), `stored ${String(raw).slice(0, 12)}...`).toBe(true);
    expect(await service.get(ID.biz, created.id)).not.toHaveProperty('accessToken');
    for (const item of await service.list(ID.biz)) expect(item).not.toHaveProperty('accessToken');
  });

  it('[V72S-03] findFirst, findUnique and findMany through the extended client return the plaintext', async () => {
    const fa = await account(ID.biz, 'V72S read bank');
    const plain = token('read', 'access');
    const { id } = await service.create(ID.biz, { financialAccountId: fa, provider: 'plaid', accessToken: plain });
    expect((await stored(id))?.startsWith(CIPHER_PREFIX)).toBe(true);
    expect((await db.bankConnection.findFirst({ where: { id } })).accessToken).toBe(plain);
    expect((await db.bankConnection.findUnique({ where: { id } })).accessToken).toBe(plain);
    const many = await db.bankConnection.findMany({ where: { businessId: ID.biz, financialAccountId: fa } });
    expect(many.map((r: any) => r.accessToken)).toEqual([plain]);
    // A select of the column alone is decrypted too.
    expect((await db.bankConnection.findFirst({ where: { id }, select: { accessToken: true } })).accessToken).toBe(plain);
  });

  it('[V72S-04] PATCH and service update with a new token store its ciphertext; a PATCH without one keeps the stored value', async () => {
    const fa = await account(ID.biz, 'V72S update bank');
    const first = token('first');
    const { id } = await service.create(ID.biz, { financialAccountId: fa, provider: 'plaid', accessToken: first });

    const second = token('second');
    const res = await http().patch(url(ID.biz, id)).set(HEADER, ID.owner).send({ accessToken: second });
    expect(res.status, said(res)).toBe(200);
    expectNoToken(res.body);
    const afterPatch = await stored(id);
    expect(afterPatch?.startsWith(CIPHER_PREFIX)).toBe(true);
    expect(afterPatch).not.toContain(second);
    expect((await db.bankConnection.findFirst({ where: { id } })).accessToken).toBe(second);

    const status = await http().patch(url(ID.biz, id)).set(HEADER, ID.owner).send({ status: 'ERROR', errorMessage: 'v72s' });
    expect(status.status, said(status)).toBe(200);
    expect(await stored(id), 'a PATCH without accessToken leaves the ciphertext byte-identical').toBe(afterPatch);

    const third = token('third');
    const updated = await service.update(ID.biz, id, { accessToken: third });
    expect(updated).not.toHaveProperty('accessToken');
    const afterUpdate = await stored(id);
    expect(afterUpdate?.startsWith(CIPHER_PREFIX)).toBe(true);
    expect(afterUpdate).not.toBe(afterPatch);
    expect((await db.bankConnection.findFirst({ where: { id } })).accessToken).toBe(third);

    // The extension's own update and upsert hooks, directly.
    const fourth = token('fourth');
    await db.bankConnection.update({ where: { id }, data: { accessToken: fourth } });
    expect((await stored(id))?.startsWith(CIPHER_PREFIX)).toBe(true);
    const upserted = await db.bankConnection.upsert({ where: { id }, create: { businessId: ID.biz, financialAccountId: fa, provider: 'plaid' }, update: { accessToken: first } });
    expect(upserted.accessToken).toBe(first);
    expect(await stored(id)).not.toContain(first);
    expect((await stored(id))?.startsWith(CIPHER_PREFIX)).toBe(true);
  });

  it('[V72S-05] a pre-existing plaintext row still reads back as plaintext, and the service keeps working on it', async () => {
    const fa = await account(ID.biz, 'V72S legacy bank');
    const plain = token('legacy');
    const id = await rawRow(ID.biz, fa, `${P}legacy1`, plain);
    expect(await stored(id)).toBe(plain);
    expect((await db.bankConnection.findFirst({ where: { id } })).accessToken).toBe(plain);
    expect((await db.bankConnection.findMany({ where: { id } }))[0].accessToken).toBe(plain);

    expect(await service.get(ID.biz, id)).not.toHaveProperty('accessToken');
    await service.recordSync(ID.biz, id, `${P}cursor`);
    expect(await stored(id), 'a write that does not name the token leaves it as stored').toBe(plain);
    // A rewrite of the token through the service encrypts it.
    await service.update(ID.biz, id, { accessToken: plain });
    expect((await stored(id))?.startsWith(CIPHER_PREFIX)).toBe(true);
    expect((await db.bankConnection.findFirst({ where: { id } })).accessToken).toBe(plain);
  });

  it('[V72S-06] the operator script: dry run lists exactly the plaintext rows and writes nothing; --apply encrypts them; a second run finds none', async () => {
    const fa = await account(ID.bizScript, 'V72S script bank');
    const fa2 = await account(ID.bizScript, 'V72S script bank 2');
    const plainA = token('scriptA');
    const plainB = token('scriptB');
    const plainC = token('scriptC');
    await rawRow(ID.bizScript, fa, `${P}s_plainA`, plainA);
    await rawRow(ID.bizScript, fa, `${P}s_plainB`, plainB);
    await rawRow(ID.bizScript, fa2, `${P}s_null`, null);
    await rawRow(ID.bizScript, fa2, `${P}s_empty`, '');
    const { id: encId } = await service.create(ID.bizScript, { financialAccountId: fa2, provider: 'plaid', accessToken: plainC });
    const snapshot = async () =>
      JSON.stringify(await db.$queryRawUnsafe(`SELECT id, access_token, updated_at FROM bank_connections WHERE business_id = $1 ORDER BY id`, ID.bizScript));
    const before = await snapshot();
    const encBefore = await stored(encId);

    const dry = await runScript([`--business=${ID.bizScript}`]);
    const dryAll = `${dry.out}\n${dry.err}`;
    expect(dry.code, dryAll).toBe(0);
    expect(dry.out).toMatch(/DRY RUN/);
    expect(countOf(dry.out, 'connections_scanned')).toBe(5);
    expect(countOf(dry.out, 'plaintext_tokens')).toBe(2);
    expect(countOf(dry.out, 'already_encrypted')).toBe(1);
    expect(countOf(dry.out, 'no_token')).toBe(2);
    expect(countOf(dry.out, 'would_encrypt')).toBe(2);
    expect(listedIds(dry.out)).toEqual([`${P}s_plainA`, `${P}s_plainB`]);
    for (const secretText of [plainA, plainB, plainC, CIPHER_PREFIX, process.env.DATABASE_URL ?? '\u0000']) {
      expect(dryAll, 'the run prints no token, ciphertext or database URL').not.toContain(secretText);
    }
    expect(await snapshot(), 'the dry run wrote nothing').toBe(before);

    // Unscoped, the dry run also lists both seeded plaintext rows (other suites' rows may be listed too).
    const dryEvery = await runScript([]);
    expect(dryEvery.code, `${dryEvery.out}\n${dryEvery.err}`).toBe(0);
    expect(listedIds(dryEvery.out)).toEqual(expect.arrayContaining([`${P}s_plainA`, `${P}s_plainB`]));
    expect(listedIds(dryEvery.out)).not.toContain(encId);
    expect(await snapshot()).toBe(before);

    const apply = await runScript(['--apply', `--business=${ID.bizScript}`]);
    const applyAll = `${apply.out}\n${apply.err}`;
    expect(apply.code, applyAll).toBe(0);
    expect(apply.out).toMatch(/APPLY/);
    expect(countOf(apply.out, 'encrypted')).toBe(2);
    expect(countOf(apply.out, 'changed_since_read')).toBe(0);
    expect(countOf(apply.out, 'failed')).toBe(0);
    for (const secretText of [plainA, plainB, plainC, CIPHER_PREFIX]) expect(applyAll).not.toContain(secretText);

    for (const [id, plain] of [[`${P}s_plainA`, plainA], [`${P}s_plainB`, plainB]] as const) {
      const raw = await stored(id);
      expect(raw?.startsWith(CIPHER_PREFIX), `${id} is ciphertext after --apply`).toBe(true);
      expect(raw).not.toContain(plain);
      expect((await db.bankConnection.findFirst({ where: { id } })).accessToken, `${id} reads back as its plaintext`).toBe(plain);
    }
    expect(await stored(`${P}s_null`)).toBeNull();
    expect(await stored(`${P}s_empty`)).toBe('');
    expect(await stored(encId), 'an encrypted row is not re-encrypted').toBe(encBefore);

    const again = await runScript([`--business=${ID.bizScript}`]);
    expect(again.code, `${again.out}\n${again.err}`).toBe(0);
    expect(countOf(again.out, 'plaintext_tokens')).toBe(0);
    expect(countOf(again.out, 'already_encrypted')).toBe(3);
    expect(listedIds(again.out)).toEqual([]);

    const afterApply = await snapshot();
    const reapply = await runScript(['--apply', `--business=${ID.bizScript}`]);
    expect(reapply.code, `${reapply.out}\n${reapply.err}`).toBe(0);
    expect(countOf(reapply.out, 'encrypted')).toBe(0);
    expect(await snapshot(), 'a second --apply writes nothing').toBe(afterApply);
  }, 4 * SCRIPT_TIMEOUT_MS);

  it('[V72S-07] --apply skips a row whose token changed after the scan, and refuses unknown arguments', async () => {
    const { main } = await import('../scripts/encrypt-bank-connection-tokens');
    const fa = await account(ID.bizScript, 'V72S race bank');
    const plain = token('race');
    const id = await rawRow(ID.bizScript, fa, `${P}s_race`, plain);
    const replaced = token('replaced');
    const out: string[] = [];
    // The database as the script sees it, except that the first update is preceded by a concurrent writer.
    let raced = false;
    const racingDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'bankConnection') return Reflect.get(target, prop, receiver);
        const delegate = target.bankConnection;
        return new Proxy(delegate, {
          get(d, op, r) {
            if (op !== 'update') return Reflect.get(d, op, r);
            return async (args: any) => {
              if (!raced && args?.where?.id === id) {
                raced = true;
                await target.$executeRawUnsafe('UPDATE bank_connections SET access_token = $1 WHERE id = $2', replaced, id);
              }
              return d.update(args);
            };
          },
        });
      },
    });
    const code = await main(['--apply', `--business=${ID.bizScript}`], { db: racingDb, log: (...a: unknown[]) => out.push(a.join(' ')), error: (...a: unknown[]) => out.push(a.join(' ')) });
    const text = out.join('\n');
    expect(raced, text).toBe(true);
    expect(code, text).toBe(0);
    expect(countOf(text, 'changed_since_read')).toBe(1);
    expect(await stored(id), 'the concurrent value is kept, not overwritten').toBe(replaced);
    expect(text).not.toContain(plain);
    expect(text).not.toContain(replaced);

    const bad: string[] = [];
    expect(await main(['--force'], { db, log: () => undefined, error: (...a: unknown[]) => bad.push(a.join(' ')) })).toBe(2);
    expect(bad.join(' ')).toMatch(/Usage/);
  });

  it("[V72S-08] another business's owner cannot read, change or delete the connection", async () => {
    const fa = await account(ID.biz, 'V72S tenancy bank');
    const plain = token('tenancy');
    const { id } = await service.create(ID.biz, { financialAccountId: fa, provider: 'plaid', accessToken: plain });
    const before = await stored(id);
    expect((await http().get(url(ID.biz, id)).set(HEADER, ID.owner2)).status).toBe(403);
    expect((await http().patch(url(ID.biz, id)).set(HEADER, ID.owner2).send({ accessToken: token('x') })).status).toBe(403);
    expect((await http().delete(url(ID.biz, id)).set(HEADER, ID.owner2)).status).toBe(403);
    // Through the other business's own path, the id is not found.
    expect((await http().get(url(ID.biz2, id)).set(HEADER, ID.owner2)).status).toBe(404);
    expect((await http().patch(url(ID.biz2, id)).set(HEADER, ID.owner2).send({ accessToken: token('y') })).status).toBe(404);
    expect(await stored(id)).toBe(before);
    await runWithTenant(ID.biz2, ID.owner2, async () => {
      expect(await db.bankConnection.findFirst({ where: { id } })).toBeNull();
    });
  });
  it('[V72S-09] bulk writes, the { set } form and the OrThrow reads store ciphertext and read plaintext', async () => {
    const fa = await account(ID.biz, 'V72S bulk bank');
    const isCipher = async (id: string, plain: string) => {
      const raw = await stored(id);
      expect(raw?.startsWith(CIPHER_PREFIX), `${id} stored as ciphertext`).toBe(true);
      expect(raw).not.toContain(plain);
    };
    const p1 = token('many1');
    await db.bankConnection.createMany({ data: [{ id: `${P}bulk1`, businessId: ID.biz, financialAccountId: fa, provider: 'plaid', accessToken: p1, status: 'DISCONNECTED' }] });
    await isCipher(`${P}bulk1`, p1);
    const p2 = token('many2');
    const returned = await db.bankConnection.createManyAndReturn({ data: [{ id: `${P}bulk2`, businessId: ID.biz, financialAccountId: fa, provider: 'plaid', accessToken: p2, status: 'DISCONNECTED' }] });
    expect(returned.map((r: any) => r.accessToken)).toEqual([p2]);
    await isCipher(`${P}bulk2`, p2);

    const p3 = token('updmany');
    await db.bankConnection.updateMany({ where: { id: `${P}bulk1` }, data: { accessToken: p3 } });
    await isCipher(`${P}bulk1`, p3);
    const p4 = token('updmanyret');
    const updatedRows = await db.bankConnection.updateManyAndReturn({ where: { id: `${P}bulk2` }, data: { accessToken: p4 } });
    expect(updatedRows.map((r: any) => r.accessToken)).toEqual([p4]);
    await isCipher(`${P}bulk2`, p4);
    const p5 = token('setform');
    await db.bankConnection.update({ where: { id: `${P}bulk1` }, data: { accessToken: { set: p5 } } });
    await isCipher(`${P}bulk1`, p5);

    expect((await db.bankConnection.findUniqueOrThrow({ where: { id: `${P}bulk1` } })).accessToken).toBe(p5);
    expect((await db.bankConnection.findFirstOrThrow({ where: { id: `${P}bulk2` } })).accessToken).toBe(p4);
  });
  it('[V72S-10] an input token shaped like ciphertext is encrypted, reads back as given, and the routes keep working', async () => {
    const fa = await account(ID.biz, 'V72S prefixed bank');
    const shaped = [CIPHER_PREFIX, 'AAAA'].join('');
    const res = await http().post(url(ID.biz)).set(HEADER, ID.owner).send({ financialAccountId: fa, provider: 'plaid', accessToken: shaped });
    expect(res.status, said(res)).toBe(201);
    const id = res.body.id as string;
    const raw = await stored(id);
    expect(raw?.startsWith(CIPHER_PREFIX)).toBe(true);
    expect(raw, 'stored as the ciphertext of the input, not as given').not.toBe(shaped);
    expect((await db.bankConnection.findFirst({ where: { id } })).accessToken).toBe(shaped);
    expect((await http().get(url(ID.biz, id)).set(HEADER, ID.owner)).status).toBe(200);
    expect((await http().get(url(ID.biz)).set(HEADER, ID.owner)).status).toBe(200);
    const patched = await http().patch(url(ID.biz, id)).set(HEADER, ID.owner).send({ accessToken: shaped });
    expect(patched.status, said(patched)).toBe(200);
    expect((await db.bankConnection.findFirst({ where: { id } })).accessToken).toBe(shaped);
    expect((await http().delete(url(ID.biz, id)).set(HEADER, ID.owner)).status).toBe(200);
  });

  it('[V72S-11] --apply refuses without a key variable, and with a @keyflow/db build that does not encrypt the column', async () => {
    const fa = await account(ID.bizScript, 'V72S refuse bank');
    const plain = token('refuse');
    const id = await rawRow(ID.bizScript, fa, `${P}s_refuse`, plain);

    const noKey = await runScript(['--apply', `--business=${ID.bizScript}`], true);
    const noKeyAll = `${noKey.out}\n${noKey.err}`;
    expect(noKey.code, noKeyAll).toBe(2);
    expect(noKeyAll).toMatch(/no encryption key variable is set/);
    expect(noKeyAll).not.toContain(plain);
    expect(await stored(id), 'nothing written').toBe(plain);
    // The dry run needs no key.
    const dryNoKey = await runScript([`--business=${ID.bizScript}`], true);
    expect(dryNoKey.code, `${dryNoKey.out}\n${dryNoKey.err}`).toBe(0);
    expect(listedIds(dryNoKey.out)).toContain(id);

    const { main } = await import('../scripts/encrypt-bank-connection-tokens');
    const lines: string[] = [];
    const code = await main(['--apply', `--business=${ID.bizScript}`], {
      db,
      encryptedFields: { Business: ['gmailAccessToken'] },
      log: (...a: unknown[]) => lines.push(a.join(' ')),
      error: (...a: unknown[]) => lines.push(a.join(' ')),
    });
    expect(code, lines.join('\n')).toBe(2);
    expect(lines.join('\n')).toMatch(/does not encrypt BankConnection\.accessToken/);
    expect(await stored(id), 'nothing written').toBe(plain);
  }, 3 * SCRIPT_TIMEOUT_MS);
  it('[V72S-12] undecryptable rows are reported and never rewritten, and bad arguments are not echoed', async () => {
    const fa = await account(ID.bizScript2, 'V72S undecryptable bank');
    const garbage = [CIPHER_PREFIX, Buffer.from('v72s-not-a-real-ciphertext-value-000000000000').toString('base64')].join('');
    const badId = await rawRow(ID.bizScript2, fa, `${P}s2_bad`, garbage);
    const plain = token('undecr');
    const plainId = await rawRow(ID.bizScript2, fa, `${P}s2_plain`, plain);

    const dry = await runScript([`--business=${ID.bizScript2}`]);
    const dryAll = `${dry.out}\n${dry.err}`;
    expect(dry.code, dryAll).toBe(0);
    expect(countOf(dry.out, 'plaintext_tokens')).toBe(1);
    expect(countOf(dry.out, 'already_encrypted')).toBe(0);
    expect(countOf(dry.out, 'undecryptable')).toBe(1);
    expect(dry.out).toMatch(new RegExp(`^\\s+${badId}\\s+undecryptable\\s*$`, 'm'));
    expect(listedIds(dry.out)).toEqual([plainId]);
    expect(dryAll).not.toContain(garbage.slice(CIPHER_PREFIX.length));

    // The loaded key is proven by ciphertext elsewhere in the database (a row of another business sealed under the
    // test key: A1's unscoped proof), so --apply encrypts the plaintext and leaves the undecryptable row as stored.
    await service.create(ID.biz, { financialAccountId: await account(ID.biz, 'V72S proof bank'), provider: 'plaid', accessToken: token('proof') });
    const applied = await runScript(['--apply', `--business=${ID.bizScript2}`]);
    expect(applied.code, `${applied.out}\n${applied.err}`).toBe(0);
    expect(countOf(applied.out, 'encrypted')).toBe(1);
    expect((await stored(plainId))?.startsWith(CIPHER_PREFIX)).toBe(true);
    expect(await stored(badId), 'an undecryptable row is never rewritten').toBe(garbage);

    const { main } = await import('../scripts/encrypt-bank-connection-tokens');
    const lines: string[] = [];
    const pasted = ['--', 'pasted', 'token', 'value', '0042'].join('');
    expect(await main([pasted], { db, log: () => undefined, error: (...a: unknown[]) => lines.push(a.join(' ')) })).toBe(2);
    expect(lines.join(' ')).toMatch(/Usage/);
    expect(lines.join(' '), 'an unknown argument is not echoed').not.toContain('pasted');
  }, 4 * SCRIPT_TIMEOUT_MS);
  it('[V72S-13] the probe tells a database error from a decrypt failure, a vanished row proves nothing, and --apply with nothing to encrypt exits 0', async () => {
    const { main } = await import('../scripts/encrypt-bank-connection-tokens');
    const fa = await account(ID.bizScript3, 'V72S probe bank');
    const garbage = [CIPHER_PREFIX, Buffer.from('v72s-probe-not-a-real-ciphertext-000000000000000').toString('base64')].join('');
    const badId = await rawRow(ID.bizScript3, fa, `${P}s3_bad`, garbage);
    const scope = `--business=${ID.bizScript3}`;
    const run = async (argv: string[], findUnique?: (args: any) => Promise<unknown>) => {
      const lines: string[] = [];
      const probed = findUnique
        ? new Proxy(db, {
            get(target, prop, receiver) {
              if (prop !== 'bankConnection') return Reflect.get(target, prop, receiver);
              return new Proxy(target.bankConnection, {
                get(d, op, r) {
                  return op === 'findUnique' ? findUnique : Reflect.get(d, op, r);
                },
              });
            },
          })
        : db;
      const code = await main(argv, { db: probed, log: (...a: unknown[]) => lines.push(a.join(' ')), error: (...a: unknown[]) => lines.push(a.join(' ')) });
      return { code, text: lines.join('\n') };
    };

    // Only undecryptable ciphertext in scope, nothing to encrypt: --apply has nothing to do and says so with exit 0.
    const nothing = await run(['--apply', scope]);
    expect(nothing.code, nothing.text).toBe(0);
    expect(countOf(nothing.text, 'undecryptable')).toBe(1);
    expect(countOf(nothing.text, 'encrypted')).toBe(0);
    expect(await stored(badId)).toBe(garbage);

    // A database error on the probe is not "undecryptable": exit 1, nothing written.
    const plain = token('probe');
    const plainId = await rawRow(ID.bizScript3, fa, `${P}s3_plain`, plain);
    const dbError = Object.assign(new Error('pool timeout'), { code: 'P1001', name: 'PrismaClientKnownRequestError' });
    const failed = await run(['--apply', scope], async () => { throw dbError; });
    expect(failed.code, failed.text).toBe(1);
    expect(failed.text).toMatch(/could not be read: database error P1001/);
    expect(failed.text).not.toMatch(/^\s*undecryptable\s+1\s*$/m);
    expect(await stored(plainId), 'nothing written').toBe(plain);

    // A row gone between the scan and the probe is neither decrypted nor undecryptable: it proves no key.
    const vanished = await run([scope], async () => null);
    expect(vanished.code, vanished.text).toBe(0);
    expect(countOf(vanished.text, 'already_encrypted')).toBe(0);
    expect(countOf(vanished.text, 'undecryptable')).toBe(0);
    expect(countOf(vanished.text, 'gone_since_read')).toBe(1);
  });
  it('[V72S-14] only a crypto failure is undecryptable, a stale build refuses the dry run too, and a row that does not decrypt can be deleted', async () => {
    const { main } = await import('../scripts/encrypt-bank-connection-tokens');
    const fa = await account(ID.bizScript3, 'V72S classify bank');
    const sealed = await service.create(ID.bizScript3, { financialAccountId: fa, provider: 'plaid', accessToken: token('classify') });
    const scope = `--business=${ID.bizScript3}`;
    const probeThrowing = (err: unknown) =>
      new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== 'bankConnection') return Reflect.get(target, prop, receiver);
          return new Proxy(target.bankConnection, {
            get(d, op, r) {
              return op === 'findUnique' ? async () => { throw err; } : Reflect.get(d, op, r);
            },
          });
        },
      });
    const run = async (argv: string[], probe: unknown, encryptedFields?: Record<string, readonly string[]>) => {
      const lines: string[] = [];
      const code = await main(argv, {
        db: probe as any,
        ...(encryptedFields ? { encryptedFields } : {}),
        log: (...a: unknown[]) => lines.push(a.join(' ')),
        error: (...a: unknown[]) => lines.push(a.join(' ')),
      });
      return { code, text: lines.join('\n') };
    };

    // A raw driver error (no P-code, plain name) is a failed read, not a foreign key.
    const reset = await run([scope], probeThrowing(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })));
    expect(reset.code, reset.text).toBe(1);
    expect(reset.text).toMatch(/could not be read/);
    // Node's own decrypt failures are undecryptable.
    const gcm = await run([scope], probeThrowing(new Error('Unsupported state or unable to authenticate data')));
    expect(gcm.code, gcm.text).toBe(0);
    expect(countOf(gcm.text, 'undecryptable')).toBeGreaterThanOrEqual(1);
    const tag = await run([scope], probeThrowing(Object.assign(new TypeError('Invalid authentication tag length: 0'), { code: 'ERR_CRYPTO_INVALID_AUTH_TAG' })));
    expect(tag.code, tag.text).toBe(0);
    expect(countOf(tag.text, 'undecryptable')).toBeGreaterThanOrEqual(1);

    // A stale @keyflow/db build: the dry run's probe would decrypt nothing, so its counts would be wrong.
    const stale = await run([scope], db, { Business: ['gmailAccessToken'] });
    expect(stale.code, stale.text).toBe(2);
    expect(stale.text).toMatch(/does not encrypt BankConnection\.accessToken/);

    // Deleting a row that does not decrypt succeeds through the extension.
    const garbage = [CIPHER_PREFIX, Buffer.from('v72s-delete-not-a-real-ciphertext-0000000000000').toString('base64')].join('');
    const badId = await rawRow(ID.bizScript3, fa, `${P}s3_delete_bad`, garbage);
    await expect(db.bankConnection.delete({ where: { id: badId } })).resolves.toBeTruthy();
    expect(await db.$queryRawUnsafe('SELECT id FROM bank_connections WHERE id = $1', badId)).toEqual([]);
    expect(await stored(sealed.id)).toMatch(new RegExp(`^${CIPHER_PREFIX}`));
  });
  it('[V72S-15] --apply refuses unless the loaded key decrypts a stored ciphertext somewhere in the database', async () => {
    const fa = await account(ID.bizScript4, 'V72S wrong key bank');
    const plain = token('wrongkey');
    const id = await rawRow(ID.bizScript4, fa, `${P}s4_wrongkey`, plain);
    const scope = `--business=${ID.bizScript4}`;
    const wrong = [P, 'not', 'the', 'api', 'key', String(Date.now())].join('-');

    // A1's case: the operator's shell has JWT_SECRET, the API ran on CONNECTOR_CREDENTIALS_KEY.
    const dry = await runScript([scope], true, { JWT_SECRET: wrong });
    expect(dry.code, `${dry.out}\n${dry.err}`).toBe(0);
    expect(dry.out).toMatch(/key source\s+JWT_SECRET/);
    expect(dry.out).not.toContain(wrong);
    for (const env of [{ JWT_SECRET: wrong }, { CONNECTOR_CREDENTIALS_KEY: wrong }]) {
      const run = await runScript(['--apply', scope], true, env);
      const all = `${run.out}\n${run.err}`;
      expect(run.code, all).toBe(2);
      expect(all).toMatch(/no stored ciphertext decrypts with the loaded key/);
      // How to get past it, and what the proof sampled (newest first), so a mixed-key database is visible.
      expect(all).toMatch(/through the API/);
      expect(countOf(run.out, 'key_proof_decrypted')).toBe(0);
      expect(countOf(run.out, 'key_proof_failed')).toBeGreaterThanOrEqual(1);
      expect(all).not.toContain(wrong);
      expect(await stored(id), 'nothing written').toBe(plain);
    }

    // With the key the suite's ciphertext is sealed under (a row of another business), the proof holds.
    await service.create(ID.biz, { financialAccountId: await account(ID.biz, 'V72S proof bank 2'), provider: 'plaid', accessToken: token('proof2') });
    const ok = await runScript(['--apply', scope]);
    expect(ok.code, `${ok.out}\n${ok.err}`).toBe(0);
    expect(ok.out).toMatch(/key proven by\s+\w+/);
    expect(countOf(ok.out, 'key_proof_decrypted')).toBeGreaterThanOrEqual(1);
    expect(countOf(ok.out, 'key_proof_failed')).toBeGreaterThanOrEqual(0);
    expect((await stored(id))?.startsWith(CIPHER_PREFIX)).toBe(true);
    expect((await db.bankConnection.findFirst({ where: { id } })).accessToken).toBe(plain);
  }, 4 * SCRIPT_TIMEOUT_MS);
});
