/**
 * Node runtime pin guard (V1-39-SEC-RUNTIME-PIN, PRS-M04, owner ruling D-21).
 *
 * Release 0 evidence needs one declared runtime. Before this packet the repo
 * declared Node 20.18.1 (.nvmrc, engines, the workflows, the Dockerfile) while
 * every proof in the build ran on v22.22.0, and PR #91 proposed 24.x. D-21
 * (2026-11-02): Node 22.x LTS is the runtime. The pin is the exact 22.x the
 * proof harness runs, so CI, the images and the evidence run one version (the
 * exact-pin convention ci-cd.yml documents above NODE_VERSION).
 *
 * pnpm 9 only WARNS when the running Node does not satisfy engines.node (it
 * fails on engines.pnpm, or with engine-strict), so nothing else stops these
 * pins drifting apart again. This spec is that check.
 *
 * What it holds:
 *   1. .nvmrc names one exact Node 22 version (D-21), at or above 22.12.0,
 *      where require(esm) is unflagged (the server emits CommonJS; see the
 *      build-server note in ci-cd.yml on ESM-only dependencies).
 *   2. engines.node, ci-cd.yml NODE_VERSION, hawkscan.yml NODE_VERSION and the
 *      Dockerfile ARG name exactly that version; every setup-node step in the
 *      two workflows reads env.NODE_VERSION and every Dockerfile FROM node:
 *      reads the ARG.
 *   3. The Node running this spec satisfies engines.node (in CI: the version
 *      setup-node installed from NODE_VERSION).
 *   4. Every other workflow that sets up Node pins that version, except the
 *      recorded exceptions below, whose pins must stay exactly as recorded: an
 *      exception that changes, aligned or not, fails until its record is
 *      updated, so no exception outlives its reason silently.
 *   5. AGENTS.md, README.md, DEPLOYMENT.md and docs/LAUNCH_GUIDE.md name
 *      Node 22 (as 22.x or the exact pin) and no other Node version.
 *   6. ci-cd.yml runs this spec in the Type Check job, after Setup Node and
 *      with no continue-on-error.
 *
 * Known exceptions (recorded, not edited):
 *   - agent-control-autopilot.yml and agent-control-worker-proof.yml pin
 *     '20.18.1'. They are the control plane's own workflows; D-21 left open
 *     who authorizes changing them, and the packet records them rather than
 *     editing them. They run node scripts only (no pnpm install).
 *   - native-dast.yml and e2e-live.yml pin NODE_VERSION '20.18.1' and are
 *     outside the V1-39 write set. Their alignment is it.todo below, not
 *     claimed. Both run `pnpm install --frozen-lockfile`, which warns on the
 *     engines mismatch and does not fail.
 *
 * Run: node --test scripts/ci/runtime-pin.spec.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

/** Owner ruling D-21: Node 22.x LTS. */
const D21_MAJOR = 22;
/** First Node 22 release with require(esm) enabled by default. */
const REQUIRE_ESM_FLOOR = [22, 12, 0];

/** Workflows whose Node pin is recorded, not aligned. Values are exact. */
const KNOWN_EXCEPTIONS = {
  'agent-control-autopilot.yml': {
    pins: ['20.18.1'],
    reason: 'control-plane workflow; D-21 left open who authorizes changing its pins',
  },
  'agent-control-worker-proof.yml': {
    pins: ['20.18.1'],
    reason: 'control-plane workflow; D-21 left open who authorizes changing its pins',
  },
};

/** Workflows outside the V1-39 write set: recorded here, alignment is todo. */
const OUTSIDE_WRITE_SET = {
  'native-dast.yml': {
    pins: ['20.18.1'],
    reason: 'outside the V1-39 write set; its NODE_VERSION line needs a packet that may edit it',
  },
  'e2e-live.yml': {
    pins: ['20.18.1'],
    reason: 'outside the V1-39 write set; its NODE_VERSION line needs a packet that may edit it',
  },
};

const DOCS = ['AGENTS.md', 'README.md', 'DEPLOYMENT.md', 'docs/LAUNCH_GUIDE.md'];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const workflow = (name) => read(path.join('.github', 'workflows', name));
const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;

function parseExact(version) {
  const m = EXACT.exec(version);
  return m ? m.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The pin every other source must name: the single line of .nvmrc. */
function nvmrcPin() {
  const lines = read('.nvmrc').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.equal(lines.length, 1, `.nvmrc must hold exactly one version line, found ${JSON.stringify(lines)}`);
  return lines[0].replace(/^v/, '');
}

const unquote = (v) => v.trim().replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');

/**
 * Every Node pin a workflow declares: literal NODE_VERSION env values and
 * literal setup-node `node-version:` values. `${{ env.NODE_VERSION }}`
 * resolves through the env values; `node-version-file: .nvmrc` is the pin.
 */
function workflowPins(source) {
  const envValues = [...source.matchAll(/^\s*NODE_VERSION:\s*(.+)$/gm)].map((m) => unquote(m[1]));
  const nodeVersions = [...source.matchAll(/^\s*node-version:\s*(.+)$/gm)].map((m) => unquote(m[1]));
  const versionFiles = [...source.matchAll(/^\s*node-version-file:\s*(.+)$/gm)].map((m) => unquote(m[1]));
  const pins = new Set(envValues);
  const unresolved = [];
  for (const v of nodeVersions) {
    if (/^\$\{\{\s*env\.NODE_VERSION\s*\}\}$/.test(v)) {
      if (envValues.length === 0) unresolved.push(v);
    } else {
      pins.add(v);
    }
  }
  for (const f of versionFiles) {
    if (f === '.nvmrc') pins.add(nvmrcPin());
    else unresolved.push(`node-version-file: ${f}`);
  }
  return { pins: [...pins].sort(), envValues, nodeVersions, unresolved };
}

/** Exact versions, `N`, `N.x` and `N.M.x` (fails closed on anything else). */
function satisfies(version, range) {
  const v = parseExact(version);
  assert.ok(v, `not an exact version: ${version}`);
  const r = range.trim().replace(/^v/, '');
  const exact = parseExact(r);
  if (exact) return compare(v, exact) === 0;
  const x = /^(\d+)(?:\.(\d+|x))?(?:\.x)?$/.exec(r);
  assert.ok(x, `engines.node '${range}' is not a form this guard reads; D-21 pins an exact version`);
  if (v[0] !== Number(x[1])) return false;
  return x[2] === undefined || x[2] === 'x' || v[1] === Number(x[2]);
}

/** Node version mentions in prose and image references. */
function docMentions(source) {
  const mentions = [];
  const prose = /\bNode(?:\.js)?\b(?:\*\*)?:?(?:\*\*)?[ \t]+v?(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?\b/gi;
  const image = /\bnode:(\d+)(?:\.(\d+))?(?:\.(\d+))?/g;
  for (const re of [prose, image]) {
    for (const m of source.matchAll(re)) mentions.push({ text: m[0], major: m[1], minor: m[2], patch: m[3] });
  }
  return mentions;
}

/** The text of one top-level job of a workflow (two-space job ids). */
function jobBlock(source, jobId) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `  ${jobId}:`);
  assert.ok(start >= 0, `job '${jobId}' not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('V1-39 runtime pin: one declared Node runtime (D-21)', () => {
  it('.nvmrc names one exact Node 22 version with require(esm) unflagged', () => {
    const pin = nvmrcPin();
    const parsed = parseExact(pin);
    assert.ok(parsed, `.nvmrc '${pin}' must be an exact version (x.y.z), the convention every pin follows`);
    assert.equal(parsed[0], D21_MAJOR, `.nvmrc '${pin}' is not Node ${D21_MAJOR} (owner ruling D-21)`);
    assert.ok(
      compare(parsed, REQUIRE_ESM_FLOOR) >= 0,
      `.nvmrc '${pin}' is below ${REQUIRE_ESM_FLOOR.join('.')}, where require(esm) is unflagged`,
    );
  });

  it('engines.node, ci-cd NODE_VERSION, hawkscan NODE_VERSION and the Dockerfile ARG name the .nvmrc version', () => {
    const pin = nvmrcPin();
    const pkg = JSON.parse(read('package.json'));
    const found = { '.nvmrc': pin, 'package.json engines.node': pkg.engines?.node };

    for (const name of ['ci-cd.yml', 'hawkscan.yml']) {
      const { envValues, nodeVersions } = workflowPins(workflow(name));
      assert.equal(envValues.length, 1, `${name} must declare NODE_VERSION once, found ${JSON.stringify(envValues)}`);
      found[`${name} NODE_VERSION`] = envValues[0];
      assert.ok(nodeVersions.length > 0, `${name} has no setup-node step`);
      for (const v of nodeVersions) {
        assert.match(v, /^\$\{\{\s*env\.NODE_VERSION\s*\}\}$/, `${name}: setup-node pins '${v}' instead of env.NODE_VERSION`);
      }
    }

    const dockerfile = read('Dockerfile');
    const args = [...dockerfile.matchAll(/^\s*ARG\s+NODE_VERSION=(\S+)\s*$/gm)].map((m) => m[1]);
    assert.equal(args.length, 1, `Dockerfile must declare ARG NODE_VERSION once, found ${JSON.stringify(args)}`);
    found['Dockerfile ARG NODE_VERSION'] = args[0];
    const froms = [...dockerfile.matchAll(/^\s*FROM\s+node:(\S+)/gim)].map((m) => m[1]);
    assert.ok(froms.length > 0, 'Dockerfile has no FROM node: stage');
    for (const tag of froms) {
      assert.match(tag, /^\$\{NODE_VERSION\}-/, `Dockerfile FROM node:${tag} does not use the NODE_VERSION ARG`);
    }

    const disagreeing = Object.entries(found).filter(([, v]) => v !== pin);
    assert.deepEqual(disagreeing, [], `pins disagree with .nvmrc '${pin}': ${JSON.stringify(found)}`);
  });

  it('the running Node satisfies engines.node', () => {
    const pkg = JSON.parse(read('package.json'));
    const range = pkg.engines?.node;
    assert.ok(range, 'package.json declares no engines.node');
    assert.ok(
      satisfies(process.versions.node, range),
      `process.version ${process.version} does not satisfy engines.node ${range}`,
    );
  });

  it('every workflow that sets up Node pins the .nvmrc version, except the recorded exceptions', () => {
    const pin = nvmrcPin();
    const recorded = { ...KNOWN_EXCEPTIONS, ...OUTSIDE_WRITE_SET };
    const files = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();
    const problems = [];
    const seen = new Set();
    for (const file of files) {
      const { pins, unresolved } = workflowPins(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8'));
      if (unresolved.length) problems.push(`${file}: unresolvable Node pin ${JSON.stringify(unresolved)}`);
      if (pins.length === 0) continue;
      if (recorded[file]) {
        seen.add(file);
        const want = [...recorded[file].pins].sort();
        if (JSON.stringify(pins) !== JSON.stringify(want)) {
          problems.push(
            `${file}: recorded exception pins ${JSON.stringify(want)}, found ${JSON.stringify(pins)}; update the record (${recorded[file].reason})`,
          );
        }
      } else if (JSON.stringify(pins) !== JSON.stringify([pin])) {
        problems.push(`${file}: pins ${JSON.stringify(pins)}, expected ['${pin}']`);
      }
    }
    for (const file of Object.keys(recorded)) {
      if (!seen.has(file)) problems.push(`${file}: recorded exception has no Node pin any more; remove the record`);
    }
    assert.deepEqual(problems, []);
  });

  for (const [file, { reason }] of Object.entries(OUTSIDE_WRITE_SET)) {
    it.todo(`${file} NODE_VERSION names the .nvmrc version (${reason})`);
  }

  it('AGENTS.md, README.md, DEPLOYMENT.md and docs/LAUNCH_GUIDE.md name Node 22 and no other version', () => {
    const pin = nvmrcPin();
    const [, minor, patch] = pin.split('.');
    const major = String(D21_MAJOR);
    const problems = [];
    for (const doc of DOCS) {
      const mentions = docMentions(read(doc));
      if (mentions.length === 0) problems.push(`${doc}: names no Node version`);
      for (const m of mentions) {
        const numeric = (s) => s !== undefined && s !== 'x';
        const ok =
          m.major === major &&
          (!numeric(m.minor) || m.minor === minor) &&
          (!numeric(m.patch) || m.patch === patch) &&
          !(numeric(m.patch) && !numeric(m.minor));
        if (!ok) problems.push(`${doc}: '${m.text}' does not name Node ${major} (pin ${pin})`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it('ci-cd.yml runs this spec in the Type Check job after Setup Node, with no continue-on-error', () => {
    const job = jobBlock(workflow('ci-cd.yml'), 'lint-and-typecheck');
    const steps = job.split(/^ {6}- /m).slice(1);
    const index = steps.findIndex((s) => /^\s*run:\s*node --test scripts\/ci\/runtime-pin\.spec\.mjs\s*$/m.test(s));
    assert.ok(index >= 0, "ci-cd.yml lint-and-typecheck has no step running 'node --test scripts/ci/runtime-pin.spec.mjs'");
    const setupNode = steps.findIndex((s) => /uses:\s*actions\/setup-node@/.test(s));
    assert.ok(setupNode >= 0 && setupNode < index, 'the runtime-pin step must run after Setup Node, on the pinned Node');
    assert.doesNotMatch(steps[index], /continue-on-error/, 'the runtime-pin step must be able to fail the job');
    assert.doesNotMatch(steps[index], /^\s*(env|if):/m, 'the runtime-pin step takes no env or condition (NODE_TEST_CONTEXT=child skips every file)');
  });
});
