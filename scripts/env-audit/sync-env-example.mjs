// Keeps .env.example in step with the environment variables the code reads.
//
//   node scripts/env-audit/sync-env-example.mjs          # report only
//   node scripts/env-audit/sync-env-example.mjs --write  # append what is missing
//
// It NEVER reads .env. Values are secrets; this tool only ever handles NAMES,
// taken from `process.env.X` in source. The file it writes contains empty
// placeholders and the location each variable is read from, nothing else.
//
// The point is not tidiness. An undocumented variable is one a teammate's clone
// silently lacks — and the failure is usually a degraded feature rather than a
// crash, because most reads here fall back to a placeholder. OPENAI_API_KEY was
// exactly that: absent from .env and .env.example, mapped in production but not
// locally, and working on one machine only because it happened to be in that
// developer's shell.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.KF_REPO || process.cwd();
const EXAMPLE = join(REPO, '.env.example');
const WRITE = process.argv.includes('--write');

/**
 * Variables that are supplied by the platform or the tooling rather than by a
 * developer, so documenting them as things to fill in would be misleading.
 */
const AMBIENT = new Set([
  'NODE_ENV',
  'CI',
  'PORT',
  'PWD',
  'HOME',
  'PATH',
  'TZ',
  'VITEST',
  'VITEST_WORKER_ID',
  'npm_lifecycle_event',
  'npm_package_version',
  'GIT_COMMIT',
  'VERCEL',
  'VERCEL_ENV',
  'NEXT_RUNTIME',
  'NEXT_PHASE',
]);

function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
}

/**
 * Variables the APPLICATION sets for a child process rather than ones a
 * developer supplies. code-executor.service.ts injects these into the E2B
 * sandbox (`KF_EXEC_TOKEN: token, KF_CODE: opts.code`) and then reads them back
 * inside it. Listing them as things to configure would send someone looking for
 * a value that is generated per execution.
 */
const APP_INJECTED = new Set(['KF_CODE', 'KF_INPUTS', 'KF_EXEC_TOKEN', 'KF_BRIDGE_URL']);

/**
 * Source files whose env reads count.
 *
 * Workspace ROOT files are included, not just src/: sentry.client.config.ts,
 * sentry.server.config.ts and next.config.ts all live beside package.json, and
 * excluding them reported four Sentry variables as documented-but-never-read
 * when they are read on every boot.
 *
 * Tests are excluded deliberately: a var only a spec sets is not something a
 * developer must configure.
 */
function sourceFiles() {
  return tracked().filter(
    (f) =>
      /^(apps|packages)\/[^/]+\/(src\/.*|[^/]+)\.(ts|tsx|mjs|js)$/.test(f) &&
      !/\.(spec|test)\.(ts|tsx)$/.test(f) &&
      !/\.d\.ts$/.test(f) &&
      !f.includes('/node_modules/'),
  );
}

/** name -> Set of files that read it */
function envReads() {
  const reads = new Map();
  for (const f of sourceFiles()) {
    let src;
    try {
      src = readFileSync(join(REPO, f), 'utf8');
    } catch {
      continue;
    }
    // process.env.NAME and process.env['NAME'] / ["NAME"]
    const re = /process\.env(?:\.([A-Z][A-Z0-9_]{2,})|\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\])/g;
    let m;
    while ((m = re.exec(src))) {
      const name = m[1] ?? m[2];
      if (AMBIENT.has(name) || APP_INJECTED.has(name)) continue;
      if (!reads.has(name)) reads.set(name, new Set());
      reads.get(name).add(f);
    }
  }
  return reads;
}

/** Declared names in .env.example, including commented-out `# NAME=` lines. */
function documented() {
  const text = readFileSync(EXAMPLE, 'utf8');
  const names = new Set();
  for (const line of text.split('\n')) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]{2,})=/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Group a variable by where it is read, so the file reads like the system. */
function groupOf(files) {
  const f = [...files][0] ?? '';
  const mod = /^apps\/server\/src\/modules\/([^/]+)\//.exec(f);
  if (mod) return `server / ${mod[1]}`;
  const core = /^apps\/server\/src\/core\/([^/]+)\//.exec(f);
  if (core) return `server / core / ${core[1]}`;
  if (f.startsWith('apps/server/')) return 'server';
  if (f.startsWith('apps/web/')) return 'web';
  if (f.startsWith('apps/voice-agent/')) return 'voice-agent';
  const pkg = /^packages\/([^/]+)\//.exec(f);
  if (pkg) return `packages / ${pkg[1]}`;
  return 'other';
}

const reads = envReads();
const known = documented();

const missing = [...reads.keys()].filter((n) => !known.has(n)).sort();
const unread = [...known].filter((n) => !reads.has(n) && !AMBIENT.has(n)).sort();

console.log(`env vars read by code   : ${reads.size}`);
console.log(`documented in .env.example: ${known.size}`);
console.log(`MISSING from .env.example : ${missing.length}`);
console.log(`documented but never read : ${unread.length}`);

if (missing.length) {
  const byGroup = new Map();
  for (const name of missing) {
    const g = groupOf(reads.get(name));
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(name);
  }

  const lines = [
    '',
    '# ============================================================================',
    '# Read by the code but previously undocumented.',
    '#',
    '# Added by scripts/env-audit/sync-env-example.mjs. Each entry names the file',
    '# that reads it. Most are optional and degrade a single feature when unset —',
    '# which is exactly why they went unnoticed. Annotate and move them into the',
    '# sections above as you confirm what each one does.',
    '# ============================================================================',
  ];
  for (const g of [...byGroup.keys()].sort()) {
    lines.push('', `# ── ${g} ──`);
    for (const name of byGroup.get(g)) {
      const where = [...reads.get(name)].sort()[0];
      lines.push(`# read by ${where}`, `${name}=`);
    }
  }

  if (WRITE) {
    writeFileSync(EXAMPLE, readFileSync(EXAMPLE, 'utf8').replace(/\s*$/, '\n') + lines.join('\n') + '\n', 'utf8');
    console.log(`\nappended ${missing.length} entries to .env.example`);
  } else {
    console.log('\nmissing (re-run with --write to append):');
    for (const g of [...byGroup.keys()].sort()) {
      console.log(`  ${g}: ${byGroup.get(g).join(', ')}`);
    }
  }
}

if (unread.length) {
  console.log(`\ndocumented but no longer read by any source file:`);
  console.log(`  ${unread.join(', ')}`);
}
