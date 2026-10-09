/**
 * Autopilot workflow proofs: the evaluator's exit status in the two merging steps.
 *
 * auto-merge-admitted.mjs exits 0 (eligible, merged), 3 (not eligible -- a
 * draft, a missing review, an unadmitted head) or 2 (error). The workflow has
 * to treat 3 as an ordinary answer and everything else that is not 0 as a
 * failure. It did neither reliably: `shell: bash` runs a step under `bash -e`,
 * so the first not-eligible PR ended the step before its `case` was reached,
 * and the hourly sweep failed on every run that met a draft.
 *
 * A merge also owes the control room an AUTO_MERGE record. Only the
 * event-driven job wrote one; the sweep now records through the same
 * record-auto-merge.mjs, and a record that cannot be confirmed fails the job.
 * The recorder itself is proved in merge-record.spec.mjs; here it is a stub,
 * and what is proved is when each step calls it and what it does with the
 * answer.
 *
 * Nothing here reads the script for a pattern. Each test takes the step's
 * `run` text out of the workflow file and executes it with the exact shell
 * line GitHub uses for `shell: bash`, against stub `gh` and `node` commands
 * that answer with a chosen status. What is asserted is what the step did.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYaml } from '../lib/yaml.mjs';

const WORKFLOW = '.github/workflows/agent-control-autopilot.yml';

// GitHub's documented invocation for `shell: bash`.
const GITHUB_BASH_ARGS = ['--noprofile', '--norc', '-e', '-o', 'pipefail'];

/** On Windows `bash` on PATH can be the WSL launcher; use the one git ships. */
function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const where = spawnSync('where', ['git'], { encoding: 'utf8' });
  for (const line of (where.stdout || '').split(/\r?\n/).filter(Boolean)) {
    const candidate = path.join(path.dirname(path.dirname(line)), 'bin', 'bash.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'bash';
}
const BASH = findBash();

const posix = (p) => p.replace(/\\/g, '/');

function step(job, name) {
  const workflow = parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
  const found = (workflow.jobs[job].steps || []).find((s) => s.name === name);
  assert.ok(found, `${job} must have a step named "${name}"`);
  // The premise of every test below: without `shell: bash` the step would not
  // run under -e and these proofs would be about a different shell.
  assert.equal(found.shell, 'bash', `"${name}" must declare shell: bash`);
  return found.run.replace(/\r\n/g, '\n');
}

const HOURLY = () => step('hourly-reconcile-open-prs', 'Reconcile every open implementation PR');
const EXACT = () => step('exact-head-auto-merge', 'Merge only an exactly admitted head');

const STUB_GH = `#!/usr/bin/env bash
if [ -f "$KF_STUB_DIR/gh-fails" ]; then echo "gh: HTTP 502" >&2; exit 1; fi
cat "$KF_STUB_DIR/prs"
`;

// Stands in for both scripts the steps run. As the evaluator: one JSON object
// on stdout with no trailing newline. As the recorder: it notes the MERGE_JSON
// it was handed and exits with the status chosen for that PR (default 0).
const STUB_NODE = `#!/usr/bin/env bash
case "$1" in
  *record-auto-merge.mjs)
    printf '%s\\n' "$MERGE_JSON" >> "$KF_STUB_DIR/records"
    pr="$(printf '%s' "$MERGE_JSON" | sed -n 's/.*"pr":\\([0-9]*\\).*/\\1/p')"
    code=0
    [ -f "$KF_STUB_DIR/record-status-$pr" ] && code="$(cat "$KF_STUB_DIR/record-status-$pr")"
    echo "{\\"outcome\\":\\"stub\\",\\"status\\":$code}"
    exit "$code"
    ;;
esac
echo "$PR_NUMBER $*" >> "$KF_STUB_DIR/calls"
answer="$KF_STUB_DIR/pr-$PR_NUMBER"
sed -n 2p "$answer" | tr -d '\\n'
exit "$(sed -n 1p "$answer")"
`;

/**
 * Runs a step's script as GitHub would. `answers` maps a PR number to the
 * evaluator's [exit status, stdout] for it.
 */
function runStep(script, { prs = [], answers = {}, ghFails = false, recordStatus = {}, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-autopilot-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), STUB_GH, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'node'), STUB_NODE, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'prs'), prs.map((n) => `${n}\n`).join(''));
    if (ghFails) fs.writeFileSync(path.join(dir, 'gh-fails'), '');
    for (const [pr, [status, stdout]] of Object.entries(answers)) {
      fs.writeFileSync(path.join(dir, `pr-${pr}`), `${status}\n${stdout}\n`);
    }
    for (const [pr, status] of Object.entries(recordStatus)) {
      fs.writeFileSync(path.join(dir, `record-status-${pr}`), String(status));
    }
    const scriptFile = path.join(dir, 'step.sh');
    fs.writeFileSync(scriptFile, script);
    const output = path.join(dir, 'github-output');
    fs.writeFileSync(output, '');

    const run = spawnSync(BASH, [...GITHUB_BASH_ARGS, posix(scriptFile)], {
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        KF_STUB_DIR: posix(dir),
        GITHUB_OUTPUT: posix(output),
        ...env,
      },
    });
    assert.equal(run.error, undefined, `bash must be runnable: ${run.error && run.error.message}`);
    const callsFile = path.join(dir, 'calls');
    const recordsFile = path.join(dir, 'records');
    return {
      // What the recorder was handed, one evaluator result per call, in order.
      records: fs.existsSync(recordsFile)
        ? fs.readFileSync(recordsFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
        : [],
      status: run.status,
      out: (run.stdout || '') + (run.stderr || ''),
      evaluated: fs.existsSync(callsFile)
        ? fs.readFileSync(callsFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => Number(l.split(' ')[0]))
        : [],
      githubOutput: fs.readFileSync(output, 'utf8'),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const DRAFT = [3, '{"eligible":false,"reason":"pr_is_draft","pr":162}'];
const NOT_ADMITTED = [3, '{"eligible":false,"reason":"not_admitted"}'];
const mergeSha = (pr) => String(pr).padStart(40, 'a');
const merged = (pr) => [0, JSON.stringify({ eligible: true, head_sha: 'b'.repeat(40), pr, merge: { merged: true, sha: mergeSha(pr) } })];
const EVALUATOR_ERROR = [2, '{"eligible":false,"reason":"evaluator_error","error":"502 Bad Gateway"}'];

// ------------------------------------------------------------ hourly sweep

test('hourly: a draft PR is not a failure, and the sweep goes on to the next PR', () => {
  const r = runStep(HOURLY(), { prs: [162, 161, 160], answers: { 162: DRAFT, 161: NOT_ADMITTED, 160: DRAFT } });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.evaluated, [162, 161, 160], 'every open impl PR is evaluated, not only the first');
  assert.match(r.out, /PR #162 not eligible/);
  assert.match(r.out, /PR #160 not eligible/);
  assert.doesNotMatch(r.out, /::error::/);
});

test('hourly: an admitted PR between two ineligible ones is merged and reported', () => {
  const r = runStep(HOURLY(), { prs: [162, 159, 155], answers: { 162: DRAFT, 159: merged(159), 155: DRAFT } });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.evaluated, [162, 159, 155]);
  assert.match(r.out, /PR #159 merged at its admitted head/);
});

test('hourly: an evaluator error fails the job, names the PR, and still reconciles the rest', () => {
  const r = runStep(HOURLY(), { prs: [162, 159, 155], answers: { 162: DRAFT, 159: EVALUATOR_ERROR, 155: merged(155) } });
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(r.evaluated, [162, 159, 155], 'one broken PR does not hide the others');
  assert.match(r.out, /^::error::PR #159 evaluator failed with status 2$/m, 'the annotation starts its own line');
  assert.match(r.out, /502 Bad Gateway/, 'the evaluator\'s own diagnostic stays in the log');
  assert.match(r.out, /^::error::1 reconciliation\(s\) failed unexpectedly$/m);
  assert.match(r.out, /PR #155 merged at its admitted head/);
});

test('hourly: a status the evaluator never documents is a failure, not an ineligible PR', () => {
  for (const status of [1, 4, 137]) {
    const r = runStep(HOURLY(), { prs: [162], answers: { 162: [status, ''] } });
    assert.equal(r.status, 1, `status ${status}: ${r.out}`);
    assert.match(r.out, new RegExp(`evaluator failed with status ${status}`));
  }
});

test('hourly: a failed PR listing fails the job instead of reconciling nothing', () => {
  const r = runStep(HOURLY(), { prs: [162], answers: { 162: merged(162) }, ghFails: true });
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(r.evaluated, []);
  assert.match(r.out, /^::error::could not list open pull requests/m);
});

test('hourly: no open impl PR is a clean no-op', () => {
  const r = runStep(HOURLY(), { prs: [] });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.evaluated, []);
});

// ------------------------------------------- hourly sweep: the merge record

test('hourly: a merge is recorded, with that PR\'s own result, and nothing else is', () => {
  const r = runStep(HOURLY(), { prs: [162, 159, 155], answers: { 162: DRAFT, 159: merged(159), 155: NOT_ADMITTED } });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.records.length, 1, 'one merge, one record; an ineligible PR is never recorded');
  assert.equal(r.records[0].pr, 159);
  assert.equal(r.records[0].merge.sha, mergeSha(159));
  assert.match(r.out, /PR #159 merged at its admitted head; AUTO_MERGE record is on the control room/);
});

test('hourly: two merges in one sweep leave two records, each for its own PR', () => {
  const r = runStep(HOURLY(), { prs: [159, 162, 155], answers: { 159: merged(159), 162: DRAFT, 155: merged(155) } });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.records.map((x) => [x.pr, x.merge.sha]), [[159, mergeSha(159)], [155, mergeSha(155)]]);
});

test('hourly: a merge whose record fails fails the job, says so, and the sweep still finishes', () => {
  const r = runStep(HOURLY(), {
    prs: [159, 162, 155],
    answers: { 159: merged(159), 162: DRAFT, 155: merged(155) },
    recordStatus: { 159: 2 },
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^::error::PR #159 was merged but its AUTO_MERGE record is not confirmed \(recorder status 2\)$/m);
  assert.doesNotMatch(r.out, /PR #159 merged at its admitted head; AUTO_MERGE record is on/, 'no success line for an unrecorded merge');
  assert.deepEqual(r.evaluated, [159, 162, 155], 'the PRs after it are still reconciled');
  assert.deepEqual(r.records.map((x) => x.pr), [159, 155], 'and the later merge is still recorded');
  assert.match(r.out, /PR #155 merged at its admitted head; AUTO_MERGE record is on the control room/);
  assert.match(r.out, /^::error::1 reconciliation\(s\) failed unexpectedly$/m);
});

test('hourly: an evaluator that exits 0 without a merge to record is a failure, not a quiet pass', () => {
  // Recorder status 3 means "this result merged nothing". After exit 0 with
  // --merge that contradicts the evaluator, and neither may be believed.
  const r = runStep(HOURLY(), { prs: [159], answers: { 159: merged(159) }, recordStatus: { 159: 3 } });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^::error::PR #159 was merged but its AUTO_MERGE record is not confirmed \(recorder status 3\)$/m);
});

test('hourly: nothing is recorded for an evaluator error', () => {
  const r = runStep(HOURLY(), { prs: [159], answers: { 159: EVALUATOR_ERROR } });
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(r.records, []);
});

// ------------------------------------------------- event-driven exact head

test('exact-head: a not-eligible verdict passes the step and reaches the next one', () => {
  const r = runStep(EXACT(), { answers: { 162: DRAFT }, env: { PR_NUMBER: '162' } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.githubOutput, /"reason":"pr_is_draft"/, 'the verdict is published for the recording step');
});

test('exact-head: a merge passes the step and publishes the merge result', () => {
  const r = runStep(EXACT(), { answers: { 159: merged(159) }, env: { PR_NUMBER: '159' } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.githubOutput, /"merged":true/);
});

test('exact-head: an evaluator error, or any undocumented status, fails the step', () => {
  for (const answer of [EVALUATOR_ERROR, [1, ''], [137, '']]) {
    const r = runStep(EXACT(), { answers: { 159: answer }, env: { PR_NUMBER: '159' } });
    assert.equal(r.status, 1, `status ${answer[0]}: ${r.out}`);
    assert.match(r.out, new RegExp(`^::error::admission evaluator failed for PR #159 with status ${answer[0]}$`, 'm'));
  }
});

// ------------------------------------------- event-driven: the merge record

const RECORD = () => step('exact-head-auto-merge', 'Record automatic merge');
const recordEnv = (pr) => ({ PR_NUMBER: String(pr), MERGE_JSON: merged(pr)[1] });

test('both merging jobs record through the one recorder, and only after an eligible verdict', () => {
  const workflow = parseYaml(fs.readFileSync(WORKFLOW, 'utf8'));
  const recordStep = workflow.jobs['exact-head-auto-merge'].steps.find((s) => s.name === 'Record automatic merge');
  assert.match(String(recordStep.if), /fromJSON\(steps\.merge\.outputs\.json\)\.eligible == true/);
  assert.match(String(recordStep.env.MERGE_JSON), /steps\.merge\.outputs\.json/);
  for (const script of [RECORD(), HOURLY()]) {
    assert.ok(script.includes('node scripts/agent-control/record-auto-merge.mjs'), 'records through record-auto-merge.mjs');
  }
  // A second, inline implementation is how the two jobs drifted apart.
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  assert.doesNotMatch(text, /message_type: AUTO_MERGE/, 'the record body lives in lib/merge-record.mjs only');
});

test('exact-head: a confirmed record passes the step', () => {
  const r = runStep(RECORD(), { env: recordEnv(159) });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].merge.sha, mergeSha(159));
});

test('exact-head: an eligible result that merged nothing passes with nothing recorded as a merge', () => {
  const r = runStep(RECORD(), { env: recordEnv(159), recordStatus: { 159: 3 } });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /eligible but not merged; nothing to record/);
});

test('exact-head: a record that cannot be confirmed fails the step and names the PR', () => {
  for (const status of [2, 1, 137]) {
    const r = runStep(RECORD(), { env: recordEnv(159), recordStatus: { 159: status } });
    assert.equal(r.status, 1, `status ${status}: ${r.out}`);
    assert.match(r.out, new RegExp(`^::error::PR #159 was merged but its AUTO_MERGE record is not confirmed \\(recorder status ${status}\\)$`, 'm'));
  }
});
