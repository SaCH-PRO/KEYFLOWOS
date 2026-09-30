/**
 * Per-packet authority queue.
 *
 * The existing worker chooses the newest global authority message. That allows
 * a newer message for packet B to shadow older unprocessed authority for
 * packet A. This module removes that global-shadow rule.
 *
 * It is pure and side-effect free. The live worker integration follows only
 * after this queue behavior is proven.
 */

export const ACTIONABLE_TYPES = Object.freeze(['DIRECTIVE', 'REVIEW']);

function order(a, b) {
  const at = Date.parse(a?.created_at || 0);
  const bt = Date.parse(b?.created_at || 0);
  if (at !== bt) return at - bt;
  return Number(a?.comment_id || 0) - Number(b?.comment_id || 0);
}

function normalizedId(value) {
  return String(value || '').trim().toLowerCase();
}

function isActionable(message) {
  return Boolean(
    message &&
    ACTIONABLE_TYPES.includes(message.message_type) &&
    String(message.packet_id || '').trim() &&
    String(message.message_id || '').trim(),
  );
}

export function buildAuthorityQueue(messages, { processed = [], held = [], now = new Date() } = {}) {
  const done = new Set(processed.map(normalizedId));
  const heldIds = new Set(held.map(normalizedId));
  const input = Array.isArray(messages) ? [...messages] : [];

  const actionable = input.filter(isActionable).sort(order);
  const byId = new Map(actionable.map((m) => [normalizedId(m.message_id), m]));

  // Explicit supersession only. A newer unrelated message never cancels an
  // older one merely because it appears later in #80.
  const superseded = new Set();
  const invalidSupersession = [];
  for (const message of actionable) {
    const target = normalizedId(message.supersedes_message_id);
    if (!target) continue;
    if (target === normalizedId(message.message_id)) {
      invalidSupersession.push({ message_id: message.message_id, code: 'SELF_SUPERSESSION' });
      continue;
    }
    const prior = byId.get(target);
    if (!prior) {
      invalidSupersession.push({ message_id: message.message_id, target: message.supersedes_message_id, code: 'SUPERSESSION_TARGET_MISSING' });
      continue;
    }
    if (prior.packet_id !== message.packet_id) {
      invalidSupersession.push({
        message_id: message.message_id,
        target: prior.message_id,
        code: 'CROSS_PACKET_SUPERSESSION_FORBIDDEN',
      });
      continue;
    }
    if (order(prior, message) >= 0) {
      invalidSupersession.push({ message_id: message.message_id, target: prior.message_id, code: 'SUPERSESSION_NOT_NEWER' });
      continue;
    }
    superseded.add(target);
  }

  const pending = actionable.filter((message) => {
    const id = normalizedId(message.message_id);
    return !done.has(id) && !superseded.has(id);
  });

  const packets = new Map();
  for (const message of pending) {
    if (!packets.has(message.packet_id)) packets.set(message.packet_id, []);
    packets.get(message.packet_id).push(message);
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const result = [];
  for (const [packet_id, queue] of packets) {
    queue.sort(order);
    const head = queue[0];
    const ageMs = Math.max(0, nowMs - Date.parse(head.created_at || nowMs));
    result.push({
      packet_id,
      head,
      depth: queue.length,
      held: heldIds.has(normalizedId(head.message_id)),
      oldest_age_ms: ageMs,
      message_ids: queue.map((m) => m.message_id),
    });
  }

  result.sort((a, b) => order(a.head, b.head));

  return {
    packets: result,
    pending_count: pending.length,
    superseded_message_ids: [...superseded],
    invalid_supersession: invalidSupersession,
  };
}

/**
 * Pick work for one worker tick.
 *
 * Fairness rule: oldest non-held packet head wins. This prevents a hot packet
 * from starving unrelated work and preserves FIFO order within each packet.
 */
export function selectNextQueuedAuthority(queue) {
  const packets = Array.isArray(queue?.packets) ? queue.packets : [];
  const runnable = packets.filter((p) => !p.held);
  if (!runnable.length) {
    return {
      selected: null,
      reason: packets.length ? 'all_packet_heads_held' : 'no_pending_authority',
    };
  }
  const selectedPacket = [...runnable].sort((a, b) => order(a.head, b.head))[0];
  return {
    selected: selectedPacket.head,
    packet_id: selectedPacket.packet_id,
    depth: selectedPacket.depth,
    oldest_age_ms: selectedPacket.oldest_age_ms,
    reason: 'oldest_runnable_packet_head',
  };
}

export function starvationReport(queue, { thresholdMs = 30 * 60 * 1000 } = {}) {
  const packets = Array.isArray(queue?.packets) ? queue.packets : [];
  return packets
    .filter((p) => p.oldest_age_ms >= thresholdMs)
    .map((p) => ({
      packet_id: p.packet_id,
      message_id: p.head.message_id,
      age_ms: p.oldest_age_ms,
      held: p.held,
      depth: p.depth,
    }));
}

export default {
  ACTIONABLE_TYPES,
  buildAuthorityQueue,
  selectNextQueuedAuthority,
  starvationReport,
};
