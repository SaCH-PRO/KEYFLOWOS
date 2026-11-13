/**
 * WORKFLOW INTEGRITY: an admission gate is a workflow that cannot conclude
 * success without doing its work (V1-30-SEC-DAST-GATE-SWAP).
 *
 * PRS-M08: the required gate 'DAST (HawkScan)' passed without scanning. Its
 * guard step wrote run=false whenever the HAWK_API_KEY secret was absent,
 * every scan step was then skipped, and the job concluded success. Its scan
 * step was also continue-on-error. Admission read that green as DAST proof on
 * every impl/* PR.
 *
 * Owner ruling D-22 swaps the required gate to 'DAST (Native)' (V1-13), which
 * needs no third-party account and no secret, and leaves HawkScan as a
 * manual-only workflow.
 *
 * Every claim reads its referent: the workflow files, the autopilot wake list,
 * the policy and the operator doc, never a copy of the list. Workflow text is
 * read with LF line endings, so the proofs hold on a Windows checkout too.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../lib/yaml.mjs';
import { REQUIRED_WORKFLOWS, REQUIRED_WORKFLOW_FILES } from '../lib/events.mjs';

const DIR = '.github/workflows';
const NATIVE = 'DAST (Native)';
const HAWKSCAN = 'DAST (HawkScan)';
const POLICY = 'docs/development/AGENT_AUTOPILOT_POLICY.yaml';
const DOC = 'docs/development/AGENT_AUTOPILOT.md';
const HARNESS = 'scripts/security/native-dast.mjs';
const HARNESS_MANIFEST = 'scripts/security/native-dast-manifest.json';
const EVALUATOR_SPEC = 'scripts/security/tests/native-dast.spec.mjs';

const lf = (text) => text.replace(/\r\n/g, '\n');
const read = (file) => lf(fs.readFileSync(file, 'utf8'));
/** Text with full-line comments removed, so a comment cannot satisfy or fail a rule. */
const code = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const isDast = (name) => /^DAST\b/.test(name);

/**
 * Every workflow file with the name it declares, read the way GitHub reads it:
 * the YAML value of the top-level `name` key, so a trailing comment, quoting
 * or a quoted key cannot hide a second workflow of the same name (review
 * SEC-V130-2). A workflow with no name shows as its file path.
 */
function declaredWorkflows() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const text = read(path.join(DIR, file));
      const doc = parseYaml(text) || {};
      const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name : `${DIR}/${file}`;
      return { file, text, doc, name };
    });
}

/** The one workflow file that declares `name`, parsed. */
function workflowNamed(name) {
  const found = declaredWorkflows().filter((w) => w.name === name);
  assert.equal(found.length, 1, `exactly one workflow file must declare "${name}"; found ${found.map((w) => w.file).join(', ') || 'none'}`);
  return found[0];
}

/** A workflow's trigger names, whichever form `on:` takes. */
function triggers(doc) {
  const on = doc.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return [...on];
  return Object.keys(on || {});
}

function steps(doc) {
  return Object.entries(doc.jobs || {}).flatMap(([job, spec]) => (spec.steps || []).map((step) => ({ job, ...step })));
}

const PROBE_COMMAND = `node ${HARNESS} ${HARNESS_MANIFEST}`;
const EVALUATOR_COMMAND = `node --test ${EVALUATOR_SPEC}`;

/**
 * The steps of `wf` that invoke `script`; there must be one, and each runs
 * exactly `command` (review SEC-V130-1). A list of swallow patterns is never
 * complete: GitHub's default `bash -e {0}` has no pipefail, so `| tee log`
 * exits 0 with the probes failed, and `|| echo`, a trailing command under
 * `shell: bash {0}`, or another interpreter all conclude success too. So
 * nothing may surround the command, and the step takes no shell, working
 * directory or condition of its own.
 */
function exactInvocations(wf, name, script, command) {
  const found = steps(wf.doc).filter((s) => String(s.run ?? '').includes(script));
  assert.ok(found.length > 0, `"${name}" must run ${command}`);
  for (const step of found) {
    const where = `step "${step.name}" of "${name}"`;
    assert.equal(String(step.run).trim(), command, `${where} must run exactly "${command}"; anything around it can swallow its exit status`);
    assert.ok(!('shell' in step), `${where} must use the default shell; found shell: ${step.shell}`);
    assert.ok(!('working-directory' in step), `${where} must run from the repository root; found working-directory: ${step['working-directory']}`);
    assert.equal(step.if ?? null, null, `${where} must be unconditional; found if: ${step.if}`);
  }
  return found;
}

// ------------------------------------------------------------ THE SWAP

test('NC gate swap: the required DAST gate is DAST (Native), and DAST (HawkScan) is not required', () => {
  assert.deepEqual(REQUIRED_WORKFLOWS.filter(isDast), [NATIVE], 'exactly one DAST gate is required, and it is the native one');
  assert.ok(!REQUIRED_WORKFLOWS.includes(HAWKSCAN), 'HawkScan concluded success with every scan step skipped (PRS-M08)');
});

test('NC duplicate name: every required workflow is declared by exactly one workflow file', () => {
  // Admission takes the latest run by name. A name no file declares makes every
  // impl/* PR inadmissible; a name two files declare lets either stand in, so a
  // later green run of a second "DAST (Native)" that sent no probes would
  // replace a failed native run (review SEC-V130-2).
  for (const name of REQUIRED_WORKFLOWS) workflowNamed(name);
});

test('NC gate files: every required workflow is bound to the one file that declares it', () => {
  // Admission counts a run for a required gate only when GitHub reports it
  // was produced by that gate's own file (owner ruling D-61; FOLLOW3-C5). The
  // map must name exactly the required workflows, each file must exist, and
  // each must declare the name it is bound to, read the way GitHub reads it.
  assert.deepEqual(Object.keys(REQUIRED_WORKFLOW_FILES).sort(), [...REQUIRED_WORKFLOWS].sort(), 'one file per required workflow, and no other');
  for (const [name, file] of Object.entries(REQUIRED_WORKFLOW_FILES)) {
    assert.equal(path.posix.dirname(file), DIR, `"${name}" is bound to a file directly under ${DIR}; found ${file}`);
    assert.ok(fs.existsSync(file), `"${name}" is bound to ${file}, which does not exist`);
    assert.equal(parseYaml(read(file))?.name, name, `${file} must declare name: ${name}`);
    assert.equal(`${DIR}/${workflowNamed(name).file}`, file, `the one file declaring "${name}" is its bound file`);
  }
});

// ------------------------------------------- THE GATE MUST DO ITS WORK

test('NC soft gate: the required DAST workflow cannot conclude success without probing', () => {
  for (const name of REQUIRED_WORKFLOWS.filter(isDast)) {
    const wf = workflowNamed(name);
    const body = code(wf.text);

    // It runs on every PR: a path-filtered required workflow is missing on the
    // PRs it filters out.
    assert.ok(triggers(wf.doc).includes('pull_request'), `"${name}" must run on pull_request`);
    const pr = (wf.doc.on && typeof wf.doc.on === 'object' && !Array.isArray(wf.doc.on) && wf.doc.on.pull_request) || {};
    assert.ok(!('paths' in pr) && !('paths-ignore' in pr), `"${name}" must not be path-filtered`);

    // No soft gate: a failed step must fail the run. Read structurally too, so
    // a step written `- continue-on-error: true` (the key first in its list
    // item) is caught as well.
    assert.doesNotMatch(body, /^\s*continue-on-error\s*:/m, `"${name}" must not declare continue-on-error`);
    for (const [job, spec] of Object.entries(wf.doc.jobs || {})) {
      assert.ok(!('continue-on-error' in spec), `job "${job}" of "${name}" must not declare continue-on-error`);
    }
    for (const step of steps(wf.doc)) {
      assert.ok(!('continue-on-error' in step), `step "${step.name}" of "${name}" must not declare continue-on-error`);
    }

    // No default shell or directory: `defaults.run.shell: bash {0}` drops
    // errexit for every step, and another shell or directory changes what
    // the probe command means.
    const scopes = [['the workflow', wf.doc.defaults], ...Object.entries(wf.doc.jobs || {}).map(([job, spec]) => [`job "${job}"`, spec.defaults])];
    for (const [scope, defaults] of scopes) {
      const run = (defaults && typeof defaults === 'object' && defaults.run) || {};
      assert.deepEqual(Object.keys(run), [], `${scope} of "${name}" must not set defaults.run; found ${JSON.stringify(run)}`);
    }

    // No dormant guard: nothing may skip the work and still conclude success.
    // Only diagnostics and cleanup may be conditional, and only on the outcome.
    assert.doesNotMatch(body, /\brun=false\b/, `"${name}" must not carry a run=false guard`);
    for (const [job, spec] of Object.entries(wf.doc.jobs || {})) {
      assert.equal(spec.if ?? null, null, `job "${job}" of "${name}" must run unconditionally; found if: ${spec.if}`);
    }
    for (const step of steps(wf.doc)) {
      if (step.if === undefined || step.if === null) continue;
      assert.ok(
        ['failure()', 'always()'].includes(String(step.if).trim()),
        `step "${step.name}" of "${name}" is conditional on "${step.if}"; only failure() or always() diagnostics and cleanup may be`,
      );
    }

    // No secret dependency: an absent secret is how HawkScan went dark.
    assert.doesNotMatch(body, /\bsecrets\./, `"${name}" must not depend on a repository secret`);

    // It runs the harness against its manifest, exactly, unconditionally and
    // unswallowed, after the job that proves the evaluator itself, which is
    // held to the same rule: a swallowed evaluator lets a broken judge
    // produce a green probe run.
    assert.ok(fs.existsSync(HARNESS) && fs.existsSync(HARNESS_MANIFEST), 'the native DAST harness and its manifest exist');
    assert.ok(fs.existsSync(EVALUATOR_SPEC), 'the native DAST evaluator spec exists');
    const probes = exactInvocations(wf, name, HARNESS, PROBE_COMMAND);
    const evaluators = exactInvocations(wf, name, EVALUATOR_SPEC, EVALUATOR_COMMAND);
    for (const probe of probes) {
      const needs = [].concat(wf.doc.jobs[probe.job].needs || []);
      assert.ok(
        evaluators.some((e) => needs.includes(e.job)),
        `the probe job "${probe.job}" must need the job that runs ${EVALUATOR_COMMAND}`,
      );
    }
  }
});

test('NC manual only: DAST (HawkScan) runs only when dispatched by hand', () => {
  const wf = workflowNamed(HAWKSCAN);
  assert.deepEqual(triggers(wf.doc), ['workflow_dispatch'], 'no pull_request, push, schedule or workflow_run trigger');
});

// -------------------------------------- EVERY COPY OF THE LIST AGREES

test('NC autopilot wake: the autopilot wakes on exactly the required workflows', () => {
  const autopilot = parseYaml(read(path.join(DIR, 'agent-control-autopilot.yml')));
  const wakes = autopilot.on.workflow_run.workflows;
  assert.deepEqual([...wakes].sort(), [...REQUIRED_WORKFLOWS].sort());
  assert.ok(wakes.includes(NATIVE) && !wakes.includes(HAWKSCAN), 'the autopilot wakes on the native gate, not the manual one');
});

test('NC policy: the autopilot policy requires exactly the workflows the code requires', () => {
  const policy = parseYaml(read(POLICY));
  assert.deepEqual([...policy.required_pr_workflows].sort(), [...REQUIRED_WORKFLOWS].sort(), 'policy and code must agree');
  assert.ok(policy.required_pr_workflows.includes(NATIVE) && !policy.required_pr_workflows.includes(HAWKSCAN));
});

test('NC doc: the operator doc names the workflows admission requires, and HawkScan as manual-only', () => {
  const doc = read(DOC);
  // The admission rule is one bullet of "Exact-head automatic merge".
  const start = doc.indexOf('- the latest runs of ');
  assert.ok(start >= 0, 'the doc states which workflow runs admission reads');
  const end = doc.indexOf('\n- ', start + 1);
  const bullet = doc.slice(start, end < 0 ? undefined : end).replace(/\s+/g, ' ');
  for (const name of REQUIRED_WORKFLOWS) assert.ok(bullet.includes(name), `the admission bullet must name "${name}"`);
  assert.ok(!bullet.includes(HAWKSCAN), 'the admission bullet must not name HawkScan');
  const paragraphs = doc.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' '));
  assert.ok(
    paragraphs.some((p) => p.includes(HAWKSCAN) && /manual-only/i.test(p) && /workflow_dispatch/.test(p)),
    'the doc says DAST (HawkScan) is manual-only (workflow_dispatch)',
  );
});

// Review CR-V1-30-4; FOLLOW3-C4. Before FOLLOW3-C4 the setup doc said that
// setting HAWK_API_KEY made HawkScan scan every PR, that opening a PR ran it,
// and told operators to add HawkScan to main's required status checks; the
// plugin roadmap gave the same soft-then-required path. After the swap that
// check never reports on a PR, so following those steps blocks every merge.
// The native-dast.yml header said it was not a required check yet. The setup
// doc now describes the required native gate and HawkScan as manual-only.
const SETUP = 'docs/SECURITY_DAST_SETUP.md';
const ROADMAP = 'docs/PLUGIN_INTEGRATION_ROADMAP.md';
const INVENTORY = 'docs/development/feature-inventory.md';
const REQUIRE_HAWKSCAN = /\badd\s+`?HawkScan`?\s+to\s+(?:`?main`?'s\s+|the\s+)?required\b/i;

test('NC setup doc: no operator doc says a PR runs DAST (HawkScan) or tells anyone to require it', () => {
  const setup = read(SETUP).replace(/\s+/g, ' ');
  assert.doesNotMatch(setup, /starts scanning on PRs/i, 'the setup doc says HAWK_API_KEY makes HawkScan scan PRs');
  assert.doesNotMatch(setup, /Open a PR \(or run the workflow manually/i, 'the setup doc says opening a PR runs HawkScan');
  assert.doesNotMatch(setup, /Add `?HawkScan`? to `?main`?'s required status checks/i, 'the setup doc tells operators to require HawkScan');
  const nativeHeader = read(path.join(DIR, 'native-dast.yml')).split(/\nname:/)[0];
  assert.doesNotMatch(nativeHeader, /NOT A REQUIRED CHECK YET/i, 'the native-dast.yml header says it is not required');

  // The setup doc describes the required gate, by name, workflow, harness and manifest.
  for (const referent of [NATIVE, `${DIR}/native-dast.yml`, HARNESS, path.basename(HARNESS_MANIFEST)]) {
    assert.ok(setup.includes(referent), `the setup doc must name ${referent}`);
  }
  // ...and HawkScan as manual-only (workflow_dispatch) and not a required check.
  const paragraphs = read(SETUP).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' '));
  assert.ok(
    paragraphs.some((p) => p.includes('HawkScan') && /manual-only/i.test(p) && p.includes('workflow_dispatch') && /\bnot a required (?:status )?check\b/i.test(p)),
    'the setup doc says HawkScan is manual-only (workflow_dispatch) and not a required check',
  );
  assert.doesNotMatch(setup, REQUIRE_HAWKSCAN, 'the setup doc has no step that adds HawkScan to the required checks');

  // The plugin roadmap gives no soft-then-required path to a required HawkScan.
  const roadmap = read(ROADMAP).replace(/\s+/g, ' ');
  assert.doesNotMatch(roadmap, /flip `?continue-on-error/i, 'the roadmap says to flip continue-on-error on HawkScan');
  assert.doesNotMatch(roadmap, REQUIRE_HAWKSCAN, 'the roadmap says to add HawkScan to the required checks');
  assert.doesNotMatch(roadmap, /soft\s*(?:→|->|then)\s*required/i, 'the roadmap describes a soft-then-required HawkScan gate');

  // The feature inventory lists the required native gate, and HawkScan as manual-only.
  const rows = read(INVENTORY).split('\n').filter((line) => line.startsWith('|'));
  assert.ok(rows.some((row) => row.startsWith(`| ${NATIVE} |`)), `the feature inventory has a "${NATIVE}" row`);
  const hawk = rows.filter((row) => row.startsWith(`| ${HAWKSCAN} |`));
  assert.equal(hawk.length, 1, `the feature inventory has one "${HAWKSCAN}" row`);
  assert.match(hawk[0], /manual-only/i, `the "${HAWKSCAN}" row says it is manual-only`);
});

// ------------------------------------- CAPTURED FAILURES ARE RE-RAISED
// Ported from #114 (impl/kf-meta-proof-integrity-001, caebaa12), and read per
// job: one job's re-raise cannot stand in for another's.

const DIVERGENCE = 'Branch divergence';
const RERAISE = 'Fail when thresholds exceeded';

test('NC captured failure: every continue-on-error step of Branch divergence is re-raised by "Fail when thresholds exceeded"', () => {
  // The divergence check is continue-on-error so that the summary and the
  // report still render when it fails. That is a soft gate unless a later
  // step of the same job fails the job on the captured status. Read from the
  // parsed workflow, so a comment cannot satisfy the rule, and per job, so the
  // PR job's re-raise does not cover a push job that lost its own.
  const wf = workflowNamed(DIVERGENCE);
  let captured = 0;
  for (const [job, spec] of Object.entries(wf.doc.jobs || {})) {
    assert.ok(!('continue-on-error' in spec), `job "${job}" of "${DIVERGENCE}" must not declare continue-on-error; it would swallow the re-raise too`);
    const list = spec.steps || [];
    list.forEach((step, index) => {
      if (!('continue-on-error' in step)) return;
      captured += 1;
      const where = `step "${step.name}" of job "${job}"`;
      assert.ok(typeof step.id === 'string' && step.id, `${where} is continue-on-error, so it needs an id its re-raise can read`);
      const reraise = list.slice(index + 1).filter((s) => s.name === RERAISE);
      assert.equal(reraise.length, 1, `${where} must be followed, in job "${job}", by exactly one "${RERAISE}" step`);
      const [fail] = reraise;
      // Fail closed: any status but 0, an empty one included, fails the job.
      assert.equal(
        String(fail.if ?? '').trim(),
        `steps.${step.id}.outputs.status != '0'`,
        `"${RERAISE}" in job "${job}" must run whenever step ${step.id} did not record status 0`,
      );
      assert.ok(!('continue-on-error' in fail), `"${RERAISE}" in job "${job}" must not itself be continue-on-error`);
      const last = String(fail.run ?? '').trim().split('\n').at(-1).trim();
      assert.equal(last, 'exit 1', `"${RERAISE}" in job "${job}" must end with exit 1`);
    });
  }
  assert.ok(captured >= 1, 'branch divergence intentionally captures command status to render evidence');
});
