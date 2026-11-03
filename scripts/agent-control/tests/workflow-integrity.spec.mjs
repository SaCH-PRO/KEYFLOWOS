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
import { REQUIRED_WORKFLOWS } from '../lib/events.mjs';

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

/** Every workflow file with the name it declares. The name is read the way GitHub shows it. */
function declaredWorkflows() {
  return fs
    .readdirSync(DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      const text = read(path.join(DIR, file));
      const name = ((text.match(/^name:\s*(.+?)\s*$/m) || [])[1] || '').replace(/^["']|["']$/g, '');
      return { file, text, name };
    });
}

/** The one workflow file that declares `name`, parsed. */
function workflowNamed(name) {
  const found = declaredWorkflows().filter((w) => w.name === name);
  assert.equal(found.length, 1, `exactly one workflow file must declare "${name}"; found ${found.map((w) => w.file).join(', ') || 'none'}`);
  return { ...found[0], doc: parseYaml(found[0].text) };
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

// ------------------------------------------------------------ THE SWAP

test('NC gate swap: the required DAST gate is DAST (Native), and DAST (HawkScan) is not required', () => {
  assert.deepEqual(REQUIRED_WORKFLOWS.filter(isDast), [NATIVE], 'exactly one DAST gate is required, and it is the native one');
  assert.ok(!REQUIRED_WORKFLOWS.includes(HAWKSCAN), 'HawkScan concluded success with every scan step skipped (PRS-M08)');
});

test('every required workflow is declared by exactly one workflow file', () => {
  // Admission takes the latest run by name. A name no file declares makes every
  // impl/* PR inadmissible; a name two files declare lets either stand in.
  for (const name of REQUIRED_WORKFLOWS) workflowNamed(name);
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

    // No soft gate: a failed step must fail the run.
    assert.doesNotMatch(body, /^\s*continue-on-error\s*:/m, `"${name}" must not declare continue-on-error`);

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

    // It runs the harness against its manifest, unconditionally and unswallowed,
    // after the job that proves the evaluator itself.
    assert.ok(fs.existsSync(HARNESS) && fs.existsSync(HARNESS_MANIFEST), 'the native DAST harness and its manifest exist');
    const probe = steps(wf.doc).find((s) => String(s.run || '').includes(`node ${HARNESS} ${HARNESS_MANIFEST}`));
    assert.ok(probe, `"${name}" must run node ${HARNESS} ${HARNESS_MANIFEST}`);
    assert.equal(probe.if ?? null, null, 'the probe step must be unconditional');
    assert.doesNotMatch(String(probe.run), /\|\|\s*(?:true|:)|\bset \+e\b|\bexit 0\b/, 'the probe outcome must not be swallowed');
    const needs = [].concat(wf.doc.jobs[probe.job].needs || []);
    const evaluator = needs.find((job) => steps({ jobs: { [job]: wf.doc.jobs[job] || {} } }).some((s) => String(s.run || '').includes(`node --test ${EVALUATOR_SPEC}`)));
    assert.ok(evaluator, `the probe job must need the job that runs node --test ${EVALUATOR_SPEC}`);
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
