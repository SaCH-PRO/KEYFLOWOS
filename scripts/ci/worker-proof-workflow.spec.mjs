/**
 * FU-CI-WINDOWS-INPUT-GATE (P39, owner ruling D-279): the contract of
 * .github/workflows/agent-control-worker-proof.yml.
 *
 * Admission requires the workflow "Agent Control Worker Proof" at the exact
 * head of every PR (REQUIRED_WORKFLOWS, REQUIRED_WORKFLOW_FILES in
 * scripts/agent-control/lib/events.mjs) and counts its run's conclusion. So:
 *
 *   1. The workflow keeps its name, file, triggers (pull_request,
 *      merge_group: no path or branch filter) and gains a nightly schedule.
 *   2. "Portable proof (ubuntu)" is unchanged: no condition, no needs.
 *   3. The input gate always runs (no condition, no needs), on a full clone
 *      at the head, proves its own logic first, and decides from the event's
 *      base and head. Nothing in the workflow can tell it to skip the gate at
 *      the merge base.
 *   4. Every Windows leg needs the gate, runs exactly when it said run, checks
 *      out the head the gate resolved and verifies it before anything else.
 *      The suites leg runs the same suites as before; the shard leg runs every
 *      shard of the manifest (fail-fast off) and uploads its report.
 *   5. "Windows worker proof" is the aggregate: it needs the gate and every
 *      Windows leg, runs `if: always()`, and decides from the gate's decision,
 *      every leg's result and the shard reports, for the same shard count as
 *      the matrix. No other job carries a required name, no job or step may
 *      continue on error, and a job the contract does not know fails it.
 *
 * Each rule is shown live by a negative control: the real workflow mutated in
 * memory must fail the contract.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../agent-control/lib/yaml.mjs';
import { REQUIRED_WORKFLOWS, REQUIRED_WORKFLOW_FILES } from '../agent-control/lib/events.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FILE = '.github/workflows/agent-control-worker-proof.yml';
const NAME = 'Agent Control Worker Proof';
const HEAD_EXPR = '${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}';
const BASE_EXPR = '${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}';
const GATE_SHA = '${{ needs.gate.outputs.sha }}';
const MANIFEST = 'scripts/agent-control/negative-controls.yaml';
const LEGS = ['suites', 'negative-controls'];
const KNOWN_JOBS = ['portable', 'gate', ...LEGS, 'windows'];
const REQUIRED_NAMES = { portable: 'Portable proof (ubuntu)', windows: 'Windows worker proof' };
const SUITES = 'node --test scripts/agent-control/tests/*.spec.mjs scripts/agent-control/tests/windows/*.spec.mjs';
const GATE_SPECS = ['scripts/ci/worker-proof-inputs.spec.mjs', 'scripts/ci/worker-proof-shards.spec.mjs', 'scripts/ci/worker-proof-workflow.spec.mjs'];

const lf = (t) => t.replace(/\r\n/g, '\n');
const read = () => lf(fs.readFileSync(path.join(ROOT, FILE), 'utf8'));
const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const bare = (expr) => String(expr ?? '').trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1').replace(/\s+/g, ' ');
const steps = (job) => (Array.isArray(job?.steps) ? job.steps : []);
const runOf = (step) => String(step?.run ?? '').trim();
const isCheckout = (step) => /^actions\/checkout@/.test(String(step?.uses ?? ''));
const isSetupNode = (step) => /^actions\/setup-node@/.test(String(step?.uses ?? ''));

/** Every way the workflow text breaks the contract (an empty list is a pass). */
export function workflowProblems(text) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  let doc;
  try {
    doc = parseYaml(text) || {};
  } catch (error) {
    return [`does not parse: ${error.message}`];
  }

  // 1. Name, file, triggers.
  if (doc.name !== NAME) p(`workflow name is ${JSON.stringify(doc.name)}, admission requires ${JSON.stringify(NAME)}`);
  if (!REQUIRED_WORKFLOWS.includes(NAME) || REQUIRED_WORKFLOW_FILES[NAME] !== FILE) p(`${NAME} is not required from ${FILE} (events.mjs)`);
  const on = doc.on && typeof doc.on === 'object' ? doc.on : {};
  const pr = on.pull_request;
  if (!pr || JSON.stringify(asList(pr.types)) !== JSON.stringify(['opened', 'synchronize', 'reopened'])) p('pull_request must trigger on opened, synchronize, reopened');
  if (!Object.hasOwn(on, 'merge_group')) p('merge_group trigger missing (D-278)');
  for (const trigger of ['pull_request', 'merge_group']) {
    for (const filter of ['paths', 'paths-ignore', 'branches', 'branches-ignore']) {
      if (on[trigger] && typeof on[trigger] === 'object' && Object.hasOwn(on[trigger], filter)) p(`${trigger} has a ${filter} filter: the required workflow must run on every PR`);
    }
  }
  const crons = asList(on.schedule).map((s) => s?.cron).filter((c) => typeof c === 'string' && c.trim().split(/\s+/).length === 5);
  if (crons.length === 0) p('no nightly schedule: D-279 runs the full proof nightly on main');

  const jobs = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
  for (const id of Object.keys(jobs)) if (!KNOWN_JOBS.includes(id)) p(`job ${id} is not in the contract (a Windows leg must be in the aggregate's needs and legs)`);
  for (const [id, job] of Object.entries(jobs)) {
    if (Object.hasOwn(job || {}, 'continue-on-error')) p(`job ${id} has continue-on-error`);
    for (const step of steps(job)) if (Object.hasOwn(step || {}, 'continue-on-error')) p(`a step of ${id} has continue-on-error`);
    for (const [owner, name] of Object.entries(REQUIRED_NAMES)) {
      if (id !== owner && String(job?.name ?? '').trim().toLowerCase() === name.toLowerCase()) p(`job ${id} also carries the required name ${name}`);
    }
  }
  if (/--no-base\b/.test(text)) p('the workflow passes --no-base: the gate at the merge base must always be asked');

  // 2. Portable, unchanged.
  const portable = jobs.portable;
  if (!portable) p('job portable missing');
  else {
    if (portable.name !== REQUIRED_NAMES.portable) p(`portable is named ${JSON.stringify(portable.name)}`);
    if (portable['runs-on'] !== 'ubuntu-latest') p('portable must run on ubuntu-latest');
    if (portable.if !== undefined || portable.needs !== undefined) p('portable must run unconditionally, needing nothing');
    const suite = steps(portable).find((s) => runOf(s) === 'node --test scripts/agent-control/tests/*.spec.mjs');
    if (!suite || String(suite.env?.KF_REQUIRE_POWERSHELL) !== '1') p('portable must run the control-plane suite with KF_REQUIRE_POWERSHELL=1');
    if (!steps(portable).some((s) => runOf(s) === 'node scripts/agent-control/validate-dag.mjs')) p('portable must validate the programme DAG');
    const co = steps(portable).find(isCheckout);
    if (co?.with?.ref !== HEAD_EXPR) p('portable must check out the event head');
  }

  // 3. The gate.
  const gate = jobs.gate;
  if (!gate) p('job gate missing');
  else {
    if (gate.if !== undefined || gate.needs !== undefined) p('the gate must always run, needing nothing');
    if (gate['runs-on'] !== 'ubuntu-latest') p('the gate must run on ubuntu-latest');
    const co = steps(gate).find(isCheckout);
    if (co?.with?.ref !== HEAD_EXPR) p('the gate must check out the event head');
    if (String(co?.with?.['fetch-depth']) !== '0') p('the gate must fetch the full history (fetch-depth: 0) to find the merge base');
    const proveAt = steps(gate).findIndex((s) => GATE_SPECS.every((spec) => runOf(s).split(/\s+/).includes(spec)) && /^node --test /.test(runOf(s)));
    const decideAt = steps(gate).findIndex((s) => s.id === 'decide');
    if (proveAt < 0) p(`the gate must prove its own logic first (node --test ${GATE_SPECS.join(' ')})`);
    if (decideAt < 0) p('the gate has no step with id decide');
    else {
      const decide = steps(gate)[decideAt];
      if (proveAt > decideAt) p('the gate decides before it proves its own logic');
      const cmd = runOf(decide);
      if (!/^node scripts\/ci\/worker-proof-inputs\.mjs /.test(cmd)) p('the decide step must run scripts/ci/worker-proof-inputs.mjs');
      for (const flag of ['--event "$EVENT"', '--base "$BASE"', '--head "$HEAD_SHA"', '--github-output "$GITHUB_OUTPUT"']) if (!cmd.includes(flag)) p(`the decide step must pass ${flag}`);
      if (decide.env?.EVENT !== '${{ github.event_name }}') p('the decide step must read the event name');
      if (decide.env?.BASE !== BASE_EXPR) p('the decide step must diff from the PR base or the merge_group base');
      if (decide.env?.HEAD_SHA !== HEAD_EXPR) p('the decide step must decide for the event head');
    }
    for (const out of ['run', 'sha', 'decision']) {
      if (bare(gate.outputs?.[out]) !== `steps.decide.outputs.${out}`) p(`the gate must output ${out} from the decide step`);
    }
  }

  // 4. The Windows legs.
  let matrixShards = null;
  for (const leg of LEGS) {
    const job = jobs[leg];
    if (!job) {
      p(`job ${leg} missing`);
      continue;
    }
    if (job['runs-on'] !== 'windows-latest') p(`${leg} must run on windows-latest`);
    if (JSON.stringify(asList(job.needs)) !== JSON.stringify(['gate'])) p(`${leg} must need the gate (only)`);
    if (bare(job.if) !== "needs.gate.outputs.run == 'true'") p(`${leg} must run exactly when the gate said run (if: needs.gate.outputs.run == 'true')`);
    const list = steps(job);
    if (!isCheckout(list[0]) || list[0]?.with?.ref !== GATE_SHA) p(`${leg} must first check out the head the gate resolved`);
    const verifyAt = list.findIndex((s) => /git rev-parse HEAD/.test(runOf(s)) && s.env?.EXPECTED === GATE_SHA);
    const firstNode = list.findIndex((s) => /\bnode\b/.test(runOf(s)));
    if (verifyAt < 0) p(`${leg} must verify the checked-out HEAD is the gate's head`);
    else if (firstNode >= 0 && verifyAt > firstNode) p(`${leg} runs node before verifying its HEAD`);
    if (!list.some((s) => isSetupNode(s) && String(s.with?.['node-version']) === '20.18.1')) p(`${leg} must pin Node 20.18.1`);
  }
  const suites = jobs.suites;
  if (suites) {
    const step = steps(suites).find((s) => runOf(s) === SUITES);
    if (!step || String(step.env?.KF_REQUIRE_POWERSHELL) !== '1' || step.shell !== 'bash') p(`suites must run "${SUITES}" in bash with KF_REQUIRE_POWERSHELL=1`);
  }
  const nc = jobs['negative-controls'];
  if (nc) {
    if (nc.strategy?.['fail-fast'] !== false) p('negative-controls must not fail fast (every shard reports)');
    const shards = asList(nc.strategy?.matrix?.shard);
    matrixShards = shards.length;
    if (shards.length < 2 || JSON.stringify(shards) !== JSON.stringify(shards.map((_, i) => i + 1))) p(`the shard matrix must be 1..N, found ${JSON.stringify(shards)}`);
    const run = steps(nc).find((s) => /worker-proof-shard\.mjs/.test(runOf(s)));
    const want = `node scripts/ci/worker-proof-shard.mjs --manifest ${MANIFEST} --shard \${{ matrix.shard }} --of ${shards.length}`;
    if (!run || !runOf(run).startsWith(want)) p(`negative-controls must run "${want} ..."`);
    const upload = steps(nc).find((s) => /^actions\/upload-artifact@/.test(String(s.uses ?? '')));
    if (!upload || upload.with?.name !== 'worker-proof-nc-shard-${{ matrix.shard }}' || upload.with?.['if-no-files-found'] !== 'error') p('negative-controls must upload its report as worker-proof-nc-shard-<n>, failing if it is missing');
  }

  // 5. The aggregate carries the required name.
  const agg = jobs.windows;
  if (!agg) p('job windows missing');
  else {
    if (agg.name !== REQUIRED_NAMES.windows) p(`the aggregate is named ${JSON.stringify(agg.name)}, admission's check is ${JSON.stringify(REQUIRED_NAMES.windows)}`);
    if (bare(agg.if) !== 'always()') p('the aggregate must run if: always(), so a failed or cancelled leg is reported as failure');
    const needs = asList(agg.needs);
    for (const id of ['gate', ...LEGS]) if (!needs.includes(id)) p(`the aggregate must need ${id}`);
    for (const id of needs) if (!['gate', ...LEGS].includes(id)) p(`the aggregate needs ${id}, which is not a Windows leg`);
    const run = steps(agg).find((s) => /worker-proof-aggregate\.mjs/.test(runOf(s)));
    if (!run) p('the aggregate must run scripts/ci/worker-proof-aggregate.mjs');
    else {
      const cmd = runOf(run);
      if (!cmd.includes(`--manifest ${MANIFEST}`)) p('the aggregate must count the real manifest');
      if (!cmd.includes(`--legs ${LEGS.join(',')}`)) p(`the aggregate must check the legs ${LEGS.join(',')}`);
      const of = /--of (\d+)/.exec(cmd);
      if (!of || Number(of[1]) !== matrixShards) p(`the aggregate counts ${of ? of[1] : 'no'} shards, the matrix has ${matrixShards}`);
      const env = run.env || {};
      if (env.DECISION !== '${{ needs.gate.outputs.decision }}') p('the aggregate must read the gate decision');
      if (bare(env.NEEDS) !== 'toJSON(needs)') p('the aggregate must read every leg result (toJSON(needs))');
      if (env.EXPECTED_HEAD !== HEAD_EXPR) p('the aggregate must check the decision is for the event head');
      if (env.EVENT_NAME !== '${{ github.event_name }}') p('the aggregate must read the event name');
    }
    const download = steps(agg).find((s) => /^actions\/download-artifact@/.test(String(s.uses ?? '')));
    if (!download || download.with?.pattern !== 'worker-proof-nc-shard-*') p('the aggregate must download every shard report');
  }
  return problems;
}

describe('agent-control-worker-proof.yml contract (D-279)', () => {
  it('the real workflow satisfies the contract', () => {
    const problems = workflowProblems(read());
    assert.deepEqual(problems, []);
  });

  it('negative controls: each mutation of the real workflow breaks the contract', () => {
    const text = read();
    assert.deepEqual(workflowProblems(text), [], 'baseline must pass first');
    const mutations = [
      ['the aggregate no longer runs always', (t) => t.replace(/(\n {2}windows:[\s\S]*?\n {4}if: )always\(\)/, '$1success()'), /always/],
      ['the aggregate is renamed', (t) => t.replace('name: Windows worker proof\n', 'name: Windows worker proof (aggregate)\n'), /aggregate is named/],
      ['a leg also carries the required name', (t) => t.replace('name: Windows proof suites', 'name: Windows worker proof'), /also carries the required name/],
      ['the schedule is removed', (t) => t.replace(/\n {2}schedule:\n(?: {4}.*\n)+/, '\n'), /nightly schedule/],
      ['a path filter is added', (t) => t.replace('types: [opened, synchronize, reopened]', "types: [opened, synchronize, reopened]\n    paths: ['scripts/**']"), /paths filter/],
      ['merge_group is removed', (t) => t.replace(/\n {2}merge_group: \{\}\n/, '\n'), /merge_group/],
      ['a leg runs unless the gate said false', (t) => t.replace("if: needs.gate.outputs.run == 'true'", "if: needs.gate.outputs.run != 'false'"), /exactly when the gate said run/],
      ['a leg is dropped from the aggregate', (t) => t.replace('needs: [gate, suites, negative-controls]', 'needs: [gate, negative-controls]'), /must need suites/],
      ['the matrix shrinks without the aggregate', (t) => t.replace('shard: [1, 2, 3, 4]', 'shard: [1, 2, 3]'), /shards/],
      ['a shard continues on error', (t) => t.replace('    strategy:\n      fail-fast: false', '    continue-on-error: true\n    strategy:\n      fail-fast: false'), /continue-on-error/],
      ['a step continues on error', (t) => t.replace('      - name: Upload the shard report\n', '      - name: Upload the shard report\n        continue-on-error: true\n'), /continue-on-error/],
      ['the gate is told to skip the merge base gate', (t) => t.replace('--github-output "$GITHUB_OUTPUT"', '--github-output "$GITHUB_OUTPUT" --no-base'), /--no-base/],
      ['the gate fetches a shallow history', (t) => t.replace('fetch-depth: 0', 'fetch-depth: 1'), /fetch-depth/],
      ['the gate gets a condition', (t) => t.replace('name: Worker proof input gate', "name: Worker proof input gate\n    if: github.event_name != 'schedule'"), /gate must always run/],
      ['the gate no longer proves itself', (t) => t.replace('scripts/ci/worker-proof-shards.spec.mjs scripts/ci/worker-proof-workflow.spec.mjs', 'scripts/ci/worker-proof-shards.spec.mjs'), /prove its own logic/],
      ['the suites lose the PowerShell requirement', (t) => t.replace(/(\n {2}suites:[\s\S]*?KF_REQUIRE_POWERSHELL: )'1'/, "$1'0'"), /KF_REQUIRE_POWERSHELL/],
      ['a leg checks out the event head instead of the gated head', (t) => t.replace(/(\n {2}suites:[\s\S]*?ref: )\$\{\{ needs\.gate\.outputs\.sha \}\}/, `$1${HEAD_EXPR}`), /gate resolved/],
      ['an unknown job appears', (t) => `${t.trimEnd()}\n\n  extra:\n    runs-on: windows-latest\n    steps:\n      - run: echo hi\n`, /not in the contract/],
      ['the portable job gets a condition', (t) => t.replace('name: Portable proof (ubuntu)', "name: Portable proof (ubuntu)\n    if: github.event_name == 'schedule'"), /portable must run unconditionally/],
    ];
    for (const [what, mutate, expected] of mutations) {
      const mutated = mutate(text);
      assert.notEqual(mutated, text, `${what}: the mutation must apply to the real workflow`);
      const problems = workflowProblems(mutated);
      assert.ok(problems.some((m) => expected.test(m)), `${what}: expected ${expected}, got ${JSON.stringify(problems)}`);
    }
  });
});
