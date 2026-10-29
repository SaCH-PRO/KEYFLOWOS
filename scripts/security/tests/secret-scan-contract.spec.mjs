import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('.github/workflows/ci-cd.yml', 'utf8');

function securityContractProblems(workflow) {
  const problems = [];
  const job = workflow.match(/\n  security-scan:\n([\s\S]*?)(?=\n  [a-zA-Z][\w-]*:\n|$)/)?.[1] || '';
  if (!job) return ['missing security-scan job'];

  const checkout = job.match(/      - name: Checkout\n([\s\S]*?)(?=\n      - name:|$)/)?.[1] || '';
  if (!/fetch-depth:\s*0/.test(checkout)) problems.push('checkout must fetch full commit history');

  const preflight = job.match(/      - name: Require usable secret scan range\n([\s\S]*?)(?=\n      - name:|$)/)?.[1] || '';
  for (const requirement of [
    ['base event SHA', /github\.event\.pull_request\.base\.sha/],
    ['push before SHA', /github\.event\.before/],
    ['head event SHA', /github\.event\.pull_request\.head\.sha/],
    ['commit existence guard', /git cat-file -e/],
    ['nonempty diff guard', /git diff --name-only/],
    ['nonempty diff rejection', /-z "\$changed_files"/],
  ]) {
    if (!requirement[1].test(preflight)) problems.push('missing scan preflight: ' + requirement[0]);
  }

  if (!job.includes('node --test scripts/security/tests/secret-scan-contract.spec.mjs')) {
    problems.push('missing executable regression suite');
  }

  const scan = job.match(/      - name: Secret scanning \(trufflehog\)\n([\s\S]*?)(?=\n      - name:|$)/)?.[1] || '';
  if (!scan) return [...problems, 'missing TruffleHog step'];
  if (/continue-on-error:\s*true/.test(scan)) problems.push('secret-scan errors must not be swallowed');
  if (/^\s*(base|head):/m.test(scan)) problems.push('hardcoded TruffleHog refs override event-specific commit SHA discovery');
  if (!/--fail-on-scan-errors(?:\s|$)/.test(scan)) problems.push('scan-source errors must fail the job');
  if (!/--fail(?:\s|$)/.test(scan)) problems.push('verified secret findings must fail the job');
  if (!/version:\s*['"]?3\.99\.7/.test(scan)) problems.push('scanner version must be pinned');
  return problems;
}

test('secret scanning on actual workflow is not vacuous or continue-on-error', () => {
  assert.deepEqual(securityContractProblems(source), []);
});

test('negative controls: restoring any old false-green mechanism makes the contract fail', () => {
  const mutations = [
    ['shallow checkout', source.replace('fetch-depth: 0', 'fetch-depth: 1')],
    ['hardcoded base', source.replace("version: '3.99.7'", "base: main\n          version: '3.99.7'")],
    ['swallowed failure', source.replace('extra_args: --only-verified --fail --fail-on-scan-errors', 'extra_args: --only-verified --fail --fail-on-scan-errors\n        continue-on-error: true')],
    ['scan error ignored', source.replace('--fail --fail-on-scan-errors', '--fail')],
    ['secrets not blocking', source.replace('--only-verified --fail --fail-on-scan-errors', '--only-verified --fail-on-scan-errors')],
    ['no nonempty check', source.replace('git diff --name-only', 'git status --porcelain')],
    ['no executable test', source.replace('node --test scripts/security/tests/secret-scan-contract.spec.mjs', 'echo tests-skipped')],
  ];
  for (const [name, mutated] of mutations) {
    assert.notEqual(mutated, source, name + ': mutation must change the source');
    assert.notDeepEqual(securityContractProblems(mutated), [], name + ': restored defect must be detected');
  }
});
