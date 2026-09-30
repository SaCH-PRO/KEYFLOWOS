/**
 * SEMANTIC-REVIEW — the provider-neutral independent semantic-review contract.
 * (KF-META-AI-REVIEW-FAILOVER-001; CG-DECISION-META-AI-REVIEW-FAILOVER-001,
 * option A; CG-REVIEW-META-AI-REVIEW-FAILOVER-CONTINUE-001)
 *
 * Admission needs an independent semantic review of the exact admitted
 * semantics. Which reviewer supplies it is a matter of availability, not of
 * contract:
 *   - copilot is the preferred reviewer. Its identity is the GitHub bot account.
 *   - chatgpt is the one approved fallback. It may satisfy the obligation only
 *     when the record shows the primary reviewer as NOT_RUN for a machine
 *     reason, such as exhausted capacity.
 * No other provider is approved.
 *
 * The record is the `semantic_review` block of claude-return.yaml. ChatGPT
 * writes it at admission, next to review_status:
 *
 *   semantic_review:
 *     implementer: claude
 *     reviews:
 *       - provider: copilot
 *         reviewer: copilot-pull-request-reviewer[bot]
 *         reviewed_head: <40-hex>
 *         outcome: NOT_RUN
 *         reason: capacity_exhausted
 *         unresolved_substantive_findings: []
 *         dispositioned_findings: []    # copilot PASS only; see below
 *         evidence_location: <PR review URL>
 *       - provider: chatgpt
 *         reviewer: chatgpt
 *         reviewed_head: <40-hex>
 *         outcome: PASS
 *         reason: null
 *         unresolved_substantive_findings: []
 *         evidence_location: <issue #80 REVIEW comment URL>
 *
 * The record alone proves nothing, because anyone can write a file. Each
 * entry must match live evidence that the admission path fetches:
 *   - copilot: a review by the bot on the PR at commit_id == reviewed_head. A
 *     bot review saying it was unable to review is NOT_RUN evidence, never PASS.
 *     A review that ran is not a pass either: on PR 103 the bot reviewed the
 *     semantic head and recommended changes with one finding. So a recorded
 *     copilot PASS must list dispositioned_findings explicitly, with at least
 *     as many entries as the live review reports findings.
 *   - chatgpt: the #80 comment at evidence_location. It must be an unedited
 *     AUTHORITY-profile REVIEW from sender chatgpt by an authorized author,
 *     whose one-line reviewed_head, semantic_review_outcome and
 *     unresolved_substantive_findings fields agree with the entry.
 *
 * reviewed_head must carry exactly the admitted semantics. That is the
 * packet's source_head, the PR head (admission proves its tail after
 * source_head is control-only), or a commit between them that the caller has
 * proved, in `lineage`, descends from source_head, is an ancestor of the PR
 * head, and differs from source_head only under .agent-control/. A reviewer
 * normally reviews the pre-RETURN artifact commit, and the admission commit
 * that records the review then becomes the PR head. Any other commit is stale.
 *
 * It fails closed on:
 *   - missing evidence or missing identities;
 *   - self-review, where the reviewer or provider is the implementer;
 *   - one provider presenting as another;
 *   - NOT_RUN without a machine reason, or NOT_RUN used as PASS;
 *   - a stale or wrong head;
 *   - contradictory entries (two outcomes for one provider at one head, or
 *     PASS beside CHANGES_REQUIRED from one provider), or a record that live
 *     evidence contradicts;
 *   - Copilot findings that the record does not show as dispositioned;
 *   - CHANGES_REQUIRED, or any unresolved substantive finding;
 *   - a fallback PASS without primary-unavailable evidence.
 *
 * Pure: the caller fetches the live evidence; this module only judges it.
 */

import {
  PROFILES,
  normalizeComment,
  parseEnvelope,
  envelopeField,
  validateEnvelope,
  rejectionOf,
} from './control-envelope.mjs';

export const PRIMARY_PROVIDER = 'copilot';
export const FALLBACK_PROVIDER = 'chatgpt';

/** Approved providers and the one identity each may review under. */
export const REVIEW_PROVIDERS = Object.freeze({
  copilot: Object.freeze({ reviewer: 'copilot-pull-request-reviewer[bot]', role: 'primary' }),
  chatgpt: Object.freeze({ reviewer: 'chatgpt', role: 'fallback' }),
});

export const REVIEW_OUTCOMES = Object.freeze(['PASS', 'NOT_RUN', 'CHANGES_REQUIRED']);

/** Why a reviewer did not run. Only these make a fallback legitimate. */
export const NOT_RUN_REASONS = Object.freeze(['capacity_exhausted', 'quota_exhausted', 'service_unavailable']);

/** The body GitHub's Copilot bot posts when it could not review. */
export const COPILOT_UNAVAILABLE = /\bunable to review\b/i;

/**
 * Machine-verifiable primary-unavailable reasons.
 *
 * The artifact never gets to choose one of these by declaration alone. The
 * reason is derived from the cited live Copilot review body and then compared
 * with the recorded reason. Unknown "unable to review" prose fails closed and
 * does not authorize fallback.
 */
const COPILOT_NOT_RUN_REASON_PATTERNS = Object.freeze([
  Object.freeze({ reason: 'quota_exhausted', pattern: /\b(?:reached|exceeded|hit)?\s*(?:their\s+|the\s+)?quota(?:\s+limit)?\b|\bquota\s+(?:is\s+)?exhausted\b/i }),
  Object.freeze({ reason: 'capacity_exhausted', pattern: /\bcapacity\b|\bresource(?:s)?\s+exhausted\b/i }),
  Object.freeze({ reason: 'service_unavailable', pattern: /\bservice\s+unavailable\b|\btemporar(?:y|ily)\s+unavailable\b|\btry\s+again\s+later\b/i }),
]);

function copilotNotRunReason(body) {
  if (!COPILOT_UNAVAILABLE.test(body)) return null;
  for (const candidate of COPILOT_NOT_RUN_REASON_PATTERNS) {
    if (candidate.pattern.test(body)) return candidate.reason;
  }
  return null;
}

/** The finding count in a Copilot review overview ("**Findings:** 1"). */
const COPILOT_FINDINGS = /\*\*Findings:\*\*\s*(\d+)/i;

export const SEMANTIC_REVIEW_REASONS = Object.freeze({
  RECORD_MISSING: 'semantic_review_missing',
  IMPLEMENTER_MISSING: 'implementer_identity_missing',
  NO_REVIEWS: 'no_review_entries',
  PROVIDER_NOT_APPROVED: 'provider_not_approved',
  REVIEWER_IDENTITY_MISSING: 'reviewer_identity_missing',
  SELF_REVIEW: 'self_review',
  REVIEWER_IDENTITY_MISMATCH: 'reviewer_identity_does_not_match_provider',
  OUTCOME_INVALID: 'outcome_not_recognised',
  NOT_RUN_WITHOUT_REASON: 'not_run_without_machine_reason',
  REVIEWED_HEAD_MISSING: 'reviewed_head_missing',
  WRONG_HEAD: 'reviewed_head_is_not_the_admitted_semantics',
  EVIDENCE_LOCATION_MISSING: 'evidence_location_missing',
  FINDINGS_NOT_EXPLICIT: 'unresolved_findings_not_explicit',
  UNDISPOSITIONED_FINDINGS: 'reviewer_findings_not_dispositioned',
  UNRESOLVED_FINDINGS: 'unresolved_substantive_findings',
  CONTRADICTORY: 'contradictory_review_evidence',
  CHANGES_REQUIRED: 'changes_required',
  NO_PASS: 'no_independent_pass',
  FALLBACK_WITHOUT_PRIMARY_UNAVAILABLE: 'fallback_without_primary_unavailable_evidence',
  LIVE_EVIDENCE_MISSING: 'live_evidence_missing',
  LIVE_EVIDENCE_CONTRADICTS: 'live_evidence_contradicts_record',
  SATISFIED: 'independent_semantic_review_satisfied',
});

const R = SEMANTIC_REVIEW_REASONS;
const SHA = /^[0-9a-f]{40}$/;

const identity = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

function fail(reason, detail) {
  return { satisfied: false, reason, detail: detail ?? null };
}

/**
 * One live Copilot review from a GitHub PR review (REST shape). Returns null
 * for reviews by anyone else, so the caller can pass the whole list.
 */
export function copilotReviewEvidence(review) {
  const login = review?.user?.login;
  if (identity(login) !== REVIEW_PROVIDERS.copilot.reviewer || review?.user?.type !== 'Bot') return null;
  const body = String(review.body || '');
  const findings = body.match(COPILOT_FINDINGS);
  const status = COPILOT_UNAVAILABLE.test(body) ? 'NOT_RUN' : 'REVIEWED';
  return {
    commit_id: review.commit_id ?? null,
    status,
    reason: status === 'NOT_RUN' ? copilotNotRunReason(body) : null,
    findings: findings ? Number(findings[1]) : null,
    url: review.html_url ?? null,
  };
}

/**
 * One live ChatGPT review from an issue #80 comment, REST or `gh` shape.
 * `valid` is false, with the problems listed, unless the comment could carry
 * review authority at all.
 */
export function chatgptReviewEvidence(comment) {
  const c = normalizeComment(comment);
  const env = parseEnvelope(c.body);
  const problems = [...validateEnvelope(env, PROFILES.AUTHORITY)];
  const rejected = rejectionOf(env, c.author);
  if (rejected) problems.push(rejected);
  if (envelopeField(env, 'message_type') !== 'REVIEW') problems.push('message_type (not REVIEW)');
  if (c.edited !== false) problems.push(c.edited ? 'edited' : 'edit state unknown');
  const findings = envelopeField(env, 'unresolved_substantive_findings');
  return {
    // REST issue comments expose both an API `url` and browser `html_url`.
    // evidence_location is the canonical browser comment URL, so prefer
    // html_url when the raw shape provides it; gh-shaped comments already
    // expose the browser URL as `url` through normalizeComment().
    url: comment?.html_url ?? c.url,
    valid: problems.length === 0,
    problems,
    reviewed_head: envelopeField(env, 'reviewed_head'),
    outcome: envelopeField(env, 'semantic_review_outcome'),
    unresolved_substantive_findings: findings !== null && /^\d+$/.test(findings) ? Number(findings) : null,
  };
}

/** Whether a reviewed commit carries exactly the admitted semantics. */
function carriesAdmittedSemantics(sha, { source_head, pr_head, lineage }) {
  if (sha === source_head || sha === pr_head) return true;
  const proof = lineage && Object.hasOwn(lineage, sha) ? lineage[sha] : null;
  return Boolean(
    proof &&
      proof.descends_from_source_head === true &&
      proof.ancestor_of_pr_head === true &&
      Array.isArray(proof.non_control_files) &&
      proof.non_control_files.length === 0,
  );
}

/** Problems of one entry on its own, or null when it is well formed. */
function entryProblem(entry, implementer, heads) {
  const provider = identity(entry?.provider);
  if (!Object.hasOwn(REVIEW_PROVIDERS, provider)) return fail(R.PROVIDER_NOT_APPROVED, entry?.provider ?? null);
  const reviewer = identity(entry.reviewer);
  if (!reviewer) return fail(R.REVIEWER_IDENTITY_MISSING, provider);
  if (reviewer === implementer || provider === implementer) {
    return fail(R.SELF_REVIEW, { provider, reviewer, implementer });
  }
  if (reviewer !== REVIEW_PROVIDERS[provider].reviewer) {
    return fail(R.REVIEWER_IDENTITY_MISMATCH, { provider, reviewer, expected: REVIEW_PROVIDERS[provider].reviewer });
  }
  if (!REVIEW_OUTCOMES.includes(entry.outcome)) return fail(R.OUTCOME_INVALID, { provider, outcome: entry.outcome ?? null });
  if (entry.outcome === 'NOT_RUN' && !NOT_RUN_REASONS.includes(entry.reason)) {
    return fail(R.NOT_RUN_WITHOUT_REASON, { provider, reason: entry.reason ?? null });
  }
  if (!SHA.test(String(entry.reviewed_head || ''))) return fail(R.REVIEWED_HEAD_MISSING, provider);
  if (!carriesAdmittedSemantics(entry.reviewed_head, heads)) {
    return fail(R.WRONG_HEAD, {
      provider,
      reviewed_head: entry.reviewed_head,
      source_head: heads.source_head ?? null,
      pr_head: heads.pr_head ?? null,
      lineage: heads.lineage?.[entry.reviewed_head] ?? null,
    });
  }
  if (typeof entry.evidence_location !== 'string' || !entry.evidence_location.trim()) {
    return fail(R.EVIDENCE_LOCATION_MISSING, provider);
  }
  if (!Array.isArray(entry.unresolved_substantive_findings)) return fail(R.FINDINGS_NOT_EXPLICIT, provider);
  if (entry.unresolved_substantive_findings.length) {
    return fail(R.UNRESOLVED_FINDINGS, { provider, findings: entry.unresolved_substantive_findings });
  }
  if (provider === PRIMARY_PROVIDER && entry.outcome === 'PASS' && !Array.isArray(entry.dispositioned_findings)) {
    return fail(R.UNDISPOSITIONED_FINDINGS, { provider, dispositioned_findings: entry.dispositioned_findings ?? null });
  }
  return null;
}

/** Whether live evidence confirms one recorded entry; null when it does. */
function liveProblem(entry, live) {
  const provider = identity(entry.provider);
  if (provider === 'copilot') {
    const atHead = (live.copilot || []).filter((r) => r && r.commit_id === entry.reviewed_head);
    const cited = atHead.filter((r) => r.url === entry.evidence_location);
    if (!cited.length) {
      return fail(R.LIVE_EVIDENCE_MISSING, {
        provider,
        reviewed_head: entry.reviewed_head,
        evidence_location: entry.evidence_location,
      });
    }

    const reviewedAtHead = atHead.some((r) => r.status === 'REVIEWED');
    const citedReviewed = cited.filter((r) => r.status === 'REVIEWED');
    const citedNotRun = cited.filter((r) => r.status === 'NOT_RUN');

    if (entry.outcome === 'PASS') {
      if (!citedReviewed.length) {
        const liveStatus = citedNotRun.length ? 'NOT_RUN' : 'UNKNOWN';
        return fail(R.LIVE_EVIDENCE_CONTRADICTS, { provider, recorded: 'PASS', live: liveStatus });
      }
      if (citedReviewed.some((r) => !Number.isInteger(r.findings) || r.findings < 0)) {
        return fail(R.LIVE_EVIDENCE_CONTRADICTS, {
          provider,
          evidence_location: entry.evidence_location,
          live: 'UNPARSEABLE_FINDINGS',
        });
      }
      const reported = Math.max(...citedReviewed.map((r) => r.findings));
      if (entry.dispositioned_findings.length < reported) {
        return fail(R.UNDISPOSITIONED_FINDINGS, { provider, reported, dispositioned: entry.dispositioned_findings.length });
      }
      return null;
    }

    if (entry.outcome === 'NOT_RUN') {
      // If Copilot actually reviewed the head, fallback cannot be authorized by
      // citing a separate unavailable review at the same head.
      if (reviewedAtHead) {
        return fail(R.LIVE_EVIDENCE_CONTRADICTS, { provider, recorded: 'NOT_RUN', live: 'REVIEWED' });
      }
      if (!citedNotRun.length) {
        return fail(R.LIVE_EVIDENCE_CONTRADICTS, { provider, recorded: 'NOT_RUN', live: 'UNKNOWN' });
      }
      const reasons = new Set(citedNotRun.map((r) => r.reason).filter(Boolean));
      if (!reasons.size) {
        return fail(R.LIVE_EVIDENCE_CONTRADICTS, {
          provider,
          recorded_reason: entry.reason,
          live_reason: null,
          evidence_location: entry.evidence_location,
        });
      }
      if (reasons.size !== 1 || !reasons.has(entry.reason)) {
        return fail(R.LIVE_EVIDENCE_CONTRADICTS, {
          provider,
          recorded_reason: entry.reason,
          live_reason: reasons.size === 1 ? [...reasons][0] : [...reasons],
          evidence_location: entry.evidence_location,
        });
      }
      return null;
    }

    return fail(R.LIVE_EVIDENCE_CONTRADICTS, { provider, recorded: entry.outcome, live: cited.map((r) => r.status) });
  }
  const matches = (live.chatgpt || []).filter((r) => r && r.url === entry.evidence_location);
  if (!matches.length) return fail(R.LIVE_EVIDENCE_MISSING, { provider, evidence_location: entry.evidence_location });
  for (const r of matches) {
    if (!r.valid) return fail(R.LIVE_EVIDENCE_CONTRADICTS, { provider, problems: r.problems });
    if (r.reviewed_head !== entry.reviewed_head || r.outcome !== entry.outcome) {
      return fail(R.LIVE_EVIDENCE_CONTRADICTS, {
        provider,
        recorded: { reviewed_head: entry.reviewed_head, outcome: entry.outcome },
        live: { reviewed_head: r.reviewed_head, outcome: r.outcome },
      });
    }
    if (r.unresolved_substantive_findings !== entry.unresolved_substantive_findings.length) {
      return fail(R.LIVE_EVIDENCE_CONTRADICTS, {
        provider,
        recorded_findings: entry.unresolved_substantive_findings.length,
        live_findings: r.unresolved_substantive_findings,
      });
    }
  }
  return null;
}

/**
 * @param {object} input
 *   record  the semantic_review block of claude-return.yaml
 *   source_head  the packet's semantic head
 *   pr_head  the PR head; its tail after source_head is control-only
 *   lineage  {[sha]: {descends_from_source_head, ancestor_of_pr_head, non_control_files}}
 *            for each reviewed_head that is neither source_head nor pr_head
 *   live  {copilot: copilotReviewEvidence[], chatgpt: chatgptReviewEvidence[]}
 * @returns {{satisfied: boolean, reason: string, detail: any, evidence?: object}}
 */
export function evaluateSemanticReview({ record, source_head, pr_head, lineage, live } = {}) {
  if (!record || typeof record !== 'object') return fail(R.RECORD_MISSING);
  const implementer = identity(record.implementer);
  if (!implementer) return fail(R.IMPLEMENTER_MISSING);
  const reviews = Array.isArray(record.reviews) ? record.reviews : [];
  if (!reviews.length) return fail(R.NO_REVIEWS);

  const heads = {
    source_head: SHA.test(String(source_head || '')) ? source_head : undefined,
    pr_head: SHA.test(String(pr_head || '')) ? pr_head : undefined,
    lineage,
  };
  for (const entry of reviews) {
    const problem = entryProblem(entry, implementer, heads);
    if (problem) return problem;
  }

  // One provider may truthfully differ across heads: on PR 103 Copilot
  // reviewed the semantic head, then hit its quota on the artifact commit. It
  // may not give two outcomes for one head, or pass and reject the same change.
  const byHead = new Map();
  const byProvider = new Map();
  for (const entry of reviews) {
    const provider = identity(entry.provider);
    const key = `${provider}@${entry.reviewed_head}`;
    if (!byHead.has(key)) byHead.set(key, new Set());
    byHead.get(key).add(entry.outcome);
    if (!byProvider.has(provider)) byProvider.set(provider, new Set());
    byProvider.get(provider).add(entry.outcome);
  }
  for (const [key, outcomes] of byHead) {
    if (outcomes.size > 1) return fail(R.CONTRADICTORY, { at: key, outcomes: [...outcomes] });
  }
  for (const [provider, outcomes] of byProvider) {
    if (outcomes.has('PASS') && outcomes.has('CHANGES_REQUIRED')) {
      return fail(R.CONTRADICTORY, { provider, outcomes: [...outcomes] });
    }
  }
  if (reviews.some((e) => e.outcome === 'CHANGES_REQUIRED')) {
    return fail(R.CHANGES_REQUIRED, reviews.filter((e) => e.outcome === 'CHANGES_REQUIRED').map((e) => identity(e.provider)));
  }

  const passing = reviews.filter((e) => e.outcome === 'PASS');
  if (!passing.length) return fail(R.NO_PASS);
  const primaryPassed = passing.some((e) => identity(e.provider) === PRIMARY_PROVIDER);
  const primaryNotRun = reviews.some((e) => identity(e.provider) === PRIMARY_PROVIDER && e.outcome === 'NOT_RUN');
  if (!primaryPassed && !primaryNotRun) {
    return fail(R.FALLBACK_WITHOUT_PRIMARY_UNAVAILABLE, passing.map((e) => identity(e.provider)));
  }

  if (!live || typeof live !== 'object') return fail(R.LIVE_EVIDENCE_MISSING, 'no live evidence supplied');
  for (const entry of reviews) {
    const problem = liveProblem(entry, live);
    if (problem) return problem;
  }

  return {
    satisfied: true,
    reason: R.SATISFIED,
    detail: null,
    evidence: {
      implementer,
      primary: primaryPassed ? 'PASS' : 'NOT_RUN',
      passing: passing.map((e) => ({
        provider: identity(e.provider),
        reviewer: identity(e.reviewer),
        reviewed_head: e.reviewed_head,
        evidence_location: e.evidence_location,
      })),
    },
  };
}

export default {
  evaluateSemanticReview,
  copilotReviewEvidence,
  chatgptReviewEvidence,
  REVIEW_PROVIDERS,
  REVIEW_OUTCOMES,
  NOT_RUN_REASONS,
  SEMANTIC_REVIEW_REASONS,
  PRIMARY_PROVIDER,
  FALLBACK_PROVIDER,
};
