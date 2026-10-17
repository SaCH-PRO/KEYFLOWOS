/**
 * HANDOFF PROJECTOR — what issue #80 shows about each ChatGPT -> Claude
 * request, read-only. (KF-META-HANDOFF-MONITOR-001, scope issue #178, H1)
 *
 * Input is the raw #80 comments exactly as GitHub returned them. Every body is
 * read through control-envelope.mjs, unchanged: this module adds correlation,
 * never a second field syntax, and never grants or repairs authority.
 *
 * A task is one authority request (a DIRECTIVE or REVIEW from the ChatGPT
 * sender). Its handoff is observed in six separate stages:
 *
 *   POSTED                 the request comment exists
 *   ACKNOWLEDGED           the intended responder's ACK names the request
 *   WORKING_LAST_OBSERVED  the newest task-bound PROGRESS/MOMENTUM/CONTRADICTION,
 *                          with its age; never a claim that anyone is still running
 *   RETURNED               the responder's RETURN names the request and revision
 *   RETURN_CONSUMED        the requester names that RETURN (in_reply_to or
 *                          return_comment_id); fetching this feed is not a receipt
 *   DECISION_RECORDED      a requester reply that records a disposition, with its
 *                          authority classification; nothing is synthesized
 *
 * Review outcome, revision validity, evidence confidence and merge authority
 * are separate fields, so a CHANGES_REQUIRED round trip can be a successful
 * delivery and is still not a PASS.
 *
 * Correlation is by explicit reference only: the logical message id in
 * `in_reply_to`, the comment ids in `ack_ref` / `return_comment_id`, the
 * intended role, the PR and the revision. Sharing a packet id or a PR number
 * never correlates two messages. A missing, ambiguous or contradicting
 * reference leaves the message unmatched and visible.
 */

import {
  AUTHORITY_SENDER,
  PROFILES,
  claimedAuthorityType,
  collectAuthority,
  envelopeField,
  normalizeComment,
  parseEnvelope,
  rejectionOf,
  validateEnvelope,
} from './control-envelope.mjs';

export const SNAPSHOT_SCHEMA = 'keyflow.handoff-snapshot/v1';
export const REPOSITORY = 'SaCH-PRO/KEYFLOWOS';
export const CONTROL_ISSUE = 80;

export const STAGES = Object.freeze([
  'POSTED',
  'ACKNOWLEDGED',
  'WORKING_LAST_OBSERVED',
  'RETURNED',
  'RETURN_CONSUMED',
  'DECISION_RECORDED',
]);

/** Message types that ask the other agent to act. */
export const REQUEST_TYPES = Object.freeze(['DIRECTIVE', 'REVIEW']);
const WORKING_TYPES = Object.freeze(['PROGRESS', 'MOMENTUM', 'CONTRADICTION']);
const REVIEW_OUTCOMES = Object.freeze(['PASS', 'CHANGES_REQUIRED', 'NOT_RUN']);

/** Worker availability in H1: there is no validated telemetry to read. */
export const WORKER_AVAILABILITY = Object.freeze({
  status: 'UNKNOWN',
  connection: 'NOT_CONNECTED',
  basis:
    'H1 has no validated local worker telemetry. An ACK or PROGRESS shows only when the worker last spoke; '
    + "the hosted autopilot's 'claude is not on PATH' describes the GitHub runner, not the local worker.",
});

const SAFE_SOURCE_URL = new RegExp(
  `^https://github\\.com/${REPOSITORY.replace('/', '\\/')}/(issues|pull)/\\d{1,7}`
  + '(#(issuecomment-\\d{1,12}|pullrequestreview-\\d{1,12}|discussion_r\\d{1,12}))?$',
);
const COMMENT_REF = /#issuecomment-(\d{1,12})$/;
const SHA = /^[0-9a-f]{40}$/;
const EXCERPT_CHARS = 280;

// ------------------------------------------------------------------ safety

/**
 * Known credential shapes, replaced before any text leaves the projector.
 * This catches common token formats; it is not a general secret detector.
 */
const CREDENTIAL_PATTERNS = Object.freeze([
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ['github-pat', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ['bearer', /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g],
  ['api-key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['aws-key-id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g],
]);

/** Replace known credential patterns. Returns the text and how many were hidden. */
export function redactCredentials(text) {
  if (typeof text !== 'string') return { text: '', redactions: 0 };
  let redactions = 0;
  let out = text;
  for (const [kind, pattern] of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, () => {
      redactions += 1;
      return `[REDACTED:${kind}]`;
    });
  }
  return { text: out, redactions };
}

/**
 * A link the viewer may render: only a page of this repository's issues or
 * pull requests, over https, with an optional comment/review anchor. Anything
 * else (another host, javascript:, a path trick) returns null and is shown as
 * text.
 */
export function safeSourceUrl(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return SAFE_SOURCE_URL.test(value) ? value : null;
}

/** The canonical URL of a #80 comment, built from its id, never read from input. */
export function controlCommentUrl(commentId) {
  return `https://github.com/${REPOSITORY}/issues/${CONTROL_ISSUE}#issuecomment-${commentId}`;
}

// ---------------------------------------------------------------- messages

const field = (env, key) => {
  const value = envelopeField(env, key);
  return typeof value === 'string' ? value : null;
};

function intOrNull(value) {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}

/** A GitHub comment id (10+ digits today). */
function commentIdOrNull(value) {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null;
  return Number(value);
}

function boolOrNull(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function shaOrNull(value) {
  return typeof value === 'string' && SHA.test(value) ? value : null;
}

/** A reference field: the raw value, the comment id it names, and a safe link. */
function referenceOf(raw) {
  if (raw === null) return null;
  const safe = safeSourceUrl(raw);
  const m = safe ? safe.match(COMMENT_REF) : null;
  const onControlIssue = Boolean(safe && safe.includes(`/issues/${CONTROL_ISSUE}#`));
  return {
    raw: redactCredentials(raw).text,
    safe_url: safe,
    control_comment_id: m && onControlIssue ? Number(m[1]) : null,
  };
}

function authorityOf(env, comment) {
  const claimed = claimedAuthorityType(env);
  if (!claimed) return { claimed_type: null, status: 'NOT_AUTHORITY', problems: [] };
  const rejection = rejectionOf(env, comment.author);
  if (rejection) return { claimed_type: claimed, status: 'REJECTED', problems: [rejection] };
  if (comment.edited === true) return { claimed_type: claimed, status: 'EDITED', problems: ['edited after posting; prior content is not verifiable'] };
  if (comment.edited === null) return { claimed_type: claimed, status: 'EDIT_STATE_UNKNOWN', problems: ['edit state not observable'] };
  const problems = validateEnvelope(env, PROFILES.AUTHORITY);
  return { claimed_type: claimed, status: problems.length ? 'MALFORMED' : 'VALID', problems };
}

function isBotAuthor(login) {
  return typeof login === 'string' && /\[bot\]$/.test(login);
}

/**
 * One #80 comment as the viewer shows it. `usable` says whether it may serve
 * as handoff evidence: well formed, unedited, with a message id.
 */
export function readMessage(raw) {
  const c = normalizeComment(raw);
  const env = parseEnvelope(c.body);
  const type = field(env, 'message_type');
  const sender = field(env, 'sender');
  const autoEvent = type === 'AUTO_EVENT' || type === 'AUTO_MERGE'
    || (isBotAuthor(c.author) && /<!--\s*keyflow-autopilot-event:/.test(c.body));
  const kind = autoEvent ? 'AUTO_EVENT' : type && sender ? 'CONTROL' : 'UNSTRUCTURED';
  const body = redactCredentials(c.body);
  const authority = authorityOf(env, c);

  const problems = [...env.problems];
  if (kind === 'CONTROL' && !field(env, 'message_id')) problems.push('message_id (absent)');
  let editState = 'UNEDITED';
  if (c.edited === true) editState = isBotAuthor(c.author) || autoEvent ? 'AMENDED_BOT_STATUS' : 'EDITED';
  else if (c.edited === null) editState = 'UNKNOWN';

  return {
    comment_id: c.id,
    url: Number.isSafeInteger(c.id) ? controlCommentUrl(c.id) : null,
    author: c.author,
    created_at: c.created_at,
    updated_at: c.updated_at,
    edit_state: editState,
    kind,
    noise: kind === 'AUTO_EVENT',
    message_id: field(env, 'message_id'),
    message_type: type,
    sender,
    recipient: field(env, 'recipient'),
    requested_reviewer: field(env, 'requested_reviewer'),
    in_reply_to: field(env, 'in_reply_to'),
    packet_id: field(env, 'packet_id'),
    pr_number: intOrNull(field(env, 'pr_number')),
    pr_number_raw: field(env, 'pr_number'),
    revision: {
      source_main: shaOrNull(field(env, 'source_main')),
      source_head: shaOrNull(field(env, 'source_head')),
      reviewed_head: shaOrNull(field(env, 'reviewed_head')),
    },
    refs: {
      ack_ref: referenceOf(field(env, 'ack_ref')),
      findings_ref: referenceOf(field(env, 'findings_ref')),
      return_comment_id: commentIdOrNull(field(env, 'return_comment_id')),
    },
    review: {
      semantic_review_outcome: field(env, 'semantic_review_outcome'),
      unresolved_substantive_findings: intOrNull(field(env, 'unresolved_substantive_findings')),
      review_status: field(env, 'review_status'),
      receipt_status: field(env, 'receipt_status'),
      decision: field(env, 'decision'),
      control_effect: field(env, 'control_effect'),
      merge_authority: boolOrNull(field(env, 'merge_authority')),
    },
    provenance: {
      github_author: c.author,
      claimed_sender: sender,
      claimed_model: field(env, 'reviewer_model') || field(env, 'authoring_model'),
      claimed_session: field(env, 'reviewer_session'),
      basis: 'GITHUB_ACCOUNT',
    },
    authority,
    envelope_problems: problems,
    usable: kind === 'CONTROL' && problems.length === 0 && c.edited === false,
    body: body.text,
    redactions: body.redactions,
    excerpt: body.text.length > EXCERPT_CHARS ? `${body.text.slice(0, EXCERPT_CHARS)}…` : body.text,
  };
}

function orderKey(m) {
  const t = Date.parse(m.created_at);
  return [Number.isNaN(t) ? Number.POSITIVE_INFINITY : t, Number.isSafeInteger(m.comment_id) ? m.comment_id : Number.POSITIVE_INFINITY];
}

function compareMessages(a, b) {
  const [ta, ia] = orderKey(a);
  const [tb, ib] = orderKey(b);
  return ta !== tb ? ta - tb : ia - ib;
}

const after = (later, earlier) => compareMessages(later, earlier) > 0;

/**
 * Collapse duplicate deliveries of one comment id. The same id delivered
 * twice is one message; if the deliveries disagree, the newest update wins
 * and the comment is marked edited, because GitHub changed it in between.
 */
function dedupeComments(comments) {
  const byId = new Map();
  const withoutId = [];
  let duplicates = 0;
  for (const raw of comments) {
    const id = normalizeComment(raw).id;
    if (!Number.isSafeInteger(id)) {
      withoutId.push(raw);
      continue;
    }
    const seen = byId.get(id);
    if (!seen) {
      byId.set(id, raw);
      continue;
    }
    duplicates += 1;
    const a = normalizeComment(seen);
    const b = normalizeComment(raw);
    if (a.body !== b.body || a.updated_at !== b.updated_at) {
      const newer = String(b.updated_at || '') > String(a.updated_at || '') ? raw : seen;
      byId.set(id, { ...newer, updated_at: newer.updated_at, includesCreatedEdit: true, __conflicting_deliveries: true });
    }
  }
  return { comments: [...byId.values(), ...withoutId], duplicates };
}

// ------------------------------------------------------------- correlation

function prCompatible(a, b) {
  return a === null || b === null || a === b;
}

function headOf(m) {
  return m.revision.reviewed_head || m.revision.source_head;
}

/**
 * Sender spellings already on #80 for the Claude worker. A listed spelling
 * matches the role but lowers confidence to MEDIUM; any other value is a
 * different sender. Like CONTROL_EFFECT_ALIASES, this records history and is
 * not a way to accept new words.
 */
export const SENDER_ALIASES = Object.freeze({
  claude: Object.freeze(['claude-code', 'claude-worker']),
});

/** 'EXACT', 'ALIAS' or null. */
function senderMatch(sender, role) {
  if (sender === role) return 'EXACT';
  return (SENDER_ALIASES[role] || []).includes(sender) ? 'ALIAS' : null;
}

/** Who a request asks to act, and how we know. */
function responderOf(request) {
  if (request.recipient) return { role: request.recipient, basis: 'DECLARED_RECIPIENT' };
  if (request.requested_reviewer) return { role: request.requested_reviewer, basis: 'DECLARED_REQUESTED_REVIEWER' };
  // Issue #80 protocol: ChatGPT authority is addressed to the Claude worker.
  return { role: 'claude', basis: 'PROTOCOL_DEFAULT' };
}

function evidenceOf(m) {
  return {
    comment_id: m.comment_id,
    message_id: m.message_id,
    message_type: m.message_type,
    sender: m.sender,
    author: m.author,
    created_at: m.created_at,
    url: m.url,
  };
}

function mismatch(m, reason, detail = null) {
  return { ...evidenceOf(m), reason, detail };
}

/**
 * Check a candidate reply against the message it names. Returns null when it
 * fits, or [reason, detail].
 *
 * `revision` is the head the reply must carry when it claims one:
 *   'claimed'  the reply's reviewed_head, else its source_head (ACK, receipt)
 *   'reviewed' only a declared reviewed_head; an implementation RETURN reports
 *              the head it produced as source_head, which is not a mismatch
 *   null       no revision rule (progress reports the head work has reached)
 */
function replyProblem(reply, { expectedSender, request, revisionHead, revision }) {
  if (!after(reply, request)) return ['BEFORE_REQUEST', `posted before ${request.message_id}`];
  if (!senderMatch(reply.sender, expectedSender)) return ['WRONG_SENDER', `sender ${reply.sender}; expected ${expectedSender}`];
  if (!prCompatible(reply.pr_number, request.pr_number)) return ['WRONG_PR', `PR ${reply.pr_number}; the message it names has PR ${request.pr_number}`];
  const head = revision === 'claimed' ? headOf(reply) : revision === 'reviewed' ? reply.revision.reviewed_head : null;
  if (revisionHead && head && head !== revisionHead) return ['WRONG_REVISION', `head ${head}; expected ${revisionHead}`];
  return null;
}

function reviewOutcomeOf(ret) {
  if (!ret) return 'UNKNOWN';
  const value = ret.review.semantic_review_outcome;
  return REVIEW_OUTCOMES.includes(value) ? value : 'UNKNOWN';
}

function ageSeconds(observedAt, createdAt) {
  const age = Math.round((Date.parse(observedAt) - Date.parse(createdAt)) / 1000);
  if (Number.isNaN(age)) return { age_seconds: null, clock_skew_suspected: false };
  return age < 0 ? { age_seconds: 0, clock_skew_suspected: true } : { age_seconds: age, clock_skew_suspected: false };
}

function projectTask(request, ctx) {
  const { byMessageId, repliesTo, observedAt, pulls, claimed } = ctx;
  const responder = responderOf(request);
  const requester = request.sender;
  const mismatched = [];
  const claim = (m) => claimed.add(m.comment_id);
  const reject = (m, reason, detail) => {
    mismatched.push(mismatch(m, reason, detail));
    claim(m);
  };

  const duplicateRequest = (byMessageId.get(request.message_id) || []).length > 1;
  const stages = Object.fromEntries(STAGES.map((s) => [s, { status: 'NOT_OBSERVED', evidence: [] }]));
  stages.POSTED = { status: 'OBSERVED', evidence: [evidenceOf(request)] };

  const task = {
    task_id: request.comment_id,
    request: {
      ...evidenceOf(request),
      packet_id: request.packet_id,
      pr_number: request.pr_number,
      source_main: request.revision.source_main,
      source_head: request.revision.source_head,
      control_effect: request.review.control_effect,
      authority_status: request.authority.status,
      authority_problems: request.authority.problems,
    },
    requester,
    responder,
    stages,
    review: { outcome: 'UNKNOWN', unresolved_substantive_findings: null, findings_ref: null, basis: null },
    revision: {
      requested_head: request.revision.source_head,
      returned_head: null,
      status: 'NO_EVIDENCE',
      current_pr_head: null,
      current_pr_state: null,
      current_status: 'UNKNOWN',
    },
    merge_authority: { status: 'NOT_GRANTED', basis: 'no valid PACKET_ADMISSION authority with merge_authority: true names this task' },
    confidence: 'NONE',
    delivery: { stage: 'POSTED', gaps: [], pending: null },
    returns: [],
    related: [],
    mismatched,
    problems: [],
  };

  if (request.authority.status !== 'VALID') {
    task.problems.push(`request authority ${request.authority.status}: ${request.authority.problems.join('; ')}`);
  }
  if (duplicateRequest) {
    task.problems.push(`DUPLICATE_LOGICAL_ID: ${byMessageId.get(request.message_id).length} comments use message_id ${request.message_id}`);
    for (const reply of repliesTo.get(request.message_id) || []) reject(reply, 'AMBIGUOUS_REQUEST', `${request.message_id} names more than one comment`);
    task.delivery.pending = { party: 'UNKNOWN', reason: 'the request id is ambiguous, so no reply can be attributed to it' };
    return task;
  }
  if (!request.usable) {
    task.problems.push(`request is not usable evidence: ${request.edit_state}; ${request.envelope_problems.join('; ')}`);
    for (const reply of repliesTo.get(request.message_id) || []) reject(reply, 'REQUEST_NOT_USABLE', request.edit_state);
    task.delivery.pending = { party: 'UNKNOWN', reason: 'the request itself is not verifiable evidence' };
    return task;
  }

  const revisionHead = request.revision.source_head;
  const direct = repliesTo.get(request.message_id) || [];

  let aliasUsed = false;
  const accept = (m, role) => {
    if (senderMatch(m.sender, role) === 'ALIAS') aliasUsed = true;
    claim(m);
  };

  // The requester's own follow-ups to its request are context, not a stage.
  for (const m of direct.filter((r) => r.sender === requester && after(r, request))) {
    task.related.push(evidenceOf(m));
    claim(m);
  }

  // ACKNOWLEDGED
  const acks = [];
  for (const m of direct.filter((r) => r.message_type === 'ACK')) {
    const problem = replyProblem(m, { expectedSender: responder.role, request, revisionHead, revision: 'claimed' });
    if (problem) reject(m, ...problem);
    else { acks.push(m); accept(m, responder.role); }
  }
  for (const m of acks) {
    if ((byMessageId.get(m.message_id) || []).length > 1) task.problems.push(`DUPLICATE_LOGICAL_ID on ACK ${m.message_id}`);
  }
  const validAcks = acks.filter((m) => (byMessageId.get(m.message_id) || []).length === 1);
  if (validAcks.length) stages.ACKNOWLEDGED = { status: 'OBSERVED', evidence: validAcks.map(evidenceOf) };

  // Replies may name the ACK instead of the request: followed only when the
  // ACK is unambiguous and itself matched this request.
  const viaAck = validAcks.flatMap((ack) => (repliesTo.get(ack.message_id) || []).map((m) => ({ m, via: ack })));
  const candidates = [...direct.map((m) => ({ m, via: null })), ...viaAck];

  // WORKING_LAST_OBSERVED
  const working = [];
  for (const { m, via } of candidates.filter(({ m }) => WORKING_TYPES.includes(m.message_type) && senderMatch(m.sender, responder.role))) {
    const problem = replyProblem(m, { expectedSender: responder.role, request, revisionHead, revision: null });
    if (problem) reject(m, ...problem);
    else { working.push({ m, via }); accept(m, responder.role); }
  }
  if (working.length) {
    const newest = working.map((w) => w.m).sort(compareMessages).at(-1);
    stages.WORKING_LAST_OBSERVED = {
      status: 'LAST_OBSERVED',
      liveness: 'UNKNOWN',
      ...ageSeconds(observedAt, newest.created_at),
      evidence: [evidenceOf(newest)],
      note: 'the newest task-bound progress message; it does not show that the worker is running now',
    };
  }

  // RETURNED
  const returns = [];
  for (const { m, via } of candidates.filter(({ m }) => m.message_type === 'RETURN')) {
    const problem = replyProblem(m, { expectedSender: responder.role, request, revisionHead, revision: 'reviewed' });
    if (problem) { reject(m, ...problem); continue; }
    if ((byMessageId.get(m.message_id) || []).length > 1) { reject(m, 'DUPLICATE_LOGICAL_ID', `${m.message_id} names more than one comment`); continue; }
    const ackRef = m.refs.ack_ref;
    if (ackRef && !validAcks.some((a) => a.comment_id === ackRef.control_comment_id)) {
      reject(m, 'ACK_REF_MISMATCH', `ack_ref ${ackRef.raw} is not a matched ACK of this request`);
      continue;
    }
    returns.push({ m, via });
    accept(m, responder.role);
  }
  returns.sort((a, b) => compareMessages(a.m, b.m));
  task.returns = returns.map(({ m, via }) => ({
    ...evidenceOf(m),
    via_ack: via ? via.message_id : null,
    reviewed_head: headOf(m),
    review_outcome: reviewOutcomeOf(m),
    unresolved_substantive_findings: m.review.unresolved_substantive_findings,
    findings_ref: m.refs.findings_ref,
    claimed_model: m.provenance.claimed_model,
    claimed_session: m.provenance.claimed_session,
  }));
  const current = returns.at(-1)?.m || null;
  if (current) {
    stages.RETURNED = { status: 'OBSERVED', evidence: [evidenceOf(current)], earlier_returns: returns.length - 1 };
    task.review = {
      outcome: reviewOutcomeOf(current),
      unresolved_substantive_findings: current.review.unresolved_substantive_findings,
      findings_ref: current.refs.findings_ref,
      basis: `${current.message_id} (${current.comment_id}), as declared by its sender`,
    };
    task.revision.returned_head = headOf(current);
  }

  // RETURN_CONSUMED and DECISION_RECORDED: the requester naming that RETURN.
  if (current) {
    const named = new Map();
    for (const m of repliesTo.get(current.message_id) || []) named.set(m.comment_id, m);
    for (const m of ctx.byReturnCommentId.get(current.comment_id) || []) named.set(m.comment_id, m);
    const receipts = [];
    for (const m of [...named.values()].sort(compareMessages)) {
      // The responder following up its own RETURN is context, not a receipt.
      if (senderMatch(m.sender, responder.role) && after(m, current)) {
        task.related.push(evidenceOf(m));
        claim(m);
        continue;
      }
      const problem = replyProblem(m, { expectedSender: requester, request: current, revisionHead: task.revision.returned_head, revision: 'claimed' });
      if (problem) { reject(m, ...problem); continue; }
      const byId = m.in_reply_to === current.message_id;
      const byComment = m.refs.return_comment_id === current.comment_id;
      if ((m.in_reply_to && !byId) || (m.refs.return_comment_id !== null && !byComment)) {
        reject(m, 'CONFLICTING_RETURN_REFERENCE', `in_reply_to ${m.in_reply_to}, return_comment_id ${m.refs.return_comment_id}`);
        continue;
      }
      receipts.push(m);
      claim(m);
    }
    if (receipts.length) {
      stages.RETURN_CONSUMED = { status: 'OBSERVED', evidence: [evidenceOf(receipts[0])], receipt_status: receipts[0].review.receipt_status };
      const decisions = receipts.filter((m) => m.review.review_status || m.review.decision);
      if (decisions.length) {
        const d = decisions.at(-1);
        stages.DECISION_RECORDED = {
          status: 'OBSERVED',
          evidence: [evidenceOf(d)],
          disposition: d.review.decision || d.review.review_status,
          review_status: d.review.review_status,
          control_effect: d.review.control_effect,
          classification: d.authority.status === 'VALID' ? 'AUTHORITY' : 'EVIDENCE_ONLY',
          classification_basis: d.authority.status === 'VALID'
            ? `${d.message_type} from the authority sender, valid under the AUTHORITY profile`
            : `${d.message_type} is not an authority type (${d.authority.status}); it records a disposition but grants nothing`,
        };
        if (d.review.unresolved_substantive_findings !== null
          && task.review.unresolved_substantive_findings !== null
          && d.review.unresolved_substantive_findings !== task.review.unresolved_substantive_findings) {
          task.problems.push(`receipt counts ${d.review.unresolved_substantive_findings} unresolved findings; the RETURN counts ${task.review.unresolved_substantive_findings}`);
        }
      }
      // Merge authority is only ever read, from a valid PACKET_ADMISSION.
      const grant = receipts.find((m) => m.authority.status === 'VALID'
        && m.review.control_effect === 'PACKET_ADMISSION' && m.review.merge_authority === true);
      if (grant) task.merge_authority = { status: 'GRANTED', basis: `${grant.message_id} (${grant.comment_id})` };
      else if (receipts.some((m) => m.review.merge_authority === false)) {
        task.merge_authority = { status: 'NOT_GRANTED', basis: 'the requester declared merge_authority: false' };
      }
    }
  }

  // Revision validity. A review RETURN declares reviewed_head and must match
  // the requested head (a mismatch was rejected above). An implementation
  // RETURN reports the head it produced, which is evidence, not a match.
  if (current && current.revision.reviewed_head) {
    task.revision.status = task.revision.requested_head
      ? (current.revision.reviewed_head === task.revision.requested_head ? 'MATCH' : 'MISMATCH')
      : 'REQUEST_NAMES_NO_HEAD';
  } else if (current && current.revision.source_head) {
    task.revision.status = 'PRODUCED_HEAD';
  }
  const pr = request.pr_number !== null ? pulls.get(request.pr_number) : null;
  if (pr) {
    task.revision.current_pr_head = pr.head_sha;
    task.revision.current_pr_state = pr.state;
    if (pr.head_sha && task.revision.returned_head) {
      task.revision.current_status = pr.head_sha === task.revision.returned_head ? 'CURRENT' : 'SUPERSEDED';
    }
  }

  // Delivery summary, confidence and whose response is pending.
  const observed = (s) => stages[s].status !== 'NOT_OBSERVED';
  const order = ['POSTED', 'ACKNOWLEDGED', 'RETURNED', 'RETURN_CONSUMED', 'DECISION_RECORDED'];
  const reached = order.filter(observed);
  task.delivery.stage = reached.at(-1);
  task.delivery.gaps = order.slice(0, order.indexOf(task.delivery.stage)).filter((s) => !observed(s));
  if (!observed('RETURNED')) {
    task.delivery.pending = observed('ACKNOWLEDGED')
      ? { party: responder.role, reason: 'acknowledged; no matching RETURN observed. Whether the responder is still working is UNKNOWN' }
      : { party: responder.role, reason: 'no matching ACK or RETURN observed' };
  } else if (!observed('RETURN_CONSUMED')) {
    task.delivery.pending = { party: requester, reason: `awaiting ${requester} consumption of ${current.message_id}; no receipt names it` };
  } else if (!observed('DECISION_RECORDED')) {
    task.delivery.pending = { party: requester, reason: 'the RETURN was consumed; no disposition recorded' };
  } else {
    task.delivery.pending = { party: 'SEE_DECISION', reason: `disposition ${stages.DECISION_RECORDED.disposition} recorded; the next step is whatever it orders` };
  }
  // HIGH needs a declared responder, direct references, the responder's own
  // spelling and an exact revision match; anything weaker is MEDIUM.
  const explicit = responder.basis !== 'PROTOCOL_DEFAULT' && !returns.some((r) => r.via) && !aliasUsed;
  task.confidence = reached.length > 1 ? (explicit && task.revision.status === 'MATCH' ? 'HIGH' : 'MEDIUM') : 'NONE';
  task.sender_alias_used = aliasUsed;
  return task;
}

// --------------------------------------------------------------- snapshot

/**
 * Project raw #80 comments into the handoff snapshot.
 *
 * @param {Array} comments REST or `gh issue view` comment objects
 * @param {object} [options]
 *   observedAt  ISO time the comments were collected (ages are measured from it)
 *   pulls       [{number, head_sha, state, merged}] PR facts collected alongside
 */
export function projectHandoffs(comments, options = {}) {
  const observedAt = options.observedAt || new Date(0).toISOString();
  const deduped = dedupeComments(Array.isArray(comments) ? comments : []);
  const messages = deduped.comments.map(readMessage).sort(compareMessages);
  const authority = collectAuthority(Array.isArray(comments) ? deduped.comments : null);

  const byMessageId = new Map();
  const repliesTo = new Map();
  const byReturnCommentId = new Map();
  for (const m of messages) {
    if (m.kind !== 'CONTROL') continue;
    if (m.message_id) byMessageId.set(m.message_id, [...(byMessageId.get(m.message_id) || []), m]);
    if (!m.usable) continue;
    if (m.in_reply_to) repliesTo.set(m.in_reply_to, [...(repliesTo.get(m.in_reply_to) || []), m]);
    if (m.refs.return_comment_id !== null) {
      byReturnCommentId.set(m.refs.return_comment_id, [...(byReturnCommentId.get(m.refs.return_comment_id) || []), m]);
    }
  }
  const pulls = new Map((options.pulls || []).map((p) => [p.number, p]));

  // Account-level provenance: one login speaking as several senders.
  const sendersByLogin = new Map();
  for (const m of messages) {
    if (m.kind !== 'CONTROL' || !m.author || !m.sender) continue;
    sendersByLogin.set(m.author, new Set([...(sendersByLogin.get(m.author) || []), m.sender]));
  }
  const shared = [...sendersByLogin].filter(([, s]) => s.size > 1).map(([login, s]) => ({ login, senders: [...s].sort() }));
  for (const m of messages) {
    m.provenance.shared_account = shared.some((s) => s.login === m.author);
    m.provenance.note = m.provenance.shared_account
      ? `GitHub account ${m.author} posts as ${shared.find((s) => s.login === m.author).senders.join(' and ')}; the sender and model are self-reported`
      : 'the sender and model are self-reported; GitHub proves only the account';
  }

  const claimed = new Set();
  const ctx = { byMessageId, repliesTo, byReturnCommentId, observedAt, pulls, claimed };
  const requests = messages.filter((m) => m.kind === 'CONTROL' && REQUEST_TYPES.includes(m.message_type) && m.sender === AUTHORITY_SENDER);
  const tasks = requests.map((r) => projectTask(r, ctx)).reverse();
  for (const r of requests) claimed.add(r.comment_id);

  // Every reply-shaped control message no task accepted stays visible.
  const unmatched = [];
  for (const m of messages) {
    if (m.kind !== 'CONTROL' || claimed.has(m.comment_id)) continue;
    if (REQUEST_TYPES.includes(m.message_type) && m.sender === AUTHORITY_SENDER) continue;
    let reason = 'NO_REFERENCE';
    let detail = 'declares no in_reply_to or return_comment_id';
    if (!m.usable) { reason = 'NOT_USABLE_EVIDENCE'; detail = `${m.edit_state}; ${m.envelope_problems.join('; ')}`; }
    else if (m.in_reply_to) {
      const targets = byMessageId.get(m.in_reply_to) || [];
      if (targets.length === 0) { reason = 'UNRESOLVED_REFERENCE'; detail = `${m.in_reply_to} is not a message on #80`; }
      else if (targets.length > 1) { reason = 'AMBIGUOUS_REFERENCE'; detail = `${m.in_reply_to} names ${targets.length} comments`; }
      else { reason = 'NOT_A_HANDOFF_STAGE'; detail = `a ${m.message_type} from ${m.sender} naming ${targets[0].message_type} ${m.in_reply_to} matches no stage of a task`; }
    }
    unmatched.push(mismatch(m, reason, detail));
  }
  const mismatchedIds = new Set(tasks.flatMap((t) => t.mismatched.map((x) => x.comment_id)));

  return {
    schema: SNAPSHOT_SCHEMA,
    repository: REPOSITORY,
    issue: CONTROL_ISSUE,
    observed_at: observedAt,
    authority_record: authority.verified
      ? { verified: true, newest: authority.newest ? { message_id: authority.newest.message_id, comment_id: authority.newest.comment_id } : null, malformed: authority.malformed.length, rejected: authority.rejected }
      : { verified: false, code: authority.code, reason: authority.reason },
    provenance: {
      shared_accounts: shared,
      note: 'GitHub authorship proves which account posted, not which model or session produced the text. No model identity is verified.',
    },
    worker: WORKER_AVAILABILITY,
    counts: {
      comments: messages.length,
      duplicate_deliveries: deduped.duplicates,
      auto_events: messages.filter((m) => m.noise).length,
      control: messages.filter((m) => m.kind === 'CONTROL').length,
      unstructured: messages.filter((m) => m.kind === 'UNSTRUCTURED').length,
      tasks: tasks.length,
      unmatched: unmatched.length,
      mismatched_replies: mismatchedIds.size,
    },
    tasks,
    unmatched,
    messages,
  };
}

// ------------------------------------------------------------------- views

function messageSummary(m, withBody) {
  if (withBody) return m;
  return {
    comment_id: m.comment_id,
    url: m.url,
    author: m.author,
    created_at: m.created_at,
    edit_state: m.edit_state,
    kind: m.kind,
    noise: m.noise,
    message_id: m.message_id,
    message_type: m.message_type,
    sender: m.sender,
    recipient: m.recipient,
    in_reply_to: m.in_reply_to,
    packet_id: m.packet_id,
    pr_number: m.pr_number,
    authority_status: m.authority.status,
    usable: m.usable,
    envelope_problems: m.envelope_problems,
    redactions: m.redactions,
    excerpt: m.excerpt,
  };
}

/** A task as the list shows it: every stage's status and newest evidence. */
function taskSummary(t) {
  return {
    task_id: t.task_id,
    request: t.request,
    requester: t.requester,
    responder: t.responder,
    stages: Object.fromEntries(Object.entries(t.stages).map(([name, s]) => [name, {
      status: s.status,
      evidence: s.evidence.length ? s.evidence[s.evidence.length - 1] : null,
      evidence_count: s.evidence.length,
      ...(s.age_seconds !== undefined ? { age_seconds: s.age_seconds, liveness: s.liveness, clock_skew_suspected: s.clock_skew_suspected } : {}),
      ...(s.disposition !== undefined ? { disposition: s.disposition, classification: s.classification } : {}),
    }])),
    review: t.review,
    revision: t.revision,
    merge_authority: t.merge_authority,
    confidence: t.confidence,
    sender_alias_used: t.sender_alias_used ?? false,
    delivery: t.delivery,
    returns_count: t.returns.length,
    related_count: t.related.length,
    mismatched_count: t.mismatched.length,
    problems: t.problems,
  };
}

/**
 * The bounded view the HTTP endpoint and CLI return: task summaries, a recent
 * feed with AUTO_EVENT noise collapsed unless asked for, and one task's full
 * chain with bodies when `task` names it.
 */
export function viewOf(snapshot, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 200);
  const includeNoise = options.includeNoise === true;
  const feed = snapshot.messages.filter((m) => includeNoise || !m.noise).slice(-limit).reverse();
  const view = {
    schema: snapshot.schema,
    repository: snapshot.repository,
    issue: snapshot.issue,
    observed_at: snapshot.observed_at,
    authority_record: snapshot.authority_record,
    provenance: snapshot.provenance,
    worker: snapshot.worker,
    counts: snapshot.counts,
    tasks: snapshot.tasks.slice(0, limit).map(taskSummary),
    unmatched: snapshot.unmatched.slice(-limit).reverse(),
    feed: feed.map((m) => messageSummary(m, false)),
    noise_hidden: includeNoise ? 0 : snapshot.messages.filter((m) => m.noise).length,
    task: null,
  };
  if (options.task !== undefined && options.task !== null) {
    const id = Number(options.task);
    const task = snapshot.tasks.find((t) => t.task_id === id);
    if (task) {
      const ids = new Set([
        task.task_id,
        ...Object.values(task.stages).flatMap((s) => s.evidence.map((e) => e.comment_id)),
        ...task.returns.map((r) => r.comment_id),
        ...task.related.map((r) => r.comment_id),
        ...task.mismatched.map((x) => x.comment_id),
      ]);
      // The same stage shape as the list, plus every piece of evidence.
      view.task = {
        ...taskSummary(task),
        stage_evidence: Object.fromEntries(Object.entries(task.stages).map(([name, s]) => [name, s.evidence])),
        returns: task.returns,
        related: task.related,
        mismatched: task.mismatched,
        chain: snapshot.messages.filter((m) => ids.has(m.comment_id)).map((m) => messageSummary(m, true)),
      };
    } else {
      view.task = { task_id: id, missing: true };
    }
  }
  return view;
}

export default { projectHandoffs, viewOf, readMessage, redactCredentials, safeSourceUrl, controlCommentUrl };
