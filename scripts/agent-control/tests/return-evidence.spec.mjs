/**
 * A branch claude-return.yaml is a pre-RETURN record: it may not claim a
 * posted RETURN or finished exact-head proof
 * (CG-REVIEW-META-CONTROL-PARSER-EVIDENCE-ORDER-001, Copilot review 5332604917).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml } from '../lib/yaml.mjs';
import { REQUIRED_WORKFLOWS } from '../lib/events.mjs';
import {
  preReturnEvidenceProblems,
  EXACT_HEAD_GATES,
  AI_REVIEW_GATE,
  PRE_RETURN_STATUS,
} from '../lib/return-evidence.mjs';

/** A truthful pre-RETURN artifact. Each test breaks exactly one thing. */
function artifact(overrides = {}) {
  return {
    packet_id: 'KF-TEST-001',
    return_status: PRE_RETURN_STATUS,
    return_message_id: null,
    previous_return_message_ids: ['CC-RETURN-TEST-001'],
    never_posted_return_message_ids: ['CC-RETURN-TEST-DRAFT-001'],
    summary: 'supersedes CC-RETURN-TEST-001; CC-RETURN-TEST-DRAFT-001 was never posted',
    exact_head_proof: EXACT_HEAD_GATES.map((gate) => ({ gate, status: 'PENDING' })),
    proof_matrix: [
      { obligation: 'local suite', result: 'PROVEN' },
      { obligation: 'exact-head CI', evidence_scope: 'exact_head', result: 'PENDING' },
    ],
    ...overrides,
  };
}

const problemsOf = (ret) => preReturnEvidenceProblems(ret);
const assertOnly = (ret, pattern) => {
  const problems = problemsOf(ret);
  assert.equal(problems.length, 1, `expected exactly one problem, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], pattern);
};

test('a truthful pre-RETURN artifact has no problems', () => {
  assert.deepEqual(problemsOf(artifact()), []);
  assert.deepEqual(problemsOf(artifact({ return_message_id: undefined })), [], 'absent is as good as null');
});

test('the exact-head gates are the required workflows plus the fresh AI review', () => {
  assert.deepEqual(EXACT_HEAD_GATES, [...REQUIRED_WORKFLOWS, AI_REVIEW_GATE]);
});

test('NC premature return id: a return_message_id before the RETURN is posted is rejected', () => {
  assertOnly(
    artifact({ return_message_id: 'CC-RETURN-TEST-001' }),
    /^return_message_id must be null until the RETURN is posted; found CC-RETURN-TEST-001$/,
  );
});

test('NC premature return status: anything but AWAITING_POSTCHECK_RETURN is rejected', () => {
  assertOnly(artifact({ return_status: 'RETURNED' }), /^return_status must be AWAITING_POSTCHECK_RETURN on the branch; found RETURNED$/);
  assertOnly(artifact({ return_status: undefined }), /^return_status must be AWAITING_POSTCHECK_RETURN on the branch; found none$/);
});

test('NC future return id: a RETURN id named anywhere must be accounted for', () => {
  // The d9b12873 shape: prose naming the RETURN that recorded the exact-head CI.
  const ci = { exact_head: 'recorded in the RETURN on #80 (CC-RETURN-TEST-002), which names that head' };
  assertOnly(artifact({ ci }), /^CC-RETURN-TEST-002 is named but not listed as previously posted or never posted$/);
  // Referent: a key, a nested list item, and an id inside a longer token.
  assertOnly(artifact({ notes: [{ 'CC-RETURN-TEST-003': 'x' }] }), /^CC-RETURN-TEST-003 is named/);
  assertOnly(artifact({ notes: ['see CC-RETURN-TEST-001-B'] }), /^CC-RETURN-TEST-001-B is named/);
  // An accounted id is fine wherever it appears.
  assert.deepEqual(problemsOf(artifact({ ci: { note: 'CC-RETURN-TEST-001 had it' } })), []);
});

test('NC exact-head pending: a finished exact-head gate cannot be claimed before the RETURN', () => {
  for (const status of ['PROVEN', 'PASS', 'UNKNOWN']) {
    const exact_head_proof = EXACT_HEAD_GATES.map((gate) => ({ gate, status: gate === AI_REVIEW_GATE ? status : 'PENDING' }));
    assertOnly(
      artifact({ exact_head_proof }),
      new RegExp(`^exact_head_proof fresh Copilot review must be PENDING before the RETURN; found ${status}$`),
    );
  }
});

test('NC exact-head complete: every exact-head gate must be listed', () => {
  const exact_head_proof = EXACT_HEAD_GATES.filter((gate) => gate !== 'DAST (HawkScan)').map((gate) => ({ gate, status: 'PENDING' }));
  assertOnly(artifact({ exact_head_proof }), /^exact_head_proof is missing DAST \(HawkScan\)$/);
  const problems = problemsOf(artifact({ exact_head_proof: undefined }));
  assert.equal(problems[0], 'exact_head_proof must list every exact-head gate');
  assert.equal(problems.length, 1 + EXACT_HEAD_GATES.length);
});

test('NC proof vocabulary: proof_matrix results use the evidence states', () => {
  // PASS_LOCAL_CI_IN_RETURN is the d9b12873 value that read as green.
  assertOnly(
    artifact({ proof_matrix: [{ obligation: 'exact-head CI', result: 'PASS_LOCAL_CI_IN_RETURN' }] }),
    /^proof_matrix "exact-head CI" result PASS_LOCAL_CI_IN_RETURN is not an evidence state$/,
  );
  assertOnly(
    artifact({ proof_matrix: [{ obligation: 'exact-head CI', evidence_scope: 'exact_head', result: 'PROVEN' }] }),
    /^proof_matrix "exact-head CI" depends on the exact head and must be PENDING; found PROVEN$/,
  );
});

test('NC branch artifact: the real claude-return.yaml on this branch is a truthful pre-RETURN record', () => {
  const ret = parseYaml(fs.readFileSync('.agent-control/claude-return.yaml', 'utf8'));
  assert.equal(ret.packet_id, 'KF-META-CONTROL-PARSER-001');
  assert.deepEqual(preReturnEvidenceProblems(ret), []);
  // Referent: the artifact really lists the gates, rather than passing vacuously.
  assert.deepEqual(ret.exact_head_proof.map((entry) => entry.gate), [...EXACT_HEAD_GATES]);
});
