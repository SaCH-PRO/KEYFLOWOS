#!/usr/bin/env node
/**
 * Research-only deterministic ContextBundle compiler.
 *
 * This is deliberately NOT wired into the Claude worker or admission path.
 * It projects explicit fixture/task metadata + proof profiles into the
 * research ContextBundle contract without inventing authority or using an LLM.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, stringifyYaml } from '../lib/yaml.mjs';

export const AUTHORITY_CLASSES = Object.freeze([
  'EXECUTION_AUTHORITY',
  'IMPLEMENTATION_TRUTH',
  'CANONICAL_ARCHITECTURE',
  'DERIVED_PROJECTION',
  'HISTORICAL_EVIDENCE',
  'RESEARCH_ONLY',
]);

export const FRESHNESS = Object.freeze(['CURRENT', 'STALE', 'SUPERSEDED', 'UNVERIFIABLE']);
export const HEALTH = Object.freeze(['VALID', 'DEGRADED', 'INVALID']);

const AUTHORITY_RANK = new Map(AUTHORITY_CLASSES.map((v, i) => [v, i]));

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqSorted(values) {
  return [...new Set(asArray(values).filter((v) => v !== null && v !== undefined).map(String))].sort();
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
    return out;
  }
  return value;
}

function claimSortKey(c) {
  return [
    String(c.authority_class ?? ''),
    String(c.source ?? ''),
    String(c.revision ?? ''),
    String(c.claim ?? ''),
  ].join('\u0000');
}

function normalizeClaim(claim) {
  return {
    claim: String(claim.claim ?? ''),
    source: String(claim.source ?? ''),
    revision:
      claim.revision === null || claim.revision === undefined
        ? null
        : String(claim.revision),
    authority_class: String(claim.authority_class ?? 'RESEARCH_ONLY'),
    source_authority_class:
      claim.source_authority_class === null ||
      claim.source_authority_class === undefined
        ? null
        : String(claim.source_authority_class),
    freshness: String(claim.freshness ?? 'UNVERIFIABLE'),
    confidence:
      claim.confidence === null || claim.confidence === undefined
        ? null
        : Number(claim.confidence),
  };
}

function normalizeClaims(values) {
  return asArray(values).map(normalizeClaim).sort((a, b) => claimSortKey(a).localeCompare(claimSortKey(b)));
}

function normalizeExcluded(values) {
  return asArray(values).map((x) => ({
    source: String(x.source ?? ''),
    revision: x.revision === null || x.revision === undefined ? null : String(x.revision),
    reason: String(x.reason ?? 'IRRELEVANT'),
  })).sort((a, b) => `${a.source}\u0000${a.revision ?? ''}\u0000${a.reason}`.localeCompare(`${b.source}\u0000${b.revision ?? ''}\u0000${b.reason}`));
}

function selectProfiles(registry, changeClasses) {
  const wanted = new Set(changeClasses);
  const selected = [];
  const covered = new Set();

  for (const [id, profile] of Object.entries(registry.profiles ?? {})) {
    const required = asArray(profile.change_classes).map(String);

    // v0 is deliberately fail-closed:
    // a proof profile is selected only when all of its declared
    // change classes are present in the task.
    if (
      required.length === 0 ||
      !required.every((changeClass) => wanted.has(changeClass))
    ) {
      continue;
    }

    selected.push({ id, profile });
    required.forEach((changeClass) => covered.add(changeClass));
  }

  selected.sort((a, b) => a.id.localeCompare(b.id));

  return {
    selected,
    uncovered: changeClasses.filter((c) => !covered.has(c)).sort(),
  };
}

function mergedProof(selected) {
  const fields = ['reachability_checks', 'fastest_falsification', 'semantic_proofs', 'adversarial_proofs', 'final_admission'];
  const out = {};
  for (const field of fields) {
    out[field] = uniqSorted(selected.flatMap(({ profile }) => asArray(profile[field])));
  }
  return out;
}

function validateClaimAuthority(claim, problems) {
  if (!AUTHORITY_CLASSES.includes(claim.authority_class)) {
    problems.push(`unknown authority_class: ${claim.authority_class}`);
  }

  if (
    claim.source_authority_class &&
    !AUTHORITY_CLASSES.includes(claim.source_authority_class)
  ) {
    problems.push(
      `unknown source_authority_class: ${claim.source_authority_class}`,
    );
  }

  if (!FRESHNESS.includes(claim.freshness)) {
    problems.push(`unknown freshness: ${claim.freshness}`);
  }

  if (claim.source_authority_class) {
    const src = AUTHORITY_RANK.get(claim.source_authority_class);
    const projected = AUTHORITY_RANK.get(claim.authority_class);

    if (
      src !== undefined &&
      projected !== undefined &&
      projected < src
    ) {
      problems.push(
        `authority promotion forbidden for claim from ${claim.source}: ${claim.source_authority_class} -> ${claim.authority_class}`,
      );
    }
  }
}

export function compileContext({ fixture, proofRegistry, generatorVersion = 'research-0' }) {
  if (!fixture || typeof fixture !== 'object') throw new TypeError('fixture must be an object');
  if (!proofRegistry || typeof proofRegistry !== 'object') throw new TypeError('proofRegistry must be an object');

  const changeClasses = uniqSorted(fixture.task?.change_classes);
  const { selected, uncovered } = selectProfiles(proofRegistry, changeClasses);
  const proof = mergedProof(selected);

  const problems = [];
  const reasons = [];

  const authority = fixture.authority?.current ?? null;
  if (!authority?.source || !authority?.identifier) {
    reasons.push('required execution/implementation authority source is missing');
  } else if (authority.freshness && authority.freshness !== 'CURRENT') {
    reasons.push(`authority source freshness is ${authority.freshness}`);
  }

  const conflicts = normalizeClaims(fixture.authority?.conflicts);
  const invariants = normalizeClaims(fixture.semantic_context?.invariants);
  const contradictions = normalizeClaims(fixture.unresolved?.contradictions);
  const unknowns = normalizeClaims(fixture.unresolved?.unknowns);
  const provenanceClaims = normalizeClaims(fixture.provenance?.claims);

  for (const claim of [...conflicts, ...invariants, ...contradictions, ...unknowns, ...provenanceClaims]) {
    validateClaimAuthority(claim, problems);
  }

  if (conflicts.length > 0 || contradictions.length > 0) reasons.push('unresolved authority/semantic conflicts are present');
  if (asArray(fixture.unresolved?.missing_required_sources).length > 0) reasons.push('required sources are missing');
  if (uncovered.length > 0) reasons.push(`uncovered change classes: ${uncovered.join(', ')}`);

  // Research material can be included only as research context.
  for (const item of asArray(fixture.research_context?.items)) {
    if (item.authority_class && item.authority_class !== 'RESEARCH_ONLY') {
      problems.push(`research item ${item.source ?? '(unknown)'} must remain RESEARCH_ONLY`);
    }
  }

  let health = 'VALID';
  if (problems.length > 0) health = 'INVALID';
  else if (reasons.length > 0) health = 'DEGRADED';

  const bundle = {
    schema_version: 1,
    generator: {
      name: 'context-bundle-prototype',
      version: generatorVersion,
      deterministic: true,
    },
    snapshot: {
      repository: String(fixture.snapshot?.repository ?? ''),
      main_sha: String(fixture.snapshot?.main_sha ?? ''),
      task_head_sha: fixture.snapshot?.task_head_sha ?? null,
      packet_id: fixture.snapshot?.packet_id ?? null,
      generated_from: asArray(fixture.snapshot?.generated_from).map((x) => ({
        source: String(x.source ?? ''),
        revision: String(x.revision ?? ''),
      })).sort((a, b) => `${a.source}\u0000${a.revision}`.localeCompare(`${b.source}\u0000${b.revision}`)),
    },
    health: {
      status: health,
      reasons: uniqSorted([...reasons, ...problems]),
    },
    task: {
      objective: String(fixture.task?.objective ?? ''),
      change_classes: changeClasses,
      allowed_scope: uniqSorted(fixture.task?.allowed_scope),
      prohibited_scope: uniqSorted(fixture.task?.prohibited_scope),
      stop_conditions: uniqSorted(fixture.task?.stop_conditions),
    },
    authority: {
      current: authority ? {
        source: String(authority.source ?? ''),
        identifier: String(authority.identifier ?? ''),
        revision: authority.revision ?? null,
        freshness: String(authority.freshness ?? 'UNVERIFIABLE'),
      } : {
        source: '',
        identifier: '',
        revision: null,
        freshness: 'UNVERIFIABLE',
      },
      conflicts,
    },
    semantic_context: {
      owners: uniqSorted(fixture.semantic_context?.owners),
      journeys: uniqSorted(fixture.semantic_context?.journeys),
      kernels: uniqSorted(fixture.semantic_context?.kernels),
      execution_paths: uniqSorted(fixture.semantic_context?.execution_paths),
      invariants,
      hotspots: uniqSorted(fixture.semantic_context?.hotspots),
      historical_failure_classes: uniqSorted(fixture.semantic_context?.historical_failure_classes),
    },
    proof_context: {
      selected_profiles: selected.map((x) => x.id),
      uncovered_change_classes: uncovered,
      ...proof,
    },
    unresolved: {
      contradictions,
      unknowns,
      missing_required_sources: uniqSorted(fixture.unresolved?.missing_required_sources),
    },
    provenance: {
      claims: provenanceClaims,
    },
    excluded: {
      sources: normalizeExcluded(fixture.excluded?.sources),
    },
    research_context: {
      items: asArray(fixture.research_context?.items).map((x) => ({
        source: String(x.source ?? ''),
        status: String(x.status ?? ''),
        authority_class: 'RESEARCH_ONLY',
        contribution: String(x.contribution ?? ''),
      })).sort((a, b) => a.source.localeCompare(b.source)),
    },
  };

  return stableObject(bundle);
}

export function compileText({ fixtureText, proofRegistryText, generatorVersion }) {
  const fixture = parseYaml(fixtureText);
  const proofRegistry = parseYaml(proofRegistryText);
  const bundle = compileContext({ fixture, proofRegistry, generatorVersion });
  return stringifyYaml(bundle);
}

function cli(argv) {
  const args = [...argv];
  const fixturePath = args[0];
  const registryPath = args[1] ?? 'docs/intelligence/research/contracts/PROOF-PROFILES.yaml';
  if (!fixturePath) {
    process.stderr.write('usage: node scripts/agent-control/research/compile-context.mjs <fixture.yaml> [proof-profiles.yaml]\n');
    return 2;
  }
  const fixtureText = fs.readFileSync(path.resolve(fixturePath), 'utf8');
  const proofRegistryText = fs.readFileSync(path.resolve(registryPath), 'utf8');
  process.stdout.write(compileText({ fixtureText, proofRegistryText }));
  return 0;
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here)) {
  process.exitCode = cli(process.argv.slice(2));
}
