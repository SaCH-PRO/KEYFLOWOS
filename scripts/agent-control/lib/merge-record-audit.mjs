/**
 * Audit of the AUTO_MERGE records: does every merge the autopilot made have
 * its record on the control room?
 *
 * The recorder runs in the same job as the merge. If that job dies between
 * the merge and the record, or the post is refused, the job goes red once and
 * nothing looks again: the PR is closed, so no sweep meets it, and nothing
 * reads AUTO_MERGE to notice it is missing. This audit is what looks again.
 *
 * It derives what SHOULD be recorded from the repository, not from any log:
 * a merged implementation PR whose merge was made by the workflow token. The
 * record for it is rebuilt from the PR itself (number, head at merge, merge
 * commit) with the recorder's own builder, and compared with the recorder's
 * own matcher. A merge made by a person owes no AUTO_MERGE record and is not
 * audited.
 *
 * Pure: it classifies and never writes. Reconciling a missing record is the
 * recorder's job (recordMerge), called by the CLI when asked to.
 */

import { buildMergeRecord, existingRecordsFor } from './merge-record.mjs';

/** The login a merge by the workflow token carries. */
export const AUTOPILOT_MERGER = 'github-actions[bot]';

export const AUDIT_STATES = Object.freeze({
  RECORDED: 'recorded',
  MISSING: 'missing',
  CONFLICT: 'conflict',
});

/** The evaluator result a merged PR stands for, as the recorder would have been handed it. */
export function mergeResultOf(pr) {
  return { eligible: true, pr: pr.number, head_sha: pr?.head?.sha, merge: { merged: true, sha: pr.merge_commit_sha } };
}

/** Whether this merged PR is one the autopilot merged and therefore owes a record. */
export function owesRecord(pr) {
  return pr?.merged === true
    && String(pr?.merged_by?.login || '') === AUTOPILOT_MERGER
    && String(pr?.head?.ref || '').startsWith('impl/');
}

/**
 * @param {object[]} mergedPrs  full PR objects (GET /pulls/{n}), any merger
 * @param {object[]} comments   EVERY control-room comment
 */
export function auditMergeRecords(mergedPrs, comments) {
  if (!Array.isArray(comments)) throw new Error('the control-room comments could not be read as a list');
  const entries = [];
  for (const pr of mergedPrs) {
    if (!owesRecord(pr)) continue;
    // Throws when a merged PR has no usable merge commit or head: an audit
    // that cannot say what should be recorded has not audited that merge.
    const record = buildMergeRecord(mergeResultOf(pr));
    const { records, conflicts } = existingRecordsFor(record, comments);
    const state = conflicts.length ? AUDIT_STATES.CONFLICT : records.length ? AUDIT_STATES.RECORDED : AUDIT_STATES.MISSING;
    entries.push({
      pr: pr.number,
      merge_sha: record.merge_sha,
      merged_at: pr.merged_at ?? null,
      state,
      record_comment_id: records[0]?.id ?? null,
      duplicates: records.slice(1).map((c) => c.id ?? null),
      conflicts,
    });
  }
  const of = (state) => entries.filter((e) => e.state === state);
  return {
    audited: entries.length,
    recorded: of(AUDIT_STATES.RECORDED).length,
    missing: of(AUDIT_STATES.MISSING).map((e) => e.pr),
    conflicts: of(AUDIT_STATES.CONFLICT).map((e) => e.pr),
    duplicates: entries.filter((e) => e.duplicates.length).map((e) => e.pr),
    clean: entries.every((e) => e.state === AUDIT_STATES.RECORDED),
    entries,
  };
}

export default { AUTOPILOT_MERGER, AUDIT_STATES, mergeResultOf, owesRecord, auditMergeRecords };
