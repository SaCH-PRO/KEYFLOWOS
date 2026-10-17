#!/usr/bin/env node
/** Frozen connector-supplied replay. No network, gh, worker or credential probes. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, 'source');
const read = rel => JSON.parse(fs.readFileSync(path.join(here, rel), 'utf8'));
const write = (rel, data) => fs.writeFileSync(path.join(here, rel), JSON.stringify(data, null, 2) + '\n');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const sourceRefs = read('source-files.expected.json');
const methodRefs = read('method-files.expected.json');
const verified = [...sourceRefs.map(r => ({ ...r, local: 'source/' + r.path })), ...methodRefs.map(r => ({ ...r, local: r.path }))].map(ref => {
  const bytes = fs.readFileSync(path.join(here, ref.local));
  const blob = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  if (blob !== ref.sha || bytes.length !== ref.size) throw new Error('Pinned source mismatch: ' + ref.path);
  return { ...ref, sha256: hash(bytes), matched: true };
});
const importSource = rel => import(pathToFileURL(path.join(repoRoot, rel)).href);
const [state, dagModule, truth, platform, statusModule, envelope, replay] = await Promise.all([
  importSource('scripts/agent-control/lib/state.mjs'),
  importSource('scripts/agent-control/lib/dag.mjs'),
  importSource('scripts/agent-control/lib/truth.mjs'),
  importSource('scripts/agent-control/lib/platform-dag.mjs'),
  importSource('scripts/agent-control/status.mjs'),
  importSource('scripts/agent-control/lib/control-envelope.mjs'),
  import('./method/docs/intelligence/sessions/2026-10-17-p0-safety-review/authority/replay-authority.mjs'),
]);
const comments = read('raw/issue80-comments.json');
const collection = read('collection.json');
const observations = read('raw/repository-observations.json');
const main = read('raw/main-commit.json');
const repository = 'SaCH-PRO/KEYFLOWOS';
const sourceMain = '98ee0202499ba87fa4ee13d58a2a9075016225bd';
if (main.sha !== sourceMain || observations.main.object.sha !== sourceMain || observations.main_end.object.sha !== sourceMain) {
  throw new Error('Main identities disagree.');
}
if (comments.length !== collection.collection_end_comment_count || new Set(comments.map(c => c.id)).size !== comments.length) {
  throw new Error('Comment inventory is incomplete or duplicated.');
}
const pages = [];
for (let at = 0; at < comments.length; at += 100) pages.push(comments.slice(at, at + 100));
const responses = new Map([
  [JSON.stringify(['api', '--paginate', '--slurp', 'repos/' + repository + '/issues/80/comments?per_page=100']), JSON.stringify(pages)],
  [JSON.stringify(['api', 'repos/' + repository + '/commits/main']), JSON.stringify(main)],
  [JSON.stringify(['api', 'repos/' + repository + '/compare/ac3a6384417093f198bcc7d672b0dbc295db137c...' + sourceMain]), JSON.stringify(observations.active_source_comparison)],
  [JSON.stringify(['api', 'repos/' + repository + '/pulls/155']), JSON.stringify(observations.pr155)],
]);
const readTrace = [];
const run = args => {
  const key = JSON.stringify(args);
  if (!responses.has(key)) throw new Error('No recorded connector response for ' + key);
  readTrace.push({ args, response_sha256: hash(responses.get(key)), source: 'frozen GitHub connector response' });
  return responses.get(key);
};
const checkpoint = state.loadState(repoRoot);
const dag = dagModule.loadDag(repoRoot);
// Exact repository truth entry point, with all gh calls replaced by recorded responses.
const reconciled = truth.reconcileWithTruth(checkpoint, { repoRoot, repository, run, dag });
const repositorySnapshot = truth.fetchRepoTruth(repository, reconciled.effective_state.programme, run);
if (!repositorySnapshot.verified) throw new Error(repositorySnapshot.reason);
const commentsDigest = replay.digestJSON(replay.canonicalComments(comments, envelope.normalizeComment));
const manifest = {
  report_kind: 'fresh_frozen_authority_source_and_snapshot_manifest',
  repository,
  source_main: sourceMain,
  source_files: sourceRefs,
  method_source: { ref: '9e222e8e3b739fafa539ac0d6f5ff834d4858492', files: methodRefs },
  comment_snapshot: {
    collection_completed_at_utc: collection.collected_through_utc,
    count: comments.length,
    latest_comment_id: comments.at(-1).id,
    latest_comment_created_at: comments.at(-1).created_at,
    normalized_sha256: commentsDigest,
    raw_file_sha256: hash(fs.readFileSync(path.join(here, 'raw/issue80-comments.json'))),
    hash_method: 'SHA-256(JSON.stringify(canonicalComments(...))); unchanged exported replay function.',
    known_local_snapshot: 'raw/issue80-comments.json',
    included_in_curated_package: false,
    collection_integrity: collection,
  },
  repository_snapshot: {
    filename: 'repository-truth.json',
    normalized_sha256: replay.digestJSON(repositorySnapshot),
    hash_method: 'SHA-256(JSON.stringify(repository-truth.json.snapshot))',
  },
  limits: [
    'Frozen connector-supplied equivalent; not the live status CLI and not an installed-worker observation.',
    'All 23 current-main source files and both published replay methods are Git-blob verified before execution.',
    'Full raw discussion supplied separately; summaries alone cannot replay it.',
    'No checkpoint, programme map, authority message, admission, ready/merge, production, process or installation mutation.',
  ],
};
write('repository-truth.json', {
  report_kind: 'fresh_frozen_repository_truth',
  collected_at_utc: collection.collected_through_utc,
  snapshot: repositorySnapshot,
  evidence: {
    main: { sha: main.sha, url: main.html_url },
    source_main_comparison: {
      source_main: observations.active_source_comparison.base_commit.sha,
      main_sha: sourceMain,
      status: observations.active_source_comparison.status,
      ahead_by: observations.active_source_comparison.ahead_by,
      behind_by: observations.active_source_comparison.behind_by,
      url: 'https://github.com/' + repository + '/compare/ac3a6384417093f198bcc7d672b0dbc295db137c...' + sourceMain,
    },
    pr: { number: observations.pr155.number, state: observations.pr155.state, draft: observations.pr155.draft, merged: observations.pr155.merged, head_sha: observations.pr155.head.sha, head_ref: observations.pr155.head.ref, base_sha: observations.pr155.base.sha, url: observations.pr155.html_url },
  },
});
write('source-and-snapshot-manifest.json', manifest);
const reconciliationSummary = { consistent: reconciled.consistent, findings: reconciled.findings, reduction: reconciled.reduction };
// An empty registry prevents auth/version/credential probes. It means NOT OBSERVED, not no installed agents.
const status = statusModule.buildStatus(repoRoot, { state: reconciled.effective_state, dag, reconciliation: reconciliationSummary, registry: [] });
const applicationDrain = dagModule.proveDrainable(dag);
const { doc: platformDoc, dag: platformDag } = platform.loadPlatformDag(repoRoot);
const policy = platform.loadAutopilotPolicy(repoRoot);
const platformDrain = dagModule.proveDrainable(platformDag);
const platformProblems = platform.validatePlatformContract(platformDoc, policy);
const platformState = platform.platformProgrammeState(comments, platformDoc, policy);
write('status-and-platform-result.json', {
  report_kind: 'frozen_current_main_truth_status_and_platform_replay',
  executed_at_utc: new Date().toISOString(),
  node_version: process.version,
  source_main: sourceMain,
  comment_count: comments.length,
  comment_normalized_sha256: commentsDigest,
  exact_entrypoints: ['truth.reconcileWithTruth', 'truth.fetchRepoTruth', 'status.buildStatus', 'dag.proveDrainable', 'platform-dag.validatePlatformContract', 'platform-dag.platformProgrammeState'],
  collection_is_live_cli: false,
  status,
  application_dag: { packets_total: dag.packetsTotal, phases_total: dag.phasesTotal, drained: applicationDrain.drained, order: applicationDrain.order },
  platform_dag: { packets_total: platformDag.packetsTotal, phases_total: platformDag.phasesTotal, drained: platformDrain.drained, file_status: platformDoc.status, contract_problems: platformProblems, human_gates: platformDoc.human_gates.gates.length, inherited_never_automatic: platformDoc.human_gates.inherited_never_automatic.length, authority_state: platformState },
  read_trace: readTrace,
  agents_observation: 'NOT_RUN: empty registry deliberately avoids installed-agent, process and credential probes.',
  limits: manifest.limits,
});
const verifiedAfter = verified.map(ref => {
  const bytes = fs.readFileSync(path.join(here, ref.local));
  const blob = crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  const sha256 = hash(bytes);
  if (blob !== ref.sha || sha256 !== ref.sha256 || bytes.length !== ref.size) throw new Error('Source changed during replay: ' + ref.path);
  return { ...ref, sha256, matched: true };
});
write('source-verification-after.json', verifiedAfter);
process.stdout.write(JSON.stringify({ comments: comments.length, consistent: reconciled.consistent, generation: reconciled.reduction.generation, observed_generation: reconciled.reduction.observed_generation, active_packet: status.active_packet, holds: status.holds.length, application_dag: [dag.packetsTotal, dag.phasesTotal, applicationDrain.drained], platform_dag: [platformDag.packetsTotal, platformDag.phasesTotal, platformDrain.drained, platformState.state], comments_sha256: commentsDigest, source_files_verified: verified.length }) + '\n');
if (!reconciled.consistent || !applicationDrain.drained || !platformDrain.drained || platformProblems.length) process.exitCode = 1;
