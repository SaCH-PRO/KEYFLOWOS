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
      { obligation: 'local suite', evidence_scope: 'semantic_head', result: 'PROVEN' },
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
      new RegExp(`^exact_head_proof independent semantic review must be PENDING before the RETURN; found ${status}$`),
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
    artifact({ proof_matrix: [{ obligation: 'exact-head CI', evidence_scope: 'exact_head', result: 'PASS_LOCAL_CI_IN_RETURN' }] }),
    /^proof_matrix "exact-head CI" result PASS_LOCAL_CI_IN_RETURN is not an evidence state$/,
  );
  assertOnly(
    artifact({ proof_matrix: [{ obligation: 'exact-head CI', evidence_scope: 'exact_head', result: 'PROVEN' }] }),
    /^proof_matrix "exact-head CI" depends on the exact head and must be PENDING; found PROVEN$/,
  );
});

test('NC missing scope: a proof_matrix entry without evidence_scope is rejected, so it cannot bypass the exact-head rule', () => {
  // Copilot r4117714827: the exact entry. Without the marker it used to pass while every gate was PENDING.
  assertOnly(
    artifact({ proof_matrix: [{ obligation: 'all exact-head workflows green', result: 'PROVEN' }] }),
    /^proof_matrix "all exact-head workflows green" evidence_scope none must be one of exact_head, semantic_head$/,
  );
  // An obligation that names no gate still has to say where its evidence comes from.
  for (const evidence_scope of [undefined, null, '', 'local', 'EXACT_HEAD']) {
    assertOnly(
      artifact({ proof_matrix: [{ obligation: 'final head proof', evidence_scope, result: 'PROVEN' }] }),
      new RegExp(`^proof_matrix "final head proof" evidence_scope ${evidence_scope || 'none'} must be one of exact_head, semantic_head$`),
    );
  }
  // Referents: with the marker, the same entry is held to PENDING, and PENDING passes.
  assertOnly(
    artifact({ proof_matrix: [{ obligation: 'all exact-head workflows green', evidence_scope: 'exact_head', result: 'PROVEN' }] }),
    /^proof_matrix "all exact-head workflows green" depends on the exact head and must be PENDING; found PROVEN$/,
  );
  assert.deepEqual(problemsOf(artifact({ proof_matrix: [{ obligation: 'all exact-head workflows green', evidence_scope: 'exact_head', result: 'PENDING' }] })), []);
});

test('NC scope mislabel: an obligation that names an exact-head gate must be scoped exact_head', () => {
  for (const obligation of ['all exact-head workflows green', 'DAST (HawkScan) on the final head', 'fresh Copilot review', 'required checks']) {
    for (const result of ['PROVEN', 'PENDING']) {
      assertOnly(
        artifact({ proof_matrix: [{ obligation, evidence_scope: 'semantic_head', result }] }),
        /^proof_matrix ".*" names an exact-head gate and must have evidence_scope exact_head; found semantic_head$/,
      );
    }
  }
  // Referent: an obligation that names no gate may be semantic_head and PROVEN.
  assert.deepEqual(problemsOf(artifact({ proof_matrix: [{ obligation: 'portable and Windows suites at the semantic head', evidence_scope: 'semantic_head', result: 'PROVEN' }] })), []);
});

test('NC pass prose: prose cannot claim an exact-head gate passed while it is PENDING', () => {
  // Copilot r4117477551: the exact 6d8a6bd8 security prose.
  const security = { local_hawkscan: 'not run; no app running. DAST (HawkScan) is a required exact-head check and passed.' };
  assertOnly(artifact({ security }), /^prose claims DAST \(HawkScan\) passed before the RETURN: "DAST \(HawkScan\) is a required exact-head check and passed\."$/);
  // Every gate and every pass word, anywhere, in any case.
  for (const gate of EXACT_HEAD_GATES) {
    for (const word of ['passed', 'GREEN', 'succeeded', 'Proven']) {
      assertOnly(artifact({ notes: [{ status: `${gate.toLowerCase()}: ${word}` }] }), /^prose claims /);
    }
  }
  // Referents: the same sentences in the vocabulary a pre-RETURN artifact may use.
  assert.deepEqual(problemsOf(artifact({ security: { local_hawkscan: 'not run. DAST (HawkScan) is a required exact-head check and is PENDING.' } })), []);
  // A pass word in another sentence, or with no gate named, is not a claim about a gate.
  assert.deepEqual(problemsOf(artifact({ summary: 'The local suite passed. DAST (HawkScan) is PENDING.' })), []);
  // An obligation states what must be proven; a previous_head_<sha> record is about that head.
  assert.deepEqual(problemsOf(artifact({ ci: { previous_head_82454cce: 'DAST (HawkScan) green' } })), []);
  assert.deepEqual(problemsOf(artifact({
    proof_matrix: [{ obligation: 'all exact-head workflows green and a fresh Copilot review', evidence_scope: 'exact_head', result: 'PENDING' }],
  })), []);
  // Only a real historical key is exempt.
  assertOnly(artifact({ ci: { previous_head: 'DAST (HawkScan) green' } }), /^prose claims DAST/);
  assertOnly(artifact({ ci: { previous_head_final: 'DAST (HawkScan) green' } }), /^prose claims DAST/);
});

test('NC completion prose: completion vocabulary claims a finished gate as surely as "passed"', () => {
  // Copilot r4117648609.
  for (const claim of ['DAST (HawkScan) completed with zero failures', 'CI/CD Pipeline complete', 'Branch divergence: no failures', 'Agent Control Gate had 0 failed jobs']) {
    assertOnly(artifact({ summary: claim }), /^prose claims /);
  }
  // Referent: a completion word with no gate named is not a gate claim.
  assert.deepEqual(problemsOf(artifact({ summary: 'The correction is complete. DAST (HawkScan) is PENDING.' })), []);
});

test('NC umbrella prose: "exact-head workflows" and "required checks" name every gate at once', () => {
  // Copilot r4117648627.
  for (const claim of [
    'All required exact-head workflows passed successfully.',
    'exact-head checks green',
    'Exact head CI completed.',
    'every required check succeeded',
    'exact-head proof: PROVEN',
  ]) {
    assertOnly(artifact({ ci: { exact_head: claim } }), /^prose claims /);
  }
  // Referents: the same umbrella phrases stated as PENDING, next to a completion word in another sentence.
  assert.deepEqual(problemsOf(artifact({ ci: { exact_head: 'PENDING. Required checks run on the PR head that carries this artifact commit.' } })), []);
  assert.deepEqual(problemsOf(artifact({ summary: 'The correction is complete. The exact-head workflows are PENDING.' })), []);
});

test('NC branch artifact: the real claude-return.yaml on this branch is a truthful pre-RETURN record', () => {
  const ret = parseYaml(fs.readFileSync('.agent-control/claude-return.yaml', 'utf8'));
  assert.equal(ret.packet_id, 'KF-META-AI-REVIEW-FAILOVER-001');
  assert.deepEqual(preReturnEvidenceProblems(ret), []);
  // Referent: the artifact really lists the gates, rather than passing vacuously.
  assert.deepEqual(ret.exact_head_proof.map((entry) => entry.gate), [...EXACT_HEAD_GATES]);
});

// KF-META-AI-REVIEW-FAILOVER-001: the review gate is provider-neutral, and a
// claim about it under any provider's name is still a claim about it.
test('the exact-head review gate is the provider-neutral independent semantic review', () => {
  assert.equal(AI_REVIEW_GATE, 'independent semantic review');
  assert.ok(!EXACT_HEAD_GATES.some((gate) => /copilot|chatgpt/i.test(gate)), 'no provider is named in a gate label');
});

test('NC review alias prose: "the ChatGPT review passed" before the RETURN is a claim', () => {
  for (const sentence of ['The ChatGPT review passed.', 'Fresh Copilot review completed with zero failures.', 'The AI review is green.', 'Independent semantic review succeeded.']) {
    assertOnly(artifact({ summary: sentence }), /^prose claims .* passed before the RETURN: /);
  }
  // Referent: naming the review without a pass word is not a claim.
  assert.deepEqual(problemsOf(artifact({ summary: 'The ChatGPT review is requested after the RETURN.' })), []);
});

test('NC review alias scope: an obligation naming a provider review must be scoped exact_head', () => {
  for (const obligation of ['fresh Copilot review on the final head', 'ChatGPT fallback review', 'independent semantic review']) {
    assertOnly(
      artifact({ proof_matrix: [{ obligation, evidence_scope: 'semantic_head', result: 'PENDING' }] }),
      /^proof_matrix ".*" names an exact-head gate and must have evidence_scope exact_head; found semantic_head$/,
    );
  }
});
