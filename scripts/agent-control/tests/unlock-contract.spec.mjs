import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseYaml } from '../lib/yaml.mjs';
import { validateUnlockContract } from '../lib/unlock-contract.mjs';

const valid = (overrides = {}) => ({
  version: 1,
  work_id: 'KF-X-001',
  implementation_branch: 'impl/kf-x-001',
  pr_number: null,
  state: 'IMPLEMENTED',
  classifications: ['DEVELOPMENT_CAPABILITY'],
  product: { effect: 'NONE', claim: 'No direct product effect.' },
  key: { effect: 'NONE', claim: 'No direct KEY effect.', dimensions: [] },
  development: { effect: 'MATERIAL', claim: 'Adds a reusable development capability.' },
  reliability: { effect: 'PARTIAL', claim: 'Reduces a defined process failure mode.' },
  enables: ['next tranche'],
  converges: [],
  complexity_cost: ['one validator'],
  proof: { obligations: ['unit proof'], evidence: [] },
  post_merge_verified: false,
  net_value: { verdict: 'POSITIVE', rationale: 'The reusable development value exceeds the added validator cost.' },
  ...overrides,
});

const codes = (contract) => validateUnlockContract(contract).problems.map((p) => p.code);

test('implemented net-positive development unlock validates', () => {
  assert.deepEqual(validateUnlockContract(valid()), { ok:true, problems:[] });
});

test('a contract must declare at least one classification', () => {
  assert.deepEqual(codes(valid({classifications:[]})), ['CLASSIFICATIONS_MISSING']);
});

test('unknown states and classifications fail closed', () => {
  const result = codes(valid({state:'DONE', classifications:['MAGIC']}));
  assert.ok(result.includes('STATE_INVALID'));
  assert.ok(result.includes('CLASSIFICATION_INVALID'));
});

test('positive value cannot be declared when every effect is NONE', () => {
  const contract = valid({
    product:{effect:'NONE',claim:'none'},
    key:{effect:'NONE',claim:'none',dimensions:[]},
    development:{effect:'NONE',claim:'none'},
    reliability:{effect:'NONE',claim:'none'},
  });
  assert.ok(codes(contract).includes('POSITIVE_WITHOUT_EFFECT'));
});

test('planning-only work cannot masquerade as product or KEY runtime capability', () => {
  const contract = valid({
    classifications:['PLANNING_ONLY'],
    product:{effect:'FOUNDATION',claim:'future product plan'},
    key:{effect:'MATERIAL',claim:'future KEY plan',dimensions:['memory']},
  });
  assert.ok(codes(contract).includes('PLANNING_CLAIMS_RUNTIME_EFFECT'));
});

test('PROVEN requires evidence and LIVE requires post-merge verification', () => {
  assert.ok(codes(valid({state:'PROVEN'})).includes('PROVEN_WITHOUT_EVIDENCE'));
  const live = valid({state:'LIVE', proof:{obligations:['unit'], evidence:['run:1']}});
  assert.ok(codes(live).includes('LIVE_WITHOUT_POST_MERGE_VERIFICATION'));
  assert.equal(validateUnlockContract({...live, post_merge_verified:true}).ok, true);
});

test('the foundation PR validates its own durable contract', () => {
  const doc = parseYaml(fs.readFileSync('docs/development/unlocks/KF-META-PR-UNLOCK-CONTRACT-001.yaml','utf8'));
  assert.deepEqual(validateUnlockContract(doc), {ok:true,problems:[]});
});
