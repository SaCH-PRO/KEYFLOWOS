/**
 * Synthetic issue #80 comments for the merge-grant predicate (F9).
 * REST shape, as auto-merge-admitted.mjs reads them. Every value is
 * synthetic; nothing here was copied from a live comment except the field
 * layout of the PR 159 grant (6111001643), which grantBody() mirrors, and
 * the public body of PLAN 5826799265 (PLAN_5826799265_BODY, below).
 */

export const REPO = 'o/r';
export const HEAD = 'a'.repeat(40);
export const BASE = 'b'.repeat(40);
export const SEMANTIC = 'c'.repeat(40);

/** The grant target the default grant matches. */
export const target = (overrides = {}) => ({
  repository: REPO,
  pr_number: 87,
  packet_id: 'KF-X-001',
  implementation_branch: 'impl/x',
  source_head: SEMANTIC,
  pr_head: HEAD,
  base_sha: BASE,
  ...overrides,
});

/**
 * A body as `key: value` lines. A key mapped to undefined is left out; an
 * array value repeats the key.
 */
export function body(fields, prose = '') {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${v === null ? '' : v}`);
  }
  return lines.join('\n') + (prose ? `\n\n${prose}\n` : '\n');
}

/** The fields of a valid exact-head grant for target(), in the PR 159 layout. */
export function grantFields(overrides = {}, t = target()) {
  return {
    message_id: 'CG-REVIEW-SYNTHETIC-MERGE-AUTH-001',
    message_type: 'REVIEW',
    packet_id: t.packet_id,
    sender: 'chatgpt',
    source_main: t.base_sha,
    source_head: t.source_head,
    pr_head: t.pr_head,
    implementation_branch: t.implementation_branch,
    pr_number: t.pr_number,
    state: 'READY_TO_MERGE',
    health: 'GREEN',
    scope_changed: 'false',
    production_touched: 'false',
    provider_traffic: 'false',
    review_status: 'READY_TO_MERGE',
    programme_credit: 'ZERO',
    merge_authority: 'true',
    control_effect: 'NO_STATE_CHANGE',
    ...overrides,
  };
}

let nextId = 7000000000;
let clock = Date.parse('2026-10-17T12:00:00Z');

/** One REST comment. Each call is newer than the last, unless told otherwise. */
export function comment(text, overrides = {}) {
  const id = overrides.id ?? (nextId += 1);
  clock += 1000;
  const created = overrides.created_at ?? new Date(clock).toISOString().replace('.000Z', 'Z');
  const repo = overrides.repo ?? REPO;
  return {
    id,
    created_at: created,
    updated_at: overrides.updated_at ?? created,
    user: { login: overrides.author ?? 'SaCH-PRO' },
    body: text,
    // An explicit null means the shape carries no URL at all.
    html_url: Object.hasOwn(overrides, 'html_url') ? overrides.html_url : `https://github.com/${repo}/issues/80#issuecomment-${id}`,
    url: Object.hasOwn(overrides, 'url') ? overrides.url : `https://api.github.com/repos/${repo}/issues/comments/${id}`,
  };
}

/** A valid grant comment for target(). */
export const grantComment = (overrides = {}, options = {}, t = target()) => comment(body(grantFields(overrides, t)), options);

/** A valid authority message about the same packet, PR and branch. */
export function followUp(fields = {}, options = {}, t = target()) {
  return comment(body({
    message_id: 'CG-REVIEW-SYNTHETIC-LATER-001',
    message_type: 'REVIEW',
    packet_id: t.packet_id,
    sender: 'chatgpt',
    source_main: t.base_sha,
    source_head: t.source_head,
    implementation_branch: t.implementation_branch,
    pr_number: t.pr_number,
    state: 'PROVING',
    health: 'YELLOW',
    scope_changed: 'false',
    production_touched: 'false',
    review_status: 'CHANGES_REQUIRED',
    merge_authority: 'false',
    control_effect: 'NO_STATE_CHANGE',
    ...fields,
  }), options);
}

/** A HOLD or RESUME for a packet; `fields` adds or overrides body fields. */
export function holdComment(type, packet, options = {}, fields = {}) {
  return comment(body({
    message_id: `CG-${type}-SYNTHETIC-${packet}`,
    message_type: type,
    packet_id: packet,
    sender: 'chatgpt',
    source_main: BASE,
    implementation_branch: 'null',
    state: 'BLOCKED',
    health: 'YELLOW',
    scope_changed: 'false',
    production_touched: 'false',
    control_effect: type === 'HOLD' ? 'HOLD_SET' : 'HOLD_CLEAR',
    ...fields,
  }), options);
}

/** A valid DIRECTIVE about the target: the start of its lifetime on #80. */
export const directiveComment = (fields = {}, options = {}, t = target()) => followUp({
  message_id: 'CG-DIRECTIVE-SYNTHETIC-001',
  message_type: 'DIRECTIVE',
  state: 'IMPLEMENTING',
  review_status: undefined,
  ...fields,
}, options, t);

/**
 * The one comment on the real SaCH-PRO/KEYFLOWOS issue #80 that the H1
 * correction read as a global hold (CC-CONTRADICTION-F9-002, 6245748866):
 * comment 5826799265, posted 2026-09-25T04:34:19Z by SaCH-PRO, never edited.
 * Its body is copied byte for byte from the public comment (LF only); its id
 * and times are the real ones, so it sorts before every synthetic comment, as
 * it precedes every later packet on #80. It has no packet_id, pr_number or
 * implementation_branch, so collectAuthority keeps it as a malformed
 * candidate, and its PLAN type makes it a hold claim.
 */
export const PLAN_5826799265_BODY = [
  '```yaml',
  'message_id: CG-PLAN-PLATFORM-CONVERGENCE-001',
  'message_type: PLAN',
  'sender: chatgpt',
  'source_main: ad97ea48841a0a4acb13f9a170bae0e07159d6f4',
  'programme: KEYFLOWOS_PLATFORM_CONVERGENCE',
  'programme_status: INACTIVE_SUCCESSOR',
  'branch: docs/platform-convergence-programme',
  'commit: ddae797290e8edb806f7f4e4f2445ec9678c00e4',
  'pr: 93',
  'production_touched: false',
  'authority_effect: NONE',
  '',
  'purpose: >',
  '  Durable repository memory for the phased platform/workflow convergence programme.',
  '  It defines ChatGPT architecture/admission, Claude primary implementation, GitHub',
  '  Copilot continuous exact-head review, deterministic CI proof, human-only production',
  '  gates, and the successor machine-readable platform DAG.',
  '',
  'activation: >',
  '  This PLAN is intentionally non-authoritative and MUST NOT supersede the current',
  '  DIRECTIVE/HOLD state. The successor programme activates only through a later valid',
  '  ChatGPT DIRECTIVE or RESUME after the current control loop permits advancement.',
  '',
  'canonical_files:',
  '  - docs/development/KEYFLOWOS_PLATFORM_CONVERGENCE_PROGRAMME.md',
  '  - docs/development/KEYFLOWOS_PLATFORM_DAG.yaml',
  '  - docs/development/KEYFLOWOS_AUTONOMOUS_AGENT_ROLES.md',
  '',
  'copilot_contract: >',
  '  Every semantic PR/push is reviewed; substantive findings must be exact-head',
  '  resolved or rejected with evidence before Claude RETURN / ChatGPT admission.',
  '```',
].join('\n');

/**
 * Comment 5826799265 as REST returns it, on the fixture repository. With
 * `options.created_at` (and an id) the same envelope can be placed later in
 * #80 order, for the at-or-after-floor case.
 */
export const realPlanComment = (options = {}) => comment(PLAN_5826799265_BODY, {
  id: 5826799265,
  created_at: '2026-09-25T04:34:19Z',
  ...options,
});

/** A non-authority Claude message, as ACK/RETURN are. */
export const claudeNote = (type = 'RETURN', options = {}, t = target()) => comment(body({
  message_id: `CC-${type}-SYNTHETIC`,
  message_type: type,
  packet_id: t.packet_id,
  sender: 'claude',
  source_main: t.base_sha,
  implementation_branch: t.implementation_branch,
  pr_number: t.pr_number,
  state: 'PROVING',
  health: 'YELLOW',
  scope_changed: 'false',
  production_touched: 'false',
  merge_authority: 'false',
}), options);
