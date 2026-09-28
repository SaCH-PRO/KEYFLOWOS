/**
 * CONTROL-ENVELOPE — the one parser for issue #80 control messages.
 * (KF-META-CONTROL-PARSER-001; contract: option T in
 * CG-REVIEW-META-CONTROL-PARSER-DECISION-001)
 *
 * Every consumer reads #80 through this module: event normalization
 * (events.mjs), source precedence (reconcile.mjs), the successor activation
 * evaluator (platform-dag.mjs) and the local worker's selector
 * (select-directive.mjs, wrapped by select-directive.ps1). None of them reads
 * a control field any other way.
 *
 * Field syntax, the same for every consumer:
 *   - a field is a top-level `key: value` line at column 0, anywhere in the
 *     body. As in YAML, the colon must be followed by whitespace or the end of
 *     the line, so `key:value` is not a field.
 *   - inline comments and quoting follow lib/yaml.mjs: ` # ...` outside quotes
 *     is a comment, and a quoted value is decoded as the codec decodes it.
 *   - '', '~' and 'null' are null.
 *   - a key that appears more than once, including in a second fenced block,
 *     is ambiguous: its value is null and the envelope is malformed.
 *   - a value with an unmatched quote is malformed.
 *
 * Two validation profiles, defined only here:
 *   AUTHORITY   what makes a message execution authority. Used by every consumer.
 *   ACTIVATION  AUTHORITY plus the successor programme's activation vocabulary.
 *               Used only by platformProgrammeState. Strictly additive.
 *
 * A single body cannot show provenance, edits or order. collectAuthority()
 * adds them from the comment metadata and fails closed when they are missing.
 */

import { parseScalar, stripComment } from './yaml.mjs';
import { HEALTH, STATES } from './state-machine.mjs';

/** Message types that carry execution authority when ChatGPT sends them. */
export const AUTHORITY_MESSAGE_TYPES = Object.freeze(['DIRECTIVE', 'REVIEW', 'HOLD', 'RESUME']);

/**
 * Types issue #80 declares under "Message types" ("Use one of") that carry no
 * authority, plus the automation's own records. ChatGPT speaks only in
 * declared types, so from the ChatGPT sender anything else is unreadable
 * authority, never silence.
 */
export const DECLARED_NON_AUTHORITY_TYPES = Object.freeze([
  'ACK', 'PROGRESS', 'MOMENTUM', 'CONTRADICTION', 'RETURN', 'CLOSE', 'AUTO_EVENT', 'AUTO_MERGE',
]);

/** Exact, case-sensitive sender value. */
export const AUTHORITY_SENDER = 'chatgpt';

/**
 * GitHub accounts whose comments may carry authority. Must equal
 * AGENT_AUTOPILOT_POLICY.yaml worker.dispatch_authority.author_allowlist; the
 * repository is public, so `sender:` alone proves nothing.
 */
export const AUTHORIZED_AUTHORS = Object.freeze(['SaCH-PRO']);

/**
 * Keys every issue #80 control message carries (issue #80 body, "Every message
 * must include"). `source_main|source_head` is satisfied by either.
 * AUTHORITY requires each key to be present, with null allowed because
 * historical authority uses it. ACTIVATION also requires a value.
 */
export const REQUIRED_ENVELOPE = Object.freeze([
  'message_id',
  'packet_id',
  'sender',
  'source_main|source_head',
  'implementation_branch',
  'state',
  'health',
  'scope_changed',
  'production_touched',
]);

export const PROFILES = Object.freeze({ AUTHORITY: 'AUTHORITY', ACTIVATION: 'ACTIVATION' });

/** Why a collection of comments cannot establish authority. */
export const AUTHORITY_FAILURES = Object.freeze({
  UNVERIFIABLE: 'AUTHORITY_UNVERIFIABLE',
  EDITED: 'AUTHORITY_EDITED',
  ORDER_AMBIGUOUS: 'AUTHORITY_ORDER_AMBIGUOUS',
});

/** Fields whose value must fit on the key line. */
const CONTROL_FIELDS = Object.freeze([
  'message_id', 'message_type', 'packet_id', 'sender', 'source_main', 'source_head',
  'implementation_branch', 'state', 'health', 'scope_changed', 'production_touched',
  'programme', 'programme_action',
]);

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_.-]*):(?=[ \t]|$)(.*)$/;
const BLOCK_INDICATOR = /^[>|][-+]?$/;
const SHA = /^[0-9a-f]{40}$/;
const BOOLEAN = Object.freeze(['true', 'false']);

// ------------------------------------------------------------------ parsing

/**
 * True when `text` is exactly one well-terminated quoted scalar. Double quotes
 * honour backslash escapes, so `"KF-X\"` is unterminated. Single quotes escape
 * only as a doubled '', so `'a'b'` has a stray quote inside.
 */
function wellQuoted(text) {
  const q = text[0];
  if ((q !== '"' && q !== "'") || text.length < 2 || text[text.length - 1] !== q) return false;
  let i = 1;
  while (i < text.length - 1) {
    if (q === '"' && text[i] === '\\') i += 2;
    else if (text[i] === q) {
      if (q === "'" && text[i + 1] === "'" && i + 1 < text.length - 1) i += 2;
      else return false;
    } else i += 1;
  }
  // An escape that swallowed the final quote leaves i past it.
  return i === text.length - 1;
}

function decodeValue(rest) {
  const text = stripComment(rest).trim();
  const opens = /^["']/.test(text);
  const closes = /["']$/.test(text);
  if (opens || closes) {
    const balanced = wellQuoted(text);
    // The envelope is malformed either way. The value is still read as it
    // appears, so `programme: 'X` names X and holds rather than vanishing, and
    // `sender: "chatgpt` is malformed authority rather than somebody else's.
    if (!balanced) return { value: text.replace(/^["']|["']$/g, ''), problem: 'unmatched quote' };
    return { value: String(parseScalar(text)) };
  }
  if (BLOCK_INDICATOR.test(text)) return { value: null, block: true };
  if (text === '' || text === '~' || text === 'null') return { value: null };
  return { value: text };
}

/**
 * Parse the top-level fields of a #80 comment body.
 *
 * @returns {{fields: object, values: object, keys: string[], blocks: string[], problems: string[]}}
 *   fields  key -> value; null when absent-valued or repeated
 *   values  key -> every value in body order, so a filter can see a repeat
 *   problems  syntax problems; empty means well formed
 */
export function parseEnvelope(body) {
  const env = { fields: Object.create(null), values: Object.create(null), keys: [], blocks: [], problems: [] };
  if (typeof body !== 'string') {
    env.problems.push('body (not text)');
    return env;
  }
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(KEY_LINE);
    if (!m) continue;
    const [, key, rest] = m;
    const decoded = decodeValue(rest);
    if (!Object.hasOwn(env.values, key)) {
      env.values[key] = [];
      env.keys.push(key);
    }
    env.values[key].push(decoded.value);
    if (decoded.problem) env.problems.push(`${key} (${decoded.problem})`);
    if (decoded.block && !env.blocks.includes(key)) env.blocks.push(key);
  }
  for (const key of env.keys) {
    if (env.values[key].length > 1) {
      env.problems.push(`${key} (repeated; ambiguous)`);
      env.fields[key] = null;
    } else {
      env.fields[key] = env.values[key][0];
    }
  }
  return env;
}

/** The single value of `key`, or null when absent, null or ambiguous. */
export function envelopeField(env, key) {
  return Object.hasOwn(env.fields, key) ? env.fields[key] : null;
}

const has = (env, key) => Object.hasOwn(env.values, key);

// ----------------------------------------------------------------- profiles

/** AUTHORITY: what one body must satisfy to carry execution authority. */
function authorityProblems(env) {
  const problems = [...env.problems];
  const type = envelopeField(env, 'message_type');
  if (!AUTHORITY_MESSAGE_TYPES.includes(type)) {
    problems.push(`message_type (${type} is not ${AUTHORITY_MESSAGE_TYPES.join('/')})`);
  }
  const sender = envelopeField(env, 'sender');
  if (sender !== AUTHORITY_SENDER) problems.push(`sender (${sender} is not exactly ${AUTHORITY_SENDER})`);
  // An identity is text. A quoted "" or "   " decodes to a string, not null,
  // and would otherwise name nothing while passing (Copilot r4117477528).
  for (const key of ['message_id', 'packet_id']) {
    const value = envelopeField(env, key);
    if (value === null) problems.push(`${key} (absent or null)`);
    else if (value.trim() === '') problems.push(`${key} (blank)`);
  }
  for (const spec of REQUIRED_ENVELOPE) {
    if (spec.split('|').every((key) => !has(env, key))) problems.push(`${spec} (absent)`);
  }
  for (const key of CONTROL_FIELDS) {
    if (env.blocks.includes(key)) problems.push(`${key} (block scalar; a control field is one line)`);
  }
  return problems;
}

/** ACTIVATION: AUTHORITY plus today's activation vocabulary, unchanged. */
function activationProblems(env) {
  const problems = authorityProblems(env);
  const value = (key) => envelopeField(env, key);
  for (const spec of REQUIRED_ENVELOPE) {
    if (spec.split('|').every((key) => value(key) === null)) problems.push(`${spec} (activation requires a value)`);
  }
  for (const key of ['source_main', 'source_head']) {
    if (value(key) !== null && !SHA.test(value(key))) problems.push(`${key} (not a 40-hex SHA)`);
  }
  if (value('state') !== null && !STATES.includes(value('state'))) problems.push(`state (${value('state')} is not a packet state)`);
  if (value('health') !== null && !HEALTH.includes(value('health'))) problems.push(`health (${value('health')} is not ${HEALTH.join('/')})`);
  for (const key of ['scope_changed', 'production_touched']) {
    if (value(key) !== null && !BOOLEAN.includes(value(key))) problems.push(`${key} (not true/false)`);
  }
  return problems;
}

/** Every problem of an envelope under a profile; an empty list is the only pass. */
export function validateEnvelope(env, profile) {
  if (profile === PROFILES.AUTHORITY) return authorityProblems(env);
  if (profile === PROFILES.ACTIVATION) return activationProblems(env);
  throw new Error(`unknown envelope profile: ${profile}`);
}

/**
 * Why a message typed as authority is not from the authority at all, or null.
 * Checked before the envelope: a non-ChatGPT sender or an outside author makes
 * the message somebody else's, so it can never displace or hold real authority.
 */
export function rejectionOf(env, author, authors = AUTHORIZED_AUTHORS) {
  const senders = env.values.sender || [];
  if (!senders.includes(AUTHORITY_SENDER)) {
    return `sender_not_chatgpt:${senders.filter((s) => s !== null).join(',')}`;
  }
  if (!author || !authors.map((a) => String(a).toLowerCase()).includes(String(author).toLowerCase())) {
    return `author_not_authorized:${author || ''}`;
  }
  return null;
}

/**
 * The authority type a body claims, or null when it plainly is not authority.
 * Any occurrence of an authority type counts, so a repeat whose first value
 * is something else cannot hide it. From the ChatGPT sender, a missing,
 * repeated or undeclared type (say `HOLDD`, `directive` or `PLAN`) returns
 * UNKNOWN: it is authority that cannot be read, and it fails closed.
 */
export function claimedAuthorityType(env) {
  const types = env.values.message_type || [];
  const authority = types.find((t) => AUTHORITY_MESSAGE_TYPES.includes(t));
  if (authority) return authority;
  if (!(env.values.sender || []).includes(AUTHORITY_SENDER)) return null;
  if (types.length === 1 && DECLARED_NON_AUTHORITY_TYPES.includes(types[0])) return null;
  return 'UNKNOWN';
}

// --------------------------------------------------------------- comments

/**
 * One comment from either input shape:
 *   REST       {id, created_at, updated_at, user: {login}, body, html_url}
 *   gh view    {id: 'IC_...', createdAt, includesCreatedEdit, author: {login}, body, url}
 * `edited` is true, false, or null when the shape carries no edit evidence.
 * The raw body and timestamps are kept as audit evidence (issue #98).
 */
export function normalizeComment(comment) {
  const c = comment || {};
  let id = null;
  if (Number.isSafeInteger(c.id)) id = c.id;
  else if (typeof c.id === 'string' && /^\d+$/.test(c.id)) id = Number(c.id);
  else {
    const m = String(c.url || c.html_url || '').match(/#issuecomment-(\d+)$/);
    if (m) id = Number(m[1]);
  }
  const createdAt = c.created_at ?? c.createdAt ?? null;
  const evidence = [];
  if (typeof c.includesCreatedEdit === 'boolean') evidence.push(c.includesCreatedEdit);
  if (typeof c.updated_at === 'string' && typeof c.created_at === 'string') evidence.push(c.updated_at !== c.created_at);
  return {
    id,
    created_at: createdAt,
    updated_at: typeof c.updated_at === 'string' ? c.updated_at : null,
    includes_created_edit: typeof c.includesCreatedEdit === 'boolean' ? c.includesCreatedEdit : null,
    author: c.user?.login ?? c.author?.login ?? null,
    body: typeof c.body === 'string' ? c.body : '',
    edited: evidence.length ? evidence.some(Boolean) : null,
    url: c.url ?? c.html_url ?? null,
  };
}

/** True when an entry can be placed in the authority order. */
export function hasDeterministicOrder(entry) {
  return Number.isSafeInteger(entry?.comment_id ?? entry?.id) && !Number.isNaN(Date.parse(entry?.created_at));
}

/** Oldest first: created_at, then comment id (monotonic on GitHub). */
export function compareAuthorityOrder(a, b) {
  const t = Date.parse(a.created_at) - Date.parse(b.created_at);
  return t !== 0 ? t : Number(a.comment_id) - Number(b.comment_id);
}

function unverified(code, reason, extra = {}) {
  return { verified: false, code, reason, messages: [], newest: null, candidates: [], malformed: [], rejected: 0, rejections: [], ...extra };
}

/**
 * Reduce raw issue #80 comments to the ordered authority record.
 *
 * Fails closed (verified: false) when the comments were not observed, when any
 * comment from an allowlisted account is edited or its edit state is unknown
 * (an edit can add, change or remove authority, and the prior body is gone),
 * or when authority cannot be ordered. Deleting a newer comment is not
 * detectable from a snapshot; nothing here pretends otherwise.
 *
 * Otherwise every authority-typed message from an allowlisted author with
 * sender chatgpt is a candidate, in order. A candidate is valid under the
 * AUTHORITY profile or malformed; a malformed candidate is still authority
 * speaking, so callers must fail closed on it rather than skip it.
 *
 * @param {Array|null} comments issue comments, REST or `gh issue view` shape
 * @param {object} [options] { authors } allowlist override (the worker passes its configured list)
 */
export function collectAuthority(comments, options = {}) {
  if (!Array.isArray(comments)) {
    return unverified(AUTHORITY_FAILURES.UNVERIFIABLE, 'issue #80 comments were not observed');
  }
  const authors = (options.authors || AUTHORIZED_AUTHORS).map((a) => String(a).toLowerCase());
  const candidates = [];
  const rejections = [];
  const edited = [];
  const editUnknown = [];

  for (const raw of comments) {
    const c = normalizeComment(raw);
    const allowlisted = c.author !== null && authors.includes(String(c.author).toLowerCase());
    if (allowlisted && c.edited === true) edited.push(c.id ?? c.url);
    if (allowlisted && c.edited === null) editUnknown.push(c.id ?? c.url);

    const env = parseEnvelope(c.body);
    const type = claimedAuthorityType(env);
    if (!type) continue;
    const entry = {
      message_id: envelopeField(env, 'message_id'),
      message_type: type === 'UNKNOWN' ? envelopeField(env, 'message_type') : type,
      packet_id: envelopeField(env, 'packet_id'),
      sender: envelopeField(env, 'sender'),
      state: envelopeField(env, 'state'),
      health: envelopeField(env, 'health'),
      source_main: envelopeField(env, 'source_main'),
      source_head: envelopeField(env, 'source_head'),
      implementation_branch: envelopeField(env, 'implementation_branch'),
      comment_id: c.id,
      created_at: c.created_at,
      author: c.author,
      url: c.url,
      // Audit evidence: exactly what was read, and the edit evidence it was read with.
      evidence: { body: c.body, updated_at: c.updated_at, includes_created_edit: c.includes_created_edit, edited: c.edited },
      envelope: env,
    };
    const reason = rejectionOf(env, c.author, authors);
    if (reason) {
      rejections.push({ ...entry, reason });
      continue;
    }
    entry.problems = validateEnvelope(env, PROFILES.AUTHORITY);
    candidates.push(entry);
  }

  if (edited.length) {
    return unverified(AUTHORITY_FAILURES.EDITED, `edited comment(s) from an authorized author: ${edited.join(', ')}; their prior content is not verifiable`);
  }
  if (editUnknown.length) {
    return unverified(AUTHORITY_FAILURES.UNVERIFIABLE, `edit state not observable for comment(s) from an authorized author: ${editUnknown.join(', ')}`);
  }
  const unordered = candidates.filter((e) => !hasDeterministicOrder(e));
  if (unordered.length) {
    return unverified(AUTHORITY_FAILURES.ORDER_AMBIGUOUS, 'an authority comment has no id or timestamp; ordering is not deterministic');
  }
  // Rejections count too: a rejected message sharing an id with a candidate
  // means the snapshot cannot say which comment that id is.
  const ids = [...candidates, ...rejections].map((e) => e.comment_id).filter((id) => id !== null);
  if (new Set(ids).size !== ids.length) {
    return unverified(AUTHORITY_FAILURES.ORDER_AMBIGUOUS, 'two authority comments share a comment id; ordering is not deterministic');
  }

  candidates.sort(compareAuthorityOrder);
  const messages = candidates.filter((e) => e.problems.length === 0);
  return {
    verified: true,
    messages,
    newest: messages.length ? messages[messages.length - 1] : null,
    candidates,
    malformed: candidates.filter((e) => e.problems.length > 0),
    rejected: rejections.length,
    rejections,
  };
}

export default {
  AUTHORITY_MESSAGE_TYPES,
  AUTHORITY_SENDER,
  AUTHORIZED_AUTHORS,
  AUTHORITY_FAILURES,
  REQUIRED_ENVELOPE,
  DECLARED_NON_AUTHORITY_TYPES,
  PROFILES,
  claimedAuthorityType,
  parseEnvelope,
  envelopeField,
  validateEnvelope,
  rejectionOf,
  normalizeComment,
  hasDeterministicOrder,
  compareAuthorityOrder,
  collectAuthority,
};
