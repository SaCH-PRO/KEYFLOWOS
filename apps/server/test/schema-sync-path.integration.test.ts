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
 * HOW. Every case runs against a throwaway database (kf_schema_sync_<pid>_<n>)
 * built one migration behind V1-17: `prisma migrate deploy` from a temporary
 * copy of packages/db/prisma whose migrations stop before V1-17. The command
 * under test is not copied here. It is resolved from each script:
 *   - post-merge.sh: the top-level '[4/4]' block runs under bash with
 *     NODE_ENV=development and `pnpm` stubbed to record its argv;
 *   - start-cloud-app.sh: its `pnpm db:*` call is looked up in the root
 *     package.json scripts.
 * The resolved command then runs for real (real pnpm, real prisma, the real
 * packages/db/prisma/schema.prisma and migrations) with DATABASE_URL and
 * DIRECT_URL pointing at that throwaway database, so the proof follows the
 * scripts rather than a copy of them.
 *
 * D-62 also rules that a database with no _prisma_migrations record of
 * 0_baseline (one built with db push) fails loudly until an operator runs
 * `prisma migrate resolve --applied 0_baseline` once; the scripts never
 * baseline by themselves. The last block runs post-merge.sh's real [4/4] step
 * against two such databases.
 *
 * The suite writes no rows in the shared database: every row lives in a
 * throwaway database that afterAll drops WITH (FORCE). It is listed in
 * test/helpers/fixture-prefixes.json noPrefixSuites for that reason.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..');
const PRISMA_DIR = join(REPO, 'packages', 'db', 'prisma');
const SCRIPTS_DIR = join(REPO, 'scripts');
const MIGRATION = '20261101000000_contact_partial_identity_uniques';
const EMAIL_LIVE = 'contacts_business_id_email_normalized_live_key';
const PHONE_LIVE = 'contacts_business_id_phone_normalized_live_key';
const EMAIL_FULL = 'contacts_business_id_email_normalized_key';
const PHONE_FULL = 'contacts_business_id_phone_normalized_key';
const RESOLVE_BASELINE = 'prisma migrate resolve --applied 0_baseline';
const HOOK_TIMEOUT = 240_000;

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

/**
 * A fresh database at the state V1-17 meets in the field: every migration
 * before 20261101000000_contact_partial_identity_uniques applied, none after.
 */
async function databaseOneMigrationBehind(): Promise<{ name: string; url: string }> {
  const name = nextDbName();
  created.push(name);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const url = urlFor(name);

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

  const r = run('pnpm', ['--filter', '@keyflow/db', 'exec', 'prisma', 'migrate', 'deploy', `--schema=${join(copy, 'schema.prisma')}`], dbEnv(url));
  if (r.status !== 0) throw new Error(`building ${name} one migration behind V1-17 failed:\n${r.output}`);
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

async function migrationRows(db: PrismaClient, name: string): Promise<Array<{ finished: boolean; rolledBack: boolean }>> {
  const table = await db.$queryRawUnsafe<Array<{ t: string | null }>>("SELECT to_regclass('public._prisma_migrations')::text AS t");
  if (!table[0]?.t) return [];
  return db.$queryRawUnsafe<Array<{ finished: boolean; rolledBack: boolean }>>(
    'SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack" FROM _prisma_migrations WHERE migration_name = $1',
    name,
  );
}

function sqlState(err: unknown): string | undefined {
  const meta = (err as { meta?: { code?: unknown } } | null)?.meta;
  if (typeof meta?.code === 'string') return meta.code;
  return /\b(23505)\b/.exec(String((err as Error)?.message ?? err))?.[1];
}

/**
 * Inserts two LIVE contacts with one email_normalized in one business, then a
 * soft-deleted third one. Returns the SQLSTATE of the second live insert (or
 * 'inserted') and whether the soft-deleted duplicate was accepted.
 */
async function duplicateEmailProbe(db: PrismaClient): Promise<{ secondLive: string; softDeleted: string }> {
  const business = `biz_${process.pid}`;
  await db.$executeRawUnsafe(
    'INSERT INTO businesses (id, name, owner_id, updated_at) VALUES ($1, $2, $3, now())',
    business, 'Schema sync probe', `owner_${process.pid}`,
  );
  const insert = (id: string, deleted: boolean) =>
    db.$executeRawUnsafe(
      `INSERT INTO contacts (id, business_id, email_normalized, updated_at, deleted_at) VALUES ($1, $2, $3, now(), ${deleted ? 'now()' : 'NULL'})`,
      id, business, 'same@probe.test',
    );
  await insert(`ct_${process.pid}_a`, false);
  const attempt = async (id: string, deleted: boolean): Promise<string> => {
    try {
      await insert(id, deleted);
      return 'inserted';
    } catch (err) {
      return sqlState(err) ?? `error: ${String((err as Error)?.message ?? err)}`;
    }
  };
  const secondLive = await attempt(`ct_${process.pid}_b`, false);
  const softDeleted = await attempt(`ct_${process.pid}_c`, true);
  return { secondLive, softDeleted };
}

/** post-merge.sh from its top-level '[4/4]' echo to the end of the file. */
function postMergeStep4(): string {
  const lines = readFileSync(join(SCRIPTS_DIR, 'post-merge.sh'), 'utf8').split('\n');
  const start = lines.findIndex((l) => /^echo "\[4\/4\]/.test(l));
  expect(start, "post-merge.sh has no top-level '[4/4]' step").toBeGreaterThan(0);
  return lines.slice(start).join('\n');
}

/**
 * The pnpm argv post-merge.sh's [4/4] step runs, resolved by bash itself
 * (variables, flags and the NODE_ENV branch included) with `pnpm` stubbed.
 */
function resolvePostMerge(): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'kf-schema-sync-argv-'));
  scratch.push(dir);
  const argvFile = join(dir, 'argv');
  const program = [
    'set -euo pipefail',
    'pnpm() { printf "%s\\037" "$@" >> "$KF_ARGV_FILE"; printf "\\n" >> "$KF_ARGV_FILE"; }',
    postMergeStep4(),
  ].join('\n');
  const r = run('bash', ['-c', program], { NODE_ENV: 'development', KF_ARGV_FILE: argvFile, POST_MERGE_ACCEPT_DATA_LOSS: '' });
  expect(r.status, r.output).toBe(0);
  const calls = existsSync(argvFile)
    ? readFileSync(argvFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\x1f').slice(0, -1))
    : [];
  const prisma = calls.filter((argv) => argv.includes('prisma'));
  expect(prisma, 'post-merge.sh step [4/4] must run exactly one prisma command').toHaveLength(1);
  return prisma[0];
}

/** The root package.json script start-cloud-app.sh runs as `pnpm db:*`. */
function resolveStartCloudApp(): { script: string; argv: string[] } {
  const src = readFileSync(join(SCRIPTS_DIR, 'start-cloud-app.sh'), 'utf8');
  const names = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .flatMap((l) => [...l.matchAll(/\bpnpm\s+(?:run\s+)?(db:[\w-]+)/g)].map((m) => m[1]));
  expect(names, 'start-cloud-app.sh must run exactly one `pnpm db:*` script').toHaveLength(1);
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const body = pkg.scripts[names[0]];
  expect(body, `root package.json has no script ${names[0]}`).toBeTruthy();
  return { script: names[0], argv: body.trim().split(/\s+/) };
}

function prismaArgs(argv: string[]): string[] {
  return argv.slice(argv.indexOf('prisma') + 1);
}

/**
 * `prisma db push` also runs `prisma generate` unless told not to, which would
 * rewrite the Prisma client in the shared node_modules. Generation never
 * touches the database, so the RED arm adds --skip-generate; migrate deploy
 * never generates and runs exactly as resolved.
 */
function withoutGenerate(args: string[]): string[] {
  const p = prismaArgs(args);
  return p[0] === 'db' && p[1] === 'push' && !args.includes('--skip-generate') ? [...args, '--skip-generate'] : args;
}

interface Arm {
  label: string;
  resolved: string[];
  run: (url: string) => Run;
}

const arms: Array<{ script: string; make: () => Arm }> = [
  {
    script: 'post-merge.sh',
    make: () => {
      const argv = resolvePostMerge();
      return { label: 'post-merge.sh [4/4]', resolved: argv, run: (url) => run('pnpm', withoutGenerate(argv), dbEnv(url)) };
    },
  },
  {
    script: 'start-cloud-app.sh',
    make: () => {
      const { script, argv } = resolveStartCloudApp();
      return {
        label: `start-cloud-app.sh (pnpm ${script})`,
        resolved: argv,
        run: (url) => run('pnpm', ['run', script, ...withoutGenerate(argv).slice(argv.length)], dbEnv(url)),
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
      expect(prismaArgs(arm.resolved).slice(0, 2), `${arm.label} resolved to: ${arm.resolved.join(' ')}`).toEqual(['migrate', 'deploy']);
      expect(arm.resolved).not.toContain('--accept-data-loss');
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

describe('post-merge.sh [4/4] on a database with no _prisma_migrations record of 0_baseline (D-62)', () => {
  const cases = [
    { label: 'no _prisma_migrations table (a database built with db push)', sql: 'DROP TABLE _prisma_migrations' },
    { label: '_prisma_migrations without the 0_baseline row', sql: "DELETE FROM _prisma_migrations WHERE migration_name = '0_baseline'" },
  ];
  const results: Array<{ label: string; run: Run; baselineFinished: boolean; liveIndexes: string[] }> = [];

  beforeAll(async () => {
    const step = postMergeStep4();
    for (const c of cases) {
      const { url } = await databaseOneMigrationBehind();
      await withDb(url, (db) => db.$executeRawUnsafe(c.sql));
      const r = run('bash', ['-c', ['set -euo pipefail', step].join('\n')], dbEnv(url));
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
    });

    it(`${c.label}: it never baselines by itself and applies nothing`, () => {
      const r = results[i];
      expect(r.baselineFinished, 'the step recorded 0_baseline as applied').toBe(false);
      expect(r.liveIndexes).toEqual([]);
    });
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
 * Lines that run db push: comment lines and message lines (echo, printf, log,
 * console.*) are prose, not invocations.
 */
function dbPushInvocations(): string[] {
  const out: string[] = [];
  for (const file of scriptFiles(SCRIPTS_DIR)) {
    const rel = relative(REPO, file).split(sep).join('/');
    if (DB_PUSH_ALLOWED.includes(rel)) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line.trim();
      if (/^(#|\/\/|\/?\*|<#)/.test(code)) return;
      if (/^(echo|printf|log)\b|^console\.\w+\(/.test(code)) return;
      if (/\bprisma\s+db\s+push\b|\bpnpm\s+(?:run\s+)?db:push\b/.test(code)) out.push(`${rel}:${i + 1}`);
    });
  }
  return out;
}

describe('static: the schema paths in scripts/ and MAINTENANCE.md (D-62)', () => {
  it('no file under scripts/ invokes `prisma db push` or `pnpm db:push` (the allow-list is empty)', () => {
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

  it('start-cloud-app.sh names `prisma migrate resolve --applied 0_baseline` for a database built with db push', () => {
    expect(readFileSync(join(SCRIPTS_DIR, 'start-cloud-app.sh'), 'utf8')).toContain(RESOLVE_BASELINE);
  });

  it('MAINTENANCE.md no longer says post-merge applies the schema with db push, and documents the one-time baseline', () => {
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
});
