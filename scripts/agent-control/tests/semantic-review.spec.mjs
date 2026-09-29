/**
 * The provider-neutral independent semantic-review contract.
 * (KF-META-AI-REVIEW-FAILOVER-001; CG-DECISION-META-AI-REVIEW-FAILOVER-001)
 *
 * Tests named "NC ..." are the directive's negative controls: each spells a
 * real defect and asserts the specific reason it fails with, so a check that
 * passes for the wrong reason still fails here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSemanticReview,
  copilotReviewEvidence,
  chatgptReviewEvidence,
  SEMANTIC_REVIEW_REASONS as R,
  REVIEW_PROVIDERS,
} from '../lib/semantic-review.mjs';

const S = '75b43f00e6f544c11ad0aee4d2f77a3eb9c7faed'; // PR 103 semantic head
const A = '5dbfac61516027ac55f9b9a724e8185456565dfd'; // PR 103 artifact commit
const B = 'b'.repeat(40); // an admission commit on top of A
const OLD = 'f'.repeat(40);
const CHATGPT_URL = 'https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-900';

// The two Copilot bot reviews recorded on PR 103 (GitHub REST, trimmed).
const PR103_REVIEWED = {
  user: { login: 'copilot-pull-request-reviewer[bot]', type: 'Bot' },
  commit_id: S,
  html_url: 'https://github.com/SaCH-PRO/KEYFLOWOS/pull/103#pullrequestreview-5342959856',
  body: '<!-- ccr-overview-v2 -->\n\n## Copilot review overview\n\n### 🟡 Changes recommended\n\nThe return artifact has an incorrect semantic head and does not record the completed semantic proof results.\n\n**Review effort:** Balanced  \n**Findings:** 1 <picture>',
};
const PR103_QUOTA = {
  user: { login: 'copilot-pull-request-reviewer[bot]', type: 'Bot' },
  commit_id: A,
  html_url: 'https://github.com/SaCH-PRO/KEYFLOWOS/pull/103#pullrequestreview-5342961439',
  body: 'Copilot was unable to review this pull request because the user who requested the review has reached their quota limit.',
};

const reviewComment = ({ head = A, outcome = 'PASS', findings = '0', sender = 'chatgpt', type = 'REVIEW', author = 'SaCH-PRO', edited = false } = {}) => ({
  id: 900,
  created_at: '2026-09-29T01:00:00Z',
  updated_at: edited ? '2026-09-29T01:05:00Z' : '2026-09-29T01:00:00Z',
  user: { login: author },
  html_url: CHATGPT_URL,
  body: [
    '```yaml',
    'message_id: CG-REVIEW-EXAMPLE-SEMANTIC-001',
    `message_type: ${type}`,
    'packet_id: KF-EXAMPLE-001',
    `sender: ${sender}`,
    `source_main: ${'c'.repeat(40)}`,
    'implementation_branch: impl/kf-example-001',
    'state: PROVING',
    'health: GREEN',
    'scope_changed: false',
    'production_touched: false',
    `reviewed_head: ${head}`,
    `semantic_review_outcome: ${outcome}`,
    `unresolved_substantive_findings: ${findings}`,
    '```',
  ].join('\n'),
});

const copilotNotRun = (over = {}) => ({
  provider: 'copilot',
  reviewer: 'copilot-pull-request-reviewer[bot]',
  reviewed_head: A,
  outcome: 'NOT_RUN',
  reason: 'quota_exhausted',
  unresolved_substantive_findings: [],
  evidence_location: PR103_QUOTA.html_url,
  ...over,
});
const copilotPass = (over = {}) => ({
  provider: 'copilot',
  reviewer: 'copilot-pull-request-reviewer[bot]',
  reviewed_head: S,
  outcome: 'PASS',
  reason: null,
  unresolved_substantive_findings: [],
  dispositioned_findings: ['incorrect semantic head: fixed in the artifact commit'],
  evidence_location: PR103_REVIEWED.html_url,
  ...over,
});
const chatgptPass = (over = {}) => ({
  provider: 'chatgpt',
  reviewer: 'chatgpt',
  reviewed_head: A,
  outcome: 'PASS',
  reason: null,
  unresolved_substantive_findings: [],
  evidence_location: CHATGPT_URL,
  ...over,
});

const live = (comments = [reviewComment()], copilot = [PR103_REVIEWED, PR103_QUOTA]) => ({
  copilot: copilot.map(copilotReviewEvidence).filter(Boolean),
  chatgpt: comments.map(chatgptReviewEvidence),
});

const judge = (reviews, over = {}) =>
  evaluateSemanticReview({
    record: { implementer: 'claude', reviews },
    source_head: S,
    pr_head: A,
    live: live(),
    ...over,
  });

// ------------------------------------------------------------ live evidence

test('the real PR 103 Copilot reviews parse as REVIEWED with 1 finding, and NOT_RUN', () => {
  assert.deepEqual(copilotReviewEvidence(PR103_REVIEWED), { commit_id: S, status: 'REVIEWED', findings: 1, url: PR103_REVIEWED.html_url });
  assert.equal(copilotReviewEvidence(PR103_QUOTA).status, 'NOT_RUN');
});

test('NC impersonated Copilot: a User account with the bot login is not Copilot evidence', () => {
  assert.equal(copilotReviewEvidence({ ...PR103_REVIEWED, user: { login: 'copilot-pull-request-reviewer[bot]', type: 'User' } }), null);
  assert.equal(copilotReviewEvidence({ ...PR103_REVIEWED, user: { login: 'someone', type: 'Bot' } }), null);
});

test('a ChatGPT REVIEW comment with the review fields is valid evidence', () => {
  const e = chatgptReviewEvidence(reviewComment());
  assert.equal(e.valid, true, e.problems.join('; '));
  assert.equal(e.reviewed_head, A);
  assert.equal(e.outcome, 'PASS');
  assert.equal(e.unresolved_substantive_findings, 0);
});

test('NC forged ChatGPT evidence: another sender, another author, an edit or a non-REVIEW type is invalid', () => {
  assert.equal(chatgptReviewEvidence(reviewComment({ sender: 'claude' })).valid, false);
  assert.equal(chatgptReviewEvidence(reviewComment({ author: 'outsider' })).valid, false);
  assert.equal(chatgptReviewEvidence(reviewComment({ edited: true })).valid, false);
  assert.equal(chatgptReviewEvidence(reviewComment({ type: 'RETURN' })).valid, false);
});

// --------------------------------------------------------------- acceptance

test('normal Copilot review satisfies the contract when Copilot ran', () => {
  const v = judge([copilotPass()]);
  assert.equal(v.satisfied, true, JSON.stringify(v));
  assert.equal(v.evidence.primary, 'PASS');
  assert.deepEqual(v.evidence.passing.map((p) => p.provider), ['copilot']);
});

test('Copilot quota exhaustion no longer blocks: a ChatGPT exact-head review satisfies the contract', () => {
  const v = judge([copilotNotRun(), chatgptPass()]);
  assert.equal(v.satisfied, true, JSON.stringify(v));
  assert.equal(v.evidence.primary, 'NOT_RUN');
  assert.deepEqual(v.evidence.passing.map((p) => [p.provider, p.reviewer]), [['chatgpt', 'chatgpt']]);
});

test('a review of an intermediate control-only commit is accepted only with a lineage proof', () => {
  const reviews = [copilotNotRun(), chatgptPass()];
  const over = { pr_head: B };
  const unproved = judge(reviews, over);
  assert.equal(unproved.reason, R.WRONG_HEAD);
  const proved = judge(reviews, {
    ...over,
    lineage: { [A]: { descends_from_source_head: true, ancestor_of_pr_head: true, non_control_files: [] } },
  });
  assert.equal(proved.satisfied, true, JSON.stringify(proved));
});

test('PR 103 as it truly was is not contradictory: Copilot reviewed S, then hit its quota on A', () => {
  const v = judge([copilotPass(), copilotNotRun()]);
  assert.equal(v.satisfied, true, JSON.stringify(v));
});

// ------------------------------------------------------ negative controls

test('NC self-review: the implementer cannot satisfy its own review obligation', () => {
  const byReviewer = judge([copilotNotRun(), chatgptPass({ reviewer: 'claude' })]);
  assert.equal(byReviewer.reason, R.SELF_REVIEW);
  const implementedByChatgpt = evaluateSemanticReview({
    record: { implementer: 'chatgpt', reviews: [copilotNotRun(), chatgptPass()] },
    source_head: S,
    pr_head: A,
    live: live(),
  });
  assert.equal(implementedByChatgpt.reason, R.SELF_REVIEW);
});

test('NC NOT_RUN is never PASS: a record with only Copilot NOT_RUN has no independent pass', () => {
  assert.equal(judge([copilotNotRun()]).reason, R.NO_PASS);
});

test('NC fake PASS on NOT_RUN: recording Copilot PASS where the bot said it was unable to review is contradicted', () => {
  const v = judge([copilotPass({ reviewed_head: A, dispositioned_findings: [] })]);
  assert.equal(v.reason, R.LIVE_EVIDENCE_CONTRADICTS);
  assert.deepEqual(v.detail, { provider: 'copilot', recorded: 'PASS', live: 'NOT_RUN' });
});

test('NC hidden Copilot review: recording NOT_RUN where Copilot actually reviewed is contradicted', () => {
  const v = judge([copilotNotRun({ reviewed_head: S }), chatgptPass()]);
  assert.equal(v.reason, R.LIVE_EVIDENCE_CONTRADICTS);
});

test('NC stale-head review: a review of any other commit fails closed', () => {
  assert.equal(judge([copilotNotRun(), chatgptPass({ reviewed_head: OLD })]).reason, R.WRONG_HEAD);
  const tainted = judge([copilotNotRun(), chatgptPass()], {
    pr_head: B,
    lineage: { [A]: { descends_from_source_head: true, ancestor_of_pr_head: true, non_control_files: ['apps/web/x.ts'] } },
  });
  assert.equal(tainted.reason, R.WRONG_HEAD, 'a commit whose tree differs outside .agent-control is not the admitted semantics');
});

test('NC stale live evidence: a ChatGPT REVIEW about another head does not support the record', () => {
  const v = judge([copilotNotRun(), chatgptPass()], { live: live([reviewComment({ head: OLD })]) });
  assert.equal(v.reason, R.LIVE_EVIDENCE_CONTRADICTS);
});

test('NC missing reviewer identity fails closed', () => {
  assert.equal(judge([copilotNotRun(), chatgptPass({ reviewer: '' })]).reason, R.REVIEWER_IDENTITY_MISSING);
  assert.equal(
    evaluateSemanticReview({ record: { reviews: [copilotPass()] }, source_head: S, pr_head: A, live: live() }).reason,
    R.IMPLEMENTER_MISSING,
  );
});

test('NC fallback without capacity-unavailable evidence: ChatGPT alone cannot satisfy the obligation', () => {
  assert.equal(judge([chatgptPass()]).reason, R.FALLBACK_WITHOUT_PRIMARY_UNAVAILABLE);
  assert.equal(judge([copilotNotRun({ reason: null }), chatgptPass()]).reason, R.NOT_RUN_WITHOUT_REASON);
  assert.equal(judge([copilotNotRun({ reason: 'did_not_feel_like_it' }), chatgptPass()]).reason, R.NOT_RUN_WITHOUT_REASON);
  const unevidenced = judge([copilotNotRun(), chatgptPass()], { live: live([reviewComment()], [PR103_REVIEWED]) });
  assert.equal(unevidenced.reason, R.LIVE_EVIDENCE_MISSING, 'NOT_RUN needs the bot saying so at that head');
});

test('NC ChatGPT review is never presented as Copilot review, nor the reverse', () => {
  assert.equal(judge([copilotPass({ reviewer: 'chatgpt' })]).reason, R.REVIEWER_IDENTITY_MISMATCH);
  assert.equal(
    judge([copilotNotRun(), chatgptPass({ reviewer: REVIEW_PROVIDERS.copilot.reviewer })]).reason,
    R.REVIEWER_IDENTITY_MISMATCH,
  );
});

test('NC unapproved provider: Kimi or any other reviewer is not part of the architecture', () => {
  assert.equal(judge([copilotNotRun(), chatgptPass({ provider: 'kimi', reviewer: 'kimi' })]).reason, R.PROVIDER_NOT_APPROVED);
  assert.deepEqual(Object.keys(REVIEW_PROVIDERS).sort(), ['chatgpt', 'copilot']);
});

test('NC unresolved substantive findings block, and findings must be explicit', () => {
  assert.equal(judge([copilotNotRun(), chatgptPass({ unresolved_substantive_findings: ['race in merge'] })]).reason, R.UNRESOLVED_FINDINGS);
  assert.equal(judge([copilotNotRun(), chatgptPass({ unresolved_substantive_findings: undefined })]).reason, R.FINDINGS_NOT_EXPLICIT);
});

test('NC undispositioned Copilot findings: the PR 103 review had 1 finding, so a PASS must disposition it', () => {
  assert.equal(judge([copilotPass({ dispositioned_findings: [] })]).reason, R.UNDISPOSITIONED_FINDINGS);
  assert.equal(judge([copilotPass({ dispositioned_findings: undefined })]).reason, R.UNDISPOSITIONED_FINDINGS);
});

test('NC ChatGPT live finding count must agree with the record', () => {
  const v = judge([copilotNotRun(), chatgptPass()], { live: live([reviewComment({ findings: '2' })]) });
  assert.equal(v.reason, R.LIVE_EVIDENCE_CONTRADICTS);
});

test('NC changes required blocks admission', () => {
  assert.equal(judge([copilotNotRun(), chatgptPass({ outcome: 'CHANGES_REQUIRED' })]).reason, R.CHANGES_REQUIRED);
});

test('NC contradictory evidence: two outcomes for one provider at one head, or PASS beside CHANGES_REQUIRED', () => {
  assert.equal(judge([copilotNotRun(), chatgptPass(), chatgptPass({ outcome: 'NOT_RUN', reason: 'service_unavailable' })]).reason, R.CONTRADICTORY);
  assert.equal(judge([copilotNotRun(), chatgptPass({ reviewed_head: S }), chatgptPass({ outcome: 'CHANGES_REQUIRED' })]).reason, R.CONTRADICTORY);
});

test('NC missing evidence fails closed at every level', () => {
  assert.equal(evaluateSemanticReview({ source_head: S, pr_head: A, live: live() }).reason, R.RECORD_MISSING);
  assert.equal(judge([]).reason, R.NO_REVIEWS);
  assert.equal(judge([copilotNotRun(), chatgptPass({ evidence_location: '' })]).reason, R.EVIDENCE_LOCATION_MISSING);
  assert.equal(judge([copilotNotRun(), chatgptPass({ reviewed_head: 'abc' })]).reason, R.REVIEWED_HEAD_MISSING);
  assert.equal(judge([copilotNotRun(), chatgptPass()], { live: undefined }).reason, R.LIVE_EVIDENCE_MISSING);
  assert.equal(judge([copilotNotRun(), chatgptPass()], { live: live([]) }).reason, R.LIVE_EVIDENCE_MISSING);
  assert.equal(judge([copilotNotRun(), chatgptPass({ outcome: 'LGTM' })]).reason, R.OUTCOME_INVALID);
});
