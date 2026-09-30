import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthorityQueue,
  selectNextQueuedAuthority,
  starvationReport,
} from '../lib/authority-queue.mjs';

const at = (minute) => `2026-09-30T12:${String(minute).padStart(2, '0')}:00Z`;
const m = (id, packet, minute, over = {}) => ({
  message_id: id,
  message_type: 'REVIEW',
  packet_id: packet,
  created_at: at(minute),
  comment_id: minute,
  ...over,
});

test('newer authority for another packet does not shadow older pending work', () => {
  const q = buildAuthorityQueue([
    m('A1', 'PACKET-A', 1),
    m('B1', 'PACKET-B', 2),
    m('B2', 'PACKET-B', 3),
  ], { now: new Date(at(10)) });

  assert.equal(q.pending_count, 3);
  assert.deepEqual(q.packets.map((p) => [p.packet_id, p.message_ids]), [
    ['PACKET-A', ['A1']],
    ['PACKET-B', ['B1', 'B2']],
  ]);

  const next = selectNextQueuedAuthority(q);
  assert.equal(next.selected.message_id, 'A1');
});

test('processed messages disappear without disturbing per-packet FIFO', () => {
  const q = buildAuthorityQueue([
    m('A1', 'PACKET-A', 1),
    m('A2', 'PACKET-A', 2),
    m('B1', 'PACKET-B', 3),
  ], { processed: ['A1'], now: new Date(at(10)) });

  assert.deepEqual(q.packets.find((p) => p.packet_id === 'PACKET-A').message_ids, ['A2']);
});

test('explicit same-packet supersession replaces older pending authority', () => {
  const q = buildAuthorityQueue([
    m('A1', 'PACKET-A', 1),
    m('A2', 'PACKET-A', 2, { supersedes_message_id: 'A1' }),
  ], { now: new Date(at(10)) });

  assert.deepEqual(q.superseded_message_ids, ['a1']);
  assert.deepEqual(q.packets[0].message_ids, ['A2']);
});

test('cross-packet supersession is forbidden and cannot erase work', () => {
  const q = buildAuthorityQueue([
    m('A1', 'PACKET-A', 1),
    m('B1', 'PACKET-B', 2, { supersedes_message_id: 'A1' }),
  ], { now: new Date(at(10)) });

  assert.equal(q.invalid_supersession[0].code, 'CROSS_PACKET_SUPERSESSION_FORBIDDEN');
  assert.deepEqual(q.packets.map((p) => p.head.message_id), ['A1', 'B1']);
});

test('self, missing-target and backwards supersession fail structurally', () => {
  const q = buildAuthorityQueue([
    m('A1', 'PACKET-A', 1, { supersedes_message_id: 'A1' }),
    m('A2', 'PACKET-A', 2, { supersedes_message_id: 'MISSING' }),
    m('A3', 'PACKET-A', 3),
    m('A0', 'PACKET-A', 0, { supersedes_message_id: 'A3' }),
  ], { now: new Date(at(10)) });

  assert.deepEqual(q.invalid_supersession.map((x) => x.code).sort(), [
    'SELF_SUPERSESSION',
    'SUPERSESSION_NOT_NEWER',
    'SUPERSESSION_TARGET_MISSING',
  ].sort());
});

test('held packet head does not block unrelated runnable packet', () => {
  const q = buildAuthorityQueue([
    m('A1', 'PACKET-A', 1),
    m('B1', 'PACKET-B', 2),
  ], { held: ['A1'], now: new Date(at(10)) });

  const next = selectNextQueuedAuthority(q);
  assert.equal(next.selected.message_id, 'B1');
});

test('all held queues produce an explicit no-run decision', () => {
  const q = buildAuthorityQueue([m('A1', 'PACKET-A', 1)], {
    held: ['A1'],
    now: new Date(at(10)),
  });
  const next = selectNextQueuedAuthority(q);
  assert.equal(next.selected, null);
  assert.equal(next.reason, 'all_packet_heads_held');
});

test('starvation report is based on oldest pending head age', () => {
  const q = buildAuthorityQueue([
    m('A1', 'PACKET-A', 1),
    m('B1', 'PACKET-B', 9),
  ], { now: new Date(at(10)) });

  const starved = starvationReport(q, { thresholdMs: 5 * 60 * 1000 });
  assert.deepEqual(starved.map((x) => x.packet_id), ['PACKET-A']);
});

test('non-actionable authority types are not worker queue entries', () => {
  const q = buildAuthorityQueue([
    m('A1', 'PACKET-A', 1, { message_type: 'HOLD' }),
    m('A2', 'PACKET-A', 2, { message_type: 'RESUME' }),
  ], { now: new Date(at(10)) });

  assert.equal(q.pending_count, 0);
  assert.equal(selectNextQueuedAuthority(q).reason, 'no_pending_authority');
});
