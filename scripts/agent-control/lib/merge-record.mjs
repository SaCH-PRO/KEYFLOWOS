/**
 * The durable AUTO_MERGE record: one comment on the control room for each
 * merge the autopilot makes.
 *
 * It was written inline by the event-driven job only, so a merge made by the
 * hourly sweep left no record at all. Both jobs now go through this module,
 * and the record is the same whichever of them merged.
 *
 * Nothing reads AUTO_MERGE to decide anything: reconciliation learns of a
 * merge from the repository (lib/truth.mjs, PR_ALREADY_MERGED in
 * lib/reconcile.mjs). The record is audit evidence, which is why a merge
 * without one must be a visible failure rather than a quiet gap.
 *
 * Idempotent on the merge commit: a replay finds the record and posts nothing.
 * "Finds the record" means a comment by a trusted author whose whole content
 * is the record for THIS merge -- the same PR, admitted head and merge commit,
 * every field, nothing else. A marker alone proves none of that. A trusted
 * comment that carries the marker and says anything different is a conflict:
 * the true record is still made sure of, and the recorder then fails, because
 * two trusted statements about one merge that disagree are not evidence.
 *
 * A marker from anyone else is ignored. The repository is public, and a marker
 * pasted by a stranger must not be able to suppress or contest a real record.
 *
 * Concurrency. Listing and posting are two API calls and GitHub offers no
 * conditional create, so two recorders running at once for one merge can both
 * post. Inside the workflow that cannot happen: both merging jobs hold the
 * single mutation lock (MUTATION_LOCK in lib/events.mjs). The remaining way
 * is an operator re-recording by hand while a job records. The result is two
 * identical, correct records; every later run reports the extra ones under
 * `duplicates`. Nothing is deleted from the control room.
 */

import { CONTROL_ISSUE } from './events.mjs';
import { AUTHORIZED_AUTHORS } from './control-envelope.mjs';

export const RECORD_OUTCOMES = Object.freeze({
  RECORDED: 'recorded',
  ALREADY_RECORDED: 'already_recorded',
  NOT_MERGED: 'not_merged',
  CONFLICT: 'conflict',
});

/** The workflow token posts as this login; the allowlist covers a manual re-record. */
export const RECORD_AUTHORS = Object.freeze(['github-actions[bot]', ...AUTHORIZED_AUTHORS]);

const SHA = /^[0-9a-f]{40}$/;

export const mergeMarker = (sha) => `<!-- keyflow-autopilot-merge:${sha} -->`;

/** The record's fields, in order. The body is built from this and checked against it. */
function recordFields(result) {
  return [
    ['message_id', 'AUTO-MERGE-' + result.merge.sha],
    ['message_type', 'AUTO_MERGE'],
    ['sender', 'github-autopilot'],
    ['pr_number', String(result.pr)],
    ['admitted_head', result.head_sha],
    ['merged', 'true'],
    ['merge_sha', result.merge.sha],
    ['next_action', 'post_merge_verify_and_checkpoint'],
  ];
}

/**
 * The record for an evaluator result, or null when that result merged nothing.
 * A result that says it merged but cannot name what it merged throws: there is
 * no honest record to write, and silence would hide a real merge.
 */
export function buildMergeRecord(result) {
  const merge = result?.merge;
  if (!merge || merge.merged !== true) return null;

  const problems = [];
  if (!SHA.test(String(merge.sha || ''))) problems.push('merge.sha');
  if (!SHA.test(String(result.head_sha || ''))) problems.push('head_sha');
  if (!Number.isInteger(result.pr) || result.pr <= 0) problems.push('pr');
  if (problems.length) {
    throw new Error(`the merge result reports a merge but has no usable ${problems.join(', ')}`);
  }

  const marker = mergeMarker(merge.sha);
  const fields = recordFields(result);
  const body = [marker, '```yaml', ...fields.map(([k, v]) => `${k}: ${v}`), '```'].join('\n');
  return { marker, body, fields, merge_sha: merge.sha, pr: result.pr };
}

const normalize = (text) => String(text).replace(/\r\n/g, '\n').trim();

/**
 * Why a comment that carries the marker is not the record for this merge.
 * An empty list means it is: its content equals the record exactly, apart
 * from line endings and surrounding whitespace. The codes say what differs so
 * a person reading the failure does not have to diff two comments.
 */
export function recordProblems(body, record) {
  const text = normalize(body);
  if (text === record.body) return [];
  if (text === record.marker) return ['marker_only'];

  const block = text.match(/```yaml\n([\s\S]*?)\n```/);
  if (!block) return ['malformed:no_yaml_block'];

  const problems = [];
  const found = new Map();
  for (const line of block[1].split('\n')) {
    const m = line.match(/^([a-z_]+): (.*)$/);
    if (!m) { problems.push('malformed:unreadable_line'); continue; }
    if (found.has(m[1])) problems.push(`malformed:repeated_${m[1]}`);
    else found.set(m[1], m[2]);
  }
  for (const [key, value] of record.fields) {
    if (!found.has(key)) problems.push(`missing:${key}`);
    else if (found.get(key) !== value) problems.push(`mismatch:${key}`);
    found.delete(key);
  }
  for (const key of found.keys()) problems.push(`unexpected:${key}`);
  // Every field agrees and it still is not the record: text around the block.
  return problems.length ? [...new Set(problems)] : ['differs_from_record'];
}

const trusted = (comment) => {
  const login = String(comment?.user?.login || '').toLowerCase();
  return RECORD_AUTHORS.some((a) => a.toLowerCase() === login);
};

/** Trusted comments disagree about one merge. Carries what a caller must report. */
export class MergeRecordConflict extends Error {
  constructor(detail) {
    const ids = detail.conflicts.map((c) => `${c.comment_id} (${c.problems.join(', ')})`).join('; ');
    super(`trusted control-room comment(s) carry the marker for merge ${detail.merge_sha} but are not its record: ${ids}`);
    this.name = 'MergeRecordConflict';
    this.detail = { outcome: RECORD_OUTCOMES.CONFLICT, ...detail };
  }
}

/**
 * Record a merge once. `listComments` returns EVERY control-room comment and
 * `createComment` posts one and returns what was stored; both throw on
 * failure, and so does this. It returns only when the record for this merge
 * is known to exist and no trusted comment contradicts it, or when there was
 * no merge to record. It throws MergeRecordConflict when one does.
 */
export async function recordMerge(result, { listComments, createComment }) {
  const record = buildMergeRecord(result);
  if (!record) return { outcome: RECORD_OUTCOMES.NOT_MERGED };

  const identity = { merge_sha: record.merge_sha, pr: record.pr, issue: CONTROL_ISSUE };
  const existing = await listComments();
  if (!Array.isArray(existing)) throw new Error('the control-room comments could not be read as a list');

  const records = [];
  const conflicts = [];
  for (const c of existing) {
    if (typeof c?.body !== 'string' || !c.body.includes(record.marker) || !trusted(c)) continue;
    const problems = recordProblems(c.body, record);
    if (problems.length === 0) records.push(c);
    else conflicts.push({ comment_id: c.id ?? null, author: c.user.login, url: c.html_url ?? null, problems });
  }

  let outcome = RECORD_OUTCOMES.ALREADY_RECORDED;
  let stored = records[0] || null;
  let postError = null;
  if (!stored) {
    try {
      const created = await createComment(record.body);
      // A 2xx with no stored record behind it is not a record.
      if (!created || !created.id || typeof created.body !== 'string' || recordProblems(created.body, record).length !== 0) {
        throw new Error('the control room did not confirm the AUTO_MERGE record it was sent');
      }
      stored = created;
      outcome = RECORD_OUTCOMES.RECORDED;
    } catch (error) {
      // With a conflict present both facts are reported; alone, this is the failure.
      if (!conflicts.length) throw error;
      postError = error.message;
    }
  }

  if (conflicts.length) {
    throw new MergeRecordConflict({
      ...identity,
      conflicts,
      record: stored ? { comment_id: stored.id, url: stored.html_url ?? null, posted_now: outcome === RECORD_OUTCOMES.RECORDED } : null,
      record_error: postError,
    });
  }

  const out = { outcome, ...identity, comment_id: stored.id ?? null, url: stored.html_url ?? null };
  // More than one correct record: harmless, but said rather than hidden.
  if (records.length > 1) out.duplicates = records.slice(1).map((c) => c.id ?? null);
  return out;
}

export default { RECORD_OUTCOMES, RECORD_AUTHORS, mergeMarker, buildMergeRecord, recordProblems, recordMerge, MergeRecordConflict };
