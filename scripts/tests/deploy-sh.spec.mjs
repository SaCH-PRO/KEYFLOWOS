/**
 * scripts/deploy.sh: the .env.production preflight and the health wait.
 *
 * WHY: on 2026-11-13 deploy.sh printed DEPLOYED while the API crash-looped on
 * "[FATAL] Environment validation failed: SUPABASE_JWT_SECRET is a public
 * placeholder". Nothing checked .env.production against the server's own
 * boot rules before the backup and the build, and the verify step slept 8 s,
 * read /healthz once and accepted any body whose commit matched, so a
 * degraded health (apiReachable false: the web up, the API down) read as a
 * success.
 *
 * HOW: each case runs the REAL scripts/deploy.sh, copied into a scratch git
 * checkout with a fixture .env.production, with stand-ins first on PATH for
 * docker (logs its calls; a pg_dump of 120 CREATE TABLE lines), curl (serves
 * /healthz bodies in order, or a transport failure), sleep (logs, returns at
 * once) and free (4 GB swap). DEPLOY_SKIP_CI_CHECK=1 skips the CI query (the
 * only other curl call). DEPLOY_BACKUP_DIR keeps the dump in the scratch
 * directory. No network, no docker, no real secret: the one real-looking
 * value is random per run and must never be printed.
 *
 *   DSH-P*  preflight: a SUPABASE_JWT_SECRET public placeholder (as env.ts
 *           lists it) is refused before any docker call (no backup, no
 *           build), plain, double- or single-quoted, padded with spaces,
 *           behind `export`, with an inline comment, with CRLF line endings,
 *           in an earlier duplicate line, and with env.ts absent (the
 *           script's own copy of the list). Empty, unset, commented-out and
 *           real-looking values pass. The server's other boot refusals
 *           (KEYFLOW_DEV_AUTH_BYPASS, the S3 group, the email-verification
 *           trio in main.ts) are refused too. No value is ever printed.
 *   DSH-V*  verify: /healthz is polled (bounded: 18 polls 5 s apart, 90 s)
 *           until it reports status ok, apiReachable true and the commit just
 *           built; DEPLOYED only then. Degraded for the whole window, an old
 *           commit, or no answer at all exits 1 with the rollback
 *           instructions and never prints DEPLOYED.
 *   DSH-S*  the script's mirror of the server rules is pinned to the server
 *           source: its built-in placeholder list equals env.ts's Set, its S3
 *           keys equal env.ts's required group, and main.ts still requires
 *           the three email-verification variables it checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEPLOY_SH = join(REPO_ROOT, 'scripts', 'deploy.sh');
const ENV_TS = join(REPO_ROOT, 'apps', 'server', 'src', 'core', 'config', 'env.ts');
const MAIN_TS = join(REPO_ROOT, 'apps', 'server', 'src', 'main.ts');

/** The placeholders as env.ts declares them (the source the preflight must follow). */
function envTsPlaceholders() {
  const src = readFileSync(ENV_TS, 'utf8');
  const m = src.match(/PUBLIC_SUPABASE_JWT_SECRET_PLACEHOLDERS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'env.ts no longer declares PUBLIC_SUPABASE_JWT_SECRET_PLACEHOLDERS = new Set([...])');
  const values = [...m[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
  assert.ok(values.length > 0, 'env.ts placeholder Set is empty');
  return values;
}

const PLACEHOLDERS = envTsPlaceholders();
const PLACEHOLDER = PLACEHOLDERS[PLACEHOLDERS.length - 1];

/** A .env.production the server would boot with (stand-in values only). */
const BASE_ENV = [
  '# test fixture: stand-in values only',
  'POSTGRES_PASSWORD=stub-db-password-not-a-secret',
  'SUPABASE_URL=https://project.example.invalid',
  'SUPABASE_SERVICE_ROLE_KEY=stub-service-role-not-a-key',
  'RESEND_API_KEY=stub-resend-not-a-key',
  'EMAIL_FROM_ADDRESS=ops@example.invalid',
  'APP_URL=https://app.example.invalid',
  '',
].join('\n');

const STUBS = {
  docker: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_STATE/docker.log"
case " $* " in
  *" exec -T db "*) for i in $(seq 1 120); do printf 'CREATE TABLE t%d (id int);\\n' "$i"; done ;;
  *" logs "*) printf 'api-1  | stub log line\\n' ;;
esac
exit 0
`,
  curl: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_STATE/curl.log"
n=$(( $(cat "$STUB_STATE/curl.count" 2>/dev/null || echo 0) + 1 ))
printf '%s\\n' "$n" > "$STUB_STATE/curl.count"
f="$STUB_STATE/health.$n"
[ -e "$f" ] || f="$STUB_STATE/health.default"
[ -e "$f" ] || { printf 'curl: (7) Failed to connect\\n' >&2; exit 7; }
if [ "$(cat "$f")" = "__FAIL__" ]; then printf 'curl: (7) Failed to connect\\n' >&2; exit 7; fi
cat "$f"
`,
  sleep: `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_STATE/sleep.log"
exit 0
`,
  free: `#!/usr/bin/env bash
printf '              total        used        free\\nMem:           7800        2000        5800\\nSwap:          4096           0        4096\\n'
`,
};

function git(cwd, args) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'deploy-sh-spec',
      GIT_AUTHOR_EMAIL: 'deploy-sh-spec@example.invalid',
      GIT_COMMITTER_NAME: 'deploy-sh-spec',
      GIT_COMMITTER_EMAIL: 'deploy-sh-spec@example.invalid',
    },
  });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * A scratch checkout holding the real deploy.sh, a fixture .env.production
 * and (unless envTs is false) the real env.ts; stand-ins on PATH.
 */
function sandbox({ envFile, envTs = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-sh-'));
  const root = join(dir, 'checkout');
  const bin = join(dir, 'bin');
  const state = join(dir, 'state');
  for (const d of [root, join(root, 'scripts'), bin, state]) mkdirSync(d, { recursive: true });
  copyFileSync(DEPLOY_SH, join(root, 'scripts', 'deploy.sh'));
  writeFileSync(join(root, 'docker-compose.production.yml'), 'services: {}\n');
  if (envTs) {
    mkdirSync(join(root, 'apps', 'server', 'src', 'core', 'config'), { recursive: true });
    copyFileSync(ENV_TS, join(root, 'apps', 'server', 'src', 'core', 'config', 'env.ts'));
  }
  writeFileSync(join(root, '.gitignore'), '.env.production\n');
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'deploy-sh spec fixture']);
  writeFileSync(join(root, '.env.production'), envFile);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const commit = git(root, ['rev-parse', 'HEAD']).slice(0, 12);
  return { dir, root, bin, state, commit };
}

function healthBody({ status = 'ok', apiReachable = true, commit, env = 'ok' }) {
  return JSON.stringify({
    status,
    uptimeSec: 3,
    commit,
    nodeVersion: 'v22.23.4',
    apiBase: 'http://api:3001',
    apiReachable,
    apiLatencyMs: 4,
    apiStatus: apiReachable ? 200 : undefined,
    apiError: apiReachable ? undefined : 'fetch failed',
    env,
    envError: null,
    timestamp: '2026-11-13T00:00:00.000Z',
  });
}

/** Health answers by poll number (1-based); `default` answers every later poll. '__FAIL__' is a transport failure. */
function serveHealth(sb, { sequence = [], fallback } = {}) {
  sequence.forEach((body, i) => writeFileSync(join(sb.state, `health.${i + 1}`), body));
  if (fallback !== undefined) writeFileSync(join(sb.state, 'health.default'), fallback);
}

function runDeploy(sb) {
  return new Promise((resolve, reject) => {
    const env = {
      PATH: `${sb.bin}:${process.env.PATH}`,
      HOME: sb.dir,
      STUB_STATE: sb.state,
      DEPLOY_SKIP_CI_CHECK: '1',
      DEPLOY_BACKUP_DIR: sb.state,
    };
    const child = spawn('bash', [join(sb.root, 'scripts', 'deploy.sh')], { cwd: sb.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.setEncoding('utf8').on('data', (s) => (stdout += s));
    child.stderr.setEncoding('utf8').on('data', (s) => (stderr += s));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(new Error(`deploy.sh ended by ${signal}: ${stdout}${stderr}`));
      else resolve({ code, out: stdout + stderr });
    });
  });
}

function lines(sb, name) {
  const f = join(sb.state, name);
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
}

async function withSandbox(opts, fn) {
  const sb = sandbox(opts);
  try {
    return await fn(sb);
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

/** The preflight refused: exit 1, the reason named, and NOTHING after it ran (no backup, build, start or probe). */
function assertRefusedBeforeBackup(sb, result, reason) {
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, reason, result.out);
  assert.match(result.out, /\.env\.production/, result.out);
  assert.deepEqual(lines(sb, 'docker.log'), [], `docker was called before the refusal:\n${result.out}`);
  assert.deepEqual(lines(sb, 'curl.log'), [], result.out);
  assert.doesNotMatch(result.out, /DEPLOYED/);
}

const PLACEHOLDER_REASON = /SUPABASE_JWT_SECRET[^\n]*public placeholder/;

// ---------------------------------------------------------------------------
// DSH-P: the .env.production preflight
// ---------------------------------------------------------------------------

const placeholderSpellings = [
  ['plain', (p) => `SUPABASE_JWT_SECRET=${p}\n`],
  ['double-quoted', (p) => `SUPABASE_JWT_SECRET="${p}"\n`],
  ['single-quoted with inner spaces', (p) => `SUPABASE_JWT_SECRET='  ${p}  '\n`],
  ['padded with spaces and tabs, unquoted', (p) => `  SUPABASE_JWT_SECRET =\t ${p} \t\n`],
  ['double-quoted with inner spaces', (p) => `SUPABASE_JWT_SECRET=" ${p} "\n`],
  ['behind export', (p) => `export SUPABASE_JWT_SECRET=${p}\n`],
  ['with an inline comment', (p) => `SUPABASE_JWT_SECRET=${p} # copied from .env.example\n`],
  ['with CRLF line endings', (p) => `SUPABASE_JWT_SECRET=${p}\r\nOTHER=1\r\n`],
  ['in an earlier duplicate line', (p) => `SUPABASE_JWT_SECRET=${p}\nSUPABASE_JWT_SECRET=${randomBytes(24).toString('hex')}\n`],
];

for (const [label, spell] of placeholderSpellings) {
  test(`[DSH-P1] a SUPABASE_JWT_SECRET placeholder (${label}) is refused before the backup and the build`, () =>
    withSandbox({ envFile: BASE_ENV + spell(PLACEHOLDER) }, async (sb) => {
      serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
      const result = await runDeploy(sb);
      assertRefusedBeforeBackup(sb, result, PLACEHOLDER_REASON);
    }));
}

test('[DSH-P2] every placeholder env.ts lists is refused', async () => {
  for (const p of PLACEHOLDERS) {
    await withSandbox({ envFile: BASE_ENV + `SUPABASE_JWT_SECRET="${p}"\n` }, async (sb) => {
      const result = await runDeploy(sb);
      assertRefusedBeforeBackup(sb, result, PLACEHOLDER_REASON);
    });
  }
});

test('[DSH-P3] without env.ts in the checkout (an older ref), the script\'s own copy of the list still refuses', () =>
  withSandbox({ envFile: BASE_ENV + `SUPABASE_JWT_SECRET=${PLACEHOLDER}\n`, envTs: false }, async (sb) => {
    const result = await runDeploy(sb);
    assertRefusedBeforeBackup(sb, result, PLACEHOLDER_REASON);
  }));

test('[DSH-P4] the refusal never prints a value from .env.production', () =>
  withSandbox(
    { envFile: BASE_ENV + `SUPABASE_JWT_SECRET='${PLACEHOLDER}'\nKEYFLOW_DEV_AUTH_BYPASS=true\nS3_BUCKET=bucket-sentinel-7f3a\n` },
    async (sb) => {
      const result = await runDeploy(sb);
      assert.equal(result.code, 1, result.out);
      assert.doesNotMatch(result.out, new RegExp(PLACEHOLDER.replace(/[-]/g, '\\-')));
      for (const v of ['bucket-sentinel-7f3a', 'stub-service-role-not-a-key', 'stub-resend-not-a-key', 'stub-db-password-not-a-secret']) {
        assert.ok(!result.out.includes(v), `printed a value from .env.production:\n${result.out}`);
      }
      // All three reasons, each by name.
      assert.match(result.out, PLACEHOLDER_REASON);
      assert.match(result.out, /KEYFLOW_DEV_AUTH_BYPASS/);
      assert.match(result.out, /S3_REGION/);
    },
  ));

const passingSpellings = [
  ['empty', 'SUPABASE_JWT_SECRET=\n'],
  ['empty quotes', 'SUPABASE_JWT_SECRET=""\n'],
  ['unset', ''],
  ['commented out', `# SUPABASE_JWT_SECRET=${PLACEHOLDER}\n`],
];

for (const [label, line] of passingSpellings) {
  test(`[DSH-P5] SUPABASE_JWT_SECRET ${label} passes the preflight and the deploy completes`, () =>
    withSandbox({ envFile: BASE_ENV + line }, async (sb) => {
      serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
      const result = await runDeploy(sb);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, /DEPLOYED/);
      assert.ok(lines(sb, 'docker.log').some((l) => / build /.test(` ${l} `)), result.out);
    }));
}

test('[DSH-P6] a real-looking SUPABASE_JWT_SECRET passes and is never printed', () => {
  const secret = randomBytes(48).toString('base64');
  return withSandbox({ envFile: BASE_ENV + `SUPABASE_JWT_SECRET="${secret}"\n` }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
    const result = await runDeploy(sb);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /DEPLOYED/);
    assert.ok(!result.out.includes(secret), 'the secret was printed');
  });
});

test('[DSH-P7] KEYFLOW_DEV_AUTH_BYPASS on is refused (main.ts assertNoDevAuthBypass exits at boot)', () =>
  withSandbox({ envFile: BASE_ENV + 'KEYFLOW_DEV_AUTH_BYPASS=1\n' }, async (sb) => {
    const result = await runDeploy(sb);
    assertRefusedBeforeBackup(sb, result, /KEYFLOW_DEV_AUTH_BYPASS/);
  }));

test('[DSH-P8] an incomplete S3 group is refused, naming the missing keys (env.ts validateS3Group)', () =>
  withSandbox({ envFile: BASE_ENV + 'S3_BUCKET=b\nS3_ENDPOINT=minio:9000\n' }, async (sb) => {
    const result = await runDeploy(sb);
    assertRefusedBeforeBackup(sb, result, /S3_REGION/);
    assert.match(result.out, /S3_ACCESS_KEY_ID/);
    assert.match(result.out, /S3_SECRET_ACCESS_KEY/);
    assert.match(result.out, /S3_ENDPOINT[^\n]*http/);
  }));

test('[DSH-P9] a complete S3 group passes', () =>
  withSandbox(
    {
      envFile:
        BASE_ENV +
        'S3_BUCKET=b\nS3_REGION=us-east-1\nS3_ACCESS_KEY_ID=stub-access-id\nS3_SECRET_ACCESS_KEY=stub-not-a-secret\nS3_ENDPOINT=http://minio:9000\n',
    },
    async (sb) => {
      serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
      const result = await runDeploy(sb);
      assert.equal(result.code, 0, result.out);
    },
  ));

test('[DSH-P10] email verification on (the production default) without RESEND_API_KEY is refused (main.ts)', () =>
  withSandbox({ envFile: BASE_ENV.replace(/^RESEND_API_KEY=.*\n/m, '') }, async (sb) => {
    const result = await runDeploy(sb);
    assertRefusedBeforeBackup(sb, result, /RESEND_API_KEY/);
  }));

test('[DSH-P11] AUTH_REQUIRE_EMAIL_VERIFICATION=false lifts the email trio, as main.ts does', () =>
  withSandbox({ envFile: BASE_ENV.replace(/^RESEND_API_KEY=.*\n/m, '') + 'AUTH_REQUIRE_EMAIL_VERIFICATION=false\n' }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
    const result = await runDeploy(sb);
    assert.equal(result.code, 0, result.out);
  }));

// ---------------------------------------------------------------------------
// DSH-V: the bounded health wait
// ---------------------------------------------------------------------------

test('[DSH-V1] polls until /healthz is ok, apiReachable and on the new commit, then DEPLOYED', () =>
  withSandbox({ envFile: BASE_ENV }, async (sb) => {
    serveHealth(sb, {
      sequence: [
        '__FAIL__',
        healthBody({ status: 'degraded', apiReachable: false, commit: 'old000000000' }),
        healthBody({ status: 'degraded', apiReachable: false, commit: sb.commit }),
      ],
      fallback: healthBody({ commit: sb.commit }),
    });
    const result = await runDeploy(sb);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /DEPLOYED/);
    assert.equal(lines(sb, 'curl.log').length, 4, result.out);
    assert.ok(lines(sb, 'curl.log').every((l) => /\/api\/healthz/.test(l)));
  }));

test('[DSH-V2] degraded for the whole window (the API crash-looping): exit 1, rollback instructions, never DEPLOYED', () =>
  withSandbox({ envFile: BASE_ENV }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ status: 'degraded', apiReachable: false, commit: sb.commit }) });
    const result = await runDeploy(sb);
    assert.equal(result.code, 1, result.out);
    assert.doesNotMatch(result.out, /DEPLOYED/);
    assert.match(result.out, /apiReachable/);
    assert.match(result.out, /docker tag keyflowos-api:rollback keyflowos-api:latest/);
    assert.match(result.out, /logs/);
    // Bounded: 18 polls, 17 waits of 5 s between them (90 s).
    assert.equal(lines(sb, 'curl.log').length, 18, result.out);
    assert.deepEqual(lines(sb, 'sleep.log'), Array(17).fill('5'));
  }));

test('[DSH-V3] status ok but apiReachable false is not healthy', () =>
  withSandbox({ envFile: BASE_ENV }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ status: 'ok', apiReachable: false, commit: sb.commit }) });
    const result = await runDeploy(sb);
    assert.equal(result.code, 1, result.out);
    assert.doesNotMatch(result.out, /DEPLOYED/);
  }));

test('[DSH-V4] apiReachable true but status degraded (web env invalid) is not healthy', () =>
  withSandbox({ envFile: BASE_ENV }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ status: 'degraded', apiReachable: true, env: 'invalid', commit: sb.commit }) });
    const result = await runDeploy(sb);
    assert.equal(result.code, 1, result.out);
    assert.doesNotMatch(result.out, /DEPLOYED/);
  }));

test('[DSH-V5] healthy but still the old commit for the whole window: MISMATCH, exit 1, rollback', () =>
  withSandbox({ envFile: BASE_ENV }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ commit: 'old000000000' }) });
    const result = await runDeploy(sb);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /MISMATCH/);
    assert.doesNotMatch(result.out, /DEPLOYED/);
    assert.match(result.out, /docker tag keyflowos-web:rollback keyflowos-web:latest/);
  }));

test('[DSH-V6] /healthz never answers: exit 1, never DEPLOYED', () =>
  withSandbox({ envFile: BASE_ENV }, async (sb) => {
    serveHealth(sb, { fallback: '__FAIL__' });
    const result = await runDeploy(sb);
    assert.equal(result.code, 1, result.out);
    assert.doesNotMatch(result.out, /DEPLOYED/);
    assert.equal(lines(sb, 'curl.log').length, 18, result.out);
  }));

// ---------------------------------------------------------------------------
// DSH-S: the mirror is pinned to the server source
// ---------------------------------------------------------------------------

test('[DSH-S1] deploy.sh\'s built-in placeholder list equals env.ts\'s Set', () => {
  const src = readFileSync(DEPLOY_SH, 'utf8');
  const m = src.match(/^DEPLOY_JWT_SECRET_PLACEHOLDERS=\(([^)]*)\)/m);
  assert.ok(m, 'deploy.sh declares no DEPLOY_JWT_SECRET_PLACEHOLDERS=(...)');
  const builtIn = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
  assert.deepEqual([...builtIn].sort(), [...PLACEHOLDERS].sort());
});

test('[DSH-S2] deploy.sh\'s S3 group equals env.ts validateS3Group, and main.ts still requires the email trio', () => {
  const env = readFileSync(ENV_TS, 'utf8');
  const sh = readFileSync(DEPLOY_SH, 'utf8');
  const keys = (re, text, what) => {
    const m = text.match(re);
    assert.ok(m, what);
    return [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]);
  };
  assert.deepEqual(
    keys(/^DEPLOY_S3_GROUP=\(([^)]*)\)/m, sh, 'deploy.sh declares no DEPLOY_S3_GROUP=(...)'),
    keys(/const s3Keys = \[([^\]]*)\]/, env, 'env.ts s3Keys moved'),
  );
  assert.deepEqual(
    keys(/^DEPLOY_S3_REQUIRED=\(([^)]*)\)/m, sh, 'deploy.sh declares no DEPLOY_S3_REQUIRED=(...)'),
    keys(/const required = \[([^\]]*)\]/, env, 'env.ts S3 required list moved'),
  );
  const main = readFileSync(MAIN_TS, 'utf8');
  const trio = keys(/^DEPLOY_EMAIL_VERIFICATION_REQUIRED=\(([^)]*)\)/m, sh, 'deploy.sh declares no DEPLOY_EMAIL_VERIFICATION_REQUIRED=(...)');
  assert.deepEqual(trio, ['SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'EMAIL_FROM_ADDRESS']);
  for (const k of trio) assert.ok(main.includes(`missing.push('${k}')`), `main.ts no longer requires ${k}`);
  assert.ok(main.includes("verificationFlag === '' && process.env.NODE_ENV === 'production'"), 'main.ts email-verification default moved');
});
