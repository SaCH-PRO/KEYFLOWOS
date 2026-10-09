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
 * Idempotent on the merge commit: a replay finds the marker and posts nothing.
 * A marker only counts when a trusted author posted it. The repository is
 * public, and a marker pasted by anyone else must not be able to suppress the
 * record of a real merge.
 */

import { CONTROL_ISSUE } from './events.mjs';
import { AUTHORIZED_AUTHORS } from './control-envelope.mjs';

export const RECORD_OUTCOMES = Object.freeze({
  RECORDED: 'recorded',
  ALREADY_RECORDED: 'already_recorded',
  NOT_MERGED: 'not_merged',
});

/** The workflow token posts as this login; the allowlist covers a manual re-record. */
export const RECORD_AUTHORS = Object.freeze(['github-actions[bot]', ...AUTHORIZED_AUTHORS]);

const SHA = /^[0-9a-f]{40}$/;

export const mergeMarker = (sha) => `<!-- keyflow-autopilot-merge:${sha} -->`;

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
  const body = [
    marker,
    '```yaml',
    'message_id: AUTO-MERGE-' + merge.sha,
    'message_type: AUTO_MERGE',
    'sender: github-autopilot',
    'pr_number: ' + result.pr,
    'admitted_head: ' + result.head_sha,
    'merged: true',
    'merge_sha: ' + merge.sha,
    'next_action: post_merge_verify_and_checkpoint',
    '```',
  ].join('\n');
  return { marker, body, merge_sha: merge.sha, pr: result.pr };
}

const trusted = (comment) => {
  const login = String(comment?.user?.login || '').toLowerCase();
  return RECORD_AUTHORS.some((a) => a.toLowerCase() === login);
};

/**
 * Record a merge once. `listComments` returns EVERY control-room comment and
 * `createComment` posts one and returns what was stored; both throw on
 * failure, and so does this. It returns only when the record is known to
 * exist or there was no merge to record.
 */
export async function recordMerge(result, { listComments, createComment }) {
  const record = buildMergeRecord(result);
  if (!record) return { outcome: RECORD_OUTCOMES.NOT_MERGED };

  const identity = { merge_sha: record.merge_sha, pr: record.pr, issue: CONTROL_ISSUE };
  const existing = await listComments();
  if (!Array.isArray(existing)) throw new Error('the control-room comments could not be read as a list');
  const prior = existing.find((c) => typeof c?.body === 'string' && c.body.includes(record.marker) && trusted(c));
  if (prior) {
    return { outcome: RECORD_OUTCOMES.ALREADY_RECORDED, ...identity, comment_id: prior.id ?? null, url: prior.html_url ?? null };
  }

  const created = await createComment(record.body);
  // A 2xx with no stored comment behind it is not a record.
  if (!created || !created.id || typeof created.body !== 'string' || !created.body.includes(record.marker)) {
    throw new Error('the control room did not confirm the AUTO_MERGE record it was sent');
  }
  return { outcome: RECORD_OUTCOMES.RECORDED, ...identity, comment_id: created.id, url: created.html_url ?? null };
}

export default { RECORD_OUTCOMES, RECORD_AUTHORS, mergeMarker, buildMergeRecord, recordMerge };
