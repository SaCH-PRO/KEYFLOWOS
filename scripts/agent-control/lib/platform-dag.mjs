/**
 * PLATFORM-DAG — contract checks for the INACTIVE successor programme
 * (docs/development/KEYFLOWOS_PLATFORM_DAG.yaml).
 *
 * Validation only. Nothing here is wired into the orchestrator, the worker or
 * the selector: teaching the dispatcher about a second programme is packet
 * KF-PLAT-AUTO-001 and is not released. This module exists so the successor's
 * topology, human gates and activation contract are proved by the same tooling
 * that proves the application DAG, before any admission.
 *
 * Pure except for loadPlatformDag/loadAutopilotPolicy, which only read files.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.mjs';
import { buildDag } from './dag.mjs';
import { readField } from './events.mjs';
import { AUTHORITY_MESSAGE_TYPES, AUTHORITY_SENDER, AUTHORIZED_AUTHORS, collectAuthority } from './reconcile.mjs';

export const PLATFORM_DAG_PATH = 'docs/development/KEYFLOWOS_PLATFORM_DAG.yaml';
export const AUTOPILOT_POLICY_PATH = 'docs/development/AGENT_AUTOPILOT_POLICY.yaml';

export const PLATFORM_STATES = Object.freeze({
  INACTIVE: 'INACTIVE_SUCCESSOR',
  ACTIVE: 'ACTIVE',
  HELD: 'HELD',
});

export function loadPlatformDag(repoRoot = process.cwd()) {
  const doc = parseYaml(fs.readFileSync(path.join(repoRoot, PLATFORM_DAG_PATH), 'utf8'));
  return { doc, dag: buildDag(doc) };
}

export function loadAutopilotPolicy(repoRoot = process.cwd()) {
  return parseYaml(fs.readFileSync(path.join(repoRoot, AUTOPILOT_POLICY_PATH), 'utf8'));
}

function sameSet(a, b) {
  const left = [...new Set(a || [])].sort();
  const right = [...new Set(b || [])].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/**
 * Structural proof of the gate and activation contract.
 * Returns every problem found; an empty list is the only passing result.
 */
export function validatePlatformContract(doc, policy) {
  const problems = [];
  const add = (code, detail) => problems.push({ code, detail });

  // --- inactive by construction ------------------------------------------
  if (doc.status !== PLATFORM_STATES.INACTIVE) {
    add('FILE_DECLARES_ACTIVATION', `status is ${doc.status}; the file may only ever say ${PLATFORM_STATES.INACTIVE}`);
  }
  const activation = doc.activation || {};
  if (activation.state !== PLATFORM_STATES.INACTIVE) {
    add('FILE_DECLARES_ACTIVATION', `activation.state is ${activation.state}; state lives on issue #80, not in this file`);
  }

  // --- activation contract ------------------------------------------------
  const policyTypes = policy?.state_authority?.valid_authority_message?.message_types || [];
  const policyAuthors = policy?.state_authority?.valid_authority_message?.author_allowlist || [];
  const policySender = policy?.state_authority?.valid_authority_message?.sender_exact;

  const checkAuthorityBlock = (name, block, types, action) => {
    if (!block) {
      add('ACTIVATION_CONTRACT_MISSING', `activation.${name} is not declared`);
      return;
    }
    for (const type of types) {
      if (!policyTypes.includes(type) || !AUTHORITY_MESSAGE_TYPES.includes(type)) add('ACTIVATION_TYPE_NOT_AUTHORITY', `activation.${name} accepts ${type}, which is not a valid authority message type`);
    }
    if (!types.length) add('ACTIVATION_CONTRACT_MISSING', `activation.${name} names no message type`);
    if (block.sender_exact !== policySender || block.sender_exact !== AUTHORITY_SENDER) {
      add('ACTIVATION_SENDER_MISMATCH', `activation.${name}.sender_exact is ${block.sender_exact}`);
    }
    if (!sameSet(block.author_allowlist, policyAuthors) || !sameSet(block.author_allowlist, AUTHORIZED_AUTHORS)) {
      add('ACTIVATION_AUTHOR_MISMATCH', `activation.${name}.author_allowlist is ${JSON.stringify(block.author_allowlist)}`);
    }
    const fields = block.required_fields || {};
    if (fields.programme !== doc.programme) {
      add('ACTIVATION_PROGRAMME_FIELD', `activation.${name}.required_fields.programme must equal ${doc.programme}`);
    }
    if (fields.programme_action !== action) {
      add('ACTIVATION_ACTION_FIELD', `activation.${name}.required_fields.programme_action must be ${action}`);
    }
  };
  checkAuthorityBlock('activate', activation.activate, activation.activate?.message_type ? [activation.activate.message_type] : [], 'ACTIVATE');
  checkAuthorityBlock('hold', activation.hold, activation.hold?.message_types || [], 'HOLD');
  if (activation.activate?.message_type && activation.activate.message_type !== 'DIRECTIVE') {
    add('ACTIVATION_TYPE_NOT_DIRECTIVE', 'only a DIRECTIVE may activate the successor programme');
  }
  if (activation.hold && !sameSet(activation.hold.message_types, ['DIRECTIVE', 'HOLD'])) {
    add('HOLD_TYPES_MISMATCH', 'activation.hold.message_types must be exactly [DIRECTIVE, HOLD], as the evaluator enforces');
  }
  if (!sameSet(activation.required_envelope, REQUIRED_ENVELOPE)) {
    add('ACTIVATION_ENVELOPE_MISMATCH', `activation.required_envelope must equal the issue #80 envelope ${JSON.stringify(REQUIRED_ENVELOPE)}`);
  }
  if (activation.evaluation?.no_matching_message !== PLATFORM_STATES.INACTIVE) {
    add('ACTIVATION_FAILS_OPEN', 'with no matching message the programme must stay INACTIVE_SUCCESSOR');
  }
  if (activation.evaluation?.authority_unverifiable !== PLATFORM_STATES.INACTIVE) {
    add('ACTIVATION_FAILS_OPEN', 'unverifiable authority must leave the programme INACTIVE_SUCCESSOR');
  }
  if (activation.evaluation?.invalid_contract !== PLATFORM_STATES.INACTIVE) {
    add('ACTIVATION_FAILS_OPEN', 'an invalid contract must leave the programme INACTIVE_SUCCESSOR');
  }
  if (activation.evaluation?.malformed_envelope !== PLATFORM_STATES.HELD) {
    add('ACTIVATION_FAILS_OPEN', 'a malformed message naming the programme must hold it');
  }
  if (activation.evaluation?.unrecognized_programme_action !== PLATFORM_STATES.HELD) {
    add('ACTIVATION_FAILS_OPEN', 'an unrecognized programme_action must hold the programme');
  }
  if (activation.activation_releases_no_other_hold !== true) {
    add('ACTIVATION_RELEASES_HOLD', 'activating the successor must not release any other hold');
  }

  // --- human gates ----------------------------------------------------------
  const gatesDoc = doc.human_gates || {};
  if (gatesDoc.inherits_never_automatic_from !== AUTOPILOT_POLICY_PATH) {
    add('GATE_INHERITANCE_SOURCE', `human_gates.inherits_never_automatic_from must be ${AUTOPILOT_POLICY_PATH}`);
  }
  const inherited = new Set(gatesDoc.inherited_never_automatic || []);
  for (const effect of policy?.never_automatic || []) {
    if (!inherited.has(effect)) add('INHERITED_GATE_MISSING', `never_automatic effect ${effect} is not inherited`);
  }
  if (!(policy?.never_automatic || []).length) add('INHERITED_GATE_MISSING', 'the autopilot policy declares no never_automatic effects');
  if (gatesDoc.applies_to_every_packet !== true) {
    add('GATES_NOT_GLOBAL', 'human gates must apply to every packet; packet annotations are hints only');
  }

  const gateIds = new Set();
  for (const gate of gatesDoc.gates || []) {
    if (!gate?.id) {
      add('GATE_WITHOUT_ID', JSON.stringify(gate));
      continue;
    }
    if (gateIds.has(gate.id)) add('GATE_DUPLICATE', gate.id);
    gateIds.add(gate.id);
    if (!gate.effect) add('GATE_WITHOUT_EFFECT', gate.id);
    for (const parent of gate.inherits || []) {
      if (!inherited.has(parent)) add('GATE_INHERITS_UNKNOWN', `${gate.id} inherits ${parent}, which is not an inherited never_automatic effect`);
    }
  }

  for (const packet of doc.packets || []) {
    for (const annotation of packet.human_gates || []) {
      if (!gateIds.has(annotation?.gate)) add('PACKET_GATE_UNKNOWN', `${packet.id} references undeclared gate ${annotation?.gate}`);
      if (!annotation?.when) add('PACKET_GATE_WITHOUT_CONDITION', `${packet.id} gate ${annotation?.gate}`);
    }
  }

  if (doc.selection_policy?.file_presence_never_activates_successor !== true) {
    add('FILE_DECLARES_ACTIVATION', 'selection_policy.file_presence_never_activates_successor must be true');
  }
  if (doc.selection_policy?.production_effects_require_matching_human_gate !== true) {
    add('GATES_NOT_GLOBAL', 'selection_policy.production_effects_require_matching_human_gate must be true');
  }

  return problems;
}

/**
 * Fields every issue #80 control message must carry (issue #80 body, "Every
 * message must include"). `source_main/source_head` is satisfied by either.
 * An authority message missing any of them is malformed and cannot activate.
 */
export const REQUIRED_ENVELOPE = Object.freeze([
  'message_id',
  'packet_id',
  'sender',
  'source_main|source_head',
  'implementation_branch',
  'state',
  'health',
  'scope_changed',
  'production_touched',
]);

export function missingEnvelopeFields(body) {
  return REQUIRED_ENVELOPE.filter((spec) => spec.split('|').every((key) => readField(body, key) === null));
}

/**
 * Derive the successor programme's state from raw issue #80 comments.
 *
 * Only authority-typed messages from an allowlisted author that carry an
 * explicit `programme:` field equal to this programme are considered; the
 * newest one decides. Prose, ids and packet ids are never read.
 *
 * Fail-closed outcomes are fixed here, not read from the DAG, and the DAG's
 * contract is validated before any comment is evaluated, so an edited file
 * cannot turn an unreadable #80 or a malformed message into ACTIVE:
 *   invalid contract / #80 unverifiable / nothing names this programme -> INACTIVE_SUCCESSOR
 *   newest naming message malformed or neither ACTIVATE nor HOLD          -> HELD
 *
 * @param {Array|null} comments GitHub issue comments ({id, created_at, user:{login}, body})
 * @param {object} doc parsed platform DAG
 * @param {object} policy parsed AGENT_AUTOPILOT_POLICY.yaml
 * @returns {{state: string, reason: string, decided_by: object|null}}
 */
export function platformProgrammeState(comments, doc, policy) {
  const problems = validatePlatformContract(doc || {}, policy);
  if (problems.length) {
    return {
      state: PLATFORM_STATES.INACTIVE,
      reason: `activation contract invalid: ${problems.map((p) => p.code).join(', ')}`,
      decided_by: null,
    };
  }

  // Always the fixed authority constants: no caller override of the allowlist.
  const authority = collectAuthority(comments);
  if (!authority.verified) {
    return { state: PLATFORM_STATES.INACTIVE, reason: authority.reason, decided_by: null };
  }

  // collectAuthority drops a comment without message_id or with a sender other
  // than exactly `chatgpt`. From an allowlisted author, with an authority type
  // and naming this programme, such a comment is a malformed message about
  // this programme: it must hold, not vanish. Other authors stay ignored.
  const authors = AUTHORIZED_AUTHORS.map((a) => a.toLowerCase());
  const naming = [];
  for (const comment of comments) {
    const body = comment?.body || '';
    if (readField(body, 'programme') !== doc.programme) continue;
    const messageType = readField(body, 'message_type');
    if (!AUTHORITY_MESSAGE_TYPES.includes(messageType)) continue;
    if (!authors.includes(String(comment?.user?.login || '').toLowerCase())) continue;
    if (comment.id === undefined || comment.id === null || !comment.created_at) {
      return { state: PLATFORM_STATES.INACTIVE, reason: 'a comment naming this programme has no id or timestamp', decided_by: null };
    }
    const missing = missingEnvelopeFields(body);
    const sender = readField(body, 'sender');
    if (sender !== null && sender !== AUTHORITY_SENDER) missing.push(`sender (${sender} is not exactly ${AUTHORITY_SENDER})`);
    naming.push({
      message_id: readField(body, 'message_id'),
      message_type: messageType,
      comment_id: comment.id,
      created_at: comment.created_at,
      programme_action: readField(body, 'programme_action'),
      missing_envelope: missing,
    });
  }
  naming.sort((a, b) => {
    const t = Date.parse(a.created_at) - Date.parse(b.created_at);
    return t !== 0 ? t : Number(a.comment_id) - Number(b.comment_id);
  });

  if (!naming.length) {
    return { state: PLATFORM_STATES.INACTIVE, reason: 'no valid authority message names this programme', decided_by: null };
  }

  const newest = naming[naming.length - 1];
  const decided_by = {
    message_id: newest.message_id,
    message_type: newest.message_type,
    comment_id: newest.comment_id,
    programme_action: newest.programme_action,
  };

  // A malformed message naming the programme can never activate it, but it
  // is still a signal from the authority about this programme: hold.
  if (newest.missing_envelope.length) {
    return {
      state: PLATFORM_STATES.HELD,
      reason: `newest message naming this programme lacks envelope fields ${newest.missing_envelope.join(', ')}; failing closed`,
      decided_by,
    };
  }

  // The contract validator has already pinned these to DIRECTIVE/ACTIVATE and
  // DIRECTIVE|HOLD/HOLD; they are restated so the outcome never depends on it.
  if (newest.message_type === 'DIRECTIVE' && newest.programme_action === 'ACTIVATE') {
    return { state: PLATFORM_STATES.ACTIVE, reason: 'newest message naming this programme is an ACTIVATE DIRECTIVE', decided_by };
  }
  if (['DIRECTIVE', 'HOLD'].includes(newest.message_type) && newest.programme_action === 'HOLD') {
    return { state: PLATFORM_STATES.HELD, reason: 'newest message naming this programme is a HOLD', decided_by };
  }
  return {
    state: PLATFORM_STATES.HELD,
    reason: `newest message naming this programme (${newest.message_type}, programme_action ${newest.programme_action}) is neither ACTIVATE nor HOLD; failing closed`,
    decided_by,
  };
}

export default {
  PLATFORM_DAG_PATH,
  AUTOPILOT_POLICY_PATH,
  PLATFORM_STATES,
  REQUIRED_ENVELOPE,
  missingEnvelopeFields,
  loadPlatformDag,
  loadAutopilotPolicy,
  validatePlatformContract,
  platformProgrammeState,
};
