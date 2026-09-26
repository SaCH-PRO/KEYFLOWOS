import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  evaluateAiReview,
  requiredComparisons,
  classifyHighRisk,
  decideReviewRequest,
  renderLedger,
  ledgerMarker,
  parseDisposition,
  severityFromComment,
  severitiesFromOverview,
  isReviewerBot,
  GATE_REASONS,
  REVIEWERS,
  REQUIRED_REVIEWERS,
} from '../lib/ai-review.mjs';

// ---------------------------------------------------------------- fixtures

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const FIX = 'c'.repeat(40);
const BASE = 'd'.repeat(40);

const COPILOT = { login: 'copilot-pull-request-reviewer', type: 'Bot', id: REVIEWERS['copilot-pull-request-reviewer'].id };
const CODEX = { login: 'chatgpt-codex-connector', type: 'Bot', id: REVIEWERS['chatgpt-codex-connector'].id };
const ACTIONS = { login: 'github-actions', type: 'Bot', id: 'BOT_kgDOAHlHYQ' };
const OWNER = { login: 'SaCH-PRO', type: 'User', id: 'U_owner' };

const review = (over = {}) => ({
  id: 1,
  author: COPILOT,
  state: 'COMMENTED',
  commit_sha: HEAD,
  submitted_at: '2026-09-26T10:00:00Z',
  body: 'Copilot reviewed 4 out of 4 changed files in this pull request and generated no new comments.',
  ...over,
});

const thread = (firstBody, { id = 4100000001, author = COPILOT, commit = HEAD, replies = [], resolved = false, path = 'apps/server/src/x.ts' } = {}) => ({
  id: `T_${id}`,
  is_resolved: resolved,
  is_outdated: false,
  path,
  line: 10,
  comments: [
    { id, author, body: firstBody, commit_sha: commit, original_commit_sha: commit, created_at: '2026-09-26T10:00:00Z' },
    ...replies.map((r, i) => ({ id: id + i + 1, author: OWNER, created_at: `2026-09-26T11:0${i}:00Z`, commit_sha: commit, original_commit_sha: commit, ...r })),
  ],
});

const snap = (over = {}) => ({
  pr: { number: 101, state: 'open', draft: false, head_sha: HEAD, base_sha: BASE },
  expected_head_sha: HEAD,
  reviews: [review()],
  threads: [],
  comparisons: {},
  files: [{ filename: 'apps/web/src/components/button.tsx', patch: '+x' }],
  ...over,
});

// ------------------------------------------------------------ happy path

test('POSITIVE CONTROL: a clean Copilot review at the exact head is admissible', () => {
  const v = evaluateAiReview(snap());
  assert.equal(v.admissible, true, JSON.stringify(v));
  assert.equal(v.reason, GATE_REASONS.ADMISSIBLE);
  assert.deepEqual(v.reviews.map((r) => [r.reviewer, r.reviewed_sha, r.relation]), [['copilot-pull-request-reviewer', HEAD, 'exact_head']]);
});

// --------------------------------------------------- missing / unavailable

test('missing reviewer result blocks admission', () => {
  const v = evaluateAiReview(snap({ reviews: [] }));
  assert.equal(v.admissible, false);
  assert.equal(v.reason, GATE_REASONS.REVIEW_MISSING);
  assert.deepEqual(v.detail.missing_reviewers, REQUIRED_REVIEWERS);
});

test('a Codex-only review does not replace the required Copilot review', () => {
  const v = evaluateAiReview(snap({ reviews: [review({ author: CODEX, body: '**Reviewed commit:** `aaaaaaaaaa`' })] }));
  assert.equal(v.reason, GATE_REASONS.REVIEW_MISSING);
});

test('an unavailable / errored reviewer result fails closed', () => {
  for (const body of ['Copilot encountered an error and was unable to review this pull request.', "Copilot wasn't able to review any files in this pull request.", 'You have reached your Codex usage limits for code reviews.']) {
    const v = evaluateAiReview(snap({ reviews: [review({ body })] }));
    assert.equal(v.admissible, false, body);
    assert.equal(v.reason, GATE_REASONS.REVIEW_MISSING, body);
    assert.equal(v.rejected_reviews[0].reason, 'reviewer_unavailable');
  }
});

test('pending or dismissed reviews never count', () => {
  for (const state of ['PENDING', 'DISMISSED']) {
    assert.equal(evaluateAiReview(snap({ reviews: [review({ state })] })).admissible, false, state);
  }
});

test('a review whose stated commit disagrees with its commit id is ambiguous and fails closed', () => {
  const v = evaluateAiReview(snap({ reviews: [review({ body: '**Reviewed commit:** `bbbbbbbbbb`' })] }));
  assert.equal(v.admissible, false);
  assert.equal(v.rejected_reviews[0].reason, 'reviewed_sha_ambiguous');
});

test('a review without a provable reviewed sha fails closed', () => {
  assert.equal(evaluateAiReview(snap({ reviews: [review({ commit_sha: null })] })).admissible, false);
});

// ------------------------------------------------------------ exact head

test('reviewer result for an OLD sha blocks admission after a semantic push', () => {
  const v = evaluateAiReview(
    snap({
      reviews: [review({ commit_sha: OLD })],
      comparisons: { [`${OLD}...${HEAD}`]: { status: 'ahead', files: ['apps/server/src/payments/charge.ts', '.agent-control/claude-return.yaml'] } },
    }),
  );
  assert.equal(v.admissible, false);
  assert.equal(v.reason, GATE_REASONS.REVIEW_STALE);
  assert.equal(v.stale_reviews[0].relation, 'semantic_change_since_review');
});

test('an old review whose relation to the head cannot be proved is stale (fail closed)', () => {
  const v = evaluateAiReview(snap({ reviews: [review({ commit_sha: OLD })], comparisons: {} }));
  assert.equal(v.reason, GATE_REASONS.REVIEW_STALE);
  assert.equal(v.stale_reviews[0].relation, 'unproven');
});

test('a review on a sha the head is not descended from (force push) is stale', () => {
  const v = evaluateAiReview(snap({ reviews: [review({ commit_sha: OLD })], comparisons: { [`${OLD}...${HEAD}`]: { status: 'diverged', files: [] } } }));
  assert.equal(v.reason, GATE_REASONS.REVIEW_STALE);
});

test('a control-only tail (.agent-control/** after the review) keeps the review current', () => {
  const v = evaluateAiReview(
    snap({ reviews: [review({ commit_sha: OLD })], comparisons: { [`${OLD}...${HEAD}`]: { status: 'ahead', files: ['.agent-control/claude-return.yaml'] } } }),
  );
  assert.equal(v.admissible, true, JSON.stringify(v));
  assert.equal(v.reviews[0].relation, 'control_only_tail');
});

test('a fresh review at the new head after a semantic push is admissible again', () => {
  const v = evaluateAiReview(
    snap({
      reviews: [review({ id: 1, commit_sha: OLD }), review({ id: 2, commit_sha: HEAD })],
      comparisons: { [`${OLD}...${HEAD}`]: { status: 'ahead', files: ['apps/server/src/x.ts'] } },
    }),
  );
  assert.equal(v.admissible, true);
  assert.equal(v.stale_reviews.length, 1, 'the stale review is still recorded, not silently dropped');
});

test('the head moving during evaluation fails closed', () => {
  const v = evaluateAiReview(snap({ expected_head_sha: OLD }));
  assert.equal(v.reason, GATE_REASONS.HEAD_MOVED);
});

test('unread paginated evidence fails closed', () => {
  assert.equal(evaluateAiReview(snap({ evidence_truncated: true })).reason, GATE_REASONS.EVIDENCE_INCOMPLETE);
});

test('a closed PR is never admissible', () => {
  assert.equal(evaluateAiReview(snap({ pr: { ...snap().pr, state: 'closed' } })).reason, GATE_REASONS.PR_NOT_OPEN);
});

// --------------------------------------------------------- identity/spoof

test('SPOOF: github-actions[bot] cannot impersonate an AI reviewer', () => {
  const v = evaluateAiReview(snap({ reviews: [review({ author: ACTIONS, body: 'Copilot reviewed all files and generated no comments.' })] }));
  assert.equal(v.admissible, false);
  assert.equal(v.reason, GATE_REASONS.REVIEW_MISSING);
});

test('SPOOF: a human quoting a passing AI review is not a review', () => {
  const v = evaluateAiReview(snap({ reviews: [review({ author: OWNER, state: 'APPROVED', body: '> copilot-pull-request-reviewer: no issues found' })] }));
  assert.equal(v.admissible, false);
});

test('SPOOF: a User account with a reviewer login, or a Bot with the wrong node id, is refused', () => {
  const asUser = { ...COPILOT, type: 'User' };
  const wrongId = { ...COPILOT, id: 'BOT_forged' };
  assert.equal(isReviewerBot(asUser), false);
  assert.equal(isReviewerBot(wrongId), false);
  assert.equal(isReviewerBot({ ...COPILOT, login: 'copilot-pull-request-reviewer[bot]' }), true, 'REST [bot] suffix normalizes');
  const v = evaluateAiReview(snap({ reviews: [review({ author: asUser }), review({ author: wrongId })] }));
  assert.equal(v.admissible, false);
  assert.equal(v.rejected_reviews.length, 2);
});

test('SPOOF: a finding cannot be downgraded by a human-authored thread or comment', () => {
  // A human-opened thread is not an AI finding; it neither blocks nor clears anything.
  const v = evaluateAiReview(snap({ threads: [thread('KF-SEVERITY: STYLE', { author: OWNER })] }));
  assert.equal(v.findings.length, 0);
});

// --------------------------------------------------------------- findings

const HIGH_FINDING = '**KF-SEVERITY: HIGH** — `prisma.$queryRawUnsafe` interpolates `req.query.q`: SQL injection.';

test('an unresolved HIGH finding blocks admission', () => {
  const v = evaluateAiReview(snap({ threads: [thread(HIGH_FINDING)] }));
  assert.equal(v.admissible, false);
  assert.equal(v.reason, GATE_REASONS.UNDISPOSITIONED);
  assert.deepEqual(v.blocking_findings, ['F-4100000001']);
  assert.equal(v.findings[0].severity, 'HIGH');
});

test('an unresolved MEDIUM, LOW or UNCLASSIFIED finding also blocks (fail closed)', () => {
  for (const body of ['KF-SEVERITY: MEDIUM missing pagination', 'KF-SEVERITY: LOW unchecked null', 'This loop issues one query per order (N+1).']) {
    const v = evaluateAiReview(snap({ threads: [thread(body)] }));
    assert.equal(v.reason, GATE_REASONS.UNDISPOSITIONED, body);
  }
  assert.equal(evaluateAiReview(snap({ threads: [thread('no tag at all')] })).findings[0].severity, 'UNCLASSIFIED');
});

test('a style-only finding does not independently block admission', () => {
  const v = evaluateAiReview(snap({ threads: [thread('KF-SEVERITY: STYLE prefer const over let here.')] }));
  assert.equal(v.admissible, true, JSON.stringify(v));
  assert.equal(v.findings[0].blocking, false);
  assert.equal(v.findings.length, 1, 'still recorded in the ledger');
});

test('style tag loses to a stronger tag in the same comment', () => {
  assert.equal(severityFromComment('KF-SEVERITY: STYLE naming; KF-SEVERITY: HIGH also the tenant filter is missing'), 'HIGH');
});

test('Codex P-badges map to severity and Codex findings block even though Codex is not required', () => {
  const p1 = '**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Provide GitHub credentials**';
  assert.equal(severityFromComment(p1), 'HIGH');
  assert.equal(severityFromComment('![P3 Badge](x)'), 'LOW');
  const v = evaluateAiReview(snap({ threads: [thread(p1, { author: CODEX })] }));
  assert.equal(v.reason, GATE_REASONS.UNDISPOSITIONED);
});

test('severity falls back to the reviewer overview when the inline comment has no tag', () => {
  const overview =
    '- <picture><img src="x" alt="High severity" width="62"></picture> [Platform dependency gate is not machine-enforced](#discussion_r4100000001) · New\n' +
    '- <picture><img alt="Low severity"></picture> [nit](#discussion_r4100000009)';
  assert.deepEqual([...severitiesFromOverview(overview)], [['4100000001', 'HIGH'], ['4100000009', 'LOW']]);
  const v = evaluateAiReview(snap({ reviews: [review({ body: overview })], threads: [thread('The dependency gate is not enforced.')] }));
  assert.equal(v.findings[0].severity, 'HIGH');
  // Overview text from a non-reviewer cannot set severity.
  const spoof = evaluateAiReview(snap({ reviews: [review(), review({ id: 9, author: OWNER, body: overview.replace('High', 'Low') })], threads: [thread('x')] }));
  assert.equal(spoof.findings[0].severity, 'UNCLASSIFIED');
});

// ------------------------------------------------------------ disposition

const resolvedComparisons = {
  [`${HEAD}...${FIX}`]: { status: 'ahead', files: ['apps/server/src/x.ts'] },
  [`${FIX}...${HEAD}`]: { status: 'identical', files: [] },
};

test('RESOLVED with a fixing commit after the finding and inside the head clears it', () => {
  const t = thread(HIGH_FINDING, { commit: OLD, replies: [{ body: `KF-DISPOSITION: RESOLVED fixed_in=${FIX}\nparameterized with Prisma.sql` }] });
  const s = snap({
    pr: { ...snap().pr, head_sha: FIX },
    expected_head_sha: FIX,
    reviews: [review({ commit_sha: FIX })],
    threads: [t],
    comparisons: { [`${OLD}...${FIX}`]: { status: 'ahead', files: ['apps/server/src/x.ts'] } },
  });
  assert.deepEqual(requiredComparisons(s), [{ from: OLD, to: FIX }]);
  const v = evaluateAiReview(s);
  assert.equal(v.admissible, true, JSON.stringify(v.findings));
  assert.equal(v.findings[0].disposition.state, 'RESOLVED');
});

test('RESOLVED naming a commit that is not after the finding, or not in the head, does not clear it', () => {
  const before = thread(HIGH_FINDING, { replies: [{ body: `KF-DISPOSITION: RESOLVED fixed_in=${FIX}` }] });
  const notAfter = evaluateAiReview(snap({ threads: [before], comparisons: { [`${HEAD}...${FIX}`]: { status: 'behind', files: [] } } }));
  assert.equal(notAfter.reason, GATE_REASONS.UNDISPOSITIONED);
  assert.match(notAfter.findings[0].disposition.detail, /not a descendant/);

  const notInHead = evaluateAiReview(
    snap({ threads: [before], comparisons: { [`${HEAD}...${FIX}`]: { status: 'ahead', files: [] }, [`${FIX}...${HEAD}`]: { status: 'diverged', files: [] } } }),
  );
  assert.equal(notInHead.reason, GATE_REASONS.UNDISPOSITIONED);
  assert.match(notInHead.findings[0].disposition.detail, /not in the current head/);

  const shortSha = evaluateAiReview(snap({ threads: [thread(HIGH_FINDING, { replies: [{ body: 'KF-DISPOSITION: RESOLVED fixed_in=ccccccc' }] })], comparisons: resolvedComparisons }));
  assert.match(shortSha.findings[0].disposition.detail, /full 40-character/);
});

test('REJECTED_WITH_EVIDENCE needs real evidence', () => {
  const thin = evaluateAiReview(snap({ threads: [thread(HIGH_FINDING, { replies: [{ body: 'KF-DISPOSITION: REJECTED_WITH_EVIDENCE\nnope' }] })] }));
  assert.equal(thin.reason, GATE_REASONS.UNDISPOSITIONED);
  const real = evaluateAiReview(
    snap({
      threads: [
        thread(HIGH_FINDING, {
          replies: [{ body: 'KF-DISPOSITION: REJECTED_WITH_EVIDENCE\n`q` is validated by `SearchDto` (IsEnum) before this call; see apps/server/src/search.dto.ts:12 and the denial test.' }],
        }),
      ],
    }),
  );
  assert.equal(real.admissible, true, JSON.stringify(real.findings));
});

test('NO SILENT DISAPPEARANCE: resolving the thread without a disposition keeps the finding blocking', () => {
  const v = evaluateAiReview(snap({ threads: [thread(HIGH_FINDING, { resolved: true })] }));
  assert.equal(v.reason, GATE_REASONS.UNDISPOSITIONED);
  assert.equal(v.findings[0].thread_resolved, true);
});

test('NO SILENT DISAPPEARANCE: a later summary-only review does not clear an open finding', () => {
  const v = evaluateAiReview(snap({ reviews: [review({ id: 2, body: '## Copilot review overview\n### No open findings' })], threads: [thread(HIGH_FINDING)] }));
  assert.equal(v.reason, GATE_REASONS.UNDISPOSITIONED);
});

test('dispositions are only accepted from authorized humans, as an anchored line', () => {
  const byBot = thread(HIGH_FINDING, { replies: [{ author: ACTIONS, body: `KF-DISPOSITION: REJECTED_WITH_EVIDENCE ${'x'.repeat(80)}` }] });
  assert.equal(evaluateAiReview(snap({ threads: [byBot] })).reason, GATE_REASONS.UNDISPOSITIONED);
  const byStranger = thread(HIGH_FINDING, { replies: [{ author: { login: 'drive-by', type: 'User', id: 'U_x' }, body: `KF-DISPOSITION: REJECTED_WITH_EVIDENCE ${'x'.repeat(80)}` }] });
  assert.equal(evaluateAiReview(snap({ threads: [byStranger] })).reason, GATE_REASONS.UNDISPOSITIONED);
  assert.equal(parseDisposition('we could write KF-DISPOSITION: RESOLVED fixed_in=' + FIX + ' later'), null);
});

test('the newest disposition wins', () => {
  const t = thread(HIGH_FINDING, {
    replies: [
      { body: `KF-DISPOSITION: REJECTED_WITH_EVIDENCE ${'evidence '.repeat(10)}` },
      { body: 'KF-DISPOSITION: RESOLVED fixed_in=deadbeef' },
    ],
  });
  assert.equal(evaluateAiReview(snap({ threads: [t] })).reason, GATE_REASONS.UNDISPOSITIONED, 'a newer invalid disposition supersedes an older valid one');
});

// -------------------------------------------------------------- high risk

test('auth / payment / data-deletion fixtures are surfaced as high-risk', () => {
  const surfaces = classifyHighRisk([
    { filename: 'apps/server/src/modules/auth/auth.guard.ts', patch: '+ canActivate' },
    { filename: 'apps/server/src/modules/commerce/payments/payment.service.ts', patch: '+ charge()' },
    { filename: 'apps/server/src/modules/crm/contacts.service.ts', patch: '+    await this.prisma.contact.deleteMany({ where: { businessId } });' },
    { filename: 'packages/db/prisma/migrations/20260926_x/migration.sql', patch: '+ALTER TABLE "Order" DROP COLUMN "total";' },
    { filename: 'apps/server/src/modules/billing/refund.controller.ts', patch: '+ refund' },
  ]).map((s) => s.surface);
  for (const s of ['auth', 'payments', 'data deletion', 'destructive migrations', 'billing', 'refunds']) assert.ok(surfaces.includes(s), `${s} in ${surfaces}`);
});

test('a non-destructive migration is not flagged destructive, and a plain UI change is not high-risk', () => {
  const additive = classifyHighRisk([{ filename: 'packages/db/prisma/migrations/1/migration.sql', patch: '+ALTER TABLE "Order" ADD COLUMN "note" TEXT;' }]).map((s) => s.surface);
  assert.ok(!additive.includes('destructive migrations'));
  assert.deepEqual(classifyHighRisk([{ filename: 'apps/web/src/components/button.tsx', patch: '+x' }]), []);
});

test('control-plane authority changes (this packet) are high-risk, and a truncated file list is never low-risk', () => {
  const s = classifyHighRisk([{ filename: '.github/workflows/ai-review-gate.yml' }, { filename: '.github/copilot-instructions.md' }]).map((x) => x.surface);
  assert.ok(s.includes('deployment/control-plane authority'));
  assert.ok(classifyHighRisk([], { truncated: true }).length > 0);
});

// ----------------------------------------------------------------- ledger

test('the ledger is exact-head attributable and lists every finding with its disposition', () => {
  const v = evaluateAiReview(snap({ threads: [thread(HIGH_FINDING), thread('KF-SEVERITY: STYLE nit', { id: 4100000050 })], files: [{ filename: 'apps/server/src/modules/auth/jwt.strategy.ts' }] }));
  const md = renderLedger(v, { prNumber: 101, runUrl: 'https://example/run/1' });
  assert.ok(md.startsWith(ledgerMarker(HEAD)), 'marker keyed by head sha comes first');
  assert.match(md, /BLOCKED/);
  assert.match(md, /F-4100000001 \| copilot-pull-request-reviewer \| HIGH .* \| YES/);
  assert.match(md, /F-4100000050 .* STYLE .* \| no/);
  assert.match(md, /auth: `apps\/server\/src\/modules\/auth\/jwt.strategy.ts`/);
  assert.match(md, /never accepted as review evidence/);
});

// -------------------------------------------------------- request / storm

const REQ = { action: 'synchronize', draft: false, before: OLD, after: HEAD, trees_equal: false, compare: { status: 'ahead', files: ['apps/server/src/x.ts'] }, existing_markers: [] };

test('a semantic push requests exactly one fresh Codex review for the new head', () => {
  assert.deepEqual(decideReviewRequest(REQ).request, true);
  assert.equal(decideReviewRequest({ ...REQ, existing_markers: [HEAD] }).reason, 'already_requested_for_head');
});

test('NO STORM: no-op and control-only updates request nothing', () => {
  assert.equal(decideReviewRequest({ ...REQ, trees_equal: true }).request, false, 'same-tree force push');
  assert.equal(decideReviewRequest({ ...REQ, compare: { status: 'ahead', files: ['.agent-control/claude-return.yaml'] } }).request, false);
  assert.equal(decideReviewRequest({ ...REQ, draft: true }).request, false, 'drafts are reviewed on ready');
});

test('open and draft->ready rely on the native triggers; a rewritten history is reviewed', () => {
  for (const action of ['opened', 'ready_for_review', 'reopened']) assert.equal(decideReviewRequest({ ...REQ, action }).reason, 'native_trigger_covers_event');
  assert.equal(decideReviewRequest({ ...REQ, compare: { status: 'diverged', files: [] } }).request, true);
  assert.equal(decideReviewRequest({ ...REQ, compare: null }).request, true);
});

// --------------------------------------------------- workflow + instructions

test('the gate re-evaluates on open, ready, push, review and reply; the verdict job is read-only', () => {
  const wf = fs.readFileSync('.github/workflows/ai-review-gate.yml', 'utf8');
  assert.match(wf, /types:\s*\[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(wf, /pull_request_review:\s*\n\s*types:\s*\[submitted, edited, dismissed\]/);
  assert.match(wf, /pull_request_review_comment:/);
  const verdictJob = wf.slice(wf.indexOf('\n  verdict:'), wf.indexOf('\n  ledger:'));
  assert.ok(verdictJob.length > 200, 'verdict job located');
  assert.match(verdictJob, /pull-requests:\s*read/);
  assert.ok(!/:\s*write/.test(verdictJob), 'verdict job must hold no write permission');
  assert.match(verdictJob, /ref:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/, 'evaluator comes from the trusted base');
  assert.match(verdictJob, /EXPECTED_HEAD_SHA:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
});

test('the request workflow only fires on synchronize, never for drafts or forks', () => {
  const wf = fs.readFileSync('.github/workflows/ai-review-request.yml', 'utf8');
  assert.match(wf, /types:\s*\[synchronize\]/);
  assert.match(wf, /draft == false/);
  assert.match(wf, /head\.repo\.full_name == github\.repository/);
  assert.ok(!/pull_request_target/.test(wf));
});

// Copilot code review reads only the first 4,000 characters of an instruction file.
const COPILOT_WINDOW = 4000;

test('merge-critical reviewer policy is in the Copilot repository-wide file, inside its read window', () => {
  const text = fs.readFileSync('.github/copilot-instructions.md', 'utf8');
  const boundary = text.indexOf('<!-- Keep everything above within 4000 characters');
  assert.ok(boundary > 0 && boundary <= COPILOT_WINDOW, `merge-critical section must end inside the window (ends at ${boundary})`);
  const window = text.slice(0, COPILOT_WINDOW);
  for (const needle of ['KF-SEVERITY', 'STYLE', 'N+1', 'SQL injection', 'tenan', 'idempot', 'race', 'business', 'edge case', 'secret', 'destructive', 'contract', 'control-plane']) {
    assert.ok(window.toLowerCase().includes(needle.toLowerCase()), `"${needle}" must be inside the first ${COPILOT_WINDOW} chars`);
  }
  assert.ok(!/canonical live programme state/i.test(text), 'programme-state is a derived projection, not canonical authority');
  assert.ok(!fs.existsSync('.github/instructions'), 'path-specific files are not consumed by Copilot code review; do not reintroduce them');
});

test('Codex review guidelines in AGENTS.md carry the same priorities', () => {
  const text = fs.readFileSync('AGENTS.md', 'utf8');
  const section = text.slice(text.indexOf('## Review guidelines'));
  assert.ok(text.includes('## Review guidelines'));
  for (const needle of ['P0', 'P1', 'N+1', 'SQL injection', 'tenan', 'idempot', 'style']) {
    assert.ok(section.toLowerCase().includes(needle.toLowerCase()), `AGENTS.md review guidelines must mention ${needle}`);
  }
});
