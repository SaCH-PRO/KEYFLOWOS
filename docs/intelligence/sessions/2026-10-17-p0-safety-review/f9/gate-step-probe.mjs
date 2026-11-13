import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getProbeConfig } from './probe-config.mjs';

const config = getProbeConfig();
const workflow = fs.readFileSync(config.sourcePath('.github/workflows/agent-control-gate.yml'), 'utf8');
const step = 'Require ChatGPT admission before non-draft merge readiness';
const marker = `      - name: ${step}\n`;
assert.equal(workflow.split(marker).length, 2, 'Expected one exact admission step.');
const block = workflow.split(marker)[1].split('\n      - name:')[0];
const runMarker = '        run: |\n';
assert.equal(block.split(runMarker).length, 2, 'Expected a literal shell run block.');
let script = block.split(runMarker)[1].split('\n').map((line) => {
  assert.ok(line.trim() === '' || line.startsWith('          '), 'Unexpected workflow indentation.');
  return line.startsWith('          ') ? line.slice(10) : line;
}).join('\n');
const BASE = 'b'.repeat(40);
const expression = '${{ github.event.pull_request.base.sha }}';
assert.equal(script.split(expression).length, 2, 'Expected only the documented base-SHA substitution.');
script = script.replace(expression, BASE);
assert.equal(script.includes('${{'), false, 'Do not execute unresolved workflow expressions.');
fs.writeFileSync(config.outputPath('gate-step-extracted.sh'), script);

// The original investigation retained the result, not a standalone gate wrapper.
// This wrapper executes the pinned run block itself, with synthetic local files.
// It is not a full workflow run and does not evaluate the step's GitHub condition.
const results = [];
for (const review_status of ['ACCEPT_FOR_ADMISSION', 'READY_TO_MERGE', 'CORRECTION_REQUIRED']) {
  const fixtureDir = config.outputPath(path.join('gate-fixtures', review_status));
  fs.mkdirSync(path.join(fixtureDir, '.agent-control'), { recursive: true });
  const common = `packet_id: SYNTHETIC-F9\nimplementation_branch: impl/f9-fixture\npr_number: 1\nsource_main: ${BASE}\nproduction_touched: false\nmerge_authority: false\n`;
  fs.writeFileSync(path.join(fixtureDir, '.agent-control', 'active-packet.yaml'), common);
  fs.writeFileSync(path.join(fixtureDir, '.agent-control', 'claude-return.yaml'), common + `review_status: ${review_status}\n`);
  const run = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    cwd: fixtureDir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '/usr/bin:/bin' },
    timeout: 10000,
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, review_status === 'CORRECTION_REQUIRED' ? 1 : 0, run.stderr);
  results.push({ review_status, both_artifact_merge_authority: false, step_exit_code: run.status, stdout: run.stdout, stderr: run.stderr });
}
const result = {
  purpose: 'EXACT_NON_DRAFT_ADMISSION_STEP_ONLY_NOT_FULL_GITHUB_CI',
  source_main: config.sourceMain,
  step,
  results,
};
fs.writeFileSync(config.outputPath('gate-step-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
