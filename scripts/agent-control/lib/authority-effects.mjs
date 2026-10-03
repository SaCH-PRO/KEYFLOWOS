/**
 * AUTHORITY-EFFECTS — the derived projection as a fold of typed authority.
 * (KF-META-STATE-REDUCER-LIVE-001; CG-DIRECTIVE-META-STATE-REDUCER-LIVE-001,
 * corrected by CG-REVIEW-META-STATE-REDUCER-LIVE-CORRECTION-001)
 *
 * programme-state.yaml is a reviewed CHECKPOINT anchored to one #80 authority
 * message. Every valid authority message newer than that anchor that carries
 * an explicit `control_effect:` is folded over it, oldest first, to give the
 * effective projection. lib/reconcile.mjs then checks the effective projection
 * against repository truth exactly as it checked the stored one.
 *
 *   effective = fold(applyEffect, checkpoint, typed authority after the anchor)
 *
 * Pure and deterministic: no clock, no I/O, no randomness. The same checkpoint
 * and the same authority snapshot always give the same effective projection,
 * so replaying a fold, or folding a prefix and then the rest, is identical to
 * folding once. Nothing here is ever written back; the checkpoint changes
 * only in a reviewed commit.
 *
 * Generation (C2). Every authority candidate, valid or malformed, has a fixed
 * place in the #80 order (created_at, then comment id). A message's generation
 * is its 1-based position among ALL candidates, and its coordinate is
 * `created_at#comment_id`. A message that becomes malformed keeps its place,
 * so no later message is ever renumbered; an edit makes the whole snapshot
 * unverifiable, so nothing is numbered at all until it is valid again.
 *
 * Holds (C1) are keyed by packet: several packets may be held at once. A legacy
 * single `hold` naming a packet is lifted into `holds` when a fold applies.
 *
 * The fold stops, and leaves every later message unapplied, at the first
 * newer authority message that:
 *   - is malformed under the AUTHORITY profile (it may be a hold);
 *   - carries no control_effect (meaning is never inferred from prose or ids);
 *   - names an unknown effect, or an effect its message type cannot carry;
 *   - names `programme` or `programme_action` (activation is not a fold);
 *   - lacks a field its effect needs, carries a health outside GREEN/YELLOW/RED,
 *     carries production_touched other than false, or conflicts with the
 *     projection;
 *   - would produce a projection that validateState() rejects.
 * reconcile() then reports the projection stale (DERIVED_STATE_STALE_AUTHORITY,
 * with `blocked` naming the message and the reason), or AUTHORITY_MALFORMED,
 * and decide() fails closed. Edited or unorderable authority never reaches the
 * fold: collectAuthority() refuses the whole snapshot.
 *
 * The fold never reads repository truth, so it can never overwrite it: a
 * CHECKPOINT for a PR that did not merge folds to CHECKPOINTED and reconcile()
 * reports PR_NOT_MERGED.
 */

import { compareAuthorityOrder, envelopeField } from './control-envelope.mjs';
import { HEALTH } from './state-machine.mjs';
import { validateState } from './state.mjs';

/** The explicit effects an authority message may declare. One per message. */
export const CONTROL_EFFECTS = Object.freeze([
  'NO_STATE_CHANGE',
  'PACKET_RELEASE',
  'PACKET_CORRECTION',
  'PACKET_ADMISSION',
  'CHECKPOINT',
  'HOLD_SET',
  'HOLD_CLEAR',
]);

/** Why a newer authority message could not be folded. */
export const EFFECT_PROBLEMS = Object.freeze({
  AUTHORITY_MALFORMED: 'AUTHORITY_MALFORMED',
  EFFECT_MISSING: 'CONTROL_EFFECT_MISSING',
  EFFECT_UNKNOWN: 'CONTROL_EFFECT_UNKNOWN',
  EFFECT_TYPE_MISMATCH: 'CONTROL_EFFECT_TYPE_MISMATCH',
  PROGRAMME_NOT_FOLDABLE: 'CONTROL_EFFECT_PROGRAMME_NOT_FOLDABLE',
  FIELD_MISSING: 'CONTROL_EFFECT_FIELD_MISSING',
  PACKET_IN_FLIGHT: 'CONTROL_EFFECT_PACKET_IN_FLIGHT',
  PACKET_NOT_ACTIVE: 'CONTROL_EFFECT_PACKET_NOT_ACTIVE',
  PR_CONFLICT: 'CONTROL_EFFECT_PR_CONFLICT',
  PACKET_HELD: 'CONTROL_EFFECT_PACKET_HELD',
  HOLD_DUPLICATE: 'CONTROL_EFFECT_HOLD_DUPLICATE',
  HOLD_MISMATCH: 'CONTROL_EFFECT_HOLD_MISMATCH',
  HEALTH_INVALID: 'CONTROL_EFFECT_HEALTH_INVALID',
  PRODUCTION_TOUCHED: 'CONTROL_EFFECT_PRODUCTION_TOUCHED',
  PROJECTION_INVALID: 'CONTROL_EFFECT_PROJECTION_INVALID',
});

/** Why the fold could not start at all; reconcile() reports these itself. */
export const FOLD_NOT_STARTED = Object.freeze({
  AUTHORITY_UNVERIFIED: 'AUTHORITY_UNVERIFIED',
  CHECKPOINT_UNANCHORED: 'CHECKPOINT_UNANCHORED',
  CHECKPOINT_ANCHOR_NOT_FOUND: 'CHECKPOINT_ANCHOR_NOT_FOUND',
});

/**
 * Which message types may carry which effects. A hold is set only by a HOLD
 * and cleared only by a RESUME, and a HOLD or RESUME carries nothing else, so
 * neither the type nor the effect can be read as the other.
 */
const EFFECTS_BY_TYPE = Object.freeze({
  DIRECTIVE: Object.freeze(['NO_STATE_CHANGE', 'PACKET_RELEASE', 'PACKET_CORRECTION']),
  REVIEW: Object.freeze(['NO_STATE_CHANGE', 'PACKET_CORRECTION', 'PACKET_ADMISSION', 'CHECKPOINT']),
  HOLD: Object.freeze(['HOLD_SET']),
  RESUME: Object.freeze(['HOLD_CLEAR']),
});

/** The packet state each packet effect projects. Never read from `state:`. */
const PROJECTED_STATE = Object.freeze({
  PACKET_RELEASE: 'CHARACTERIZING',
  PACKET_CORRECTION: 'FIXING_PROOF_FAILURES',
  PACKET_ADMISSION: 'READY_TO_MERGE',
  CHECKPOINT: 'CHECKPOINTED',
});

/** Packet effects that are about a PR, so they must name it. */
const PR_REQUIRED = Object.freeze(['PACKET_ADMISSION', 'CHECKPOINT']);

const SHA = /^[0-9a-f]{40}$/;
const PR_NUMBER = /^[1-9][0-9]*$/;

/**
 * Own-key access to the packet-keyed holds map (AUDIT-CORRECTION-007 A7-F1).
 * A packet id is any non-blank text, so `__proto__` or `constructor` must be
 * an ordinary key: never read from the prototype, never written through the
 * `__proto__` setter.
 */
const ownHold = (holds, packet) => (Object.hasOwn(holds, packet) ? holds[packet] : undefined);
function setHold(holds, packet, hold) {
  Object.defineProperty(holds, packet, { value: hold, enumerable: true, writable: true, configurable: true });
}

function problem(code, detail) {
  return { code, detail: detail ?? null };
}

/** Text value of one envelope field, or null. */
function field(message, key) {
  if (!message?.envelope) return null;
  const value = envelopeField(message.envelope, key);
  return value === null || String(value).trim() === '' ? null : String(value);
}

/** The immutable #80 coordinate of an authority message. */
export function coordinateOf(message) {
  return `${message.created_at}#${message.comment_id}`;
}

/**
 * The effect a message declares and the fields it needs, or the reason it
 * cannot be folded. Looks only at the message, never at the projection.
 */
export function readEffect(message) {
  if (Array.isArray(message?.problems) && message.problems.length) {
    return { ok: false, ...problem(EFFECT_PROBLEMS.AUTHORITY_MALFORMED, message.problems) };
  }
  for (const key of ['programme', 'programme_action']) {
    if (message?.envelope && Object.hasOwn(message.envelope.values, key)) {
      return { ok: false, ...problem(EFFECT_PROBLEMS.PROGRAMME_NOT_FOLDABLE, `${key} is present; programme activation is never folded`) };
    }
  }
  const effect = field(message, 'control_effect');
  if (effect === null) return { ok: false, ...problem(EFFECT_PROBLEMS.EFFECT_MISSING, 'no control_effect; meaning is never inferred from prose or message ids') };
  if (!CONTROL_EFFECTS.includes(effect)) return { ok: false, ...problem(EFFECT_PROBLEMS.EFFECT_UNKNOWN, effect) };
  const allowed = EFFECTS_BY_TYPE[message.message_type] || [];
  if (!allowed.includes(effect)) {
    return { ok: false, ...problem(EFFECT_PROBLEMS.EFFECT_TYPE_MISMATCH, `${message.message_type} cannot carry ${effect}`) };
  }

  const read = {
    effect,
    packet_id: field(message, 'packet_id'),
    implementation_branch: field(message, 'implementation_branch'),
    source_main: field(message, 'source_main'),
    pr_number: field(message, 'pr_number'),
    health: field(message, 'health'),
    merge_authority: field(message, 'merge_authority'),
  };
  // Health is projected, so it must be in the repository vocabulary. Anything
  // else, including the AMBER some authority has used, fails closed before an
  // effect applies; it is never translated (CORRECTION-003 F1, Copilot r4171049945).
  if (read.health !== null && !HEALTH.includes(read.health)) {
    return { ok: false, ...problem(EFFECT_PROBLEMS.HEALTH_INVALID, `${read.health} is not ${HEALTH.join('/')}`) };
  }
  // No effect projects production_touched, so authority signalling anything
  // but the safe value must stop the fold rather than fold as untouched
  // (Copilot r4171364250). This applies to every effect, holds included.
  const touched = field(message, 'production_touched');
  if (touched !== 'false') {
    return { ok: false, ...problem(EFFECT_PROBLEMS.PRODUCTION_TOUCHED, `production_touched is ${touched ?? 'absent'}; only false folds`) };
  }
  if (effect === 'HOLD_SET' || effect === 'HOLD_CLEAR') {
    // A hold is keyed by its packet; blank names none.
    if (read.packet_id === null) return { ok: false, ...problem(EFFECT_PROBLEMS.FIELD_MISSING, `${effect} needs packet_id`) };
    return { ok: true, ...read };
  }
  if (effect === 'NO_STATE_CHANGE') return { ok: true, ...read };

  const missing = [];
  if (read.implementation_branch === null) missing.push('implementation_branch');
  if (read.source_main === null || !SHA.test(read.source_main)) missing.push('source_main (40-hex)');
  // A release or a correction can come before any PR exists; an admission or
  // a checkpoint is about one.
  if (PR_REQUIRED.includes(effect) ? !PR_NUMBER.test(read.pr_number ?? '') : read.pr_number !== null && !PR_NUMBER.test(read.pr_number)) {
    missing.push('pr_number');
  }
  if (read.merge_authority !== null && !['true', 'false'].includes(read.merge_authority)) missing.push('merge_authority (true/false)');
  if (missing.length) return { ok: false, ...problem(EFFECT_PROBLEMS.FIELD_MISSING, `${effect} needs ${missing.join(', ')}`) };
  return { ok: true, ...read, pr_number: read.pr_number === null ? null : Number(read.pr_number) };
}

const anchorOf = (message) => ({ message_id: message.message_id, comment_id: message.comment_id });

/**
 * The packet-keyed holds of a projection. A legacy single `hold` that names a
 * packet is lifted in; one that names none stays where it is.
 */
function liftHolds(next) {
  // Spread copies own keys as data properties, `__proto__` included.
  const holds = { ...(next.holds || {}) };
  if (next.hold?.packet_id && !Object.hasOwn(holds, next.hold.packet_id)) {
    setHold(holds, next.hold.packet_id, next.hold);
    next.hold = null;
  }
  next.holds = holds;
  return holds;
}

/**
 * Apply one readable effect to a projection. Returns a NEW projection, or the
 * reason the effect conflicts with it. The input is never modified.
 *
 * @param {object} state  projection to apply to
 * @param {object} message  valid authority entry (collectAuthority)
 * @param {object} read  readEffect(message) with ok: true
 * @param {object} [options] { applicationPackets: Set<string> } packets that earn programme credit
 */
export function applyEffect(state, message, read, options = {}) {
  const next = structuredClone(state);
  const p = next.programme || (next.programme = {});
  const holds = liftHolds(next);
  const { effect, packet_id: packet } = read;
  // Own keys only, so an inherited name never reads as an active hold (Copilot r4171599236).
  const own = ownHold(holds, packet);
  const held = own && own.active !== false ? own : null;

  if (effect === 'HOLD_SET') {
    // The effect carries nothing but the packet, so a second hold on a packet
    // that is already held can never be shown compatible with the first.
    if (held) {
      return { ok: false, ...problem(EFFECT_PROBLEMS.HOLD_DUPLICATE, { packet_id: packet, hold_message_id: held.hold_message_id ?? null }) };
    }
    setHold(holds, packet, {
      active: true,
      packet_id: packet,
      reason: `HOLD_SET by ${message.message_id}`,
      hold_message_id: message.message_id,
      hold_comment_id: message.comment_id,
    });
  } else if (effect === 'HOLD_CLEAR') {
    if (!held) {
      return { ok: false, ...problem(EFFECT_PROBLEMS.HOLD_MISMATCH, { packet_id: packet, held: Object.keys(holds).filter((k) => ownHold(holds, k)?.active !== false) }) };
    }
    setHold(holds, packet, { ...held, active: false, released_by: message.message_id, released_comment_id: message.comment_id });
  } else if (effect !== 'NO_STATE_CHANGE') {
    // A packet effect for a held packet would be a release; only HOLD_CLEAR
    // releases. Holds on other packets do not affect this one.
    if (held) {
      return { ok: false, ...problem(EFFECT_PROBLEMS.PACKET_HELD, { packet_id: packet, hold_message_id: held.hold_message_id ?? null }) };
    }
    if (effect === 'PACKET_RELEASE') {
      const idle = p.state === null || p.state === undefined || p.state === 'CHECKPOINTED';
      const sameUnstarted = p.active_packet === packet && p.state === 'CHARACTERIZING';
      if (!idle && !sameUnstarted) {
        return { ok: false, ...problem(EFFECT_PROBLEMS.PACKET_IN_FLIGHT, { active_packet: p.active_packet ?? null, state: p.state }) };
      }
    } else {
      if (p.active_packet !== packet) {
        return { ok: false, ...problem(EFFECT_PROBLEMS.PACKET_NOT_ACTIVE, { active_packet: p.active_packet ?? null, requested: packet }) };
      }
      const projectedPr = p.pr_number === null || p.pr_number === undefined ? null : Number(p.pr_number);
      if (projectedPr !== null && read.pr_number !== null && projectedPr !== read.pr_number) {
        return { ok: false, ...problem(EFFECT_PROBLEMS.PR_CONFLICT, { projected: projectedPr, requested: read.pr_number }) };
      }
    }
    const grant = effect === 'PACKET_ADMISSION' && read.merge_authority === 'true';
    Object.assign(p, {
      active_packet: packet,
      active_phase: null,
      state: PROJECTED_STATE[effect],
      health: read.health,
      source_main: read.source_main,
      implementation_branch: read.implementation_branch,
      // A correction that names no PR keeps the projected one; a release starts afresh.
      pr_number: read.pr_number ?? (effect === 'PACKET_CORRECTION' ? (p.pr_number ?? null) : null),
      merge_authority: grant,
    });
    next.merge_authority_marker = grant ? anchorOf(message) : null;
    if (effect === 'CHECKPOINT' && options.applicationPackets?.has(packet)) {
      const prior = Array.isArray(p.checkpointed) ? p.checkpointed : [];
      if (!prior.includes(packet)) p.checkpointed = [...prior, packet];
    }
  }

  next.authority_basis = anchorOf(message);
  return { ok: true, state: next };
}

/**
 * Fold every newer typed authority message over the reviewed checkpoint.
 *
 * @param {object} checkpoint  programme-state as committed (normalized)
 * @param {object} authority   collectAuthority() output
 * @param {object} [options]   { applicationPackets: Set<string> }
 * @returns {{
 *   started: boolean, reason: string|null, state: object,
 *   checkpoint: {message_id, comment_id}|null,
 *   generation: number, checkpoint_generation: number|null, observed_generation: number|null,
 *   applied: object[], blocked: object|null, unapplied: object[] }}
 *   `state` is the effective projection; it equals the checkpoint when the
 *   fold could not start or applied nothing. `generation` is the number of
 *   authority candidates; every generation is a position among them.
 */
export function reduceAuthority(checkpoint, authority, options = {}) {
  const verified = authority?.verified === true;
  const candidates = verified
    ? [...(Array.isArray(authority.candidates) ? authority.candidates : authority.messages || [])].sort(compareAuthorityOrder)
    : [];
  const out = {
    started: false,
    reason: null,
    state: checkpoint,
    checkpoint: checkpoint?.authority_basis
      ? { message_id: checkpoint.authority_basis.message_id ?? null, comment_id: checkpoint.authority_basis.comment_id ?? null }
      : null,
    generation: candidates.length,
    checkpoint_generation: null,
    observed_generation: null,
    applied: [],
    blocked: null,
    unapplied: [],
  };
  if (!verified) return { ...out, reason: FOLD_NOT_STARTED.AUTHORITY_UNVERIFIED };
  const basis = checkpoint?.authority_basis;
  if (!basis?.message_id || basis.comment_id === undefined || basis.comment_id === null) {
    return { ...out, reason: FOLD_NOT_STARTED.CHECKPOINT_UNANCHORED };
  }
  // The anchor must be valid authority, not merely a candidate.
  const valid = new Set(authority.messages || []);
  const index = candidates.findIndex((m) => valid.has(m) && String(m.comment_id) === String(basis.comment_id) && m.message_id === basis.message_id);
  if (index < 0) return { ...out, reason: FOLD_NOT_STARTED.CHECKPOINT_ANCHOR_NOT_FOUND };

  const mark = (m, i) => ({ message_id: m.message_id ?? null, comment_id: m.comment_id ?? null, generation: i + 1, coordinate: coordinateOf(m) });
  let state = checkpoint;
  let observed = index + 1;
  for (let i = index + 1; i < candidates.length; i += 1) {
    const message = candidates[i];
    const read = readEffect(message);
    let applied = read.ok ? applyEffect(state, message, read, options) : read;
    // Never hand decide() a projection the state contract rejects.
    const invalid = applied.ok ? validateState(applied.state).problems : [];
    if (invalid.length) applied = { ok: false, ...problem(EFFECT_PROBLEMS.PROJECTION_INVALID, invalid.map((x) => x.code)) };
    if (!applied.ok) {
      return {
        ...out,
        started: true,
        state,
        checkpoint_generation: index + 1,
        observed_generation: observed,
        blocked: { ...mark(message, i), code: applied.code, detail: applied.detail },
        unapplied: candidates.slice(i).map((m, k) => mark(m, i + k)),
      };
    }
    state = applied.state;
    observed = i + 1;
    out.applied.push({ ...mark(message, i), effect: read.effect });
  }
  return { ...out, started: true, state, checkpoint_generation: index + 1, observed_generation: observed };
}

export default { CONTROL_EFFECTS, EFFECT_PROBLEMS, FOLD_NOT_STARTED, coordinateOf, readEffect, applyEffect, reduceAuthority };
