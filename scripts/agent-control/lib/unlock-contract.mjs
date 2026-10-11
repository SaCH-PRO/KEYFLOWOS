const STATES = Object.freeze(['DECLARED','IMPLEMENTED','PROVEN','ADMITTED','LIVE']);
const CLASSIFICATIONS = Object.freeze([
  'PLANNING_ONLY',
  'ARCHITECTURE_ONLY',
  'GOVERNANCE_ONLY',
  'RUNTIME_CAPABILITY',
  'DEVELOPMENT_CAPABILITY',
  'RELIABILITY_CAPABILITY',
  'DEBT_REMOVAL',
]);
const EFFECTS = Object.freeze(['NONE','FOUNDATION','PARTIAL','MATERIAL','CANONICAL']);
const VERDICTS = Object.freeze(['POSITIVE','NEUTRAL_REQUIRED','NEGATIVE_DO_NOT_MERGE']);
const STATE_RANK = Object.freeze(Object.fromEntries(STATES.map((state, index) => [state,index])));

const mapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const list = (value) => Array.isArray(value);

function problem(code, detail) {
  return { code, detail };
}

function validateEffectSection(contract, name, problems) {
  const section = contract[name];
  if (!mapping(section)) {
    problems.push(problem('EFFECT_SECTION_MISSING', name));
    return;
  }
  if (!EFFECTS.includes(section.effect)) {
    problems.push(problem('EFFECT_INVALID', `${name}.effect=${String(section.effect)}`));
  }
  if (!text(section.claim)) {
    problems.push(problem('EFFECT_CLAIM_MISSING', name));
  }
}

export function validateUnlockContract(contract) {
  const problems = [];
  if (!mapping(contract)) return { ok:false, problems:[problem('CONTRACT_NOT_MAPPING','contract must be a mapping')] };

  if (contract.version !== 1) problems.push(problem('VERSION_UNSUPPORTED', String(contract.version)));
  if (!text(contract.work_id)) problems.push(problem('WORK_ID_MISSING','work_id must be non-blank text'));
  if (!text(contract.implementation_branch)) problems.push(problem('BRANCH_MISSING','implementation_branch must be non-blank text'));
  if (!STATES.includes(contract.state)) problems.push(problem('STATE_INVALID', String(contract.state)));

  if (!list(contract.classifications) || contract.classifications.length === 0) {
    problems.push(problem('CLASSIFICATIONS_MISSING','at least one classification is required'));
  } else {
    const seen = new Set();
    for (const value of contract.classifications) {
      if (!CLASSIFICATIONS.includes(value)) problems.push(problem('CLASSIFICATION_INVALID', String(value)));
      if (seen.has(value)) problems.push(problem('CLASSIFICATION_DUPLICATE', String(value)));
      seen.add(value);
    }
  }

  for (const name of ['product','key','development','reliability']) validateEffectSection(contract,name,problems);

  for (const name of ['enables','converges','complexity_cost']) {
    if (!list(contract[name])) problems.push(problem('LIST_REQUIRED', name));
  }

  if (!mapping(contract.proof)) {
    problems.push(problem('PROOF_MISSING','proof must be a mapping'));
  } else {
    if (!list(contract.proof.obligations)) problems.push(problem('PROOF_OBLIGATIONS_INVALID','proof.obligations must be a list'));
    if (!list(contract.proof.evidence)) problems.push(problem('PROOF_EVIDENCE_INVALID','proof.evidence must be a list'));
    if (STATES.includes(contract.state) && STATE_RANK[contract.state] >= STATE_RANK.IMPLEMENTED && contract.proof.obligations?.length === 0) {
      problems.push(problem('IMPLEMENTED_WITHOUT_PROOF_OBLIGATIONS','implemented-or-later work must declare proof obligations'));
    }
    if (STATES.includes(contract.state) && STATE_RANK[contract.state] >= STATE_RANK.PROVEN && contract.proof.evidence?.length === 0) {
      problems.push(problem('PROVEN_WITHOUT_EVIDENCE','proven-or-later work must cite proof evidence'));
    }
  }

  if (!mapping(contract.net_value)) {
    problems.push(problem('NET_VALUE_MISSING','net_value must be a mapping'));
  } else {
    if (!VERDICTS.includes(contract.net_value.verdict)) problems.push(problem('NET_VALUE_VERDICT_INVALID', String(contract.net_value.verdict)));
    if (!text(contract.net_value.rationale)) problems.push(problem('NET_VALUE_RATIONALE_MISSING','net_value.rationale must be non-blank text'));
  }

  const effects = ['product','key','development','reliability'].map((name) => contract[name]?.effect);
  if (contract.net_value?.verdict === 'POSITIVE' && effects.every((effect) => effect === 'NONE')) {
    problems.push(problem('POSITIVE_WITHOUT_EFFECT','POSITIVE requires at least one non-NONE effect'));
  }

  if (contract.classifications?.includes('PLANNING_ONLY')) {
    if (contract.product?.effect !== 'NONE' || contract.key?.effect !== 'NONE') {
      problems.push(problem('PLANNING_CLAIMS_RUNTIME_EFFECT','PLANNING_ONLY cannot claim product or KEY effect'));
    }
  }

  if (contract.state === 'LIVE' && contract.post_merge_verified !== true) {
    problems.push(problem('LIVE_WITHOUT_POST_MERGE_VERIFICATION','LIVE requires post_merge_verified=true'));
  }

  return { ok: problems.length === 0, problems };
}

export { STATES, CLASSIFICATIONS, EFFECTS, VERDICTS };
