#!/usr/bin/env node
/** Replay this separately identified publication snapshot with the unchanged P0 runner.
 * No network, worker, checkpoint mutation, merge or runtime effect is performed.
 * Pass the same four explicit arguments documented by replay-authority.mjs.
 */
import fs from 'node:fs';
import { runReplay } from '../../2026-10-17-p0-safety-review/authority/replay-authority.mjs';

try {
  const result = await runReplay(process.argv.slice(2));
  const at = process.argv.indexOf('--comments-file');
  if (at < 0) throw new Error('Use the explicit --comments-file <path> form.');
  const raw = JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8'));
  const comments = Array.isArray(raw) ? raw.flat() : raw.comments;
  const ruling = comments.find(c => c.id === 6240050804);
  if (!ruling || ruling.created_at !== ruling.updated_at ||
      !ruling.body.includes('message_id: CG-REVIEW-KF155-006') ||
      !ruling.body.includes('decision: SEMANTIC_PASS_AND_REANCHOR_CONTRADICTION_SETTLED') ||
      !result.reduction.applied.some(effect => effect.comment_id === ruling.id && effect.effect === 'NO_STATE_CHANGE')) {
    throw new Error('Required unedited live ruling is absent from this snapshot.');
  }
  result.report_kind = 'frozen_continuation_publication_authority_replay';
  result.formal_contradiction_ruling = {
    still_owed_at_snapshot: false,
    ruling_id: ruling.id,
    ruling_url: 'https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240050804',
    settled_review_id: 6023054785,
    settled_contradiction_id: 6023151885,
    interpretation: 'The valid typed ruling records narrow semantic PASS, settles the obsolete re-anchor demand and preserves NO_STATE_CHANGE. It grants neither admission nor merge.'
  };
  result.worker_observation = {
    directive_id: 6240051686,
    acknowledgement_in_snapshot: comments.some(c =>
      /message_type:\s*ACK\b/.test(c.body || '') &&
      /(?:CG-DIR-F9-001|KF-META-MERGE-AUTHORITY-001)/.test(c.body || '')),
    limit: 'Issue-history observation only. No installed worker cursor, process or liveness probe is performed.'
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.consistent || !result.direct_reduce_matches_reconcile) process.exitCode = 1;
} catch (error) {
  process.stderr.write('Publication replay failed: ' + error.message + '\n');
  process.exitCode = 2;
}
