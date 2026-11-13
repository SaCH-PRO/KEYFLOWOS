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
 *           script's own copy of the list); a value added to env.ts's Set
 *           is refused too (the list is read from the code being deployed). Empty, unset, commented-out and
 *           real-looking values pass. The server's other boot refusals
 *           (KEYFLOW_DEV_AUTH_BYPASS, the S3 group, the email-verification
 *           trio in main.ts) are refused too. No value is ever printed,
 *           not even under `bash -x` (P12). For a name the preflight reads,
 *           a line compose reads differently from KEY=value (YAML-style
 *           `KEY: value`, `${VAR}` or `$VAR` outside single quotes) cannot
 *           be verified and is refused (P13).
 *   DSH-V*  verify: /healthz is polled (bounded: 18 polls 5 s apart, 90 s)
 *           until it reports status ok, apiReachable true and the commit just
 *           built; DEPLOYED only then. Degraded for the whole window, an old
 *           commit, or no answer at all exits 1 with the rollback
 *           instructions and never prints DEPLOYED.
 *   DSH-B*  the pre-deploy dump is created owner-only (0600) under umask 022.
 *   DSH-R*  `deploy.sh <ref>` from a box whose deploy.sh differs from the
 *           ref's: after the checkout the ref's deploy.sh is run (once),
 *           so its preflight and health wait apply on that deploy.
 *   DSH-S*  the script's mirror of the server rules is pinned to the server
 *           source: its built-in placeholder list equals env.ts's Set, its S3
 *           keys equal env.ts's required group, and main.ts still requires
 *           the three email-verification variables it checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
function sandbox({ envFile, envTs = true, envTsTransform = (src) => src }) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-sh-'));
  const root = join(dir, 'checkout');
  const bin = join(dir, 'bin');
  const state = join(dir, 'state');
  for (const d of [root, join(root, 'scripts'), bin, state]) mkdirSync(d, { recursive: true });
  copyFileSync(DEPLOY_SH, join(root, 'scripts', 'deploy.sh'));
  writeFileSync(join(root, 'docker-compose.production.yml'), 'services: {}\n');
  if (envTs) {
    mkdirSync(join(root, 'apps', 'server', 'src', 'core', 'config'), { recursive: true });
    writeFileSync(join(root, 'apps', 'server', 'src', 'core', 'config', 'env.ts'), envTsTransform(readFileSync(ENV_TS, 'utf8')));
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

/**
 * Runs the sandbox's deploy.sh. `args` go to the script (a git ref),
 * `bashArgs` to bash before it (`-x`), `umask` is set before bash starts,
 * and `env` adds to the stand-in environment.
 */
function runDeploy(sb, { args = [], bashArgs = [], umask = null, env: extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      PATH: `${sb.bin}:${process.env.PATH}`,
      HOME: sb.dir,
      STUB_STATE: sb.state,
      DEPLOY_SKIP_CI_CHECK: '1',
      DEPLOY_BACKUP_DIR: sb.state,
      ...extraEnv,
    };
    const script = join(sb.root, 'scripts', 'deploy.sh');
    const [cmd, argv] = umask === null
      ? ['bash', [...bashArgs, script, ...args]]
      : ['sh', ['-c', `umask ${umask} && exec bash "$@"`, 'sh', ...bashArgs, script, ...args]];
    const child = spawn(cmd, argv, { cwd: sb.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('[DSH-P3b] the list is read from the env.ts being deployed: a value added there is refused too', () =>
  withSandbox(
    {
      envFile: BASE_ENV + 'SUPABASE_JWT_SECRET="dsh-newly-listed-placeholder"\n',
      envTsTransform: (src) => {
        const out = src.replace(/(PUBLIC_SUPABASE_JWT_SECRET_PLACEHOLDERS\s*=\s*new Set\(\[)/, "$1'dsh-newly-listed-placeholder', ");
        assert.notEqual(out, src, 'could not add a value to the env.ts Set');
        return out;
      },
    },
    async (sb) => {
      const result = await runDeploy(sb);
      assertRefusedBeforeBackup(sb, result, PLACEHOLDER_REASON);
    },
  ));

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

// An operator debugging a deploy runs `bash -x scripts/deploy.sh`, and deploy
// output gets pasted into chats and issues. The preflight is the one part of
// the script that holds .env.production values in shell variables; traced,
// every one of them was printed (each sentinel 20+ times).
function traceSentinels() {
  const tag = randomBytes(8).toString('hex');
  return {
    POSTGRES_PASSWORD: `dsh-trace-pg-${tag}`,
    SUPABASE_SERVICE_ROLE_KEY: `dsh-trace-srk-${tag}`,
    RESEND_API_KEY: `dsh-trace-resend-${tag}`,
    STRIPE_SECRET_KEY: `dsh-trace-stripe-${tag}`,
    SUPABASE_JWT_SECRET: `dsh-trace-jwt-${tag}`,
    S3_SECRET_ACCESS_KEY: `dsh-trace-s3-${tag}`,
  };
}

function traceEnvFile(sentinels) {
  return [
    '# test fixture: every value below is a per-run sentinel',
    'EMAIL_FROM_ADDRESS=ops@example.invalid',
    'S3_BUCKET=b',
    'S3_REGION=us-east-1',
    'S3_ACCESS_KEY_ID=stub-access-id',
    'S3_ENDPOINT=http://minio:9000',
    ...Object.entries(sentinels).map(([k, v], i) => (i % 2 ? `${k}="${v}"` : `export ${k}=${v} # inline`)),
    '',
  ].join('\n');
}

function assertNoSentinel(result, sentinels) {
  assert.match(result.out, /^\++ /m, `the run was not traced:\n${result.out}`);
  for (const [k, v] of Object.entries(sentinels)) {
    const n = result.out.split(v).length - 1;
    assert.equal(n, 0, `${k}'s value appears ${n} time(s) in the bash -x output`);
  }
}

test('[DSH-P12] under bash -x a deploy that passes the preflight traces no .env.production value', () => {
  const sentinels = traceSentinels();
  return withSandbox({ envFile: traceEnvFile(sentinels) }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
    const result = await runDeploy(sb, { bashArgs: ['-x'] });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /DEPLOYED/);
    assertNoSentinel(result, sentinels);
    // Off for the preflight only: the caller's tracing is back for the rest.
    assert.match(result.out, /^\++ BACKUP_DIR=/m, 'tracing did not resume after the preflight');
  });
});

test('[DSH-P12b] under bash -x a refused .env.production traces no value either', () => {
  const sentinels = traceSentinels();
  return withSandbox({ envFile: traceEnvFile(sentinels) + 'KEYFLOW_DEV_AUTH_BYPASS=true\n' }, async (sb) => {
    const result = await runDeploy(sb, { bashArgs: ['-x'] });
    assertRefusedBeforeBackup(sb, result, /KEYFLOW_DEV_AUTH_BYPASS/);
    assertNoSentinel(result, sentinels);
  });
});

// Compose reads more than KEY=value: a YAML-style `KEY: value` line, and
// `${VAR}` / `$VAR` interpolation outside single quotes (from the file or the
// shell that runs compose). The preflight did not model either, so
// `SUPABASE_JWT_SECRET: your-jwt-secret` or `RESEND_API_KEY=${UNSET}` passed it
// and the API crash-looped after the backup, the build and the restart. For a
// name the preflight reads, a line it cannot read as compose does is refused.
const unverifiable = [
  ['SUPABASE_JWT_SECRET', 'a YAML-style placeholder', `SUPABASE_JWT_SECRET: ${PLACEHOLDER}\n`],
  ['SUPABASE_JWT_SECRET', 'a YAML-style placeholder behind export', `export SUPABASE_JWT_SECRET:${PLACEHOLDER}\n`],
  ['RESEND_API_KEY', 'an interpolated ${VAR} (compose fills it from the shell)', 'RESEND_API_KEY=${RESEND_KEY_FROM_SHELL}\n'],
  ['SUPABASE_JWT_SECRET', 'an interpolated ${VAR} in double quotes', 'OLD_SECRET=x\nSUPABASE_JWT_SECRET="${OLD_SECRET}"\n'],
  ['KEYFLOW_DEV_AUTH_BYPASS', 'an interpolated bare $VAR', 'KEYFLOW_DEV_AUTH_BYPASS=$BYPASS\n'],
  ['S3_ENDPOINT', 'a YAML-style S3 value', 'S3_BUCKET=b\nS3_REGION=r\nS3_ACCESS_KEY_ID=a\nS3_SECRET_ACCESS_KEY=s\nS3_ENDPOINT: minio:9000\n'],
];

for (const [key, label, line] of unverifiable) {
  test(`[DSH-P13] ${key} written as ${label} cannot be verified and is refused before the backup`, () =>
    withSandbox({ envFile: BASE_ENV + line }, async (sb) => {
      serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
      const result = await runDeploy(sb, { env: { RESEND_KEY_FROM_SHELL: 'stub-from-shell', BYPASS: 'false' } });
      assertRefusedBeforeBackup(sb, result, new RegExp(`${key} \\(line \\d+\\)[^\\n]*cannot be verified`));
      assert.ok(!result.out.includes(PLACEHOLDER), `printed a value:\n${result.out}`);
    }));
}

const verifiable = [
  ['a $ inside single quotes (compose reads it literally)', `SUPABASE_JWT_SECRET='${randomBytes(12).toString('hex')}$x'\n`],
  ['interpolation and YAML style on names the preflight does not read', 'POSTGRES_PASSWORD="pa$$word"\nAPP_NAME: KEYFLOW\nDOCS_NOTE=see ${DOCS}\n'],
];

for (const [label, line] of verifiable) {
  test(`[DSH-P13b] ${label} passes the preflight`, () =>
    withSandbox({ envFile: BASE_ENV + line }, async (sb) => {
      serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
      const result = await runDeploy(sb);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, /DEPLOYED/);
    }));
}

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
// DSH-B: the pre-deploy dump
// ---------------------------------------------------------------------------

test('[DSH-B1] the dump (every tenant\'s data) is written owner-only, whatever the umask and DEPLOY_BACKUP_DIR', () =>
  withSandbox({ envFile: BASE_ENV }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
    const result = await runDeploy(sb, { umask: '022' });
    assert.equal(result.code, 0, result.out);
    const dumps = readdirSync(sb.state).filter((f) => /^keyflow-backup-.*\.sql$/.test(f));
    assert.equal(dumps.length, 1, `expected one dump in DEPLOY_BACKUP_DIR: ${dumps}`);
    const mode = statSync(join(sb.state, dumps[0])).mode & 0o777;
    assert.equal(mode & 0o077, 0, `the dump is mode ${mode.toString(8)}: readable beyond its owner`);
  }));

// ---------------------------------------------------------------------------
// DSH-R: `deploy.sh <ref>` runs the deploy.sh of the ref it deploys
// ---------------------------------------------------------------------------
//
// Bash reads a script through an open file. `git checkout` replaces
// scripts/deploy.sh with a new file, so the running bash went on reading the
// copy the box had BEFORE the checkout: the first deploy of a changed
// deploy.sh ran the previous one's logic from start to finish (no preflight,
// the old health check). Here the box is a single-branch clone of a local
// origin, as production is, and `next` on origin carries a different deploy.sh.

const REAL_DEPLOY_SH = readFileSync(DEPLOY_SH, 'utf8');

/** The real deploy.sh without its .env.production preflight: a box still on an older copy. */
function withoutPreflight(src) {
  const out = src.replace(/^check_env_production "\$ENV_FILE"\n/m, '');
  assert.notEqual(out, src, 'deploy.sh no longer calls check_env_production "$ENV_FILE" on a line of its own');
  return out;
}

/**
 * A box: a single-branch clone, at main, of an origin whose main holds
 * `boxScript` as scripts/deploy.sh and whose `next` holds `refScript`.
 */
function boxSandbox({ envFile, boxScript, refScript }) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-sh-box-'));
  const origin = join(dir, 'origin');
  const root = join(dir, 'checkout');
  const bin = join(dir, 'bin');
  const state = join(dir, 'state');
  const config = join(origin, 'apps', 'server', 'src', 'core', 'config');
  for (const d of [join(origin, 'scripts'), config, bin, state]) mkdirSync(d, { recursive: true });
  writeFileSync(join(origin, 'scripts', 'deploy.sh'), boxScript);
  writeFileSync(join(origin, 'docker-compose.production.yml'), 'services: {}\n');
  writeFileSync(join(config, 'env.ts'), readFileSync(ENV_TS, 'utf8'));
  writeFileSync(join(origin, '.gitignore'), '.env.production\n');
  git(origin, ['init', '-q']);
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(origin, ['add', '-A']);
  git(origin, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'what the box runs today']);
  git(origin, ['checkout', '-q', '-b', 'next']);
  writeFileSync(join(origin, 'scripts', 'deploy.sh'), refScript);
  writeFileSync(join(origin, 'RELEASE'), 'next\n');
  git(origin, ['add', '-A']);
  git(origin, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'the ref being deployed']);
  const next = git(origin, ['rev-parse', 'HEAD']);
  git(origin, ['checkout', '-q', 'main']);
  git(dir, ['clone', '-q', '--single-branch', '--branch', 'main', origin, root]);
  writeFileSync(join(root, '.env.production'), envFile);
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  return { dir, root, bin, state, next, commit: next.slice(0, 12) };
}

async function withBox(opts, fn) {
  const sb = boxSandbox(opts);
  try {
    return await fn(sb);
  } finally {
    rmSync(sb.dir, { recursive: true, force: true });
  }
}

const count = (text, re) => (text.match(new RegExp(re.source, 'g')) || []).length;
const REEXEC_NOTICE = /re-running the checked-out copy/;

test('[DSH-R1] deploying a ref whose deploy.sh differs runs THAT deploy.sh: its preflight refuses a placeholder the box\'s copy would ship', () =>
  withBox(
    { envFile: BASE_ENV + `SUPABASE_JWT_SECRET=${PLACEHOLDER}\n`, boxScript: withoutPreflight(REAL_DEPLOY_SH), refScript: REAL_DEPLOY_SH },
    async (sb) => {
      serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
      const result = await runDeploy(sb, { args: ['next'] });
      assertRefusedBeforeBackup(sb, result, PLACEHOLDER_REASON);
      assert.equal(count(result.out, REEXEC_NOTICE), 1, result.out);
      assert.equal(git(sb.root, ['rev-parse', 'HEAD']), sb.next, 'the ref was not checked out');
    },
  ));

test('[DSH-R2] after the re-run the deploy completes once: one fetch, one build, DEPLOYED on the ref', () =>
  withBox({ envFile: BASE_ENV, boxScript: withoutPreflight(REAL_DEPLOY_SH), refScript: REAL_DEPLOY_SH }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
    const result = await runDeploy(sb, { args: ['next'] });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, new RegExp(`DEPLOYED — /healthz reports ${sb.commit}`));
    assert.equal(count(result.out, REEXEC_NOTICE), 1, result.out);
    assert.equal(count(result.out, /==> Fetching next/), 1, result.out);
    assert.match(result.out, /Checking \.env\.production against the API's boot rules/);
    assert.equal(lines(sb, 'docker.log').filter((l) => / build /.test(` ${l} `)).length, 1, result.out);
  }));

test('[DSH-R3] a ref whose deploy.sh is the one running is deployed without a re-run', () =>
  withBox({ envFile: BASE_ENV, boxScript: REAL_DEPLOY_SH, refScript: REAL_DEPLOY_SH }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
    const result = await runDeploy(sb, { args: ['next'] });
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, new RegExp(`DEPLOYED — /healthz reports ${sb.commit}`));
    assert.equal(count(result.out, REEXEC_NOTICE), 0, result.out);
    assert.equal(count(result.out, /==> Fetching next/), 1, result.out);
  }));

test('[DSH-R4] a run that is already a re-run never goes on with a copy that is not the deployed one', () =>
  withBox({ envFile: BASE_ENV, boxScript: withoutPreflight(REAL_DEPLOY_SH), refScript: REAL_DEPLOY_SH }, async (sb) => {
    serveHealth(sb, { fallback: healthBody({ commit: sb.commit }) });
    const result = await runDeploy(sb, { args: ['next'], env: { DEPLOY_REEXEC: '1' } });
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /deploy\.sh/);
    assert.deepEqual(lines(sb, 'docker.log'), [], `docker was called:\n${result.out}`);
    assert.doesNotMatch(result.out, /DEPLOYED/);
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
