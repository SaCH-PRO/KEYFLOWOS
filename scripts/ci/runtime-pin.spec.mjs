/**
 * Node runtime pin guard (V1-39-SEC-RUNTIME-PIN, PRS-M04, owner ruling D-21).
 *
 * Release 0 evidence needs one declared runtime. Before this packet the repo
 * declared Node 20.18.1 (.nvmrc, engines, the workflows, the Dockerfile) while
 * every proof in the build ran on v22.22.0, and PR #91 proposed 24.x. D-21
 * (2026-11-02): Node 22.x LTS is the runtime. The pin is the newest Node 22
 * security release when it was set: v22.23.4 (2026-10-20). Review SEC-V139-1
 * found that 22.22.0, the version the proof harness ran, was four security
 * releases behind (22.22.2, 22.23.0, 22.23.2, 22.23.4), so the shipped images
 * would have run a runtime with publicly fixed CVEs. This spec runs offline
 * and cannot read the release feed: moving to a later security release is one
 * edit to each pin, and this spec keeps the pins together. The proof harness
 * must run the pinned version too (case 3).
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
 *      Dockerfile ARG name exactly that version. Every setup-node step in the
 *      two workflows reads env.NODE_VERSION. Every Dockerfile stage is built
 *      FROM an earlier stage or FROM node:${NODE_VERSION}[-variant]; a
 *      --platform flag is read past, and a registry-qualified or any other
 *      base image is refused (review SEC-V139-3a).
 *   3. The Node running this spec satisfies engines.node (in CI: the version
 *      setup-node installed from NODE_VERSION).
 *   4. Every other workflow that runs Node pins that version, except the
 *      recorded exceptions below, whose pins must stay exactly as recorded: an
 *      exception that changes, aligned or not, fails until its record is
 *      updated, so no exception outlives its reason silently. A workflow's
 *      pins are its NODE_VERSION values, its setup-node versions (block or
 *      flow mapping; a setup-node with no version is the runner image's Node),
 *      every node:<tag> image (job container, service, docker:// step, docker
 *      run) and, for a job that runs node, npm, npx, pnpm, yarn or corepack
 *      with no setup-node and no container, the runner image's Node (review
 *      SEC-V139-3b).
 *   5. AGENTS.md, README.md, DEPLOYMENT.md and docs/LAUNCH_GUIDE.md name
 *      Node 22 (as 22.x or the exact pin) and no other Node version, in prose,
 *      in node:<tag> image references and in shields.io node badges (review
 *      CR-V139-1). AGENTS.md's Node line names as exceptions exactly the
 *      recorded workflows below, so its caveats neither outlive an alignment
 *      nor miss an exception.
 *   6. ci-cd.yml runs this spec in the Type Check job (lint-and-typecheck),
 *      and nothing can skip or neuter it while the job reports success
 *      (review SEC-V139-2): the job sets only name, runs-on, permissions and
 *      steps (a job-level `if` skips it and GitHub reports a skipped required
 *      check as success; job env, defaults or continue-on-error neuter it);
 *      the step sets only name and run, and runs exactly this command; every
 *      step before it is the checkout (with no `with`, so it checks out the
 *      commit under test), the pnpm setup or setup-node, so no earlier step
 *      writes GITHUB_ENV; the workflow sets no top-level defaults and no
 *      NODE_TEST_CONTEXT, NODE_OPTIONS or BASH_ENV. NODE_TEST_CONTEXT=child
 *      alone makes `node --test` skip every file and exit 0, and
 *      NODE_OPTIONS=--test-skip-pattern=.* skips every case.
 *   7. While any workflow boots apps/server/dist/main.js on a Node where
 *      require(esm) is not unflagged (below 20.19.0, 21.x, 22 below 22.12.0,
 *      or a Node this guard cannot read), ci-cd.yml's "Verify the server gets
 *      past module loading" step runs node with --no-experimental-require-module,
 *      so an ESM-only server dependency fails ci-cd the way it would kill that
 *      workflow's server at boot (ERR_REQUIRE_ESM). Once no workflow does, the
 *      flag must go (review CR-V139-2): every workflow that boots the server
 *      (native-dast.yml, e2e-live.yml) runs the pin, so the step runs without
 *      it. The step sets a DATABASE_URL: main.ts
 *      exits at env validation before it imports AppModule, so without one
 *      the check only ever loaded main.ts's own imports.
 *   8. Negative controls: each way found in review to let a different Node
 *      ship, or to skip the guard, is applied to the real files and rejected.
 *
 * Known exceptions (recorded, not edited):
 *   - agent-control-autopilot.yml and agent-control-worker-proof.yml pin
 *     '20.18.1', and agent-control-gate.yml runs the merge-grant check
 *     (node scripts/agent-control/auto-merge-admitted.mjs --grant-only) with
 *     no setup-node, on the runner image's Node. They are the control plane's
 *     own workflows; D-21 left open who authorizes changing them, and the
 *     packet records them rather than editing them. They run node scripts
 *     only (no pnpm install).
 *
 * native-dast.yml and e2e-live.yml were recorded here at '20.18.1' while they
 * sat outside the V1-39 write set (review SEC-V139-4: the required native
 * DAST gate tested a different runtime than the shipped images). The V1-39
 * follow-up aligned them; case 4 now holds them to the pin like every other
 * workflow.
 *
 * Run: node --test scripts/ci/runtime-pin.spec.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

/** Owner ruling D-21: Node 22.x LTS. */
const D21_MAJOR = 22;
/** First Node 22 release with require(esm) enabled by default. */
const REQUIRE_ESM_FLOOR = [22, 12, 0];
/** The pin of a job that runs Node with no setup-node version and no container. */
const RUNNER_DEFAULT = 'runner image Node (no setup-node version)';

const CONTROL_PLANE = 'control-plane workflow; D-21 left open who authorizes changing its pins';

/** Workflows whose Node pin is recorded, not aligned. Values are exact. */
const KNOWN_EXCEPTIONS = {
  'agent-control-autopilot.yml': { pins: ['20.18.1'], reason: CONTROL_PLANE },
  'agent-control-gate.yml': {
    pins: [RUNNER_DEFAULT],
    reason: `${CONTROL_PLANE}; its agent-control job runs node scripts/agent-control/auto-merge-admitted.mjs --grant-only with no setup-node`,
  },
  'agent-control-worker-proof.yml': { pins: ['20.18.1'], reason: CONTROL_PLANE },
};

const DOCS = ['AGENTS.md', 'README.md', 'DEPLOYMENT.md', 'docs/LAUNCH_GUIDE.md'];

const PIN_JOB = 'lint-and-typecheck';
const PIN_RUN = 'node --test scripts/ci/runtime-pin.spec.mjs';
const PIN_JOB_KEYS = ['name', 'runs-on', 'permissions', 'steps'];
const PIN_STEP_KEYS = ['name', 'run'];
/** The only steps that may run before the runtime-pin step, and the keys each may set. */
const BEFORE_PIN = [
  { uses: /^actions\/checkout@/, keys: ['name', 'uses'] },
  { uses: /^pnpm\/action-setup@/, keys: ['name', 'uses', 'with'] },
  { uses: /^actions\/setup-node@/, keys: ['name', 'uses', 'with'] },
];
/** Set at workflow level, these reach the runtime-pin step. */
const NEUTERING_WORKFLOW_ENV = ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'BASH_ENV'];
const BOOT_JOB = 'build-server';
const BOOT_STEP = 'Verify the server gets past module loading';
const NO_REQUIRE_ESM = '--no-experimental-require-module';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const workflow = (name) => read(path.join('.github', 'workflows', name));
const allWorkflows = () =>
  Object.fromEntries(
    fs
      .readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => [f, fs.readFileSync(path.join(WORKFLOWS, f), 'utf8')]),
  );
const docs = () => Object.fromEntries(DOCS.map((doc) => [doc, read(doc)]));
const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;

function parseExact(version) {
  const m = EXACT.exec(version);
  return m ? m.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** require(esm) is on by default from 20.19.0 on the 20 line, from 22.12.0 on 22, and on 23+. */
function requireEsmUnflagged(version) {
  const v = parseExact(version);
  if (!v) return false;
  if (v[0] === 20) return compare(v, [20, 19, 0]) >= 0;
  if (v[0] === 22) return compare(v, REQUIRE_ESM_FLOOR) >= 0;
  return v[0] >= 23;
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

/** The pin every other source must name: the single line of .nvmrc. */
function nvmrcPin() {
  const lines = read('.nvmrc').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.equal(lines.length, 1, `.nvmrc must hold exactly one version line, found ${JSON.stringify(lines)}`);
  return lines[0].replace(/^v/, '');
}

// ---------------------------------------------------------------------------
// Workflow reading. Full-line comments are blanked (line numbers kept), so a
// commented-out pin neither satisfies nor fails the guard.

const indentOf = (line) => line.length - line.trimStart().length;
const codeLines = (source) => source.split(/\r?\n/).map((line) => (/^\s*#/.test(line) ? '' : line));
const ENV_REF = /^\$\{\{\s*env\.NODE_VERSION\s*\}\}$/;
// One YAML scalar on one line: an expression, a quoted string or a plain token.
const VALUE = String.raw`(\$\{\{[^}]*\}\}|'[^']*'|"[^"]*"|[^\s,{}#'"]+)`;
const unquote = (v) => (v ?? '').replace(/^(['"])(.*)\1$/, '$2').trim();

/** Every value of `key`, block (`key: v`) or flow (`{ key: v }`); a key with no value on its line reads ''. */
function keyValues(text, key) {
  const re = new RegExp(String.raw`(?:^|[\s{,])${key}:(?:[ \t]+${VALUE})?(?=[\s,}]|$)`, 'gm');
  return [...text.matchAll(re)].map((m) => unquote(m[1]));
}

/** The text of each setup-node step: from its `- ` line to the next line at or left of that dash. */
function setupNodeSteps(lines) {
  const steps = [];
  lines.forEach((line, k) => {
    if (!/(?:^|[\s{,])uses:\s*['"]?actions\/setup-node@/.test(line)) return;
    const usesAt = line.search(/uses:/);
    let j = k;
    while (j >= 0 && !(/^\s*- /.test(lines[j]) && lines[j].indexOf('-') < usesAt)) j -= 1;
    if (j < 0) {
      steps.push(line);
      return;
    }
    const dash = lines[j].indexOf('-');
    let end = j + 1;
    while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > dash)) end += 1;
    steps.push(lines.slice(j, end).join('\n'));
  });
  return steps;
}

/** Top-level jobs: { id, start, end } line ranges under `jobs:`. */
function jobsOf(lines) {
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const jobs = [];
  let i = start + 1;
  for (; i < lines.length && !/^\S/.test(lines[i]); i += 1) {
    const m = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(lines[i]);
    if (!m) continue;
    if (jobs.length) jobs[jobs.length - 1].end = i;
    jobs.push({ id: m[1], start: i, end: lines.length });
  }
  if (jobs.length) jobs[jobs.length - 1].end = i;
  return jobs;
}

/** The shell lines of every `run:` (inline, block scalar or flow mapping). */
function runCommands(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*(?:- )?)run:[ \t]*(.*)$/.exec(lines[i]) || /[{,]\s*run:[ \t]*()(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] && !/^[|>][+-]?\s*$/.test(m[2])) {
      out.push(m[2]);
      continue;
    }
    const keyIndent = m[1].length;
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > keyIndent); j += 1) {
      out.push(lines[j]);
    }
  }
  return out;
}

const NODE_COMMAND = /(?:^|[\s;&|(`'"=])(?:node|npx|npm|pnpm|yarn|corepack)(?=[\s;&|)`'"]|$)/;
const BOOTS_SERVER = /(?:^|[\s;&|(`'"=])node\s(?:[^\n]*\s)?(?:apps\/server\/)?dist\/main\.js\b/;

/** node:<tag> image references (job container, service, docker://, docker run); `node:fs` and friends are not images. */
function nodeImages(text) {
  const tags = [];
  for (const m of text.matchAll(/(?:^|[\s'"=/@,{[])node:([^\s'",}\]]+)/gm)) {
    if (isBuiltin(`node:${m[1].split(/[/'"`)]/)[0]}`)) continue;
    tags.push(m[1]);
  }
  return tags;
}

/** The Node version an image tag names: N, N.N or N.N.N, or env.NODE_VERSION; null when unreadable. */
function imagePins(tag, envValues) {
  if (/^\$\{\{\s*env\.NODE_VERSION\s*\}\}/.test(tag)) return envValues.length ? envValues : null;
  const m = /^(\d+(?:\.\d+){0,2})(?:-|@|$)/.exec(tag);
  return m ? [m[1]] : null;
}

/**
 * Every Node pin a workflow declares (see case 4 in the header). Literal
 * NODE_VERSION values; setup-node versions, `${{ env.NODE_VERSION }}`
 * resolving through those values and `node-version-file: .nvmrc` to the
 * .nvmrc pin; node:<tag> images; the runner image's Node for a setup-node
 * with no version, and for a job that runs Node with no setup-node and no
 * container. Anything else is unresolved, which fails case 4.
 */
function workflowPins(source) {
  const lines = codeLines(source);
  const text = lines.join('\n');
  const envValues = keyValues(text, 'NODE_VERSION');
  const pins = new Set(envValues);
  const unresolved = [];
  const nodeVersions = [];
  const versionFiles = [];
  const setupNode = setupNodeSteps(lines);
  for (const step of setupNode) {
    const versions = keyValues(step, 'node-version');
    const files = keyValues(step, 'node-version-file');
    nodeVersions.push(...versions);
    versionFiles.push(...files);
    if (versions.length + files.length === 0) pins.add(RUNNER_DEFAULT);
    for (const v of versions) {
      if (ENV_REF.test(v)) {
        if (envValues.length === 0) unresolved.push(v);
      } else if (v === '') {
        unresolved.push('node-version with no value on its line');
      } else {
        pins.add(v);
      }
    }
    for (const f of files) {
      if (f === '.nvmrc') pins.add(nvmrcPin());
      else unresolved.push(`node-version-file: ${f}`);
    }
  }
  for (const tag of nodeImages(text)) {
    const found = imagePins(tag, envValues);
    if (found) found.forEach((v) => pins.add(v));
    else unresolved.push(`node:${tag}`);
  }
  for (const job of jobsOf(lines)) {
    const body = lines.slice(job.start, job.end);
    if (!runCommands(body).some((c) => NODE_COMMAND.test(c))) continue;
    if (setupNodeSteps(body).length) continue;
    const at = body.findIndex((l) => /^ {4}container:/.test(l));
    if (at < 0) {
      pins.add(RUNNER_DEFAULT);
      continue;
    }
    let end = at + 1;
    while (end < body.length && (body[end].trim() === '' || indentOf(body[end]) > 4)) end += 1;
    if (nodeImages(body.slice(at, end).join('\n')).length === 0) {
      unresolved.push(`job ${job.id} runs Node in a container that names no node:<tag> image`);
    }
  }
  return { pins: [...pins].sort(), envValues, nodeVersions, versionFiles, setupNodeSteps: setupNode.length, unresolved };
}

/** Case 4 over a set of workflow sources. */
function workflowPinProblems(sources, pin) {
  const recorded = KNOWN_EXCEPTIONS;
  const problems = [];
  const seen = new Set();
  for (const [file, source] of Object.entries(sources)) {
    const { pins, unresolved } = workflowPins(source);
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
  return problems;
}

// ---------------------------------------------------------------------------
// Dockerfile.

/** ARG NODE_VERSION values, and a problem for every stage not built from an earlier stage or node:${NODE_VERSION}. */
function dockerfileFindings(source) {
  const lines = source.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  const problems = [];
  const args = [];
  const stages = new Set();
  let froms = 0;
  for (const line of lines) {
    const arg = /^\s*ARG\s+NODE_VERSION\b(?:=(\S*))?/i.exec(line);
    if (arg) {
      args.push(arg[1] ?? '');
      if (froms > 0) problems.push(`ARG NODE_VERSION after a FROM is stage-scoped and pins no FROM line: ${line.trim()}`);
    }
    const from = /^\s*FROM\s+(.*)$/i.exec(line);
    if (!from) continue;
    froms += 1;
    const tokens = from[1].trim().split(/\s+/);
    while (tokens[0]?.startsWith('--')) tokens.shift();
    const image = tokens[0] ?? '';
    const alias = /^as$/i.test(tokens[1] ?? '') ? tokens[2] : undefined;
    if (!stages.has(image.toLowerCase()) && !/^node:\$\{NODE_VERSION\}(?:-[a-z0-9][a-z0-9.-]*)?$/.test(image)) {
      problems.push(`Dockerfile FROM ${image} is neither an earlier stage nor node:\${NODE_VERSION}[-variant]`);
    }
    if (alias) stages.add(alias.toLowerCase());
  }
  if (froms === 0) problems.push('Dockerfile has no FROM line');
  return { args, problems };
}

// ---------------------------------------------------------------------------
// Docs.

/** Node version mentions in prose, image references and shields.io badges. */
function docMentions(source) {
  const mentions = [];
  const prose = /\bNode(?:\.js)?\b(?:\*\*)?:?(?:\*\*)?[ \t]+v?(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?\b/gi;
  const image = /\bnode:(\d+)(?:\.(\d+))?(?:\.(\d+))?/g;
  for (const re of [prose, image]) {
    for (const m of source.matchAll(re)) mentions.push({ text: m[0], major: m[1], minor: m[2], patch: m[3] });
  }
  // shields.io: badge/<label>-<message>-<color>; a literal dash is `--`, so
  // the message is everything up to the next single dash.
  for (const m of source.matchAll(/\bbadge\/node(?:\.?js)?-((?:[^-/)\s?]|--)+)/gi)) {
    let message = m[1].replace(/--/g, '-');
    try {
      message = decodeURIComponent(message);
    } catch {
      // keep it encoded: it then fails to parse below, and is reported
    }
    const v = /^(?:>=|>|\^|~|v)?\s*(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?$/.exec(message.trim());
    mentions.push({ text: m[0], major: v?.[1], minor: v?.[2], patch: v?.[3] });
  }
  return mentions;
}

/** Case 5 over a set of doc sources. */
function docProblems(sources, pin) {
  const [, minor, patch] = pin.split('.');
  const major = String(D21_MAJOR);
  const numeric = (s) => s !== undefined && s !== 'x';
  const problems = [];
  for (const [doc, source] of Object.entries(sources)) {
    const mentions = docMentions(source);
    if (mentions.length === 0) problems.push(`${doc}: names no Node version`);
    for (const m of mentions) {
      const ok =
        m.major === major &&
        (!numeric(m.minor) || m.minor === minor) &&
        (!numeric(m.patch) || m.patch === patch) &&
        !(numeric(m.patch) && !numeric(m.minor));
      if (!ok) problems.push(`${doc}: '${m.text}' does not name Node ${major} (pin ${pin})`);
    }
  }
  return problems;
}

/** Case 5, AGENTS.md: its Node line names as exceptions exactly the workflows recorded in KNOWN_EXCEPTIONS. */
function agentsExceptionProblems(source) {
  const lines = source.split(/\r?\n/).filter((line) => /^\s*- \*\*Node:\*\*/.test(line));
  if (lines.length !== 1) return [`AGENTS.md must have exactly one '- **Node:**' line, found ${lines.length}`];
  const named = [...new Set([...lines[0].matchAll(/[\w.-]+\.ya?ml\b/g)].map((m) => m[0]))].sort();
  const recorded = Object.keys(KNOWN_EXCEPTIONS).sort();
  if (JSON.stringify(named) === JSON.stringify(recorded)) return [];
  return [`AGENTS.md's Node line names ${JSON.stringify(named)} as runtime exceptions; this spec records ${JSON.stringify(recorded)}`];
}

// ---------------------------------------------------------------------------
// One job of ci-cd.yml, read strictly (the reader secret-scan-contract.spec.mjs
// uses for the security-scan job, for this job's shape): the job at two
// spaces, its keys at four, `- key:` steps at six, step keys at eight and
// their nested maps or block scalars at ten or more. A line this reader
// cannot read (a quoted key, a flow mapping, an unknown indent) is reported,
// never ignored.

function jobText(source, jobId) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^  ${jobId}:\\s*(#.*)?$`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z_][\w-]*:\s*(#.*)?$/.test(lines[end]) && !/^[^\s#]/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

function scalar(raw) {
  if (raw === undefined) return '';
  const value = raw.trim();
  const quoted = value.match(/^(['"])(.*)\1(\s+#.*)?$/);
  if (quoted) return quoted[2];
  return value.replace(/\s+#.*$/, '').trim();
}

function readJob(job) {
  const header = {};
  const steps = [];
  const unparsed = [];
  let inSteps = false;
  let step = null;
  let key = null;
  for (const line of job.split('\n').slice(1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = indentOf(line);
    if (indent <= 4) {
      const m = /^ {4}([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
      inSteps = false;
      step = null;
      if (!m) {
        unparsed.push(line.trim());
        continue;
      }
      header[m[1]] = scalar(m[2]);
      inSteps = m[1] === 'steps';
      continue;
    }
    if (!inSteps) continue;
    const head = /^ {6}- ([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    const field = /^ {8}([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (head) {
      step = { fields: {} };
      steps.push(step);
      key = head[1];
      step.fields[key] = { inline: scalar(head[2]), block: [] };
    } else if (step && field) {
      key = field[1];
      step.fields[key] = { inline: scalar(field[2]), block: [] };
    } else if (step && key && indent >= 10) {
      step.fields[key].block.push(line.trim());
    } else {
      unparsed.push(line.trim());
    }
  }
  const value = (s, name) => {
    const f = s.fields[name];
    if (!f) return undefined;
    return f.inline === '' || /^[|>][+-]?$/.test(f.inline) ? f.block.join('\n') : f.inline;
  };
  return {
    header,
    unparsed,
    steps: steps.map((s) => ({
      keys: Object.keys(s.fields),
      name: value(s, 'name'),
      uses: value(s, 'uses'),
      run: value(s, 'run'),
      env: Object.fromEntries(
        (s.fields.env?.block ?? [])
          .map((line) => /^([A-Za-z_][\w]*):(?:\s+(.*))?$/.exec(line))
          .filter(Boolean)
          .map((m) => [m[1], scalar(m[2])]),
      ),
    })),
  };
}

/** The workflow's top-level `env:` region, comments dropped. */
function workflowEnvText(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^env\s*:/.test(line));
  if (start < 0) return '';
  const region = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#]/.test(line)) break;
    if (!/^\s*#/.test(line)) region.push(line);
  }
  return region.join('\n');
}

/** Case 6: the runtime-pin step in ci-cd.yml runs, on the pinned Node, and can fail the job. */
function runnerStepProblems(source) {
  const problems = [];
  if (source.split(/\r?\n/).some((line) => /^defaults\s*:/.test(line))) {
    problems.push('workflow-level defaults change the shell or directory of the runtime-pin step');
  }
  const envText = workflowEnvText(source);
  for (const name of NEUTERING_WORKFLOW_ENV) {
    if (new RegExp(`\\b${name}\\b`).test(envText)) {
      problems.push(`workflow-level env sets ${name}, which reaches the runtime-pin step (NODE_TEST_CONTEXT=child makes node --test run nothing and pass)`);
    }
  }
  const job = jobText(source, PIN_JOB);
  if (!job) return [...problems, `ci-cd.yml has no ${PIN_JOB} job`];
  const { header, steps, unparsed } = readJob(job);
  for (const key of Object.keys(header)) {
    if (!PIN_JOB_KEYS.includes(key)) {
      problems.push(`job-level ${key} on ${PIN_JOB} (it may set only ${PIN_JOB_KEYS.join(', ')}: a skipped or neutered job reports success)`);
    }
  }
  for (const line of unparsed) problems.push(`${PIN_JOB} line this guard cannot read: ${line}`);

  const mentions = steps.filter((s) => /runtime-pin\.spec\.mjs/.test(s.run ?? ''));
  if (mentions.length !== 1) {
    return [...problems, `ci-cd.yml ${PIN_JOB} must have exactly one step running '${PIN_RUN}', found ${mentions.length}`];
  }
  const index = steps.indexOf(mentions[0]);
  const step = steps[index];
  const extra = step.keys.filter((k) => !PIN_STEP_KEYS.includes(k));
  if (extra.length) {
    problems.push(`the runtime-pin step may not set ${extra.join(', ')} (it may set only ${PIN_STEP_KEYS.join(', ')}: shell, env, if, working-directory or continue-on-error can make it pass without checking)`);
  }
  if (step.run !== PIN_RUN) problems.push(`the runtime-pin step must run exactly '${PIN_RUN}', found ${JSON.stringify(step.run)}`);

  const before = steps.slice(0, index);
  if (!before.some((s) => /^actions\/setup-node@/.test(s.uses ?? ''))) {
    problems.push('the runtime-pin step must run after Setup Node, on the pinned Node');
  }
  for (const s of before) {
    const allowed = BEFORE_PIN.find((b) => b.uses.test(s.uses ?? ''));
    const label = s.name || s.uses || s.run;
    if (!allowed || s.run !== undefined) {
      problems.push(`'${label}' runs before the runtime-pin step; only the checkout, pnpm setup and setup-node may (an earlier step can write GITHUB_ENV)`);
      continue;
    }
    const over = s.keys.filter((k) => !allowed.keys.includes(k));
    if (over.length) problems.push(`'${label}' before the runtime-pin step may not set ${over.join(', ')}`);
  }
  return problems;
}

/** Case 7: the module-loading check keeps catching ESM-only dependencies while a workflow boots the server without require(esm). */
function bootCheckProblems(sources) {
  const problems = [];
  const legacy = [];
  for (const [file, source] of Object.entries(sources)) {
    if (file === 'ci-cd.yml') continue;
    if (!runCommands(codeLines(source)).some((c) => BOOTS_SERVER.test(c))) continue;
    const { pins } = workflowPins(source);
    const flagged = pins.length === 0 ? ['(no pin)'] : pins.filter((p) => !requireEsmUnflagged(p));
    if (flagged.length) legacy.push(`${file} (${flagged.join(', ')})`);
  }
  const job = jobText(sources['ci-cd.yml'] ?? '', BOOT_JOB);
  if (!job) return [`ci-cd.yml has no ${BOOT_JOB} job`];
  const found = readJob(job).steps.filter((s) => s.name === BOOT_STEP);
  if (found.length !== 1) return [`ci-cd.yml ${BOOT_JOB} must have exactly one '${BOOT_STEP}' step, found ${found.length}`];
  const boots = (found[0].run ?? '').split('\n').filter((l) => BOOTS_SERVER.test(l));
  if (boots.length !== 1) return [`'${BOOT_STEP}' must boot apps/server/dist/main.js exactly once, found ${boots.length}`];
  // main.ts exits at env validation, before it imports AppModule, when
  // DATABASE_URL is missing: without one the check never loads the graph.
  if (!/^postgres(?:ql)?:\/\//.test(found[0].env.DATABASE_URL ?? '')) {
    problems.push(`'${BOOT_STEP}' must set a DATABASE_URL, or main.ts exits before it loads the AppModule graph`);
  }
  const flag = new RegExp(String.raw`(?:^|\s)node\s+${NO_REQUIRE_ESM}\s+apps/server/dist/main\.js\b`).test(boots[0]);
  if (legacy.length && !flag) {
    problems.push(
      `${legacy.join(', ')} boot apps/server/dist/main.js on a Node without require(esm): '${BOOT_STEP}' must run node ${NO_REQUIRE_ESM}, or an ESM-only dependency passes ci-cd and dies there with ERR_REQUIRE_ESM`,
    );
  }
  if (!legacy.length && flag) {
    problems.push(`no workflow boots the server on a Node without require(esm) any more: drop ${NO_REQUIRE_ESM} from '${BOOT_STEP}'`);
  }
  return problems;
}

/** Applies one text edit, failing loudly when the anchor is gone (a mutation that no longer applies proves nothing). */
function mutate(source, from, to) {
  assert.ok(source.includes(from), `mutation anchor not found: ${JSON.stringify(from.slice(0, 80))}`);
  return source.replace(from, to);
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
      const { envValues, nodeVersions, versionFiles, setupNodeSteps: count } = workflowPins(workflow(name));
      assert.equal(envValues.length, 1, `${name} must declare NODE_VERSION once, found ${JSON.stringify(envValues)}`);
      found[`${name} NODE_VERSION`] = envValues[0];
      assert.ok(count > 0, `${name} has no setup-node step`);
      assert.equal(nodeVersions.length, count, `${name}: every setup-node step must set node-version (${count} steps, ${nodeVersions.length} versions)`);
      assert.deepEqual(versionFiles, [], `${name}: setup-node reads node-version-file instead of env.NODE_VERSION`);
      for (const v of nodeVersions) {
        assert.match(v, ENV_REF, `${name}: setup-node pins '${v}' instead of env.NODE_VERSION`);
      }
    }

    const { args, problems } = dockerfileFindings(read('Dockerfile'));
    assert.equal(args.length, 1, `Dockerfile must declare ARG NODE_VERSION once, found ${JSON.stringify(args)}`);
    assert.deepEqual(problems, []);
    found['Dockerfile ARG NODE_VERSION'] = args[0];

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

  it('every workflow that runs Node pins the .nvmrc version, except the recorded exceptions', () => {
    assert.deepEqual(workflowPinProblems(allWorkflows(), nvmrcPin()), []);
  });

  it('AGENTS.md, README.md, DEPLOYMENT.md and docs/LAUNCH_GUIDE.md name Node 22 and no other version', () => {
    assert.deepEqual(docProblems(docs(), nvmrcPin()), []);
  });

  it('AGENTS.md names as runtime exceptions exactly the recorded workflows', () => {
    assert.deepEqual(agentsExceptionProblems(read('AGENTS.md')), []);
  });

  it('ci-cd.yml runs this spec in the Type Check job after Setup Node, and nothing can skip or neuter it', () => {
    assert.deepEqual(runnerStepProblems(workflow('ci-cd.yml')), []);
  });

  it('while a workflow boots the server on a Node without require(esm), the ci-cd module-loading check runs with it off', () => {
    assert.deepEqual(bootCheckProblems(allWorkflows()), []);
  });
});

describe('V1-39 negative controls: review mutations are rejected', () => {
  const PIN_STEP = `      - name: Check the Node runtime pin\n        run: ${PIN_RUN}`;
  const JOB_HEAD = `  ${PIN_JOB}:\n    name: Type Check\n    runs-on: ubuntu-latest\n`;
  const CHECKOUT = '      - name: Checkout\n        uses: actions/checkout@v4\n';

  // SEC-V139-2: each leaves the step text unchanged and makes it pass without checking.
  const runnerMutations = {
    'job env NODE_TEST_CONTEXT=child (M7)': [JOB_HEAD, `${JOB_HEAD}    env:\n      NODE_TEST_CONTEXT: child\n`],
    'job continue-on-error (M9)': [JOB_HEAD, `${JOB_HEAD}    continue-on-error: true\n`],
    'job if: false (M9b)': [JOB_HEAD, `${JOB_HEAD}    if: false\n`],
    'job defaults shell': [JOB_HEAD, `${JOB_HEAD}    defaults:\n      run:\n        shell: bash -c "exit 0" {0}\n`],
    'job container node:20': [JOB_HEAD, `${JOB_HEAD}    container: node:20\n`],
    'step shell override (M11)': [PIN_STEP, `${PIN_STEP}\n        shell: bash -c "exit 0" {0}`],
    'step env': [PIN_STEP, `${PIN_STEP}\n        env:\n          NODE_OPTIONS: --test-skip-pattern=.*`],
    'step if': [PIN_STEP, `${PIN_STEP}\n        if: false`],
    'step continue-on-error': [PIN_STEP, `${PIN_STEP}\n        continue-on-error: true`],
    'step quoted continue-on-error key': [PIN_STEP, `${PIN_STEP}\n        "continue-on-error": true`],
    'step working-directory': [PIN_STEP, `${PIN_STEP}\n        working-directory: apps`],
    'run swallows the failure': [PIN_STEP, `${PIN_STEP} || true`],
    'earlier step writes GITHUB_ENV': [
      PIN_STEP,
      `      - name: Prepare\n        run: echo "NODE_TEST_CONTEXT=child" >> "$GITHUB_ENV"\n\n${PIN_STEP}`,
    ],
    'checkout of another ref': [CHECKOUT, `${CHECKOUT}        with:\n          ref: main\n`],
    'workflow env NODE_TEST_CONTEXT=child (M8)': ["env:\n  NODE_VERSION:", "env:\n  NODE_TEST_CONTEXT: child\n  NODE_VERSION:"],
    'workflow env NODE_OPTIONS skip pattern': ["env:\n  NODE_VERSION:", "env:\n  NODE_OPTIONS: --test-skip-pattern=.*\n  NODE_VERSION:"],
    'workflow defaults (M10)': ['\njobs:\n', '\ndefaults:\n  run:\n    shell: bash -c "exit 0" {0}\n\njobs:\n'],
  };
  for (const [name, [from, to]] of Object.entries(runnerMutations)) {
    it(`runtime-pin step: rejects ${name}`, () => {
      assert.notDeepEqual(runnerStepProblems(mutate(workflow('ci-cd.yml'), from, to)), []);
    });
  }
  it('runtime-pin step: rejects the step moved before Setup Node', () => {
    const source = mutate(workflow('ci-cd.yml'), `${PIN_STEP}\n`, '');
    const moved = mutate(source, CHECKOUT, `${CHECKOUT}\n${PIN_STEP}\n`);
    assert.notDeepEqual(runnerStepProblems(moved), []);
  });

  // SEC-V139-3b: a workflow that runs another Node without a failure.
  const SETUP = '      - uses: actions/setup-node@v4\n';
  const extra = (job) => `name: Extra\non: push\njobs:\n  extra:\n    runs-on: ubuntu-latest\n${job}`;
  const pinMutations = {
    'setup-node with no node-version (M4)': extra(`    steps:\n${SETUP}      - run: node -v\n`),
    'job container node:20 (M5)': extra('    container: node:20\n    steps:\n      - run: node -v\n'),
    'job container image block node:20.18.1-alpine': extra('    container:\n      image: node:20.18.1-alpine\n    steps:\n      - run: node -v\n'),
    'flow-mapping node-version (M6)': extra(`    steps:\n${SETUP}        with: { node-version: '20.18.1' }\n      - run: node -v\n`),
    'flow-mapping setup-node step': extra("    steps:\n      - { uses: actions/setup-node@v4, with: { node-version: '20.18.1' } }\n      - run: node -v\n"),
    'job runs pnpm with no setup-node': extra('    steps:\n      - name: Install\n        run: |\n          pnpm install --frozen-lockfile\n'),
    'docker:// node step': extra('    steps:\n      - uses: docker://node:20\n'),
    'matrix node-version': extra(
      `    strategy:\n      matrix:\n        node: [20, 22]\n    steps:\n${SETUP}        with:\n          node-version: \${{ matrix.node }}\n      - run: node -v\n`,
    ),
  };
  for (const [name, source] of Object.entries(pinMutations)) {
    it(`workflow pins: rejects ${name}`, () => {
      assert.notDeepEqual(workflowPinProblems({ ...allWorkflows(), 'extra.yml': source }, nvmrcPin()), []);
    });
  }
  it('workflow pins: accepts setup-node from .nvmrc and a node:fs import (controls)', () => {
    const source = extra(
      `    steps:\n${SETUP}        with:\n          node-version-file: .nvmrc\n      - run: node -e "require('node:fs')"\n`,
    );
    assert.deepEqual(workflowPinProblems({ ...allWorkflows(), 'extra.yml': source }, nvmrcPin()), []);
  });
  it('workflow pins: rejects agent-control-gate.yml changing its recorded runner-image Node', () => {
    const sources = allWorkflows();
    sources['agent-control-gate.yml'] = mutate(
      sources['agent-control-gate.yml'],
      '        uses: actions/checkout@v4\n',
      `        uses: actions/checkout@v4\n${SETUP}        with:\n          node-version: '${nvmrcPin()}'\n`,
    );
    assert.notDeepEqual(workflowPinProblems(sources, nvmrcPin()), []);
  });

  // SEC-V139-3a: Dockerfile FROM forms the first regex missed.
  const BASE = 'FROM node:${NODE_VERSION}-alpine AS base';
  const dockerMutations = {
    'FROM --platform with another node (M1)': 'FROM --platform=$BUILDPLATFORM node:20.18.1-alpine AS base',
    'registry-qualified node image (M2)': 'FROM docker.io/library/node:20.18.1-alpine AS base',
    'plain node:20.18.1 (M2b)': 'FROM node:20.18.1-alpine AS base',
    'node:lts': 'FROM node:lts AS base',
  };
  for (const [name, line] of Object.entries(dockerMutations)) {
    it(`Dockerfile: rejects ${name}`, () => {
      assert.notDeepEqual(dockerfileFindings(mutate(read('Dockerfile'), BASE, line)).problems, []);
    });
  }
  it('Dockerfile: accepts --platform before node:${NODE_VERSION} (control)', () => {
    const source = mutate(read('Dockerfile'), BASE, 'FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS base');
    assert.deepEqual(dockerfileFindings(source).problems, []);
  });

  // CR-V139-1: the shields.io badge form.
  const BADGE = 'badge/node-22.x-';
  for (const badge of ['badge/node-20.x-', 'badge/node-18.x-', 'badge/Node.js-20.x-', 'badge/node-%3E%3D20-']) {
    it(`docs: rejects the README badge ${badge}`, () => {
      const sources = docs();
      sources['README.md'] = mutate(sources['README.md'], BADGE, badge);
      assert.notDeepEqual(docProblems(sources, nvmrcPin()), []);
    });
  }

  // SEC-V139-4: the workflows that boot the server for DAST and the live
  // journey hold the pin; putting either back on 20.18.1 fails case 4, and
  // so does keeping a record for one that is aligned.
  const SERVER_BOOTS = ['native-dast.yml', 'e2e-live.yml'];
  const backTo20 = (source) => mutate(source, `NODE_VERSION: '${nvmrcPin()}'`, "NODE_VERSION: '20.18.1'");
  for (const file of SERVER_BOOTS) {
    it(`workflow pins: rejects ${file} back on NODE_VERSION 20.18.1`, () => {
      const sources = allWorkflows();
      sources[file] = backTo20(sources[file]);
      assert.notDeepEqual(workflowPinProblems(sources, nvmrcPin()), []);
    });
  }

  // CR-V139-2: the flag follows the workflows that boot the server.
  const BOOT = 'timeout 45 node apps/server/dist/main.js';
  const FLAGGED_BOOT = `timeout 45 node ${NO_REQUIRE_ESM} apps/server/dist/main.js`;
  for (const file of SERVER_BOOTS) {
    it(`module-loading check: rejects no flag while ${file} boots on 20.18.1`, () => {
      const sources = allWorkflows();
      sources[file] = backTo20(sources[file]);
      assert.notDeepEqual(bootCheckProblems(sources), []);
      sources['ci-cd.yml'] = mutate(sources['ci-cd.yml'], BOOT, FLAGGED_BOOT);
      assert.deepEqual(bootCheckProblems(sources), [], `control: ${file} on 20.18.1 and the flag`);
    });
  }
  it('module-loading check: rejects keeping the flag once every server boot has require(esm)', () => {
    const sources = allWorkflows();
    assert.deepEqual(bootCheckProblems(sources), [], 'control: aligned workflows and no flag');
    sources['ci-cd.yml'] = mutate(sources['ci-cd.yml'], BOOT, FLAGGED_BOOT);
    assert.notDeepEqual(bootCheckProblems(sources), []);
  });

  // Case 5, AGENTS.md: a stale caveat, or an exception the doc forgets, fails.
  const AGENTS_GATE = "and `agent-control-gate.yml` runs its merge-grant check with no setup-node, on the runner image's Node";
  it('AGENTS.md exceptions: rejects a caveat for an aligned workflow', () => {
    const source = mutate(read('AGENTS.md'), AGENTS_GATE, `${AGENTS_GATE}; \`native-dast.yml\` and \`e2e-live.yml\` pin \`20.18.1\``);
    assert.notDeepEqual(agentsExceptionProblems(source), []);
  });
  it('AGENTS.md exceptions: rejects a recorded exception the doc leaves out', () => {
    const source = mutate(read('AGENTS.md'), `, ${AGENTS_GATE}`, '');
    assert.notDeepEqual(agentsExceptionProblems(source), []);
  });
  it('module-loading check: rejects a step with no DATABASE_URL (it stops before the AppModule graph)', () => {
    const sources = allWorkflows();
    sources['ci-cd.yml'] = mutate(
      sources['ci-cd.yml'],
      '        env:\n          DATABASE_URL: postgresql://module-load-check@127.0.0.1:1/module-load-check\n',
      '',
    );
    assert.notDeepEqual(bootCheckProblems(sources), []);
  });
});
