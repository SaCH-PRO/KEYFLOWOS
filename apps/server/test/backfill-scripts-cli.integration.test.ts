/**
 * OPS-BACKFILL-CLI — the one-time operator scripts run THE DOCUMENTED WAY.
 * REAL database (DATABASE_URL), no provider traffic.
 *
 * WHY: every existing proof of these scripts (owner-membership-backfill,
 * google-identity-backfill, data-cleanup-scripts) imports the script module
 * into vitest and calls its exported main() in process. vitest does not apply
 * apps/server/tsconfig.json's `paths`, so those proofs never saw what an
 * operator sees. tsx DOES apply them: apps/server/tsconfig.json maps
 * '@keyflow/db' to packages/db/dist/src/client.d.ts (for tsc), so under
 * `pnpm backfill:owner-memberships` the script's `import { db } from
 * '@keyflow/db'` loaded a declaration file with no runtime code, `db` was
 * undefined, and every run died: "Stopped after 0 business(es): TypeError"
 * then "Cannot read properties of undefined (reading '$disconnect')", exit 1.
 * And `tsx --env-file ../../.env` refused to start at all where the repo-root
 * .env is absent (CI, the production box): "node: ../../.env: not found".
 *
 *   BSC-01..04  each package.json script (backfill:owner-memberships,
 *               backfill:google-identities, backfill:timeline-contacts,
 *               cleanup:custom-field-values) runs its dry run (no arguments)
 *               exactly as `pnpm <name>` runs it from apps/server: the
 *               package.json command through `sh -c` with node_modules/.bin on
 *               PATH. The environment carries only DATABASE_URL (and, for the
 *               Google script, a 127.0.0.1 GoTrue stand-in). Exit 0, the DRY
 *               RUN banner and its counts printed, no TypeError, and the
 *               database URL never printed.
 *   BSC-05      the production API image has no apps/server/tsconfig.json and
 *               no scripts/ directory; docs/development/owner-membership-backfill.md
 *               mounts scripts/ read-only and runs `npx tsx
 *               scripts/backfill-owner-memberships.ts` from /app/apps/server.
 *               Same shape here: the script alone in a scratch apps/server/scripts/,
 *               no tsconfig.json anywhere above it, '@keyflow/db' reachable only
 *               through node_modules (packages/db's package.json main,
 *               dist/src/client.js, as in the image). Its dry run exits 0 with
 *               its counts.
 *
 * Dry runs only: nothing here writes a row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';

const SERVER_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(SERVER_DIR, '..', '..');
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const SCRIPT_TIMEOUT_MS = 120_000;

const PACKAGE_SCRIPTS: Record<string, string> = JSON.parse(readFileSync(join(SERVER_DIR, 'package.json'), 'utf8')).scripts;

/** PATH as `pnpm run` builds it for apps/server: its own bin, then the workspace root's. */
function binPath(): string {
  return [join(SERVER_DIR, 'node_modules', '.bin'), join(REPO_ROOT, 'node_modules', '.bin'), process.env.PATH ?? ''].join(':');
}

/** The environment an operator would have: PATH, HOME, DATABASE_URL, and only what `extra` adds. */
function operatorEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: binPath(),
    HOME: process.env.HOME ?? tmpdir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    DATABASE_URL,
    ...extra,
  };
}

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function runCommand(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), SCRIPT_TIMEOUT_MS - 5_000);
    child.stdout.setEncoding('utf8').on('data', (s: string) => (out += s));
    child.stderr.setEncoding('utf8').on('data', (s: string) => (err += s));
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, out, err });
    });
  });
}

/** `pnpm <name>` from apps/server: the package.json command, run as pnpm runs it. */
function runPackageScript(name: string, env: NodeJS.ProcessEnv): Promise<Run> {
  const command = PACKAGE_SCRIPTS[name];
  expect(command, `apps/server/package.json has no "${name}" script`).toBeTruthy();
  return runCommand(command, SERVER_DIR, env);
}

function expectCleanDryRun(run: Run, countLines: RegExp[]): void {
  const all = `${run.out}\n${run.err}`;
  expect(run.code, all).toBe(0);
  expect(run.out, all).toMatch(/DRY RUN/);
  for (const line of countLines) expect(run.out, all).toMatch(line);
  expect(all).not.toMatch(/TypeError|Cannot read properties of undefined/);
  expect(all).not.toMatch(/\.env: not found/);
  if (DATABASE_URL) expect(all).not.toContain(DATABASE_URL);
}

/** A GoTrue admin API stand-in on 127.0.0.1: an empty user list; counts the list reads. */
let gotrue: Server;
let gotrueUrl = '';
let gotrueListReads = 0;

beforeAll(async () => {
  expect(DATABASE_URL, 'DATABASE_URL must name the test database').not.toBe('');
  gotrue = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/auth/v1/admin/users') {
      gotrueListReads += 1;
      res.writeHead(200, { 'content-type': 'application/json', 'x-total-count': '0' });
      res.end(JSON.stringify({ users: [], aud: 'authenticated' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ msg: 'not found' }));
  });
  await new Promise<void>((ok, fail) => {
    gotrue.once('error', fail);
    gotrue.listen(0, '127.0.0.1', () => ok());
  });
  const address = gotrue.address();
  if (!address || typeof address === 'string') throw new Error('GoTrue stand-in has no port');
  gotrueUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((ok) => (gotrue ? gotrue.close(() => ok()) : ok()));
});

describe('operator scripts run the documented way (pnpm <name> from apps/server, DATABASE_URL only)', () => {
  it(
    '[BSC-01] pnpm backfill:owner-memberships: dry run exits 0 and prints its counts',
    async () => {
      const run = await runPackageScript('backfill:owner-memberships', operatorEnv());
      expectCleanDryRun(run, [
        /businesses_scanned\s+\d+/,
        /owner_is_member\s+\d+/,
        /missing_owner_membership\s+\d+/,
        /skipped_with_another_owner\s+\d+/,
        /would_write\s+\d+/,
      ]);
    },
    SCRIPT_TIMEOUT_MS,
  );

  it(
    '[BSC-02] pnpm backfill:google-identities: dry run (GoTrue stand-in on 127.0.0.1) exits 0 and prints its counts',
    async () => {
      const before = gotrueListReads;
      const run = await runPackageScript(
        'backfill:google-identities',
        operatorEnv({ SUPABASE_URL: gotrueUrl, SUPABASE_SERVICE_ROLE_KEY: 'bsc-gotrue-stand-in-not-a-key' }),
      );
      expectCleanDryRun(run, [
        /gotrue_users_scanned\s+0\b/,
        /gotrue_pages_read\s+1\b/,
        /would_write\s+0\b/,
        /unapplied_risc_events\s+\d+/,
      ]);
      expect(gotrueListReads - before).toBe(1);
    },
    SCRIPT_TIMEOUT_MS,
  );

  it(
    '[BSC-03] pnpm backfill:timeline-contacts: dry run exits 0 and prints its counts',
    async () => {
      const run = await runPackageScript('backfill:timeline-contacts', operatorEnv());
      expectCleanDryRun(run, [
        /invoice_sent_unlinked\s+\d+/,
        /intake_approved_unlinked\s+\d+/,
        /invoice_sent_would_link\s+\d+/,
        /intake_approved_would_withhold\s+\d+/,
      ]);
    },
    SCRIPT_TIMEOUT_MS,
  );

  it(
    '[BSC-04] pnpm cleanup:custom-field-values: dry run exits 0 and prints its counts',
    async () => {
      const run = await runPackageScript('cleanup:custom-field-values', operatorEnv());
      expectCleanDryRun(run, [/cross_bound_values\s+\d+/, /contacts_affected\s+\d+/, /businesses_affected\s+\d+/]);
    },
    SCRIPT_TIMEOUT_MS,
  );
});

describe('the production API image shape (docs/development/owner-membership-backfill.md)', () => {
  let scratch = '';

  afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it(
    '[BSC-05] the owner-membership script alone, no tsconfig.json above it, @keyflow/db through node_modules only: `npx tsx scripts/backfill-owner-memberships.ts` dry run exits 0',
    async () => {
      scratch = mkdtempSync(join(tmpdir(), 'bsc-image-'));
      // Nothing above the scratch app may hold a tsconfig.json: tsx would apply it.
      for (let dir = scratch; ; dir = dirname(dir)) {
        expect(existsSync(join(dir, 'tsconfig.json')), `${dir}/tsconfig.json would be applied by tsx`).toBe(false);
        if (dir === parse(dir).root) break;
      }
      // /app/apps/server in the image: package.json, node_modules (whose
      // @keyflow/db is packages/db, main dist/src/client.js), no tsconfig.json,
      // and only the mounted script.
      const app = join(scratch, 'apps', 'server');
      mkdirSync(join(app, 'scripts'), { recursive: true });
      copyFileSync(join(SERVER_DIR, 'package.json'), join(app, 'package.json'));
      symlinkSync(join(SERVER_DIR, 'node_modules'), join(app, 'node_modules'), 'dir');
      symlinkSync(join(REPO_ROOT, 'node_modules'), join(scratch, 'node_modules'), 'dir');
      copyFileSync(join(SERVER_DIR, 'scripts', 'backfill-owner-memberships.ts'), join(app, 'scripts', 'backfill-owner-memberships.ts'));

      const run = await runCommand('tsx scripts/backfill-owner-memberships.ts', app, operatorEnv());
      expectCleanDryRun(run, [/businesses_scanned\s+\d+/, /would_write\s+\d+/]);
    },
    SCRIPT_TIMEOUT_MS,
  );
});
