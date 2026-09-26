/**
 * AI REVIEW GATE — exact-head AI review admission evaluator (KF-AI-PR-REVIEW-GATE-001).
 *
 * Pure functions over a recorded snapshot, like admission.mjs, so every verdict
 * is reproducible from evidence and testable without the network.
 *
 * The gate answers one question: does the CURRENT semantic head of this PR
 * carry a completed, machine-attributable AI review, with every substantive
 * AI finding dispositioned? It never approves anything itself, it never
 * accepts prose as a review, and anything it cannot prove fails closed.
 *
 * Evidence model:
 *   - a review counts only if its author is a pinned reviewer bot (login AND
 *     node id AND actor type Bot). github-actions and every human are refused,
 *     so neither a workflow comment nor a pasted "LGTM from Copilot" can pass.
 *   - a review is current only if its commit IS the head, or is an ancestor
 *     whose diff to the head touches .agent-control/** only (the repository's
 *     semantic-head rule). Any other push makes it stale.
 *   - every inline thread opened by a reviewer bot is a finding. It clears only
 *     through a KF-DISPOSITION reply by an authorized dispositioner. Resolving
 *     the thread in the UI is recorded but never clears it on its own.
 */

/** Workflow name admission requires at the exact head (see admission.mjs). */
export const AI_REVIEW_GATE_WORKFLOW = 'AI Review Gate';

/**
 * Reviewer bots, pinned by GraphQL node id as well as login. A login can in
 * principle be registered by a User; a Bot node id cannot be forged.
 */
export const REVIEWERS = Object.freeze({
  'copilot-pull-request-reviewer': Object.freeze({ id: 'BOT_kgDOCnlnWA', name: 'GitHub Copilot code review' }),
  'chatgpt-codex-connector': Object.freeze({ id: 'BOT_kgDOC98s_g', name: 'OpenAI Codex' }),
});

/**
 * Reviewers that MUST have a current review. Copilot is the only reviewer
 * that is both requested on every push (ruleset "KEYFLOWOS Copilot Review")
 * and leaves an attributable review when it finds nothing. Codex findings
 * still block; a clean Codex pass is only a reaction, which carries no SHA.
 */
export const REQUIRED_REVIEWERS = Object.freeze(['copilot-pull-request-reviewer']);

/** Humans who may record a finding disposition (same allowlist as #80 authority). */
export const DISPOSITIONERS = Object.freeze(['SaCH-PRO']);

/** Commits after a review that touch only these paths do not invalidate it. */
export const CONTROL_ONLY_PREFIX = '.agent-control/';

export const SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNCLASSIFIED', 'STYLE']);
/** STYLE is the only severity that cannot block admission on its own. */
export const NON_BLOCKING_SEVERITIES = Object.freeze(['STYLE']);
const RANK = { STYLE: 0, LOW: 1, UNCLASSIFIED: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };

export const GATE_REASONS = Object.freeze({
  PR_NOT_OPEN: 'pr_not_open',
  HEAD_MOVED: 'head_moved_during_evaluation',
  EVIDENCE_TAMPERED: 'finding_register_edited',
  EVIDENCE_INCOMPLETE: 'review_evidence_incomplete',
  REVIEW_MISSING: 'required_ai_review_missing',
  REVIEW_STALE: 'ai_review_not_at_semantic_head',
  UNDISPOSITIONED: 'undispositioned_substantive_findings',
  ADMISSIBLE: 'current_head_ai_review_admissible',
});

const SHA = /^[0-9a-f]{40}$/;

/** Bodies that record a reviewer failing rather than reviewing. */
const UNAVAILABLE_BODY =
  /encountered an error|wasn['’]?t able to review|was not able to review|unable to review|could not review|couldn['’]?t review|review (was )?skipped|usage limit|rate limit|try again later/i;

export function normalizeLogin(login) {
  return String(login || '').replace(/\[bot\]$/i, '').trim().toLowerCase();
}

/**
 * The pinned reviewer an actor is, or null. Identity is the node id plus actor
 * type Bot; the login is not trusted (REST even reports Copilot's inline
 * comments as login "Copilot").
 */
export function reviewerName(author) {
  if (!author || author.type !== 'Bot') return null;
  const hit = Object.entries(REVIEWERS).find(([, pinned]) => author.id === pinned.id);
  return hit ? hit[0] : null;
}

/** True only for a pinned reviewer bot. */
export function isReviewerBot(author) {
  return reviewerName(author) !== null;
}

/**
 * A review or comment edited by anyone other than its author is no longer the
 * author's statement (a repository writer can edit any comment).
 */
export function editedByOther(item) {
  return Boolean(item?.editor) && String(item.editor.id) !== String(item.author?.id);
}

/**
 * The gate's own writer (GITHUB_TOKEN), pinned like the reviewers. Its
 * register reviews are the gate's durable finding memory; it is never a reviewer.
 */
export const GATE_WRITER = Object.freeze({ login: 'github-actions', id: 'MDM6Qm90NDE4OTgyODI=' });

export function isGateWriter(author) {
  return Boolean(author && author.type === 'Bot' && author.id === GATE_WRITER.id);
}

export function isDispositioner(author) {
  if (!author || author.type !== 'User') return false;
  return DISPOSITIONERS.includes(String(author.login || ''));
}

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

function maxSeverity(a, b) {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/** Severity the reviewer stated inside its own inline comment, or null. */
export function severityFromComment(body) {
  const text = String(body || '');
  let found = null;
  for (const m of text.matchAll(/KF-SEVERITY:\s*\**\s*(CRITICAL|HIGH|MEDIUM|LOW|STYLE)\b/gi)) {
    found = maxSeverity(found, m[1].toUpperCase());
  }
  // Codex priority badges.
  for (const m of text.matchAll(/!\[P([0-3]) Badge\]/g)) {
    found = maxSeverity(found, ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'][Number(m[1])]);
  }
  return found;
}

/**
 * Severity per discussion id from a reviewer's own review overview, e.g.
 *   <img ... alt="High severity" ...></picture> [title](#discussion_r4111814409)
 */
export function severitiesFromOverview(body) {
  const out = new Map();
  for (const line of String(body || '').split('\n')) {
    const sev = line.match(/alt="(Critical|High|Medium|Low) severity"/i);
    if (!sev) continue;
    for (const m of line.matchAll(/\(#discussion_r(\d+)\)/g)) {
      out.set(m[1], maxSeverity(out.get(m[1]) || null, sev[1].toUpperCase()));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------

export const MIN_EVIDENCE_CHARS = 40;

/**
 * Parse a KF-DISPOSITION line. Anchored to line start so a quoted mention in
 * prose ("we should not write KF-DISPOSITION: RESOLVED here") cannot count.
 */
export function parseDisposition(body) {
  const text = String(body || '');
  const m = text.match(/^KF-DISPOSITION:[ \t]*(RESOLVED|REJECTED_WITH_EVIDENCE)\b([^\n]*)$/m);
  if (!m) return null;
  const state = m[1];
  const finding = (m[2].match(/\bfinding=(F-\d+)\b/) || [])[1] || null;
  if (state === 'RESOLVED') {
    const fixed = m[2].match(/\bfixed_in=([0-9a-fA-F]+)\b/);
    return { state, finding, fixed_in: fixed ? fixed[1].toLowerCase() : null };
  }
  // Evidence may follow on the same line or on the lines after it; the
  // finding= reference is an address, not evidence.
  const sameLine = m[2].replace(/\bfinding=F-\d+\b/, '');
  const rest = text.slice(0, m.index) + '\n' + sameLine + '\n' + text.slice(m.index + m[0].length);
  return { state, finding, evidence: rest.replace(/\s+/g, ' ').trim() };
}

// ---------------------------------------------------------------------------
// High-risk surfaces
// ---------------------------------------------------------------------------

export const HIGH_RISK_RULES = Object.freeze([
  { surface: 'auth', path: /(^|\/)(auth|authn|authz|guards?|passport|jwt|oauth|sessions?|login|mfa|otp)([\/._-]|$)/i },
  { surface: 'authorization', path: /(permission|rbac|roles?[\/._-]|polic(y|ies)|authori[sz]|access-?control|effective-authority)/i },
  { surface: 'tenancy', path: /(tenan|membership|business-?scope|scoped-?prisma|isolation)/i },
  { surface: 'payments', path: /(payment|stripe|checkout|payout|wallet|charge|ledger|money)/i },
  { surface: 'billing', path: /(billing|invoice|subscription|pricing|plan-?limit)/i },
  { surface: 'refunds', path: /refund|chargeback|dispute/i },
  {
    surface: 'data deletion',
    path: /(delet|purge|erase|gdpr|retention|soft-?delete|cleanup)/i,
    patch: /^\+.*\b(deleteMany|\.delete\(|DELETE\s+FROM|TRUNCATE|hardDelete)\b/im,
  },
  {
    surface: 'destructive migrations',
    path: /(^|\/)migrations\/.*\.sql$|schema\.prisma$/i,
    patch: /^\+.*\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN\s+\S+\s+(SET\s+NOT\s+NULL|TYPE))\b/im,
    requirePatch: true,
  },
  {
    surface: 'production configuration',
    path: /^(docker-compose[^/]*\.ya?ml|infrastructure\/|scripts\/deploy|Dockerfile|[^/]*\.env(\.|$)|nginx|caddy|apps\/[^/]+\/Dockerfile)/i,
  },
  {
    surface: 'deployment/control-plane authority',
    path: /^(\.github\/(workflows\/|copilot-instructions\.md|branch-divergence)|scripts\/agent-control\/|\.agent-control\/|docs\/development\/(AGENT_|EXECUTION_CONTROL|KEYFLOWOS_PROGRAMME_DAG)|CLAUDE\.md$|AGENTS\.md$)/,
  },
  {
    surface: 'external provider side effects',
    path: /(twilio|sendgrid|resend|mailgun|openai|anthropic|livekit|webhook|provider|connector|integration|stripe|shopify|whatsapp|sms)/i,
  },
]);

/** Classify changed files into high-risk surfaces. Patch-sensitive rules need the patch. */
export function classifyHighRisk(files = [], { truncated = false } = {}) {
  const hits = new Map();
  for (const f of files) {
    const name = String(f.filename || '');
    for (const rule of HIGH_RISK_RULES) {
      const pathHit = rule.path.test(name);
      const patchHit = rule.patch ? rule.patch.test(String(f.patch || '')) : false;
      const hit = rule.requirePatch ? pathHit && (patchHit || f.patch == null) : pathHit || patchHit;
      if (!hit) continue;
      if (!hits.has(rule.surface)) hits.set(rule.surface, []);
      hits.get(rule.surface).push(name);
    }
  }
  const surfaces = [...hits.entries()].map(([surface, list]) => ({ surface, files: [...new Set(list)].sort() }));
  // An unread file list cannot be declared low-risk.
  if (truncated) surfaces.push({ surface: 'unclassified (file list truncated)', files: [] });
  return surfaces;
}

// ---------------------------------------------------------------------------
// Comparisons the evaluator needs (fetched by the caller, then passed back in)
// ---------------------------------------------------------------------------

const key = (from, to) => `${from}...${to}`;

function findingCommit(thread) {
  const first = (thread.comments || [])[0] || {};
  return first.original_commit_sha || first.commit_sha || null;
}

/** Every base...head comparison the verdict depends on. */
export function requiredComparisons(snapshot) {
  const head = snapshot.pr?.head_sha;
  const pairs = new Set();
  for (const r of snapshot.reviews || []) {
    if (isReviewerBot(r.author) && SHA.test(String(r.commit_sha)) && r.commit_sha !== head) pairs.add(key(r.commit_sha, head));
  }
  for (const t of snapshot.threads || []) {
    const first = (t.comments || [])[0];
    if (!first || !isReviewerBot(first.author)) continue;
    const origin = findingCommit(t);
    for (const c of (t.comments || []).slice(1)) {
      if (!isDispositioner(c.author)) continue;
      const d = parseDisposition(c.body);
      if (d?.state === 'RESOLVED' && d.fixed_in && SHA.test(d.fixed_in)) {
        if (origin) pairs.add(key(origin, d.fixed_in));
        if (d.fixed_in !== head) pairs.add(key(d.fixed_in, head));
      }
    }
  }
  return [...pairs].map((p) => {
    const [from, to] = p.split('...');
    return { from, to };
  });
}

/** Status of `to` relative to `from` ('ahead' | 'identical' | 'behind' | 'diverged' | null when unknown). */
function relation(comparisons, from, to) {
  if (from === to) return { status: 'identical', files: [] };
  return comparisons[key(from, to)] || null;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

function reviewCurrency(review, head, comparisons) {
  if (review.commit_sha === head) return { current: true, relation: 'exact_head' };
  const cmp = relation(comparisons, review.commit_sha, head);
  if (!cmp) return { current: false, relation: 'unproven' };
  if (cmp.status !== 'ahead') return { current: false, relation: `head_${cmp.status}` };
  const semantic = (cmp.files || []).filter((f) => !String(f).startsWith(CONTROL_ONLY_PREFIX));
  if (semantic.length) return { current: false, relation: 'semantic_change_since_review', files: semantic };
  return { current: true, relation: 'control_only_tail' };
}

function reviewUsable(review) {
  if (!['COMMENTED', 'APPROVED', 'CHANGES_REQUESTED'].includes(String(review.state))) {
    return `state_${String(review.state).toLowerCase()}`;
  }
  if (!SHA.test(String(review.commit_sha))) return 'no_reviewed_sha';
  if (UNAVAILABLE_BODY.test(String(review.body || ''))) return 'reviewer_unavailable';
  // Codex states the reviewed commit in prose too; disagreement is ambiguity.
  const stated = String(review.body || '').match(/Reviewed commit:\**\s*`([0-9a-f]{7,40})`/i);
  if (stated && !review.commit_sha.startsWith(stated[1].toLowerCase())) return 'reviewed_sha_ambiguous';
  return null;
}

function evaluateDisposition(thread, head, comparisons) {
  const origin = findingCommit(thread);
  const replies = (thread.comments || []).slice(1).filter((c) => isDispositioner(c.author));
  let latest = null;
  for (const c of replies) {
    const d = parseDisposition(c.body);
    if (!d) continue;
    if (!latest || new Date(c.created_at) >= new Date(latest.at)) latest = { ...d, by: c.author.login, at: c.created_at, comment_id: c.id };
  }
  if (!latest) return { state: 'NONE', valid: false, detail: 'no KF-DISPOSITION reply from an authorized dispositioner' };

  if (latest.state === 'REJECTED_WITH_EVIDENCE') {
    const ok = String(latest.evidence || '').length >= MIN_EVIDENCE_CHARS;
    return { ...latest, valid: ok, detail: ok ? null : `evidence shorter than ${MIN_EVIDENCE_CHARS} characters` };
  }

  // RESOLVED must name the fixing commit, which must follow the finding and be in the head's history.
  if (!latest.fixed_in || !SHA.test(latest.fixed_in)) {
    return { ...latest, valid: false, detail: 'RESOLVED requires fixed_in=<full 40-character sha>' };
  }
  if (!origin) return { ...latest, valid: false, detail: 'finding commit unknown' };
  const after = relation(comparisons, origin, latest.fixed_in);
  if (!after || after.status !== 'ahead') {
    return { ...latest, valid: false, detail: `fixed_in is not a descendant of the finding commit (${after ? after.status : 'unproven'})` };
  }
  const inHead = relation(comparisons, latest.fixed_in, head);
  if (!inHead || !['ahead', 'identical'].includes(inHead.status)) {
    return { ...latest, valid: false, detail: `fixed_in is not in the current head history (${inHead ? inHead.status : 'unproven'})` };
  }
  return { ...latest, valid: true, detail: null };
}

/** A deleted finding can only be dispositioned in the PR conversation, by id, with evidence. */
function evaluatePrLevelDisposition(findingId, comments) {
  let latest = null;
  for (const c of comments) {
    if (!isDispositioner(c.author)) continue;
    const d = parseDisposition(c.body);
    if (!d || d.finding !== findingId) continue;
    if (!latest || new Date(c.created_at) >= new Date(latest.at)) latest = { ...d, by: c.author.login, at: c.created_at };
  }
  if (!latest) return { state: 'DELETED', valid: false, detail: `finding deleted without a PR-level KF-DISPOSITION finding=${findingId}`, by: null, fixed_in: null };
  if (latest.state !== 'REJECTED_WITH_EVIDENCE') {
    return { state: latest.state, valid: false, detail: 'a deleted finding needs REJECTED_WITH_EVIDENCE (its thread history is gone)', by: latest.by, fixed_in: null };
  }
  const ok = String(latest.evidence || '').length >= MIN_EVIDENCE_CHARS;
  return { state: latest.state, valid: ok, detail: ok ? null : `evidence shorter than ${MIN_EVIDENCE_CHARS} characters`, by: latest.by, fixed_in: null };
}

/**
 * @param {object} snapshot
 *   recorded_findings: [{id, reviewer?, reviewer_author?, severity}] from earlier ledgers / deletion events
 *   pr_dispositions: [{author, body, created_at}] PR conversation comments
 *   pr: {number, state, draft, head_sha, base_sha}
 *   expected_head_sha: head the triggering event was about
 *   reviews: [{id, author:{login,type,id}, state, commit_sha, submitted_at, body}]
 *   threads: [{id, is_resolved, is_outdated, path, line,
 *              comments:[{id, author, body, commit_sha, original_commit_sha, created_at}]}]
 *   comparisons: {"from...to": {status, files}}
 *   files: [{filename, patch}], files_truncated: bool
 *   evidence_truncated: bool  (any paginated evidence left unread)
 */
export function evaluateAiReview(snapshot) {
  const { pr = {}, comparisons = {} } = snapshot;
  const head = String(pr.head_sha || '');
  const base = {
    head_sha: head || null,
    high_risk: classifyHighRisk(snapshot.files || [], { truncated: snapshot.files_truncated === true }),
  };
  const fail = (reason, detail, extra = {}) => ({ admissible: false, reason, detail: detail ?? null, ...base, ...extra });

  if (pr.state !== 'open') return fail(GATE_REASONS.PR_NOT_OPEN, pr.state ?? null);
  if (!SHA.test(head)) return fail(GATE_REASONS.EVIDENCE_INCOMPLETE, 'pr head sha unknown');
  if (snapshot.expected_head_sha && snapshot.expected_head_sha !== head) {
    return fail(GATE_REASONS.HEAD_MOVED, { expected: snapshot.expected_head_sha, live: head });
  }
  if (snapshot.evidence_truncated === true) return fail(GATE_REASONS.EVIDENCE_INCOMPLETE, 'paginated review evidence was not fully read');

  // --- reviews ---------------------------------------------------------------
  const reviews = [];
  const rejected = [];
  for (const r of snapshot.reviews || []) {
    if (!isReviewerBot(r.author)) {
      // Recorded so a spoof attempt is visible, never counted.
      if (r.author && /copilot|codex|review/i.test(String(r.author.login))) {
        rejected.push({ id: r.id, author: r.author.login, reason: 'not_a_pinned_reviewer_bot' });
      }
      continue;
    }
    const unusable = editedByOther(r) ? 'edited_by_non_reviewer' : reviewUsable(r);
    if (unusable) {
      rejected.push({ id: r.id, author: reviewerName(r.author), reason: unusable, commit_sha: r.commit_sha ?? null });
      continue;
    }
    reviews.push({ ...r, reviewer: reviewerName(r.author), ...reviewCurrency(r, head, comparisons) });
  }

  const current = reviews.filter((r) => r.current);
  const reviewEvidence = current.map((r) => ({
    reviewer: r.reviewer,
    review_id: r.id,
    reviewed_sha: r.commit_sha,
    relation: r.relation,
    submitted_at: r.submitted_at ?? null,
  }));
  const stale = reviews.filter((r) => !r.current).map((r) => ({ reviewer: r.reviewer, review_id: r.id, reviewed_sha: r.commit_sha, relation: r.relation }));

  // --- findings --------------------------------------------------------------
  const overview = new Map();
  for (const r of snapshot.reviews || []) {
    if (!isReviewerBot(r.author) || editedByOther(r)) continue;
    for (const [id, sev] of severitiesFromOverview(r.body)) overview.set(id, maxSeverity(overview.get(id) || null, sev));
  }

  const findings = [];
  for (const t of snapshot.threads || []) {
    const first = (t.comments || [])[0];
    if (!first || !isReviewerBot(first.author)) continue;
    // An edited finding is no longer the reviewer's own words: ignore its
    // severity tag (so it cannot be downgraded to STYLE) and keep it blocking.
    const tampered = editedByOther(first);
    const severity = tampered ? 'UNCLASSIFIED' : severityFromComment(first.body) || overview.get(String(first.id)) || 'UNCLASSIFIED';
    const disposition = evaluateDisposition(t, head, comparisons);
    const blocking = !NON_BLOCKING_SEVERITIES.includes(severity) && !disposition.valid;
    findings.push({
      id: `F-${first.id}`,
      reviewer: reviewerName(first.author),
      severity,
      path: t.path ?? null,
      line: t.line ?? null,
      commit_sha: findingCommit(t),
      thread_resolved: t.is_resolved === true,
      outdated: t.is_outdated === true,
      tampered,
      disposition: { state: disposition.state, valid: disposition.valid, detail: disposition.detail, by: disposition.by ?? null, fixed_in: disposition.fixed_in ?? null },
      blocking,
    });
  }

  // Findings recorded earlier that no longer exist were deleted. Deletion is
  // not a disposition: they block until a PR-level KF-DISPOSITION names them.
  // Sources, most durable first:
  //   - the gate's register REVIEWS (a submitted review cannot be deleted;
  //     an edit by anyone but the gate writer fails the whole evaluation),
  //   - the reviewer's own overview review, which lists its finding ids,
  //   - ledger comments and deletion events (snapshot.recorded_findings).
  const registered = new Set();
  const recordedAll = [...(snapshot.recorded_findings || [])];
  for (const r of snapshot.reviews || []) {
    if (isGateWriter(r.author) && String(r.body || '').includes(`<!-- ${REGISTER_MARKER} `)) {
      if (editedByOther(r)) {
        return fail(GATE_REASONS.EVIDENCE_TAMPERED, { review_id: r.id, editor: r.editor?.login ?? null }, {
          reviews: reviewEvidence, stale_reviews: stale, rejected_reviews: rejected, findings, blocking_findings: findings.map((f) => f.id),
        });
      }
      for (const row of parseLedgerFindings(r.body)) {
        registered.add(row.id);
        recordedAll.push({ ...row, source: 'register' });
      }
    }
    if (isReviewerBot(r.author) && !editedByOther(r)) {
      for (const [id, sev] of severitiesFromOverview(r.body)) {
        recordedAll.push({ id: `F-${id}`, reviewer: reviewerName(r.author), severity: sev, source: 'reviewer_overview' });
      }
    }
  }
  const present = new Set(findings.map((f) => f.id));
  const deleted = new Map();
  for (const rec of recordedAll) {
    if (present.has(rec.id)) continue;
    if (rec.reviewer_author && !isReviewerBot(rec.reviewer_author)) continue; // a deleted human comment is not a finding
    const prev = deleted.get(rec.id);
    deleted.set(rec.id, { ...rec, severity: maxSeverity(prev?.severity || null, SEVERITIES.includes(rec.severity) ? rec.severity : 'UNCLASSIFIED') });
  }
  for (const rec of deleted.values()) {
    const disposition = evaluatePrLevelDisposition(rec.id, snapshot.pr_dispositions || []);
    findings.push({
      id: rec.id,
      reviewer: rec.reviewer || reviewerName(rec.reviewer_author) || 'unknown',
      severity: rec.severity,
      path: null,
      line: null,
      commit_sha: null,
      thread_resolved: false,
      outdated: false,
      deleted: true,
      disposition,
      blocking: !NON_BLOCKING_SEVERITIES.includes(rec.severity) && !disposition.valid,
    });
  }
  const blockingIds = findings.filter((f) => f.blocking).map((f) => f.id);
  // Findings the register does not hold yet; the ledger job appends them as a new register review.
  const registerAdditions = findings
    .filter((f) => !registered.has(f.id))
    .map((f) => ({ id: f.id, reviewer: f.reviewer, severity: f.severity }));
  const extra = {
    reviews: reviewEvidence,
    stale_reviews: stale,
    rejected_reviews: rejected,
    findings,
    blocking_findings: blockingIds,
    register_additions: registerAdditions,
  };

  // --- verdict ---------------------------------------------------------------
  const missing = REQUIRED_REVIEWERS.filter((name) => !current.some((r) => r.reviewer === name));
  if (missing.length) {
    const hadAny = reviews.some((r) => missing.includes(r.reviewer));
    return fail(hadAny ? GATE_REASONS.REVIEW_STALE : GATE_REASONS.REVIEW_MISSING, { missing_reviewers: missing }, extra);
  }
  if (blockingIds.length) return fail(GATE_REASONS.UNDISPOSITIONED, blockingIds, extra);

  return { admissible: true, reason: GATE_REASONS.ADMISSIBLE, detail: null, ...base, ...extra };
}

// ---------------------------------------------------------------------------
// Durable ledger
// ---------------------------------------------------------------------------

export const LEDGER_MARKER = 'kf-ai-review-gate:ledger';

export function ledgerMarker(headSha) {
  return `<!-- ${LEDGER_MARKER} head=${headSha} -->`;
}

export const REGISTER_MARKER = 'kf-ai-review-gate:register';

/**
 * Body of an append-only register review: the findings the register did not
 * hold yet. Same row shape as the ledger so one parser reads both.
 */
export function renderRegister(additions, headSha) {
  if (!additions?.length) return '';
  const lines = [`<!-- ${REGISTER_MARKER} head=${headSha} -->`];
  lines.push('AI Review Gate finding register (append-only; a submitted review cannot be deleted, and an edit by anyone but the gate fails the gate).');
  lines.push('', '| id | reviewer | severity |', '|---|---|---|');
  for (const a of additions) lines.push(`| ${a.id} | ${a.reviewer} | ${a.severity} |`);
  return lines.join('\n');
}

/**
 * Findings an earlier ledger recorded. The ledgers are the gate's durable
 * memory: a finding recorded once is expected to still exist later, so its
 * deletion is visible. A forged row can only add a blocker, never remove one.
 */
export function parseLedgerFindings(body) {
  const out = [];
  for (const m of String(body || '').matchAll(/^\| (F-\d+) \| ([a-z0-9-]+) \| ([A-Z]+) \|/gm)) {
    out.push({ id: m[1], reviewer: m[2], severity: m[3], source: 'ledger' });
  }
  return out;
}

/** Markdown ledger for one head. Written by github-actions; never review evidence. */
export function renderLedger(verdict, { prNumber = null, runUrl = null } = {}) {
  const lines = [];
  lines.push(ledgerMarker(verdict.head_sha));
  lines.push(`### AI Review Gate — ${verdict.admissible ? 'ADMISSIBLE' : 'BLOCKED'}`);
  lines.push('');
  lines.push(`- PR: #${prNumber ?? '?'} · head \`${verdict.head_sha}\``);
  lines.push(`- verdict: \`${verdict.reason}\``);
  if (runUrl) lines.push(`- evaluation run: ${runUrl}`);
  lines.push('- this ledger is written by the gate and is never accepted as review evidence');
  lines.push('');
  lines.push('**Current-head AI reviews**');
  if ((verdict.reviews || []).length) {
    for (const r of verdict.reviews) lines.push(`- ${r.reviewer} review ${r.review_id} at \`${r.reviewed_sha}\` (${r.relation})`);
  } else {
    lines.push('- none');
  }
  if ((verdict.stale_reviews || []).length) {
    lines.push('', '**Stale AI reviews (not counted)**');
    for (const r of verdict.stale_reviews) lines.push(`- ${r.reviewer} review ${r.review_id} at \`${r.reviewed_sha}\` (${r.relation})`);
  }
  if ((verdict.rejected_reviews || []).length) {
    lines.push('', '**Rejected review evidence**');
    for (const r of verdict.rejected_reviews) lines.push(`- ${r.author} review ${r.id}: ${r.reason}`);
  }
  lines.push('', '**Findings**');
  if ((verdict.findings || []).length) {
    lines.push('| id | reviewer | severity | location | disposition | blocking |', '|---|---|---|---|---|---|');
    for (const f of verdict.findings) {
      const d = f.disposition.valid ? f.disposition.state : `${f.disposition.state}${f.disposition.detail ? ` (${f.disposition.detail})` : ''}`;
      const where = f.deleted ? 'DELETED' : `${f.path ?? '-'}:${f.line ?? '-'}${f.tampered ? ' (edited by non-reviewer)' : ''}`;
      lines.push(`| ${f.id} | ${f.reviewer} | ${f.severity} | ${where} | ${d} | ${f.blocking ? 'YES' : 'no'} |`);
    }
  } else {
    lines.push('- none');
  }
  lines.push('', '**High-risk surfaces (explicit review required)**');
  if ((verdict.high_risk || []).length) {
    for (const h of verdict.high_risk) lines.push(`- ${h.surface}${h.files.length ? `: ${h.files.slice(0, 10).map((f) => `\`${f}\``).join(', ')}${h.files.length > 10 ? ' …' : ''}` : ''}`);
  } else {
    lines.push('- none detected');
  }
  lines.push('', 'Clear a finding with a reply in its thread: `KF-DISPOSITION: RESOLVED fixed_in=<40-char sha>` or `KF-DISPOSITION: REJECTED_WITH_EVIDENCE` followed by the evidence. A DELETED finding needs a PR comment: `KF-DISPOSITION: REJECTED_WITH_EVIDENCE finding=<id>` with evidence.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Re-review request (Codex is not natively re-triggered on push)
// ---------------------------------------------------------------------------

export const REQUEST_MARKER = 'kf-ai-review-request';

export function requestMarker(headSha) {
  return `<!-- ${REQUEST_MARKER} head=${headSha} -->`;
}

/**
 * Decide whether a synchronize event warrants an explicit Codex re-review.
 *   action, draft, before, after
 *   trees_equal: before and after have the same tree (no-op rebase / empty push)
 *   compare: {status, files} for before...after, or null if unknown
 *   existing_markers: head shas that already carry a request comment
 */
export function decideReviewRequest(input) {
  const { action, draft, before, after, trees_equal: treesEqual, compare, existing_markers: markers = [] } = input;
  if (action !== 'synchronize') return { request: false, reason: 'native_trigger_covers_event' };
  if (draft === true) return { request: false, reason: 'draft_reviewed_on_ready' };
  if (!SHA.test(String(after))) return { request: false, reason: 'head_unknown' };
  if (markers.includes(after)) return { request: false, reason: 'already_requested_for_head' };
  if (treesEqual === true) return { request: false, reason: 'no_op_update_same_tree' };
  // Unknown or rewritten history: the change cannot be proved non-semantic, so review it.
  if (!compare || !SHA.test(String(before)) || compare.status !== 'ahead') {
    return { request: true, reason: 'history_rewritten_or_unproven' };
  }
  const semantic = (compare.files || []).filter((f) => !String(f).startsWith(CONTROL_ONLY_PREFIX));
  if (!semantic.length) return { request: false, reason: 'control_only_update' };
  return { request: true, reason: 'semantic_push', files: semantic };
}

export default {
  evaluateAiReview,
  requiredComparisons,
  classifyHighRisk,
  decideReviewRequest,
  renderLedger,
  GATE_REASONS,
};
