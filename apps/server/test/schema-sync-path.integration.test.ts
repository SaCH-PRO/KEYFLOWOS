/**
 * V1-83 (FOLLOW3-C6-SCHEMA-SYNC-MIGRATE-DEPLOY), owner ruling D-62: the deploy
 * scripts apply the schema with `prisma migrate deploy`, never `prisma db push`.
 *
 * WHY. V1-17 (migration 20261101000000_contact_partial_identity_uniques)
 * replaced the full contact identity uniques with partial unique indexes
 * WHERE deleted_at IS NULL. Prisma cannot declare a partial unique, so the
 * indexes live only in the migration. `prisma db push` reconciles a database
 * with schema.prisma alone: on a database one migration behind V1-17 it drops
 * both full contacts_business_id_{email,phone}_normalized_key indexes and
 * creates nothing in their place. Two live contacts of one business can then
 * share an email, and the concurrent-POST 409 contract is gone (V1-17 review
 * V117-ST-1 / CR-5). At bb6b86d4 scripts/post-merge.sh (step [4/4]) and
 * scripts/start-cloud-app.sh (`pnpm db:push`) both ran db push.
 *
 * HOW. Every database case runs against a throwaway database
 * (kf_schema_sync_<pid>_<n>), most of them built one migration behind V1-17:
 * `prisma migrate deploy` from a temporary copy of packages/db/prisma whose
 * migrations stop before V1-17. The command under test is not copied here. It
 * is resolved from each script:
 *   - post-merge.sh runs end to end under bash with NODE_ENV=development.
 *     Every package manager, `prisma` and `psql` is replaced on PATH by a stub
 *     that records its argv and working directory, and DATABASE_URL and
 *     DIRECT_URL point at an address nothing listens on, so nothing the script
 *     runs can reach the shared database (review C6-ST-2). The recorded
 *     commands, except install, client generation and the [3/4] drift check,
 *     then run for real and in order;
 *   - start-cloud-app.sh: its `db:*` package-manager call is looked up in the
 *     root package.json scripts.
 * The resolved commands run for real (real pnpm, real prisma, the real
 * packages/db/prisma/schema.prisma and migrations) with DATABASE_URL and
 * DIRECT_URL pointing at the throwaway database, so the proof follows the
 * scripts rather than a copy of them.
 *
 * D-62 also rules that a database with no _prisma_migrations record of
 * 0_baseline (one built with db push) fails loudly until an operator adopts it
 * once; the scripts never record a migration by themselves. The review repairs
 * (C6-ST-1, CR-1) add: the adoption procedure in MAINTENANCE.md ("Adopting a
 * database built without migrations"), run as written on a database built with
 * db push, and post-merge's check that both partial indexes exist after deploy,
 * which `prisma migrate diff` and `migrate status` cannot see.
 *
 * The suite writes no rows in the shared database: every row lives in a
 * throwaway database that afterAll drops WITH (FORCE). It is listed in
 * test/helpers/fixture-prefixes.json noPrefixSuites for that reason.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..');
const PRISMA_DIR = join(REPO, 'packages', 'db', 'prisma');
const SCRIPTS_DIR = join(REPO, 'scripts');
const MIGRATION = '20261101000000_contact_partial_identity_uniques';
const BANK_MIGRATION = '20260808140000_bank_transaction_external_id_unique';
const FIRST_LATER_MIGRATION = '20260720181801_org_assignment_contact_delegation';
const EMAIL_LIVE = 'contacts_business_id_email_normalized_live_key';
const PHONE_LIVE = 'contacts_business_id_phone_normalized_live_key';
const EMAIL_FULL = 'contacts_business_id_email_normalized_key';
const PHONE_FULL = 'contacts_business_id_phone_normalized_key';
const BANK_INDEX = 'bank_transactions_account_external_id_key';
const RESOLVE_BASELINE = 'prisma migrate resolve --applied 0_baseline';
const ADOPTION = 'Adopting a database built without migrations';
const ASSERT_SQL = 'assert-contact-identity-uniques.sql';
const HOOK_TIMEOUT = 240_000;
const ADOPTION_TIMEOUT = 480_000;

/** Where the resolver points the scripts: nothing listens on port 9. */
const UNREACHABLE_URL = 'postgresql://kf_unreachable:unreachable@127.0.0.1:9/kf_unreachable';
const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'];
const STUBBED_TOOLS = [...PACKAGE_MANAGERS, 'npx', 'bunx', 'prisma', 'psql'];

/** Files under scripts/ allowed to invoke db push. Empty on purpose (D-62). */
const DB_PUSH_ALLOWED: string[] = [];

const baseUrl = process.env.DATABASE_URL ?? '';
const created: string[] = [];
const scratch: string[] = [];
let admin: PrismaClient;

function urlFor(db: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

function nextDbName(): string {
  return `kf_schema_sync_${process.pid}_${created.length + 1}`;
}

interface Run { status: number | null; output: string }

function run(cmd: string, args: string[], env: Record<string, string>, cwd = REPO): Run {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}` };
}

function dbEnv(url: string): Record<string, string> {
  return { DATABASE_URL: url, DIRECT_URL: url, NODE_ENV: 'development' };
}

function prismaExec(args: string[], url: string): Run {
  return run('pnpm', ['--filter', '@keyflow/db', 'exec', 'prisma', ...args], dbEnv(url));
}

async function emptyDatabase(): Promise<{ name: string; url: string }> {
  const name = nextDbName();
  created.push(name);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  return { name, url: urlFor(name) };
}

/**
 * A fresh database at the state V1-17 meets in the field: every migration
 * before 20261101000000_contact_partial_identity_uniques applied, none after.
 */
async function databaseOneMigrationBehind(): Promise<{ name: string; url: string }> {
  const { name, url } = await emptyDatabase();

  const copy = mkdtempSync(join(tmpdir(), 'kf-schema-sync-'));
  scratch.push(copy);
  cpSync(join(PRISMA_DIR, 'schema.prisma'), join(copy, 'schema.prisma'));
  cpSync(join(PRISMA_DIR, 'migrations'), join(copy, 'migrations'), {
    recursive: true,
    filter: (src) => {
      const top = relative(join(PRISMA_DIR, 'migrations'), src).split(sep)[0];
      return top === '' || !/^\d/.test(top) || top < MIGRATION;
    },
  });
  expect(existsSync(join(copy, 'migrations', MIGRATION))).toBe(false);
  expect(existsSync(join(copy, 'migrations', '0_baseline', 'migration.sql'))).toBe(true);

  const r = prismaExec(['migrate', 'deploy', `--schema=${join(copy, 'schema.prisma')}`], url);
  if (r.status !== 0) throw new Error(`building ${name} one migration behind V1-17 failed:\n${r.output}`);
  return { name, url };
}

/**
 * A database built the way every environment was before V1-83
 * (docs/SCHEMA_DEPLOYMENT.md §1): `prisma db push` at the current
 * schema.prisma, with no migration recorded.
 */
async function databaseBuiltWithDbPush(): Promise<{ name: string; url: string }> {
  const { name, url } = await emptyDatabase();
  await withDb(url, (db) => db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector'));
  const r = prismaExec(['db', 'push', '--schema=./prisma/schema.prisma', '--skip-generate'], url);
  if (r.status !== 0) throw new Error(`building ${name} with db push failed:\n${r.output}`);
  return { name, url };
}

async function withDb<T>(url: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

async function contactIndexes(db: PrismaClient): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ indexname: string }>>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'contacts' AND indexname = ANY($1::text[]) ORDER BY indexname",
    [EMAIL_LIVE, PHONE_LIVE, EMAIL_FULL, PHONE_FULL],
  );
  return rows.map((r) => r.indexname);
}

async function hasBankIndex(db: PrismaClient): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ n: number }>>(
    "SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
    BANK_INDEX,
  );
  return rows[0]?.n === 1;
}

async function migrationRows(db: PrismaClient, name: string): Promise<Array<{ finished: boolean; rolledBack: boolean }>> {
  const table = await db.$queryRawUnsafe<Array<{ t: string | null }>>("SELECT to_regclass('public._prisma_migrations')::text AS t");
  if (!table[0]?.t) return [];
  return db.$queryRawUnsafe<Array<{ finished: boolean; rolledBack: boolean }>>(
    'SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack" FROM _prisma_migrations WHERE migration_name = $1 ORDER BY started_at',
    name,
  );
}

function sqlState(err: unknown): string | undefined {
  const meta = (err as { meta?: { code?: unknown } } | null)?.meta;
  if (typeof meta?.code === 'string') return meta.code;
  return /\b(23505)\b/.exec(String((err as Error)?.message ?? err))?.[1];
}

async function seedBusiness(db: PrismaClient, business: string): Promise<void> {
  await db.$executeRawUnsafe(
    'INSERT INTO businesses (id, name, owner_id, updated_at) VALUES ($1, $2, $3, now())',
    business, 'Schema sync probe', `owner_${process.pid}`,
  );
}

/** Inserts one contact with email 'same@probe.test'; returns 'inserted' or the SQLSTATE. */
async function insertContact(db: PrismaClient, id: string, business: string, deleted: boolean): Promise<string> {
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO contacts (id, business_id, email_normalized, updated_at, deleted_at) VALUES ($1, $2, $3, now(), ${deleted ? 'now()' : 'NULL'})`,
      id, business, 'same@probe.test',
    );
    return 'inserted';
  } catch (err) {
    return sqlState(err) ?? `error: ${String((err as Error)?.message ?? err)}`;
  }
}

/**
 * Inserts two LIVE contacts with one email_normalized in one business, then a
 * soft-deleted third one. Returns the SQLSTATE of the second live insert (or
 * 'inserted') and whether the soft-deleted duplicate was accepted.
 */
async function duplicateEmailProbe(db: PrismaClient): Promise<{ secondLive: string; softDeleted: string }> {
  const business = `biz_${process.pid}`;
  await seedBusiness(db, business);
  expect(await insertContact(db, `ct_${process.pid}_a`, business, false)).toBe('inserted');
  const secondLive = await insertContact(db, `ct_${process.pid}_b`, business, false);
  const softDeleted = await insertContact(db, `ct_${process.pid}_c`, business, true);
  return { secondLive, softDeleted };
}

/** post-merge.sh from its top-level '[4/4]' echo to the end of the file. */
function postMergeStep4(): string {
  const lines = readFileSync(join(SCRIPTS_DIR, 'post-merge.sh'), 'utf8').split('\n');
  const start = lines.findIndex((l) => /^echo "\[4\/4\]/.test(l));
  expect(start, "post-merge.sh has no top-level '[4/4]' step").toBeGreaterThan(0);
  return lines.slice(start).join('\n');
}

/** Runs post-merge.sh's real [4/4] step (real pnpm) against one database, with the ROOT_DIR its header sets. */
function runStep4(url: string): Run {
  return run('bash', ['-c', ['set -euo pipefail', postMergeStep4()].join('\n')], { ...dbEnv(url), ROOT_DIR: REPO });
}

interface Call { tool: string; cwd: string; argv: string[] }

/** A PATH whose first directory stubs STUBBED_TOOLS; each call appends tool, cwd and argv to the returned file. */
function stubbedPath(): { path: string; calls: string } {
  const dir = mkdtempSync(join(tmpdir(), 'kf-schema-sync-stub-'));
  scratch.push(dir);
  const calls = join(dir, 'calls');
  for (const tool of STUBBED_TOOLS) {
    writeFileSync(
      join(dir, tool),
      `#!/bin/sh\n{ printf '%s\\037' "${tool}" "$PWD" "$@"; printf '\\n'; } >> "$KF_CALLS_FILE"\nexit 0\n`,
      { mode: 0o755 },
    );
  }
  return { path: `${dir}:${process.env.PATH ?? ''}`, calls };
}

function readCalls(file: string): Call[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [tool, cwd, ...argv] = line.split('\x1f').slice(0, -1);
      return { tool, cwd, argv };
    });
}

function packageScripts(file: string): Record<string, string> {
  return (JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
}

/**
 * What a recorded call runs: 'install', 'prisma <command>' (directly, or
 * through the package.json db:* script it names), or the call itself.
 */
function commandOf(call: Call): string {
  const full = [call.tool, ...call.argv];
  if (PACKAGE_MANAGERS.includes(call.tool) && ['install', 'i', 'ci', 'add'].includes(call.argv[0] ?? '')) return 'install';
  let prisma: string[] | undefined;
  if (full.includes('prisma')) {
    prisma = full.slice(full.indexOf('prisma') + 1);
  } else {
    const script = full.find((a) => /^db:[\w-]+$/.test(a));
    if (script) {
      const inDb = full.some((a) => /^(--filter=)?(@keyflow\/)?db$/.test(a));
      const body = packageScripts(inDb ? join(REPO, 'packages', 'db', 'package.json') : join(REPO, 'package.json'))[script] ?? '';
      const words = body.trim().split(/\s+/);
      if (words.includes('prisma')) prisma = words.slice(words.indexOf('prisma') + 1);
      else if (script === 'db:generate') return 'prisma generate';
      else return `script ${script}: ${body || '(missing)'}`;
    }
  }
  if (!prisma) return full.join(' ');
  const [a = '', b = ''] = prisma.filter((w) => !w.startsWith('-'));
  return a === 'migrate' || a === 'db' ? `prisma ${a} ${b}` : `prisma ${a}`;
}

/** Never re-run for real: they change no database, and generation rewrites the shared Prisma client. */
const NOT_RERUN = ['install', 'prisma generate', 'prisma migrate diff'];
/** Also run `prisma generate` unless told not to; generation never touches the database. */
const GENERATES = ['prisma db push', 'prisma migrate dev', 'prisma migrate reset'];

function isIndexCheck(call: Call): boolean {
  return commandOf(call) === 'prisma db execute' && call.argv.some((a) => a.endsWith(`scripts/${ASSERT_SQL}`));
}

/** Re-runs a recorded call for real against one throwaway database. */
function rerun(call: Call, url: string): Run {
  let argv = call.argv.map((a) => a.split(UNREACHABLE_URL).join(url));
  if (GENERATES.includes(commandOf(call)) && !argv.includes('--skip-generate')) argv = [...argv, '--skip-generate'];
  return run(call.tool, argv, dbEnv(url), call.cwd);
}

/**
 * Every command post-merge.sh runs, end to end, resolved by bash itself
 * (variables, flags, the NODE_ENV branch and every step included) with the
 * tools stubbed and the database URLs unreachable.
 */
function resolverEnv(path: string, calls: string): Record<string, string> {
  return {
    PATH: path,
    KF_CALLS_FILE: calls,
    NODE_ENV: 'development',
    DATABASE_URL: UNREACHABLE_URL,
    DIRECT_URL: UNREACHABLE_URL,
    POST_MERGE_SKIP_DB_PUSH: '',
    POST_MERGE_ALLOW_DB_DRIFT: '',
    POST_MERGE_ACCEPT_DATA_LOSS: '',
  };
}

function resolvePostMerge(): Call[] {
  const { path, calls } = stubbedPath();
  const r = run('bash', [join(SCRIPTS_DIR, 'post-merge.sh')], resolverEnv(path, calls));
  expect(r.status, r.output).toBe(0);
  expect(r.output).toContain('=== Post-merge setup complete ===');
  const recorded = readCalls(calls);
  expect(recorded.length, 'post-merge.sh ran no stubbed command').toBeGreaterThan(0);
  return recorded;
}

/** The root package.json script start-cloud-app.sh runs as `<package manager> [run] db:*`. */
function resolveStartCloudApp(): { script: string; argv: string[] } {
  const src = readFileSync(join(SCRIPTS_DIR, 'start-cloud-app.sh'), 'utf8');
  const names = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .flatMap((l) => [...l.matchAll(/\b(?:pnpm|npm|yarn|bun)\b[^;&|]*?\b(db:[\w-]+)/g)].map((m) => m[1]));
  expect(names, 'start-cloud-app.sh must run exactly one `db:*` package script').toHaveLength(1);
  const pkg = packageScripts(join(REPO, 'package.json'));
  const body = pkg[names[0]];
  expect(body, `root package.json has no script ${names[0]}`).toBeTruthy();
  return { script: names[0], argv: body.trim().split(/\s+/) };
}

/** Non-comment line numbers (1-based) of start-cloud-app.sh matching a pattern. */
function startCloudAppLines(pattern: RegExp): number[] {
  return readFileSync(join(SCRIPTS_DIR, 'start-cloud-app.sh'), 'utf8')
    .split('\n')
    .flatMap((l, i) => (!l.trim().startsWith('#') && pattern.test(l) ? [i + 1] : []));
}

interface Arm {
  label: string;
  /** What applies the schema: every database command except the V1-17 index check. */
  schema: string[];
  /** Every command the script runs, as text. */
  all: string[];
  /** Whether the script runs the V1-17 index check after applying the schema. */
  checksIndexesAfterDeploy: boolean;
  run: (url: string) => Run;
}

const arms: Array<{ script: string; make: () => Arm }> = [
  {
    script: 'post-merge.sh',
    make: () => {
      const calls = resolvePostMerge();
      const toRun = calls.filter((c) => !NOT_RERUN.includes(commandOf(c)));
      // psql calls re-run like the rest, but only prisma and package scripts apply the schema.
      const schema = toRun.filter((c) => !isIndexCheck(c) && c.tool !== 'psql');
      const deployAt = calls.findIndex((c) => commandOf(c) === 'prisma migrate deploy');
      const checkAt = calls.findIndex(isIndexCheck);
      return {
        label: 'post-merge.sh',
        schema: schema.map(commandOf),
        all: calls.map((c) => [c.tool, ...c.argv].join(' ')),
        checksIndexesAfterDeploy: deployAt >= 0 && checkAt > deployAt,
        run: (url) => {
          const outputs: string[] = [];
          let last: Run = { status: 0, output: '' };
          for (const call of toRun) {
            last = rerun(call, url);
            outputs.push(`$ ${[call.tool, ...call.argv].join(' ')}\n${last.output}`);
            if (last.status !== 0) break;
          }
          return { status: last.status, output: outputs.join('\n') };
        },
      };
    },
  },
  {
    script: 'start-cloud-app.sh',
    make: () => {
      const { script, argv } = resolveStartCloudApp();
      const call: Call = { tool: 'pnpm', cwd: REPO, argv };
      const skip = GENERATES.includes(commandOf(call)) && !argv.includes('--skip-generate') ? ['--skip-generate'] : [];
      const deployLine = startCloudAppLines(new RegExp(`\\b${script}\\b`))[0] ?? Infinity;
      const checkLine = startCloudAppLines(/prisma db execute .*scripts\/assert-contact-identity-uniques\.sql/)[0] ?? -1;
      return {
        label: `start-cloud-app.sh (pnpm ${script})`,
        schema: [commandOf(call)],
        all: [`pnpm ${script}: ${argv.join(' ')}`],
        checksIndexesAfterDeploy: checkLine > deployLine,
        run: (url) => run('pnpm', ['run', script, ...skip], dbEnv(url)),
      };
    },
  },
];

beforeAll(() => {
  if (!baseUrl) throw new Error('DATABASE_URL is required');
  admin = new PrismaClient({ datasourceUrl: baseUrl });
});

afterAll(async () => {
  for (const name of created) {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
  const left = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
    'SELECT datname FROM pg_database WHERE starts_with(datname, $1)',
    `kf_schema_sync_${process.pid}_`,
  );
  await admin.$disconnect();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  if (left.length) throw new Error(`throwaway databases left behind: ${left.map((r) => r.datname).join(', ')}`);
}, HOOK_TIMEOUT);

for (const { script, make } of arms) {
  describe(`${script} on a database one migration behind V1-17 (D-62)`, () => {
    let arm: Arm;
    let before: { indexes: string[]; rows: number };
    let result: Run;
    let after: { indexes: string[]; rows: Array<{ finished: boolean; rolledBack: boolean }>; probe: { secondLive: string; softDeleted: string } };

    beforeAll(async () => {
      arm = make();
      const { url } = await databaseOneMigrationBehind();
      before = await withDb(url, async (db) => ({ indexes: await contactIndexes(db), rows: (await migrationRows(db, MIGRATION)).length }));
      result = arm.run(url);
      after = await withDb(url, async (db) => ({
        indexes: await contactIndexes(db),
        rows: await migrationRows(db, MIGRATION),
        probe: await duplicateEmailProbe(db),
      }));
    }, HOOK_TIMEOUT);

    it('resolves to `prisma migrate deploy`, not `prisma db push`', () => {
      expect(arm.schema, `${arm.label} ran:\n${arm.all.join('\n')}`).toEqual(['prisma migrate deploy']);
      expect(arm.all.filter((c) => /accept-data-loss|\bdb push\b|\bdb:push\b/.test(c))).toEqual([]);
    });

    it('then checks both partial contact identity uniques (scripts/assert-contact-identity-uniques.sql)', () => {
      expect(arm.checksIndexesAfterDeploy, `${arm.label} ran:\n${arm.all.join('\n')}`).toBe(true);
    });

    it('control: before the command the database holds the full *_key indexes and no row for V1-17', () => {
      expect(before.indexes).toEqual([EMAIL_FULL, PHONE_FULL]);
      expect(before.rows).toBe(0);
    });

    it('the command exits 0', () => {
      expect(result.status, result.output).toBe(0);
    });

    it('after the command both partial *_live_key indexes exist and the full *_key indexes are gone', () => {
      expect(after.indexes).toEqual([EMAIL_LIVE, PHONE_LIVE]);
    });

    it('_prisma_migrations has a finished row for 20261101000000_contact_partial_identity_uniques', () => {
      expect(after.rows).toEqual([{ finished: true, rolledBack: false }]);
    });

    it('two live contacts with one email in one business raise 23505; a soft-deleted duplicate is accepted', () => {
      expect(after.probe).toEqual({ secondLive: '23505', softDeleted: 'inserted' });
    });
  });
}

describe('post-merge.sh resolution never reaches the shared database (C6-ST-2)', () => {
  it('under the resolver environment psql, npx, prisma and pnpm are stubs and the database URLs are unreachable', () => {
    const { path, calls } = stubbedPath();
    // The review's probe, plus the other ways a script could reach the database.
    const program = [
      'printf "env:%s|%s\\n" "$DATABASE_URL" "$DIRECT_URL"',
      'psql "$DATABASE_URL" -tAc "select current_database()"',
      'npx prisma db push --accept-data-loss',
      'prisma migrate deploy',
      'pnpm --filter @keyflow/db exec prisma migrate deploy',
      'bash -c \'psql "$DATABASE_URL" -c "select 2"\'',
    ].join('\n');
    const r = run('bash', ['-c', program], resolverEnv(path, calls));
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain(`env:${UNREACHABLE_URL}|${UNREACHABLE_URL}`);
    const recorded = readCalls(calls);
    expect(recorded.map((c) => c.tool)).toEqual(['psql', 'npx', 'prisma', 'pnpm', 'psql']);
    expect(recorded[0].argv[0]).toBe(UNREACHABLE_URL);
    expect(recorded[4].argv[0]).toBe(UNREACHABLE_URL);
    expect(r.output).not.toContain(baseUrl);
  });
});

describe('post-merge.sh [4/4] on a database with no _prisma_migrations record of 0_baseline (D-62)', () => {
  const cases = [
    { label: 'no _prisma_migrations table (a database built with db push)', sql: 'DROP TABLE _prisma_migrations' },
    { label: '_prisma_migrations without the 0_baseline row', sql: "DELETE FROM _prisma_migrations WHERE migration_name = '0_baseline'" },
  ];
  const results: Array<{ label: string; run: Run; baselineFinished: boolean; liveIndexes: string[] }> = [];

  beforeAll(async () => {
    for (const c of cases) {
      const { url } = await databaseOneMigrationBehind();
      await withDb(url, (db) => db.$executeRawUnsafe(c.sql));
      const r = runStep4(url);
      const state = await withDb(url, async (db) => ({
        baselineFinished: (await migrationRows(db, '0_baseline')).some((row) => row.finished),
        liveIndexes: (await contactIndexes(db)).filter((n) => n.endsWith('_live_key')),
      }));
      results.push({ label: c.label, run: r, ...state });
    }
  }, HOOK_TIMEOUT);

  cases.forEach((c, i) => {
    it(`${c.label}: the step fails loudly and names \`prisma migrate resolve --applied 0_baseline\``, () => {
      const r = results[i];
      expect(r.run.status, r.run.output).not.toBe(0);
      expect(r.run.output).toContain(RESOLVE_BASELINE);
      expect(r.run.output).toContain(ADOPTION);
    });

    it(`${c.label}: it never baselines by itself and applies nothing`, () => {
      const r = results[i];
      expect(r.baselineFinished, 'the step recorded 0_baseline as applied').toBe(false);
      expect(r.liveIndexes).toEqual([]);
    });
  });
});

describe('post-merge.sh [4/4] when V1-17 cannot apply, or is recorded without running (C6-ST-1)', () => {
  const business = `biz_${process.pid}_dup`;
  let failed: { run: Run; rows: Array<{ finished: boolean; rolledBack: boolean }>; indexes: string[] };
  let forced: { resolve: Run; run: Run; rows: Array<{ finished: boolean; rolledBack: boolean }>; indexes: string[]; duplicate: string };
  let repaired: { remedy: string; remedyRun: Run; run: Run; indexes: string[]; duplicate: string };

  beforeAll(async () => {
    const { url } = await databaseOneMigrationBehind();
    // What `db push` at the current schema.prisma did to this database: both
    // full uniques dropped and nothing in their place, so a live duplicate fits.
    await withDb(url, async (db) => {
      await db.$executeRawUnsafe(`DROP INDEX "${EMAIL_FULL}"`);
      await db.$executeRawUnsafe(`DROP INDEX "${PHONE_FULL}"`);
      await seedBusiness(db, business);
      expect(await insertContact(db, `ct_${process.pid}_dup_a`, business, false)).toBe('inserted');
      expect(await insertContact(db, `ct_${process.pid}_dup_b`, business, false)).toBe('inserted');
    });

    const r1 = runStep4(url);
    failed = await withDb(url, async (db) => ({ run: r1, rows: await migrationRows(db, MIGRATION), indexes: await contactIndexes(db) }));

    // The step the procedure forbids: record V1-17 as applied without its indexes.
    const resolve = prismaExec(['migrate', 'resolve', '--applied', MIGRATION], url);
    const r2 = runStep4(url);
    forced = await withDb(url, async (db) => ({
      resolve,
      run: r2,
      rows: await migrationRows(db, MIGRATION),
      indexes: await contactIndexes(db),
      duplicate: await insertContact(db, `ct_${process.pid}_dup_c`, business, false),
    }));

    // The remedy the FATAL prints, after resolving the duplicates.
    await withDb(url, (db) => db.$executeRawUnsafe(
      'UPDATE contacts SET deleted_at = now() WHERE business_id = $1 AND id <> $2',
      business, `ct_${process.pid}_dup_a`,
    ));
    const remedy = (r2.output.split('\n').find((l) => /prisma db execute .*20261101000000_contact_partial_identity_uniques\/migration\.sql/.test(l)) ?? '').trim();
    const remedyRun = remedy ? run('bash', ['-c', remedy], dbEnv(url)) : { status: null, output: 'no remedy printed' };
    const r3 = runStep4(url);
    repaired = await withDb(url, async (db) => ({
      remedy,
      remedyRun,
      run: r3,
      indexes: await contactIndexes(db),
      duplicate: await insertContact(db, `ct_${process.pid}_dup_d`, business, false),
    }));
  }, ADOPTION_TIMEOUT);

  it('live duplicates: V1-17 fails, the step exits non-zero, names the duplicate scan and `--rolled-back`, never `--applied`', () => {
    expect(failed.run.status, failed.run.output).not.toBe(0);
    expect(failed.run.output).toContain('duplicate scan');
    expect(failed.run.output).toContain(`prisma migrate resolve --rolled-back ${MIGRATION}`);
    expect(failed.run.output).toContain('Never mark it --applied');
    expect(failed.run.output).not.toContain('=== Post-merge setup complete ===');
    expect(failed.rows).toEqual([{ finished: false, rolledBack: false }]);
    expect(failed.indexes).toEqual([]);
  });

  it('V1-17 recorded as applied without its indexes: migrate deploy has nothing to do, and the index check fails the step', () => {
    expect(forced.resolve.status, forced.resolve.output).toBe(0);
    expect(forced.rows.some((r) => r.finished), 'control: V1-17 is recorded as finished').toBe(true);
    expect(forced.indexes, 'control: neither identity unique exists').toEqual([]);
    expect(forced.duplicate, 'control: a third live duplicate still fits').toBe('inserted');
    expect(forced.run.output).toContain('No pending migrations to apply');
    expect(forced.run.status, forced.run.output).not.toBe(0);
    expect(forced.run.output).toContain(EMAIL_LIVE);
    expect(forced.run.output).toContain(PHONE_LIVE);
    expect(forced.run.output).toContain('[FATAL]');
    expect(forced.run.output).not.toContain('=== Post-merge setup complete ===');
  });

  it('the remedy it prints, run after the duplicates are resolved, creates both indexes and the next run passes', () => {
    expect(repaired.remedy).toContain('prisma db execute');
    expect(repaired.remedyRun.status, repaired.remedyRun.output).toBe(0);
    expect(repaired.run.status, repaired.run.output).toBe(0);
    expect(repaired.indexes).toEqual([EMAIL_LIVE, PHONE_LIVE]);
    expect(repaired.duplicate).toBe('23505');
  });
});

/** The resolve loop of MAINTENANCE.md "Adopting a database built without migrations", as written. */
function adoptionLoop(): string {
  const doc = readFileSync(join(REPO, 'MAINTENANCE.md'), 'utf8');
  const start = doc.indexOf(`### ${ADOPTION}`);
  expect(start, `MAINTENANCE.md has no "### ${ADOPTION}" section`).toBeGreaterThan(0);
  const end = doc.indexOf('\n---\n', start);
  const section = doc.slice(start, end > start ? end : undefined);
  const loops = [...section.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes('migrate resolve --applied "$m"'));
  expect(loops, 'the adoption section must hold exactly one resolve loop').toHaveLength(1);
  return loops[0];
}

function adoptionList(): string[] {
  return [...adoptionLoop().matchAll(/^\s*(0_baseline|\d{14}_\w+)\b/gm)].map((m) => m[1]);
}

describe(`the one-time adoption in MAINTENANCE.md ("${ADOPTION}") on a database built with db push (CR-1, C6-ST-1)`, () => {
  let before: { indexes: string[]; bank: boolean; diff: Run };
  let p3005: Run;
  let baselineOnly: Run;
  let p3018: { run: Run; rows: Array<{ finished: boolean; rolledBack: boolean }>; indexes: string[] };
  let p3009: Run;
  let procedure: Run;
  let adopted: Run;
  let after: {
    indexes: string[];
    bank: boolean;
    v117: Array<{ finished: boolean; rolledBack: boolean }>;
    bankRows: Array<{ finished: boolean; rolledBack: boolean }>;
    probe: { secondLive: string; softDeleted: string };
  };

  beforeAll(async () => {
    const { url } = await databaseBuiltWithDbPush();
    const diff = prismaExec(['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], url);
    before = await withDb(url, async (db) => ({ indexes: await contactIndexes(db), bank: await hasBankIndex(db), diff }));

    p3005 = runStep4(url);
    // The one-time fix the first version of this packet documented.
    baselineOnly = prismaExec(['migrate', 'resolve', '--applied', '0_baseline'], url);
    const r = runStep4(url);
    p3018 = await withDb(url, async (db) => ({ run: r, rows: await migrationRows(db, FIRST_LATER_MIGRATION), indexes: await contactIndexes(db) }));
    p3009 = runStep4(url);

    procedure = run('bash', ['-c', adoptionLoop()], dbEnv(url));
    adopted = runStep4(url);
    after = await withDb(url, async (db) => ({
      indexes: await contactIndexes(db),
      bank: await hasBankIndex(db),
      v117: await migrationRows(db, MIGRATION),
      bankRows: await migrationRows(db, BANK_MIGRATION),
      probe: await duplicateEmailProbe(db),
    }));
  }, ADOPTION_TIMEOUT);

  it('control: db push left no contact identity unique and no bank_transactions expression unique, and `prisma migrate diff` cannot see it', () => {
    expect(before.indexes).toEqual([]);
    expect(before.bank).toBe(false);
    expect(before.diff.status, before.diff.output).toBe(0);
    expect(before.diff.output).toContain('No difference detected');
  });

  it('first post-merge: P3005, exits non-zero and points to the adoption procedure', () => {
    expect(p3005.status, p3005.output).not.toBe(0);
    expect(p3005.output).toContain('P3005');
    expect(p3005.output).toContain(ADOPTION);
    expect(p3005.output).toContain(RESOLVE_BASELINE);
  });

  it('after recording only 0_baseline: P3018 "already exists", rolled back, and the step points to the procedure (CR-1)', () => {
    expect(baselineOnly.status, baselineOnly.output).toBe(0);
    expect(p3018.run.status, p3018.run.output).not.toBe(0);
    expect(p3018.run.output).toContain('P3018');
    expect(p3018.run.output).toContain(`Migration name: ${FIRST_LATER_MIGRATION}`);
    expect(p3018.run.output).toContain('already exists');
    expect(p3018.run.output).toContain(ADOPTION);
    expect(p3018.rows).toEqual([{ finished: false, rolledBack: false }]);
    expect(p3018.indexes).toEqual([]);
  });

  it('the run after that: P3009, and the step still points to the procedure (CR-1)', () => {
    expect(p3009.status, p3009.output).not.toBe(0);
    expect(p3009.output).toContain('P3009');
    expect(p3009.output).toContain(ADOPTION);
  });

  it('the documented loop records 0_baseline and every migration before V1-17 except the bank_transactions one, never V1-17 or later', () => {
    const expected = [
      '0_baseline',
      ...readdirSync(join(PRISMA_DIR, 'migrations'))
        .filter((d) => /^\d{14}_/.test(d) && d < MIGRATION && d !== BANK_MIGRATION)
        .sort(),
    ];
    expect(adoptionList()).toEqual(expected);
    expect(adoptionLoop()).toContain('pnpm --filter @keyflow/db exec prisma migrate resolve --applied "$m"');
  });

  it('after the procedure, post-merge applies the bank_transactions and V1-17 migrations and exits 0', () => {
    expect(procedure.status, procedure.output).toBe(0);
    expect(adopted.status, adopted.output).toBe(0);
    expect(adopted.output).toContain(BANK_MIGRATION);
    expect(adopted.output).toContain(MIGRATION);
    expect(adopted.output).toContain('=== Post-merge setup complete ===');
    expect(after.v117).toEqual([{ finished: true, rolledBack: false }]);
    expect(after.bankRows).toEqual([{ finished: true, rolledBack: false }]);
  });

  it('after the procedure both *_live_key indexes and the bank_transactions unique exist, and a live duplicate raises 23505', () => {
    expect(after.indexes).toEqual([EMAIL_LIVE, PHONE_LIVE]);
    expect(after.bank).toBe(true);
    expect(after.probe).toEqual({ secondLive: '23505', softDeleted: 'inserted' });
  });
});

/** Script files under scripts/: by extension, or extensionless with a shebang. */
function scriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return scriptFiles(p);
    const ext = extname(name);
    if (['.sh', '.bash', '.mjs', '.cjs', '.js', '.ts', '.ps1', '.py'].includes(ext)) return [p];
    return ext === '' && readFileSync(p, 'utf8').startsWith('#!') ? [p] : [];
  });
}

/**
 * The commands one line runs: split at ; & | outside quotes and at $( and `
 * outside single quotes, with a trailing # or // comment dropped.
 */
function shellSegments(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      cur += c;
      if (c === "'") quote = null;
      continue;
    }
    if (c === '\\') {
      cur += c + (line[i + 1] ?? '');
      i++;
      continue;
    }
    if ((c === '$' && line[i + 1] === '(') || c === '`') {
      out.push(cur);
      cur = '';
      if (c === '$') i++;
      continue;
    }
    if (quote === '"') {
      cur += c;
      if (c === '"') quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    const boundary = i === 0 || /\s/.test(line[i - 1]);
    if (boundary && (c === '#' || (c === '/' && line[i + 1] === '/'))) break;
    if (c === ';' || c === '&' || c === '|') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const LEADING_KEYWORDS = /^(?:(?:if|then|else|elif|do|while|until|time|!|\{|\()\s*)*/;
/** A command that only prints: its text is prose, not an invocation. */
const MESSAGE = /^(?:echo|printf|log)\b|^console\.\w+\s*\(/;
/** `prisma db push` by any runner, or a db:push package script by any package manager. */
const DB_PUSH = /\bprisma\s+(?:--?[\w=./@-]+\s+)*db\s+push\b|\bdb:push\b/;

/** Whether one line runs db push. Comment lines and message commands are prose. */
function runsDbPush(line: string): boolean {
  const code = line.trim();
  if (/^(#|\/\/|\/?\*|<#)/.test(code)) return false;
  return shellSegments(code).some((seg) => {
    const cmd = seg.replace(LEADING_KEYWORDS, '');
    return !MESSAGE.test(cmd) && DB_PUSH.test(cmd);
  });
}

function dbPushInvocations(): string[] {
  const out: string[] = [];
  for (const file of scriptFiles(SCRIPTS_DIR)) {
    const rel = relative(REPO, file).split(sep).join('/');
    if (DB_PUSH_ALLOWED.includes(rel)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (runsDbPush(line)) out.push(`${rel}:${i + 1}`);
    });
  }
  return out;
}

describe('static: the schema paths in scripts/ and MAINTENANCE.md (D-62)', () => {
  it('the db push detector flags the spellings the review found and leaves prose alone (C6-ST-3)', () => {
    const invocations = [
      'echo "  -> syncing schema" && pnpm --filter @keyflow/db exec prisma db push --schema=./prisma/schema.prisma --skip-generate',
      '  DATABASE_URL="$db_url" DIRECT_URL="$direct_url" npm run db:push >/dev/null',
      'pnpm -w db:push',
      'log "sync" && pnpm db:push',
      'npx prisma db push',
      'yarn db:push',
      'printf "x\\n"; prisma db push --accept-data-loss',
      'echo "$(pnpm db:push)"',
      'if ! DATABASE_URL="$u" pnpm run db:push; then',
      'bash -c "prisma db push"',
      "execSync('pnpm db:push', { stdio: 'inherit' });",
    ];
    const prose = [
      '# never run prisma db push',
      'echo "Never run prisma db push (pnpm db:push)" >&2',
      'log "db push is gone"',
      "console.log('prisma db push is forbidden');",
      'printf \'%s\\n\' "not db:push"',
      '  then echo "use migrate deploy, not prisma db push"',
      'pnpm install # then prisma db push',
      'pnpm --filter @keyflow/db exec prisma db execute --file x.sql',
      'pnpm db:deploy',
    ];
    expect(invocations.filter((l) => !runsDbPush(l))).toEqual([]);
    expect(prose.filter(runsDbPush)).toEqual([]);
  });

  it('no file under scripts/ invokes `prisma db push` or a `db:push` script (the allow-list is empty)', () => {
    expect(DB_PUSH_ALLOWED).toEqual([]);
    expect(scriptFiles(SCRIPTS_DIR).map((f) => relative(REPO, f).split(sep).join('/'))).toEqual(
      expect.arrayContaining(['scripts/post-merge.sh', 'scripts/start-cloud-app.sh']),
    );
    expect(dbPushInvocations()).toEqual([]);
  });

  it('both scripts pass `bash -n`', () => {
    for (const script of ['post-merge.sh', 'start-cloud-app.sh']) {
      const r = run('bash', ['-n', join(SCRIPTS_DIR, script)], {});
      expect(r.status, `${script}: ${r.output}`).toBe(0);
    }
  });

  it('post-merge.sh keeps the [3/4] drift check, its non-dev FATAL policy and the POST_MERGE_SKIP_DB_PUSH name; the --accept-data-loss branch is gone', () => {
    const src = readFileSync(join(SCRIPTS_DIR, 'post-merge.sh'), 'utf8');
    expect(src).toContain('echo "[3/4] Checking for schema drift (prisma migrate diff)…"');
    expect(src).toContain(
      'if [ "${POST_MERGE_ALLOW_DB_DRIFT:-0}" != "1" ] && [ "${NODE_ENV:-development}" != "development" ]; then',
    );
    expect(src).toContain('[FATAL] Schema drift detected in non-dev environment — aborting.');
    expect(src).toContain('if [ "${POST_MERGE_SKIP_DB_PUSH:-0}" = "1" ]; then');
    expect(src).not.toContain('accept-data-loss');
    expect(src).not.toContain('POST_MERGE_ACCEPT_DATA_LOSS');
  });

  it('start-cloud-app.sh names `prisma migrate resolve --applied 0_baseline` and the adoption procedure for a database built with db push', () => {
    const src = readFileSync(join(SCRIPTS_DIR, 'start-cloud-app.sh'), 'utf8');
    expect(src).toContain(RESOLVE_BASELINE);
    // In what it prints, not only in a comment.
    expect(startCloudAppLines(new RegExp(`echo .*${ADOPTION}`)).length).toBeGreaterThan(0);
  });

  it('MAINTENANCE.md no longer says post-merge applies the schema with db push, and documents the one-time adoption', () => {
    const doc = readFileSync(join(REPO, 'MAINTENANCE.md'), 'utf8');
    const start = doc.indexOf('After a code merge');
    const end = doc.indexOf('Failure policy:', start);
    expect(start).toBeGreaterThan(0);
    const steps = doc.slice(start, end);
    expect(steps).toContain('prisma migrate deploy');
    expect(steps).not.toMatch(/db push/);
    expect(doc).not.toMatch(/Applies the schema with `prisma db push/);
    // Every remaining mention of db push says not to use it.
    const mentions = doc.split('\n').filter((l) => /db push|db:push/.test(l));
    expect(mentions.filter((l) => !/\b(no longer|never|not|instead of|replaced)\b/i.test(l))).toEqual([]);
    expect(doc).toContain(RESOLVE_BASELINE);
  });

  it('MAINTENANCE.md and docs/SCHEMA_DEPLOYMENT.md no longer present recording 0_baseline alone as the fix (CR-1, C6-ST-1)', () => {
    const maintenance = readFileSync(join(REPO, 'MAINTENANCE.md'), 'utf8');
    const deployment = readFileSync(join(REPO, 'docs', 'SCHEMA_DEPLOYMENT.md'), 'utf8');
    expect(maintenance).not.toContain('The next post-merge then applies every later migration');
    expect(maintenance).toMatch(/Recording `0_baseline`\s+alone is not enough/);
    expect(maintenance).toMatch(/Never record\s+`20261101000000_contact_partial_identity_uniques` as applied unless/);
    expect(maintenance).toContain('pg_indexes');
    expect(maintenance).toContain('GROUP BY 1, 2 HAVING count(*) > 1;');
    expect(deployment).not.toContain('**Production still needs `migrate resolve --applied 0_baseline` once.**');
    expect(deployment).toContain(ADOPTION);
  });
});
