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

test('the real PR 103 Copilot reviews parse as REVIEWED with 1 finding, and quota-backed NOT_RUN', () => {
  assert.deepEqual(copilotReviewEvidence(PR103_REVIEWED), {
    commit_id: S,
    status: 'REVIEWED',
    reason: null,
    findings: 1,
    url: PR103_REVIEWED.html_url,
  });
  assert.deepEqual(copilotReviewEvidence(PR103_QUOTA), {
    commit_id: A,
    status: 'NOT_RUN',
    reason: 'quota_exhausted',
    findings: null,
    url: PR103_QUOTA.html_url,
  });
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

test('NC Copilot evidence_location is exact: another review URL at the same head cannot satisfy the record', () => {
  const wrongUrl = judge([
    copilotNotRun({ evidence_location: 'https://github.com/SaCH-PRO/KEYFLOWOS/pull/103#pullrequestreview-9999999999' }),
    chatgptPass(),
  ]);
  assert.equal(wrongUrl.reason, R.LIVE_EVIDENCE_MISSING);
  assert.equal(wrongUrl.detail.evidence_location.endsWith('9999999999'), true);
});

test('NC live NOT_RUN reason must match the recorded machine reason', () => {
  const mismatch = judge([copilotNotRun({ reason: 'capacity_exhausted' }), chatgptPass()]);
  assert.equal(mismatch.reason, R.LIVE_EVIDENCE_CONTRADICTS);
  assert.equal(mismatch.detail.recorded_reason, 'capacity_exhausted');
  assert.equal(mismatch.detail.live_reason, 'quota_exhausted');

  const unknownReview = {
    ...PR103_QUOTA,
    body: 'Copilot was unable to review this pull request because of an unexpected internal condition.',
  };
  const unknown = judge([copilotNotRun(), chatgptPass()], { live: live([reviewComment()], [unknownReview]) });
  assert.equal(unknown.reason, R.LIVE_EVIDENCE_CONTRADICTS);
  assert.equal(unknown.detail.live_reason, null);
});

test('NC unparseable Copilot findings fail closed for PASS', () => {
  const unparseable = {
    ...PR103_REVIEWED,
    body: '<!-- ccr-overview-v2 -->\n## Copilot review overview\n### Review completed\nNo machine-readable Findings count is present.',
  };
  const v = judge([copilotPass({ dispositioned_findings: [] })], { live: live([], [unparseable]) });
  assert.equal(v.reason, R.LIVE_EVIDENCE_CONTRADICTS);
  assert.equal(v.detail.live, 'UNPARSEABLE_FINDINGS');
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

// ------------------------------------ live REST evidence (PR 104 admission)
//
// CC-CONTRADICTION-META-AI-REVIEW-FAILOVER-ADMIT-001: auto-merge-admitted.mjs
// fetches the cited comment with GET /repos/{repo}/issues/comments/{id}. That
// REST shape carries both `url` (the API URL) and `html_url`, and the evidence
// was keyed on `url`, so no evidence_location could ever match. The fixtures
// below are the live REST responses, trimmed to the fields GitHub returned.

const PR104_SOURCE_HEAD = 'b70dff17bf6d0c71791cd9e62ae8bb8096ea34d4';
const PR104_REVIEWED_HEAD = 'ae3e1d2b0ac07447e0febef82cb5c93a00df58a5';
const PR104_REVIEW_HTML = 'https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5887238277';
const PR104_REVIEW_API = 'https://api.github.com/repos/SaCH-PRO/KEYFLOWOS/issues/comments/5887238277';

// GET /repos/SaCH-PRO/KEYFLOWOS/issues/comments/5887238277
const PR104_REST_REVIEW = {
  id: 5887238277,
  url: PR104_REVIEW_API,
  html_url: PR104_REVIEW_HTML,
  created_at: '2026-09-29T09:14:37Z',
  updated_at: '2026-09-29T09:14:37Z',
  user: { login: 'SaCH-PRO', type: 'User' },
  body: [
    'message_id: CG-REVIEW-META-AI-REVIEW-FAILOVER-ADMIT-001',
    'message_type: REVIEW',
    'packet_id: KF-META-AI-REVIEW-FAILOVER-001',
    'sender: chatgpt',
    'in_reply_to: CC-RETURN-META-AI-REVIEW-FAILOVER-001',
    'source_main: 4eba59ebc28230f2d114cad852304a9f791b47d2',
    `source_head: ${PR104_SOURCE_HEAD}`,
    'implementation_branch: impl/kf-meta-ai-review-failover-001',
    'state: PROVING',
    'health: GREEN',
    'scope_changed: true',
    'production_touched: false',
    `reviewed_head: ${PR104_REVIEWED_HEAD}`,
    'semantic_review_outcome: PASS',
    'unresolved_substantive_findings: 0',
    'merge_authority: false',
    'programme_credit: ZERO',
    'decision: >',
    '  Exact-head independent review passed. Copilot review 5346592135 is NOT_RUN',
    '  because of quota exhaustion. Claude may update only .agent-control artifacts',
    '  to record this review and ACCEPT_FOR_ADMISSION, then must wait for fresh',
    '  exact-head required checks and RETURN before any merge.',
    'next_action: >',
    '  Create one control-only admission commit, push it, wait for required checks,',
    '  then RETURN the resulting exact head for final review.',
  ].join('\n'),
};

// GET /repos/SaCH-PRO/KEYFLOWOS/pulls/104/reviews, the review at ae3e1d2b
const PR104_REST_QUOTA = {
  id: 5346592135,
  user: { login: 'copilot-pull-request-reviewer[bot]', type: 'Bot' },
  commit_id: PR104_REVIEWED_HEAD,
  html_url: 'https://github.com/SaCH-PRO/KEYFLOWOS/pull/104#pullrequestreview-5346592135',
  body: 'Copilot was unable to review this pull request because the user who requested the review has reached their quota limit.',
};

// The record CG-REVIEW-META-AI-REVIEW-FAILOVER-ADMIT-001 directed.
const pr104Record = (chatgptOver = {}) => ({
  implementer: 'claude',
  reviews: [
    copilotNotRun({ reviewed_head: PR104_REVIEWED_HEAD, evidence_location: PR104_REST_QUOTA.html_url }),
    chatgptPass({ reviewed_head: PR104_REVIEWED_HEAD, evidence_location: PR104_REVIEW_HTML, ...chatgptOver }),
  ],
});

// What auto-merge-admitted.mjs evaluates: source_head, the PR head, and live
// evidence built from the REST responses.
const judgePr104 = ({ record = pr104Record(), comments = [PR104_REST_REVIEW] } = {}) =>
  evaluateSemanticReview({
    record,
    source_head: PR104_SOURCE_HEAD,
    pr_head: PR104_REVIEWED_HEAD,
    live: { copilot: [copilotReviewEvidence(PR104_REST_QUOTA)].filter(Boolean), chatgpt: comments.map(chatgptReviewEvidence) },
  });

test('NC REST evidence URL: a real REST comment is keyed by its html_url, never the API url', () => {
  const e = chatgptReviewEvidence(PR104_REST_REVIEW);
  assert.equal(e.valid, true, e.problems.join('; '));
  assert.equal(e.url, PR104_REVIEW_HTML);
  assert.notEqual(e.url, PR104_REVIEW_API);
});

test('NC REST evidence URL: the PR 104 admission evaluation that failed live is satisfied by the genuine review', () => {
  const v = judgePr104();
  assert.equal(v.satisfied, true, JSON.stringify(v));
  assert.equal(v.reason, R.SATISFIED);
  assert.equal(v.evidence.primary, 'NOT_RUN');
  assert.deepEqual(v.evidence.passing, [
    { provider: 'chatgpt', reviewer: 'chatgpt', reviewed_head: PR104_REVIEWED_HEAD, evidence_location: PR104_REVIEW_HTML },
  ]);
});

test('REST evidence still satisfies only genuine, matching evidence', () => {
  // The record cites another comment: the REST review does not stand in for it.
  const otherComment = judgePr104({ record: pr104Record({ evidence_location: `${PR104_REVIEW_HTML.replace(/\d+$/, '')}5887238278` }) });
  assert.equal(otherComment.reason, R.LIVE_EVIDENCE_MISSING);
  // The API url is never an evidence_location: the admission path fetches only
  // the #80 browser form, and the evidence is keyed by it.
  assert.equal(judgePr104({ record: pr104Record({ evidence_location: PR104_REVIEW_API }) }).reason, R.LIVE_EVIDENCE_MISSING);
  // The comment exists but was edited.
  const edited = judgePr104({ comments: [{ ...PR104_REST_REVIEW, updated_at: '2026-09-29T09:20:00Z' }] });
  assert.equal(edited.reason, R.LIVE_EVIDENCE_CONTRADICTS);
  assert.ok(edited.detail.problems.includes('edited'), JSON.stringify(edited.detail));
  // Another author, and another sender.
  assert.equal(judgePr104({ comments: [{ ...PR104_REST_REVIEW, user: { login: 'outsider', type: 'User' } }] }).reason, R.LIVE_EVIDENCE_CONTRADICTS);
  assert.equal(
    judgePr104({ comments: [{ ...PR104_REST_REVIEW, body: PR104_REST_REVIEW.body.replace('sender: chatgpt', 'sender: claude') }] }).reason,
    R.LIVE_EVIDENCE_CONTRADICTS,
  );
  // The live review is of another head, or reports a finding the record hides.
  assert.equal(
    judgePr104({ comments: [{ ...PR104_REST_REVIEW, body: PR104_REST_REVIEW.body.replace(`reviewed_head: ${PR104_REVIEWED_HEAD}`, `reviewed_head: ${OLD}`) }] }).reason,
    R.LIVE_EVIDENCE_CONTRADICTS,
  );
  assert.equal(
    judgePr104({ comments: [{ ...PR104_REST_REVIEW, body: PR104_REST_REVIEW.body.replace('unresolved_substantive_findings: 0', 'unresolved_substantive_findings: 1') }] }).reason,
    R.LIVE_EVIDENCE_CONTRADICTS,
  );
  // A REST shape whose html_url is missing falls back to the API url and matches nothing.
  const { html_url: _dropped, ...noHtml } = PR104_REST_REVIEW;
  assert.equal(judgePr104({ comments: [noHtml] }).reason, R.LIVE_EVIDENCE_MISSING);
});

test('gh-shaped comments still match: their url is already the browser url', () => {
  const ghShaped = {
    id: 'IC_kwDOexample',
    url: PR104_REVIEW_HTML,
    createdAt: PR104_REST_REVIEW.created_at,
    includesCreatedEdit: false,
    author: { login: 'SaCH-PRO' },
    body: PR104_REST_REVIEW.body,
  };
  assert.equal(chatgptReviewEvidence(ghShaped).url, PR104_REVIEW_HTML);
  const v = judgePr104({ comments: [ghShaped] });
  assert.equal(v.satisfied, true, JSON.stringify(v));
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
