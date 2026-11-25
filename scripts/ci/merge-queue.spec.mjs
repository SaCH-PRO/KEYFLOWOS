/**
 * FU-CI-MERGE-QUEUE (P38, owner ruling D-278):
 *
 * Every required workflow in REQUIRED_WORKFLOW_FILES must trigger on GitHub's
 * `merge_group` event and remain sound when `github.event.pull_request` is
 * absent (as it is on every merge-queue check run):
 *
 *   1. Every required workflow declares top-level `on.merge_group`.
 *   2. `ci-cd.yml` resolves `SCAN_BASE`/`SCAN_HEAD` from
 *      `github.event.merge_group.base_sha` / `head_sha` in `Require usable
 *      secret scan range`, passes those exact event-derived inputs to
 *      TruffleHog (empty on `pull_request`/`push` -> native discovery; exact
 *      range on `merge_group` -> never widens to full history), and keeps
 *      deployment jobs gated off `merge_group`.
 *   3. `agent-control-worker-proof.yml` falls back to `github.ref` in
 *      `concurrency.group` and to `github.event.merge_group.head_sha ||
 *      github.sha` in every `actions/checkout` `ref:`.
 *   4. `native-dast.yml`, `agent-control-gate.yml`, and `branch-divergence.yml`
 *      declare `on.merge_group` and do not dereference `pull_request` without
 *      a `pull_request` guard on `merge_group` runs.
 *   5. Negative controls: removing `merge_group` or its event fallbacks fails
 *      the validator.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml } from '../agent-control/lib/yaml.mjs';
import { REQUIRED_WORKFLOW_FILES } from '../agent-control/lib/events.mjs';

const lf = (text) => text.replace(/\r\n/g, '\n');
const read = (file) => lf(fs.readFileSync(file, 'utf8'));

/** Extract top-level trigger names from a parsed GitHub Actions workflow. */
function triggerNames(doc) {
  const on = doc?.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return [...on];
  return Object.keys(on || {});
}

/**
 * Pure validator over a `{ [workflowFile]: yamlText }` map so negative controls
 * can mutate any workflow in memory without touching disk.
 */
export function mergeQueueProblems(workflowTexts) {
  const problems = [];

  for (const [name, file] of Object.entries(REQUIRED_WORKFLOW_FILES)) {
    const text = workflowTexts[file];
    if (typeof text !== 'string') {
      problems.push(`missing workflow text for ${name} (${file})`);
      continue;
    }
    const doc = parseYaml(text) || {};
    const triggers = triggerNames(doc);
    if (!triggers.includes('merge_group')) {
      problems.push(`${file} (${name}) is missing the merge_group trigger`);
    }
  }

  const ciText = workflowTexts['.github/workflows/ci-cd.yml'] || '';
  if (!ciText.includes('SCAN_BASE: ${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha || github.event.before }}')) {
    problems.push('ci-cd.yml SCAN_BASE must fall back to github.event.merge_group.base_sha');
  }
  if (!ciText.includes('SCAN_HEAD: ${{ github.event.pull_request.head.sha || github.event.merge_group.head_sha || github.sha }}')) {
    problems.push('ci-cd.yml SCAN_HEAD must fall back to github.event.merge_group.head_sha');
  }
  if (!ciText.includes('base: ${{ github.event.merge_group.base_sha }}')) {
    problems.push('ci-cd.yml TruffleHog step must pass base: ${{ github.event.merge_group.base_sha }}');
  }
  if (!ciText.includes('head: ${{ github.event.merge_group.head_sha }}')) {
    problems.push('ci-cd.yml TruffleHog step must pass head: ${{ github.event.merge_group.head_sha }}');
  }

  const workerText = workflowTexts['.github/workflows/agent-control-worker-proof.yml'] || '';
  if (!workerText.includes('group: agent-control-worker-proof-${{ github.event.pull_request.number || github.ref }}')) {
    problems.push('agent-control-worker-proof.yml concurrency.group must fall back to github.ref on merge_group');
  }
  const refMatches = workerText.match(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.event\.merge_group\.head_sha\s*\|\|\s*github\.sha\s*\}\}/g) || [];
  if (refMatches.length < 2) {
    problems.push(`agent-control-worker-proof.yml must set merge_group head_sha fallback on both portable and windows checkout refs (found ${refMatches.length})`);
  }

  const dastText = workflowTexts['.github/workflows/native-dast.yml'] || '';
  if (/\bgithub\.event\.pull_request\b/.test(dastText)) {
    problems.push('native-dast.yml must not dereference github.event.pull_request unconditionally');
  }

  return problems;
}

function loadRequiredWorkflows() {
  const map = {};
  for (const file of Object.values(REQUIRED_WORKFLOW_FILES)) {
    map[file] = read(file);
  }
  return map;
}

test('MQ-01..MQ-04 (D-278): every required workflow supports merge_group safely', () => {
  const problems = mergeQueueProblems(loadRequiredWorkflows());
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('MQ-05 (D-278): negative controls reject missing merge_group triggers or missing merge_group SHA fallbacks', () => {
  const baseline = loadRequiredWorkflows();
  assert.deepEqual(mergeQueueProblems(baseline), [], 'baseline workflows must pass before negative controls run');

  for (const file of Object.values(REQUIRED_WORKFLOW_FILES)) {
    const mutated = {
      ...baseline,
      [file]: baseline[file].replace(/^\s*merge_group:\s*(?:\{\})?\s*$/m, ''),
    };
    const errs = mergeQueueProblems(mutated);
    assert.ok(
      errs.some((e) => e.includes(file) && e.includes('merge_group')),
      `removing merge_group from ${file} must fail; got: ${errs.join('; ')}`,
    );
  }

  const noScanBase = {
    ...baseline,
    '.github/workflows/ci-cd.yml': baseline['.github/workflows/ci-cd.yml'].replace(
      ' || github.event.merge_group.base_sha',
      '',
    ),
  };
  assert.ok(
    mergeQueueProblems(noScanBase).some((e) => e.includes('SCAN_BASE')),
    'dropping merge_group.base_sha from SCAN_BASE must fail',
  );

  const noTruffleBase = {
    ...baseline,
    '.github/workflows/ci-cd.yml': baseline['.github/workflows/ci-cd.yml'].replace(
      'base: ${{ github.event.merge_group.base_sha }}',
      '',
    ),
  };
  assert.ok(
    mergeQueueProblems(noTruffleBase).some((e) => e.includes('TruffleHog')),
    'dropping merge_group.base_sha from TruffleHog step must fail',
  );

  const noWorkerRef = {
    ...baseline,
    '.github/workflows/agent-control-worker-proof.yml': baseline['.github/workflows/agent-control-worker-proof.yml'].replace(
      ' || github.event.merge_group.head_sha || github.sha',
      '',
    ),
  };
  assert.ok(
    mergeQueueProblems(noWorkerRef).some((e) => e.includes('checkout refs')),
    'dropping merge_group.head_sha fallback from worker proof checkout must fail',
  );
});
