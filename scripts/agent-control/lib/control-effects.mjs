/**
 * Typed authority effects for the KEYFLOWOS control plane.
 *
 * This module is deliberately pure. It does not read GitHub, mutate files, or
 * decide whether repository truth permits an effect. It only validates and
 * folds already-authenticated authority messages over a reviewed checkpoint.
 *
 * Legacy/untyped authority is never inferred from prose: callers must fail
 * closed until it is checkpointed or migrated.
 */

export const CONTROL_EFFECTS = Object.freeze([
  'NO_STATE_CHANGE',
  'PACKET_CORRECTION',
  'PACKET_ADMISSION',
  'HOLD_SET',
  'HOLD_CLEAR',
  'CHECKPOINT',
  'PROGRAMME_ACTIVATE',
]);

const STATE_EFFECTS = new Set(CONTROL_EFFECTS);
const PACKET_EFFECTS = new Set(['PACKET_CORRECTION', 'PACKET_ADMISSION', 'HOLD_SET', 'HOLD_CLEAR', 'CHECKPOINT']);

export function validateControlEffect(message) {
  if (!message || typeof message !== 'object') {
    return { ok: false, code: 'CONTROL_EFFECT_MESSAGE_MISSING' };
  }
  const effect = String(message.control_effect || '').trim();
  if (!effect) return { ok: false, code: 'CONTROL_EFFECT_MISSING' };
  if (!STATE_EFFECTS.has(effect)) {
    return { ok: false, code: 'CONTROL_EFFECT_UNKNOWN', detail: effect };
  }
  if (PACKET_EFFECTS.has(effect) && !String(message.packet_id || '').trim()) {
    return { ok: false, code: 'CONTROL_EFFECT_PACKET_MISSING', detail: effect };
  }
  if (effect === 'PROGRAMME_ACTIVATE' && !String(message.programme || '').trim()) {
    return { ok: false, code: 'CONTROL_EFFECT_PROGRAMME_MISSING' };
  }
  if (effect === 'HOLD_CLEAR' && message.message_type !== 'RESUME') {
    return { ok: false, code: 'CONTROL_EFFECT_RESUME_REQUIRED' };
  }
  return { ok: true, effect };
}

export function authorityGeneration(authority) {
  const messages = Array.isArray(authority?.messages) ? authority.messages : [];
  return messages.length;
}

export function checkpointObservedGeneration(state, authority) {
  const messages = Array.isArray(authority?.messages) ? authority.messages : [];
  const basis = state?.authority_basis;
  if (!basis?.message_id || basis.comment_id === undefined || basis.comment_id === null) return null;
  const index = messages.findIndex(
    (m) => String(m.comment_id) === String(basis.comment_id) && m.message_id === basis.message_id,
  );
  return index < 0 ? null : index + 1;
}

function clone(value) {
  return structuredClone(value);
}

function applyOne(state, message) {
  const verdict = validateControlEffect(message);
  if (!verdict.ok) return { ok: false, problem: verdict, state };
  const next = clone(state);
  const effect = verdict.effect;

  if (effect === 'NO_STATE_CHANGE') return { ok: true, state: next };

  if (effect === 'PACKET_CORRECTION') {
    next.programme = {
      ...(next.programme || {}),
      active_packet: message.packet_id,
      state: message.state || next.programme?.state || null,
      health: message.health || next.programme?.health || null,
      implementation_branch: message.implementation_branch || next.programme?.implementation_branch || null,
      merge_authority: false,
    };
    return { ok: true, state: next };
  }

  if (effect === 'PACKET_ADMISSION') {
    next.programme = {
      ...(next.programme || {}),
      active_packet: message.packet_id,
      state: message.state || 'READY_TO_MERGE',
      health: message.health || next.programme?.health || null,
      implementation_branch: message.implementation_branch || next.programme?.implementation_branch || null,
    };
    return { ok: true, state: next };
  }

  if (effect === 'HOLD_SET') {
    next.hold = {
      active: true,
      packet_id: message.packet_id,
      reason: message.control_reason || null,
      hold_message_id: message.message_id,
      hold_comment_id: message.comment_id ?? null,
    };
    return { ok: true, state: next };
  }

  if (effect === 'HOLD_CLEAR') {
    if (next.hold?.active !== true || next.hold?.packet_id !== message.packet_id) {
      return {
        ok: false,
        problem: {
          ok: false,
          code: 'CONTROL_EFFECT_HOLD_MISMATCH',
          detail: { held: next.hold?.packet_id ?? null, requested: message.packet_id },
        },
        state,
      };
    }
    next.hold = {
      ...next.hold,
      active: false,
      released_by: message.message_id,
      released_comment_id: message.comment_id ?? null,
    };
    return { ok: true, state: next };
  }

  if (effect === 'CHECKPOINT') {
    const prior = Array.isArray(next.programme?.checkpointed) ? next.programme.checkpointed : [];
    const checkpointed = prior.includes(message.packet_id) ? prior : [...prior, message.packet_id];
    next.programme = {
      ...(next.programme || {}),
      active_packet: message.packet_id,
      state: 'CHECKPOINTED',
      health: message.health || 'GREEN',
      checkpointed,
      merge_authority: false,
    };
    return { ok: true, state: next };
  }

  if (effect === 'PROGRAMME_ACTIVATE') {
    next.platform_programme = {
      ...(next.platform_programme || {}),
      programme: message.programme,
      status: 'ACTIVE',
      activation_authorized: true,
      activated_by: message.message_id,
    };
    return { ok: true, state: next };
  }

  return { ok: false, problem: { ok: false, code: 'CONTROL_EFFECT_UNHANDLED', detail: effect }, state };
}

export function reduceAuthorityFromCheckpoint(state, authority) {
  const messages = Array.isArray(authority?.messages) ? authority.messages : [];
  const observedGeneration = checkpointObservedGeneration(state, authority);
  const generation = messages.length;

  if (observedGeneration === null) {
    return {
      ok: false,
      code: 'CONTROL_EFFECT_CHECKPOINT_UNANCHORED',
      generation,
      observed_generation: null,
      state,
    };
  }

  let effective = clone(state);
  for (const message of messages.slice(observedGeneration)) {
    const applied = applyOne(effective, message);
    if (!applied.ok) {
      return {
        ok: false,
        code: applied.problem.code,
        detail: applied.problem.detail ?? null,
        generation,
        observed_generation: observedGeneration,
        blocked_message_id: message.message_id ?? null,
        state: effective,
      };
    }
    effective = applied.state;
  }

  return {
    ok: true,
    generation,
    observed_generation: generation,
    checkpoint_generation: observedGeneration,
    state: effective,
  };
}

export default {
  CONTROL_EFFECTS,
  validateControlEffect,
  authorityGeneration,
  checkpointObservedGeneration,
  reduceAuthorityFromCheckpoint,
};
