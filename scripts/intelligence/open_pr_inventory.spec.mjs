import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory } from './open_pr_inventory.mjs';

const sha = 'a'.repeat(40);
const repository = 'SaCH-PRO/KEYFLOWOS';
const pr = (n, draft = true) => ({
  state: 'open', number: n, title: 'Sample PR ' + n, draft,
  html_url: 'https://github.com/' + repository + '/pull/' + n,
  updated_at: '2026-10-10T00:00:00Z',
  base: { ref: n % 2 ? 'main' : 'docs/keyflow-intelligence-foundation', sha },
  head: { ref: 'sample/' + n, sha }
});
const build = pages => buildInventory({
  pages, repository, mainSha: sha, observedAt: '2026-10-10T00:00:00Z'
});

test('enumerates beyond the first 30, including all pages', () => {
  const result = build([[...Array.from({ length: 30 }, (_, i) => pr(i + 1))],
    [...Array.from({ length: 9 }, (_, i) => pr(i + 31, false))]]);
  assert.equal(result.totals.open, 39);
  assert.equal(result.totals.draft, 30);
  assert.equal(result.totals.not_draft, 9);
  assert.equal(result.pull_requests.length, 39);
  assert.equal(result.pull_requests[0].number, 39);
  assert.equal(result.pull_requests.at(-1).number, 1);
  assert.equal(result.pull_requests[0].implementation_proof, 'NOT_ASSESSED');
  assert.equal(result.pull_requests[0].deployment_proof, 'NOT_ASSESSED');
});

test('does not infer implementation or deployment from an open non-draft PR', () => {
  const result = build([[pr(4, false)]]);
  assert.equal(result.pull_requests[0].reconciliation, 'NOT_ASSESSED');
  assert.equal(result.pull_requests[0].implementation_proof, 'NOT_ASSESSED');
  assert.equal(result.pull_requests[0].deployment_proof, 'NOT_ASSESSED');
});

test('rejects missing pagination structure, duplicates, and non-open PRs', () => {
  assert.throws(() => build([]), /paginated arrays/);
  assert.throws(() => build([pr(1)]), /paginated arrays/);
  assert.throws(() => build([[pr(1)], [pr(1)]]), /Duplicate PR/);
  assert.throws(() => build([[{ ...pr(1), state: 'closed' }]]), /Invalid or non-open/);
});

test('refuses mismatched URLs and absent exact-head evidence', () => {
  assert.throws(() => build([[{ ...pr(1), html_url: 'https://example.com/1' }]]), /URL mismatch/);
  assert.throws(() => build([[{ ...pr(1), head: { ref: 'branch', sha: 'short' } }]]), /invalid SHA/);
  assert.throws(() => buildInventory({
    pages: [[pr(1)]], repository, mainSha: 'wrong', observedAt: '2026-10-10T00:00:00Z'
  }), /invalid SHA/);
});

test('inventory is reproducible for identical evidence and time', () => {
  const pages = [[pr(3), pr(2)], [pr(1)]];
  assert.deepEqual(build(pages), build([[pr(1)], [pr(2), pr(3)]]));
});
