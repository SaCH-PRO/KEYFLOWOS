import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySource } from './cognitive-dependency-scan.mjs';
import { parseEnvelope, mineMotifs } from './procedure-motif-miner.mjs';

test('classifies gateway dependency', () => {
  const row = classifySource('/repo/apps/server/src/modules/key-cortex/a.ts', "import { ModelGatewayService } from '../ai/model-gateway.service';", '/repo');
  assert.equal(row.dependency, 'GATEWAY_MODEL_DEPENDENCY');
  assert.equal(row.confidence, 'HIGH');
});

test('classifies direct provider dependency', () => {
  const row = classifySource('/repo/apps/server/src/modules/ai/a.ts', "import OpenAI from 'openai';", '/repo');
  assert.equal(row.dependency, 'DIRECT_PROVIDER_DEPENDENCY');
});

test('does not call absence proof', () => {
  const row = classifySource('/repo/apps/server/src/modules/key-cortex/a.ts', 'export function rank(x) { return x; }', '/repo');
  assert.equal(row.dependency, 'NO_DETECTED_MODEL_DEPENDENCY');
  assert.match(row.note, /Heuristic only/);
});

test('parser fails closed on duplicate envelope keys', () => {
  const parsed = parseEnvelope('message_type: REVIEW\nmessage_type: RETURN\npacket_id: P1');
  assert.equal(parsed.malformed, true);
  assert.equal(parsed.reason, 'duplicate_key');
});

test('motif miner emits candidates without authority', () => {
  const comments = [
    { id: 1, created_at: '2026-01-01T00:00:00Z', body: 'message_type: REVIEW\npacket_id: P1' },
    { id: 2, created_at: '2026-01-01T00:00:01Z', body: 'message_type: ACK\npacket_id: P1' },
    { id: 3, created_at: '2026-01-01T00:00:02Z', body: 'message_type: REVIEW\npacket_id: P1' },
    { id: 4, created_at: '2026-01-01T00:00:03Z', body: 'message_type: ACK\npacket_id: P1' },
  ];
  const result = mineMotifs(comments, { minCount: 2, maxLength: 2 });
  const motif = result.candidates.find((x) => x.sequence.join(' -> ') === 'REVIEW -> ACK');
  assert.ok(motif);
  assert.equal(motif.authority, 'NONE');
  assert.equal(motif.status, 'CANDIDATE_PATTERN');
});
