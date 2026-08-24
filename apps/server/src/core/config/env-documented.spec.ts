/**
 * An environment variable the code reads but nobody wrote down is a variable a
 * fresh clone silently lacks.
 *
 * Silently is the operative word. Almost nothing here throws on a missing key —
 * the pattern is a warning and a placeholder:
 *
 *   const apiKey = process.env.OPENAI_API_KEY;
 *   if (!apiKey) this.logger.warn('… will be unavailable');
 *   this.openai = new OpenAI({ apiKey: apiKey ?? 'sk-no-key' });
 *
 * So the feature does not fail at boot. It fails later, at the provider, with an
 * authentication error that names nothing useful. OPENAI_API_KEY was exactly
 * this: read by key-cortex-document and key-cortex-voice, absent from both .env
 * and .env.example, mapped in docker-compose.production.yml but not locally, and
 * working on one machine only because that developer happened to have it in
 * their shell. Two features were one `git clone` away from being quietly dead.
 *
 * This gate does not check that a variable has a VALUE — that is deployment
 * configuration and differs per environment. It checks that a variable the code
 * depends on is DECLARED, so the person setting up an environment can see it
 * exists at all.
 *
 * WHAT IT DELIBERATELY IGNORES:
 *
 *   ambient    NODE_ENV, PORT, CI — supplied by the platform or the runner.
 *   injected   KF_CODE, KF_EXEC_TOKEN — code-executor.service.ts SETS these on
 *              the E2B sandbox and reads them back inside it. They are generated
 *              per execution; listing them would send someone hunting for a
 *              value that does not exist until runtime.
 *   tests      A variable only a spec sets is not setup a developer must do.
 *
 * The reverse direction — documented but no longer read — is reported by
 * scripts/env-audit/sync-env-example.mjs but NOT gated here, because that check
 * has false positives this one does not: env passed as a function parameter
 * rather than read through process.env, tooling that reads it outside the app
 * (TURBO_TOKEN), and scripts/ which is not scanned.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.join(__dirname, '..', '..', '..', '..', '..');
const EXAMPLE = path.join(REPO, '.env.example');

const AMBIENT = new Set([
  'NODE_ENV', 'CI', 'PORT', 'PWD', 'HOME', 'PATH', 'TZ',
  'VITEST', 'VITEST_WORKER_ID', 'npm_lifecycle_event', 'npm_package_version',
  'GIT_COMMIT', 'VERCEL', 'VERCEL_ENV', 'NEXT_RUNTIME', 'NEXT_PHASE',
]);

/** Set by the app on a child process, not supplied by a developer. */
const APP_INJECTED = new Set(['KF_CODE', 'KF_INPUTS', 'KF_EXEC_TOKEN', 'KF_BRIDGE_URL']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.next', '.turbo'].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.(spec|test)\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Files whose env reads count: every workspace's src/, plus the config files
 * that sit beside package.json. sentry.client.config.ts and next.config.ts read
 * env on every boot and live outside src/ — scanning only src/ reported four
 * Sentry variables as unused when they are load-bearing.
 */
function sourceFiles(): string[] {
  const out: string[] = [];
  for (const group of ['apps', 'packages']) {
    const base = path.join(REPO, group);
    let workspaces: string[];
    try {
      workspaces = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const ws of workspaces) {
      out.push(...walk(path.join(base, ws, 'src')));
      // Root-level config files only, not a recursive walk of the workspace.
      try {
        for (const f of fs.readdirSync(path.join(base, ws), { withFileTypes: true })) {
          if (!f.isFile()) continue;
          if (!/\.(ts|mjs|js)$/.test(f.name) || /\.d\.ts$/.test(f.name)) continue;
          out.push(path.join(base, ws, f.name));
        }
      } catch {
        /* workspace has no root config files */
      }
    }
  }
  return out;
}

function envReads(): Map<string, string> {
  const reads = new Map<string, string>();
  for (const f of sourceFiles()) {
    let src: string;
    try {
      src = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const re = /process\.env(?:\.([A-Z][A-Z0-9_]{2,})|\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]\s*\])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const name = (m[1] ?? m[2]) as string;
      if (AMBIENT.has(name) || APP_INJECTED.has(name)) continue;
      if (!reads.has(name)) reads.set(name, path.relative(REPO, f).split(path.sep).join('/'));
    }
  }
  return reads;
}

/** Names declared in .env.example, including commented-out `# NAME=` lines. */
function documented(): Set<string> {
  const names = new Set<string>();
  for (const line of fs.readFileSync(EXAMPLE, 'utf8').split('\n')) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]{2,})=/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

describe('environment variables are declared', () => {
  it('finds the reads and the declarations — this gate is not vacuous', () => {
    // Either number collapsing to zero would make the assertion below pass on
    // anything at all.
    expect(envReads().size, 'process.env reads not being found').toBeGreaterThan(150);
    expect(documented().size, '.env.example not being parsed').toBeGreaterThan(150);
  });

  it('scans config files beside package.json, not only src/', () => {
    // The case that produced four false "unused" reports. If Sentry's DSN stops
    // being seen, the scanner has narrowed again.
    const reads = envReads();
    expect(reads.has('NEXT_PUBLIC_SENTRY_DSN')).toBe(true);
    expect(reads.get('NEXT_PUBLIC_SENTRY_DSN')).toMatch(/sentry\..*\.config\.ts$/);
  });

  it('ignores variables the app injects into its own sandbox', () => {
    // KF_CODE is assigned by code-executor.service.ts and read back inside E2B.
    expect(envReads().has('KF_CODE')).toBe(false);
  });

  it('every environment variable the code reads is declared in .env.example', () => {
    const reads = envReads();
    const known = documented();

    const undeclared = [...reads.entries()]
      .filter(([name]) => !known.has(name))
      .map(([name, where]) => `${name} (read by ${where})`)
      .sort();

    expect(
      undeclared,
      'this variable is read by the code but appears nowhere in .env.example, so ' +
        'a fresh clone has no way to know it exists. Most reads here fall back to ' +
        'a placeholder rather than failing, so the symptom is a dead feature and a ' +
        'confusing provider error, not a boot failure. Add it with ' +
        '`node scripts/env-audit/sync-env-example.mjs --write`, then annotate it.',
    ).toEqual([]);
  });
});
