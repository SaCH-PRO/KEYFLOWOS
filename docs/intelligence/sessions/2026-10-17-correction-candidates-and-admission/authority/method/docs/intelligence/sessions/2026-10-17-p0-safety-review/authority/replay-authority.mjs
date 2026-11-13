#!/usr/bin/env node
/**
 * Read-only replay of the frozen 2026-10-17 authority observation.
 * Uses unchanged, blob-verified repository modules. No network, gh, git, worker,
 * credential, checkpoint-write, PR mutation, or merge operation is performed.
 * Output goes to stdout; redirect only to a separate evidence file if desired.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const digestJSON = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function canonicalComments(comments, normalizeComment) {
  return comments.map(raw => {
    const n = normalizeComment(raw);
    return {
      id: n.id,
      created_at: n.created_at,
      updated_at: n.updated_at,
      includes_created_edit: n.includes_created_edit,
      author: n.author,
      body: n.body,
      edited: n.edited,
      url: raw.html_url ?? n.url,
    };
  }).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function commentArray(input) {
  const comments = Array.isArray(input) ? input.flat() : input.comments;
  if (!Array.isArray(comments)) throw new Error('Expected a REST comments array, paginated arrays, or {comments:[...]}.');
  return comments;
}
function parseArgs(args) {
  const allowed = new Set(['repo-root', 'comments-file', 'manifest', 'repo-truth-file']);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(out, match[1])) {
      throw new Error('Unknown, repeated or positional argument: ' + args[i]);
    }
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing value for --' + match[1]);
    out[match[1]] = value;
  }
  for (const key of allowed) if (!out[key]) throw new Error('Required: --' + key);
  return out;
}
const githubComment = (repo, id) => 'https://github.com/' + repo + '/issues/80#issuecomment-' + id;

export async function runReplay(args) {
  const options = parseArgs(args);
  const repoRoot = path.resolve(options['repo-root']);
  const manifest = readJSON(options.manifest);
  const truth = readJSON(options['repo-truth-file']);
  const sourceVerification = manifest.source_files.map(ref => {
    const bytes = fs.readFileSync(path.join(repoRoot, ref.path));
    const actual = crypto.createHash('sha1')
      .update(Buffer.from('blob ' + bytes.length + '\0'))
      .update(bytes).digest('hex');
    return { ...ref, actual_sha: actual, matched: actual === ref.sha };
  });
  const bad = sourceVerification.filter(ref => !ref.matched);
  if (bad.length) throw new Error('Pinned repository source mismatch: ' + JSON.stringify(bad));

  const moduleAt = rel => import(pathToFileURL(path.join(repoRoot, rel)).href);
  const [{ loadState, activeHolds, validateState }, { loadDag }, envelope, effects, reconciliation, selector] =
    await Promise.all([
      moduleAt('scripts/agent-control/lib/state.mjs'),
      moduleAt('scripts/agent-control/lib/dag.mjs'),
      moduleAt('scripts/agent-control/lib/control-envelope.mjs'),
      moduleAt('scripts/agent-control/lib/authority-effects.mjs'),
      moduleAt('scripts/agent-control/lib/reconcile.mjs'),
      moduleAt('scripts/agent-control/select-directive.mjs'),
    ]);
  const comments = commentArray(readJSON(options['comments-file']));
  const digest = digestJSON(canonicalComments(comments, envelope.normalizeComment));
  if (comments.length !== manifest.comment_snapshot.count || digest !== manifest.comment_snapshot.normalized_sha256) {
    throw new Error('Comment snapshot mismatch: this runner reproduces the frozen observation, not a later or edited snapshot. count=' + comments.length + ' digest=' + digest);
  }
  if (digestJSON(truth.snapshot) !== manifest.repository_snapshot.normalized_sha256) {
    throw new Error('Repository truth snapshot mismatch.');
  }
  if (truth.snapshot.main_sha !== manifest.source_main || truth.snapshot.verified !== true) {
    throw new Error('Repository truth does not identify the pinned observed main.');
  }

  const checkpoint = loadState(repoRoot);
  const dag = loadDag(repoRoot);
  const authority = envelope.collectAuthority(comments);
  const applicationPackets = new Set(dag.byPacket.keys());
  const reduced = effects.reduceAuthority(checkpoint, authority, { applicationPackets });
  const reconciled = reconciliation.reconcileProjection(checkpoint, authority, truth.snapshot, { applicationPackets });
  const selected = selector.selectDirective({ comments, authors: envelope.AUTHORIZED_AUTHORS, processed: [] });
  const canonicalUrl = entry => entry ? { ...entry, url: githubComment(manifest.repository, entry.comment_id) } : null;
  const result = {
    report_kind: 'frozen_authority_observation_replay',
    executed_at_utc: new Date().toISOString(),
    snapshot_collected_at_utc: manifest.comment_snapshot.collection_completed_at_utc,
    repository: manifest.repository,
    source_main: manifest.source_main,
    source_verification: sourceVerification,
    comments: { count: comments.length, normalized_sha256: digest },
    authority: {
      verified: authority.verified,
      candidates: authority.candidates.length,
      valid_messages: authority.messages.length,
      malformed: authority.malformed.map(m => ({ message_id: m.message_id, comment_id: m.comment_id, problems: m.problems, url: githubComment(manifest.repository, m.comment_id) })),
      rejected: authority.rejected,
      rejections: authority.rejections.map(m => ({ message_id: m.message_id, comment_id: m.comment_id, author: m.author, sender: m.sender, reason: m.reason, url: githubComment(manifest.repository, m.comment_id) })),
      newest: authority.newest ? canonicalUrl({
        message_id: authority.newest.message_id, comment_id: authority.newest.comment_id,
        message_type: authority.newest.message_type, packet_id: authority.newest.packet_id,
        created_at: authority.newest.created_at,
      }) : null,
    },
    checkpoint_validation: validateState(checkpoint),
    consistent: reconciled.consistent,
    findings: reconciled.findings,
    reduction: reconciled.reduction,
    effective_programme: reconciled.effective_state.programme,
    authority_basis: reconciled.effective_state.authority_basis,
    active_holds: activeHolds(reconciled.effective_state),
    hold_history: Object.values(reconciled.effective_state.holds || {}).map(h => ({
      packet_id: h.packet_id, active: h.active, hold_message_id: h.hold_message_id,
      hold_comment_id: h.hold_comment_id, released_by: h.released_by,
      released_comment_id: h.released_comment_id,
      release_url: h.released_comment_id ? githubComment(manifest.repository, h.released_comment_id) : null,
    })),
    retained_checkpoint_descriptions: {
      updated_at: reconciled.effective_state.updated_at,
      next_legal_action: reconciled.effective_state.next_legal_action,
      application_frontier: reconciled.effective_state.programme.application_frontier,
      warning: 'These descriptive fields are retained from the checkpoint, not re-derived by applyEffect. The held-ACTION reason is historical and contradicts the current inactive hold. CONSISTENT does not establish freshness of every retained field.',
    },
    formal_contradiction_ruling: {
      still_owed_at_snapshot: true,
      review_url: 'https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6023054785',
      contradiction_url: 'https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6023151885',
      interpretation: 'The old stale-fold condition is absent in this replay. The replay is not a typed ruling withdrawing the historical reanchor instruction; it grants no admission or merge permission.',
    },
    selector_with_empty_cursor: selected,
    direct_reduce_matches_reconcile: JSON.stringify(reduced.state) === JSON.stringify(reconciled.effective_state),
    scope_limits: [
      'No live API or local-worker observation is performed by this runner.',
      'The empty selector cursor identifies authority eligibility only; it is not the installed worker cursor or proof of worker liveness.',
      'The complete raw issue history is supplied separately and is not embedded in this evidence package.',
      'A changed snapshot or source must receive a new separately identified observation, not be labelled as this frozen replay.',
      'No current REVIEW, checkpoint mutation, packet release, admission, merge, production access or programme credit results from this replay.',
    ],
  };
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runReplay(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.consistent || !result.direct_reduce_matches_reconcile) process.exitCode = 1;
  } catch (error) {
    process.stderr.write('Authority replay failed: ' + error.message + '\n');
    process.exitCode = 2;
  }
}
