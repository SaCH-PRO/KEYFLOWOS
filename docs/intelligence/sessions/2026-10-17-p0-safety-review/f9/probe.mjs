import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getProbeConfig } from './probe-config.mjs';
const config = getProbeConfig();
const { evaluateAdmission, recheckBeforeMerge } = await import(config.sourceUrl('scripts/agent-control/lib/admission.mjs'));
const { REQUIRED_WORKFLOWS } = await import(config.sourceUrl('scripts/agent-control/lib/events.mjs'));

// Characterization only: every record is synthetic and no network is used.
const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40), SEMANTIC = 'c'.repeat(40);
const reviewUrl = 'https://github.com/local/f9-fixture/pull/1#pullrequestreview-1';
const fixture = () => ({
  pr: { number: 1, state: 'open', draft: false, head_sha: HEAD, base_sha: BASE, head_ref: 'impl/f9-fixture' },
  active: { packet_id: 'SYNTHETIC-F9', implementation_branch: 'impl/f9-fixture', pr_number: 1, source_main: BASE, production_touched: false, merge_authority: false },
  ret: {
    packet_id: 'SYNTHETIC-F9', implementation_branch: 'impl/f9-fixture', pr_number: 1,
    source_main: BASE, source_head: SEMANTIC, review_status: 'ACCEPT_FOR_ADMISSION',
    state: 'PROVING', production_touched: false, scope_changed: false, merge_authority: false,
    tests: { failed: 0, skipped: 0 },
    semantic_review: { implementer: 'claude', reviews: [{
      provider: 'copilot', reviewer: 'copilot-pull-request-reviewer[bot]', reviewed_head: HEAD,
      outcome: 'PASS', reason: null, unresolved_substantive_findings: [], dispositioned_findings: [], evidence_location: reviewUrl,
    }] },
  },
  ancestry: { source_head_is_ancestor: true, non_control_files: [] },
  workflow_runs: REQUIRED_WORKFLOWS.map((name, i) => ({ id: 100+i, name, head_sha: HEAD, status: 'completed', conclusion: 'success', created_at: '2026-10-17T00:00:00Z' })),
  contradictions: [], pr_transitions: [],
  semantic_review_live: { copilot: [{ commit_id: HEAD, status: 'REVIEWED', reason: null, findings: 0, url: reviewUrl }], chatgpt: [] },
});
const unsafe = [];
for (const status of ['ACCEPT_FOR_ADMISSION', 'READY_TO_MERGE']) {
  for (const flag of [undefined, false, null, 0, 'false', 'true']) {
    const s = fixture(); s.ret.review_status = status;
    if (flag === undefined) { delete s.active.merge_authority; delete s.ret.merge_authority; }
    else { s.active.merge_authority = flag; s.ret.merge_authority = flag; }
    const v = evaluateAdmission(s);
    assert.equal(v.eligible, true, 'Current defect characterization changed; reassess instead of assuming it remains.');
    unsafe.push({ review_status: status, both_artifact_grants: flag === undefined ? 'ABSENT' : flag, expected_secure: 'REJECT', actual_eligible: v.eligible, reason: v.reason });
  }
}
const controls = [
  ['draft stays closed', s => { s.pr.draft = true; }],
  ['correction status stays closed', s => { s.ret.review_status = 'CORRECTION_REQUIRED'; }],
  ['missing independent review stays closed', s => { s.semantic_review_live.copilot = []; }],
  ['base drift stays closed', s => { s.pr.base_sha = 'd'.repeat(40); }],
  ['pending required check stays closed', s => { s.workflow_runs[0].status = 'in_progress'; }],
  ['wrong packet artifact stays closed', s => { s.ret.packet_id = 'OTHER'; }],
].map(([name, mutate]) => {
  const s = fixture(); mutate(s); const v = evaluateAdmission(s); assert.equal(v.eligible, false);
  return { name, actual_eligible: v.eligible, reason: v.reason };
});
const first = fixture(); first.active.merge_authority = true; first.ret.merge_authority = true;
const second = fixture();
const recheck = recheckBeforeMerge(evaluateAdmission(first), evaluateAdmission(second));
assert.equal(recheck.eligible, true);
const result = { purpose: 'READ_ONLY_DEFECT_CHARACTERIZATION_NOT_FIXED', source_main: '98ee0202499ba87fa4ee13d58a2a9075016225bd', node: process.version, unsafe_cases: unsafe, preserved_boundary_controls: controls, uninspected_artifact_bits_in_synthetic_recheck: { actual_eligible: recheck.eligible, reason: recheck.reason, limitation: 'This varies immutable artifact contents at one synthetic head and is not a real revocation-race proof. A live authority revocation is absent from the current caller inputs; that gap is established by source and the mocked request trace.' } };
fs.writeFileSync(config.outputPath('probe-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
