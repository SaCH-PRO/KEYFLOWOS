/**
 * No committed audit credential (R0-31-SEC-CREDENTIAL-REMOVE, PRS-M06).
 *
 * At c2f6f46d the two root Playwright audit scripts, audit-keyflowos.py and
 * audit-mobile-quick.py, carried a live login as module constants. It is not
 * a throwaway test account: the email is SUPER_ADMIN_EMAIL in
 * apps/server/src/core/seed/seed.service.ts and a bypass email in
 * feature-flags.service.ts, so this is the platform super-admin login. This
 * spec holds the two scripts to four rules.
 *
 *   1. Neither file contains the committed literals. The literals are NOT in
 *      this spec: it carries their SHA-256 digests, computed when the spec was
 *      written, and hashes every candidate token in the files. A pattern check
 *      also rejects any hard-coded password/secret assignment and any
 *      email-address literal, so a different credential pasted in later fails
 *      too.
 *   2. Both scripts take the login from KEYFLOWOS_AUDIT_EMAIL and
 *      KEYFLOWOS_AUDIT_PASSWORD, with no literal fallback, and those exact
 *      values are what reach the login form.
 *   3. When either variable is unset or empty, the script exits non-zero
 *      before it imports Playwright (so before any browser launch or HTTP
 *      call) and before it creates its output directory. This is observed,
 *      not inferred: the scripts run under a stub `playwright` package that
 *      announces its import, has no network code, and records what the login
 *      form was given.
 *   4. When a login step fails, neither login value reaches stdout, stderr or
 *      any file the script writes. Playwright appends its call log to the
 *      error message, and the call log line for page.fill repeats the typed
 *      value verbatim (`fill("<value>")`, playwright-core lib/server/dom.js),
 *      while audit-output/results.json and audit-output/mobile-results.json
 *      are tracked files. The stub raises an error of that shape from fill.
 *
 * Removing the literal from these two scripts does NOT remove it from the
 * repository. The password literal is still committed in two tracked files
 * outside this packet's write set (pinned by the repository-wide tests at the
 * end), and it stays in history. A follow-up packet must remove it there,
 * and rotating it is operator action D-30. This spec does not claim the
 * credential is safe.
 *
 * Run: node --test scripts/security/tests/no-committed-credential.spec.mjs
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPTS = ['audit-keyflowos.py', 'audit-mobile-quick.py'];
const ENV_EMAIL = 'KEYFLOWOS_AUDIT_EMAIL';
const ENV_PASSWORD = 'KEYFLOWOS_AUDIT_PASSWORD';

// SHA-256 (hex) of the two literals committed at c2f6f46d
// (audit-keyflowos.py:18-19, audit-mobile-quick.py:13-14).
const COMMITTED_DIGESTS = {
  email: '160bf673b7444aa688e00112d47df544106eaa0eb9377b36122e1d77ad9e169a',
  password: '12a8a4236ba1fad0e6ce18ffff07d27dcb5f50d4942a74aa38a7cb9e07f189ce',
};

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// Split on whitespace, quotes and the delimiters a literal sits between in
// Python, TypeScript, JSON, SQL and Markdown; also try each token with
// emphasis or sentence punctuation trimmed from its ends.
const TOKEN_SPLIT = /[\s'"`,;:()[\]{}<>=|\\/]+/;
const EDGE_PUNCT = /^[*_.!?#~]+|[*_.!?#~]+$/g;

function tokensOf(line) {
  const out = new Set();
  for (const raw of line.split(TOKEN_SPLIT)) {
    if (!raw) continue;
    out.add(raw);
    const trimmed = raw.replace(EDGE_PUNCT, '');
    if (trimmed) out.add(trimmed);
  }
  return out;
}

/**
 * `file:line (name)` for every line holding a token whose digest is one of
 * `digests`. Never returns the token itself, so a failure cannot print the
 * secret.
 */
function digestHits(relFile, text, digests, cache) {
  const wanted = new Map(Object.entries(digests).map(([name, d]) => [d, name]));
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const tok of tokensOf(line)) {
      let d = cache?.get(tok);
      if (d === undefined) {
        d = sha256(tok);
        cache?.set(tok, d);
      }
      const name = wanted.get(d);
      if (name) hits.push(`${relFile}:${i + 1} (${name})`);
    }
  });
  return hits;
}

/** `file:line` for every line matching `re` (a non-global RegExp). */
function lineHits(relFile, text, re) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (re.test(line)) hits.push(`${relFile}:${i + 1}`);
  });
  return hits;
}

const readScript = (f) => readFileSync(path.join(REPO_ROOT, f), 'utf8');

// A hard-coded secret: NAME = "<non-empty literal>" where NAME mentions a
// password, secret or token.
const HARDCODED_SECRET =
  /^\s*\w*(?:PASSWORD|PASSWD|SECRET|TOKEN)\w*\s*=\s*[rbuRBU]{0,2}(['"])(?!\1)/i;
// Any email-address string literal.
const EMAIL_LITERAL = /(['"])[^'"\s@]+@[^'"\s@]+\.[A-Za-z]{2,}\1/;
// os.environ.get("KEYFLOWOS_AUDIT_*", "<non-empty default>") or getenv(...).
const LITERAL_FALLBACK =
  /(?:environ\.get|getenv)\(\s*(['"])KEYFLOWOS_AUDIT_(?:EMAIL|PASSWORD)\1\s*,\s*[rbuRBU]{0,2}(['"])(?!\2)/;

const envRead = (name) =>
  new RegExp(
    String.raw`(?:os\.environ\.get|os\.getenv)\(\s*(['"])${name}\1|os\.environ\[\s*(['"])${name}\2\s*\]`,
  );

describe('the committed audit credential is gone from both root audit scripts', () => {
  for (const script of SCRIPTS) {
    it(`${script} contains neither committed literal (by SHA-256 digest)`, () => {
      assert.deepEqual(digestHits(script, readScript(script), COMMITTED_DIGESTS), []);
    });

    it(`${script} assigns no hard-coded password/secret and holds no email literal`, () => {
      const src = readScript(script);
      assert.deepEqual(lineHits(script, src, HARDCODED_SECRET), [], 'hard-coded secret assignment');
      assert.deepEqual(lineHits(script, src, EMAIL_LITERAL), [], 'email-address literal');
    });

    it(`${script} reads ${ENV_EMAIL} and ${ENV_PASSWORD} with no literal fallback`, () => {
      const src = readScript(script);
      assert.ok(envRead(ENV_EMAIL).test(src), `${script} does not read ${ENV_EMAIL}`);
      assert.ok(envRead(ENV_PASSWORD).test(src), `${script} does not read ${ENV_PASSWORD}`);
      assert.deepEqual(lineHits(script, src, LITERAL_FALLBACK), [], 'non-empty literal default');
    });

    it(`${script} passes python3 -I -m py_compile`, () => {
      const cache = mkdtempSync(path.join(tmpdir(), 'r031-pyc-'));
      try {
        const r = spawnSync(
          'python3',
          ['-I', '-X', `pycache_prefix=${cache}`, '-m', 'py_compile', path.join(REPO_ROOT, script)],
          { encoding: 'utf8', timeout: 30_000 },
        );
        if (r.error) throw r.error;
        assert.equal(r.status, 0, r.stderr);
      } finally {
        rmSync(cache, { recursive: true, force: true });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Behaviour under a stub Playwright
// ---------------------------------------------------------------------------

const IMPORT_MARK = 'STUB_PLAYWRIGHT_IMPORTED';
const SUBMIT_MARK = 'STUB_LOGIN_SUBMITTED';
const SUBMIT_EXIT = 98;
const LOGIN_LOG = 'stub-login.json';
const FAIL_SELECTOR_ENV = 'STUB_FILL_FAIL_SELECTOR';

const STUB_INIT = `import sys
sys.stderr.write("${IMPORT_MARK}\\n")
sys.stderr.flush()
`;

// Just enough of playwright.async_api for both scripts to reach the login
// submit. No network code. On submit it records what the form was filled
// with and exits ${SUBMIT_EXIT}.
const STUB_ASYNC_API = `import json
import os
import sys


class Route:
    pass


class Request:
    pass


class TimeoutError(Exception):
    pass


# When ${FAIL_SELECTOR_ENV} names a selector, fill() on it raises the way
# Playwright does: the message ends with the call log, whose fill line holds
# the typed value verbatim (playwright-core lib/server/dom.js: fill("<value>")).
_FAIL_SELECTOR = os.environ.get("${FAIL_SELECTOR_ENV}", "")


class _Page:
    def __init__(self):
        self.url = "about:blank"
        self.main_frame = object()
        self.fills = []

    def on(self, *args, **kwargs):
        pass

    async def route(self, *args, **kwargs):
        pass

    async def goto(self, url, **kwargs):
        self.url = url

    async def screenshot(self, **kwargs):
        pass

    async def fill(self, selector, value):
        if selector == _FAIL_SELECTOR:
            raise TimeoutError(
                "Page.fill: Timeout 1500ms exceeded.\\n"
                "Call log:\\n"
                f"  - waiting for locator('{selector}')\\n"
                "    - element is not enabled\\n"
                f'  -   fill("{value}")\\n'
            )
        self.fills.append([selector, value])

    async def close(self):
        pass

    async def click(self, selector):
        with open("${LOGIN_LOG}", "w") as f:
            json.dump(self.fills, f)
        sys.stderr.write("${SUBMIT_MARK}\\n")
        sys.stderr.flush()
        raise SystemExit(${SUBMIT_EXIT})


class _Context:
    async def new_page(self):
        return _Page()

    async def close(self):
        pass


class _Browser:
    async def new_context(self, **kwargs):
        return _Context()

    async def close(self):
        pass


class _Chromium:
    async def launch(self, **kwargs):
        return _Browser()


class _Playwright:
    chromium = _Chromium()


class _Manager:
    async def __aenter__(self):
        return _Playwright()

    async def __aexit__(self, *exc):
        return False


def async_playwright():
    return _Manager()
`;

// -I: no PYTHONPATH, user site or script directory on sys.path, so the stub
// inserted first is the only playwright the script can import.
const RUNNER = `import runpy, sys
sys.path.insert(0, sys.argv[1])
sys.argv = [sys.argv[2]]
runpy.run_path(sys.argv[0], run_name="__main__")
`;

const FAKE_EMAIL = 'audit-spec@example.invalid';
const FAKE_PASSWORD = 'not-a-real-password-r031';

// Whatever the form was given is reported only as one of these labels, so a
// failing run against a script that still holds a literal cannot print it.
function redact(value) {
  if (value === FAKE_EMAIL) return 'FAKE_EMAIL';
  if (value === FAKE_PASSWORD) return 'FAKE_PASSWORD';
  return '<some other value, redacted>';
}

/** Every regular file under `dir`, as relative path -> utf8 text. */
function readTree(dir, rel = '') {
  const out = {};
  for (const ent of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? path.join(rel, ent.name) : ent.name;
    if (ent.isDirectory()) Object.assign(out, readTree(dir, child));
    else if (ent.isFile()) out[child] = readFileSync(path.join(dir, child), 'utf8');
  }
  return out;
}

function runUnderStub(script, credentialEnv, stubEnv = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'r031-'));
  try {
    const stub = path.join(root, 'stub');
    mkdirSync(path.join(stub, 'playwright'), { recursive: true });
    writeFileSync(path.join(stub, 'playwright', '__init__.py'), STUB_INIT);
    writeFileSync(path.join(stub, 'playwright', 'async_api.py'), STUB_ASYNC_API);
    const cwd = path.join(root, 'cwd');
    mkdirSync(cwd);

    const r = spawnSync(
      'python3',
      ['-I', '-B', '-c', RUNNER, stub, path.join(REPO_ROOT, script)],
      {
        cwd,
        env: { PATH: process.env.PATH ?? '', ...stubEnv, ...credentialEnv },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    if (r.error) throw r.error;
    const logPath = path.join(cwd, LOGIN_LOG);
    const raw = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : null;
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      files: readTree(cwd),
      importedPlaywright: r.stderr.includes(IMPORT_MARK),
      createdOutputDir: existsSync(path.join(cwd, 'audit-output')),
      reachedLoginForm: raw !== null,
      fills: raw && raw.map(([selector, value]) => [selector, redact(value)]),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Where `secret` appears in a run's stdout, stderr or written files, as
 * labels only ('stdout', 'stderr', 'file audit-output/results.json'), so a
 * failure names the place without printing the value.
 */
function leaksOf(r, secret) {
  const where = [];
  if (r.stdout.includes(secret)) where.push('stdout');
  if (r.stderr.includes(secret)) where.push('stderr');
  for (const [rel, text] of Object.entries(r.files)) {
    if (text.includes(secret)) where.push(`file ${rel}`);
  }
  return where;
}

const RESULTS_FILE = {
  'audit-keyflowos.py': path.join('audit-output', 'results.json'),
  'audit-mobile-quick.py': path.join('audit-output', 'mobile-results.json'),
};


const MISSING_CASES = [
  { label: 'neither variable is set', env: {}, missing: [ENV_EMAIL, ENV_PASSWORD] },
  { label: `only ${ENV_EMAIL} is set`, env: { [ENV_EMAIL]: FAKE_EMAIL }, missing: [ENV_PASSWORD] },
  { label: `only ${ENV_PASSWORD} is set`, env: { [ENV_PASSWORD]: FAKE_PASSWORD }, missing: [ENV_EMAIL] },
  {
    label: 'both variables are set but empty',
    env: { [ENV_EMAIL]: '', [ENV_PASSWORD]: '' },
    missing: [ENV_EMAIL, ENV_PASSWORD],
  },
];

for (const script of SCRIPTS) {
  describe(`${script} under a stub Playwright`, () => {
    for (const c of MISSING_CASES) {
      it(`exits non-zero before importing Playwright when ${c.label}`, () => {
        const r = runUnderStub(script, c.env);
        assert.equal(typeof r.status, 'number', `no exit status: ${r.stderr}`);
        assert.notEqual(r.status, 0, 'exit status 0 without a credential');
        assert.equal(r.importedPlaywright, false, 'imported Playwright before checking the credential');
        assert.equal(r.reachedLoginForm, false, 'reached the login form');
        assert.equal(r.createdOutputDir, false, 'created audit-output before checking the credential');
        assert.ok(!r.stderr.includes('Traceback'), `crashed instead of refusing:\n${r.stderr}`);
        for (const name of c.missing) {
          assert.ok(r.stderr.includes(name), `stderr does not name ${name}:\n${r.stderr}`);
        }
      });
    }

    it('fills the login form with exactly the environment values when both are set', () => {
      const r = runUnderStub(script, { [ENV_EMAIL]: FAKE_EMAIL, [ENV_PASSWORD]: FAKE_PASSWORD });
      assert.equal(r.status, SUBMIT_EXIT, `did not reach the login submit:\n${r.stderr}`);
      assert.equal(r.importedPlaywright, true);
      assert.deepEqual(r.fills, [
        ['input[type="email"]', 'FAKE_EMAIL'],
        ['input[type="password"]', 'FAKE_PASSWORD'],
      ]);
    });

    for (const field of ['email', 'password']) {
      const selector = `input[type="${field}"]`;
      it(`keeps the login out of stdout, stderr and every written file when the ${field} fill fails`, () => {
        const r = runUnderStub(
          script,
          { [ENV_EMAIL]: FAKE_EMAIL, [ENV_PASSWORD]: FAKE_PASSWORD },
          { [FAIL_SELECTOR_ENV]: selector },
        );
        assert.equal(typeof r.status, 'number', 'no exit status');
        assert.notEqual(r.status, SUBMIT_EXIT, 'reached the login submit although the fill failed');
        assert.deepEqual(leaksOf(r, FAKE_PASSWORD), [], 'the password leaked');
        assert.deepEqual(leaksOf(r, FAKE_EMAIL), [], 'the email leaked');

        // The failure is still recorded, with the call log kept and only the
        // login value replaced.
        const resultsText = r.files[RESULTS_FILE[script]];
        assert.ok(resultsText !== undefined, `${RESULTS_FILE[script]} was not written`);
        const login = JSON.parse(resultsText).filter((e) => e.step === 'login');
        assert.ok(login.length > 0, 'no login entry recorded');
        for (const e of login) {
          assert.equal(e.status, 'failed');
          assert.equal(typeof e.error, 'string', 'login failure has no error text');
          assert.ok(e.error.includes('Call log'), 'the call log was dropped instead of redacted');
          assert.ok(e.error.includes('fill("[REDACTED]")'), 'the fill value was not replaced by [REDACTED]');
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Repository-wide: outside this packet's write set
// ---------------------------------------------------------------------------

// The two tracked files that still carry the password literal. Both are
// outside this packet's write set; removing it there is a follow-up packet.
// admin-auth.service.spec.ts puts it beside ADMIN_EMAIL and role SUPER_ADMIN.
const KNOWN_OUTSIDE_WRITE_SET = [
  'apps/server/src/modules/admin-auth/admin-auth.service.spec.ts',
  'audit-output/KEYFLOWOS-AUDIT-REPORT.md',
];

/** Distinct tracked files holding the committed password literal. */
function trackedFilesWithPassword() {
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (ls.error) throw ls.error;
  assert.equal(ls.status, 0, ls.stderr);
  const cache = new Map();
  const files = new Set();
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const abs = path.join(REPO_ROOT, rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) continue;
    if (digestHits(rel, buf.toString('utf8'), { password: COMMITTED_DIGESTS.password }, cache).length) {
      files.add(rel);
    }
  }
  return [...files].sort();
}

// Ratchet: passes today and fails as soon as the literal lands in any other
// tracked file (including either audit script). It does not claim the
// repository is clean; the todo below does.
test('the committed password literal is in no tracked file beyond the two known ones outside the write set', () => {
  const unexpected = trackedFilesWithPassword().filter((f) => !KNOWN_OUTSIDE_WRITE_SET.includes(f));
  assert.deepEqual(unexpected, []);
});

test(
  'no tracked file carries the committed password literal',
  {
    todo:
      'outside the R0-31 write set: the platform super-admin password literal is still committed in ' +
      KNOWN_OUTSIDE_WRITE_SET.join(' and ') +
      ', so repo-wide the count is not zero; a follow-up packet must remove it there, and D-30 rotation ' +
      'is still required because the literal stays in history',
  },
  () => {
    assert.deepEqual(trackedFilesWithPassword(), []);
  },
);
