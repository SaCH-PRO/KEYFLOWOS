import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, stringifyYaml } from '../../lib/yaml.mjs';
import { compileContext, compileText } from '../compile-context.mjs';

const ROOT = process.cwd();
const registryText = fs.readFileSync(path.join(ROOT, 'docs/intelligence/research/contracts/PROOF-PROFILES.yaml'), 'utf8');
const registry = parseYaml(registryText);

function fixture(name) {
  return fs.readFileSync(path.join(ROOT, 'scripts/agent-control/research/fixtures', name), 'utf8');
}

function assertTenantProofProfile(out) {
  assert.ok(
    out.proof_context.selected_profiles.includes('TENANT_AUTHORITY_DATA_BOUNDARY'),
  );

  assert.ok(
    out.proof_context.semantic_proofs.some((proof) => /pagination/i.test(proof)),
    'TENANT proof profile must retain a pagination semantic proof',
  );
}

test('deterministic: same input emits byte-identical YAML', () => {
  const a = compileText({ fixtureText: fixture('tenant.yaml'), proofRegistryText: registryText });
  const b = compileText({ fixtureText: fixture('tenant.yaml'), proofRegistryText: registryText });
  assert.equal(a, b);
});

test('round trip: emitted YAML parses to the compiled object', () => {
  const f = parseYaml(fixture('tenant.yaml'));
  const object = compileContext({ fixture: f, proofRegistry: registry });
  const emitted = compileText({ fixtureText: fixture('tenant.yaml'), proofRegistryText: registryText });
  assert.deepEqual(parseYaml(emitted), object);
});

test('TENANT selects the tenant proof profile', () => {
  const out = compileContext({
    fixture: parseYaml(fixture('tenant.yaml')),
    proofRegistry: registry,
  });

  assertTenantProofProfile(out);
});

test('CONTROL selects the control proof profile', () => {
  const out = compileContext({ fixture: parseYaml(fixture('control.yaml')), proofRegistry: registry });
  assert.deepEqual(out.proof_context.selected_profiles, ['CONTROL_AUTHORITY_STATE']);
  assert.ok(out.proof_context.adversarial_proofs.some((x) => /prototype-like/i.test(x)));
});

test('EXTFX selects the external-effect proof profile without compiler special-casing', () => {
  const out = compileContext({ fixture: parseYaml(fixture('extfx.yaml')), proofRegistry: registry });
  assert.deepEqual(out.proof_context.selected_profiles, ['EXTERNAL_EFFECT_CERTAINTY']);
  assert.ok(out.proof_context.semantic_proofs.some((x) => /reconciliation/i.test(x)));
});

test('missing authority cannot be VALID', () => {
  const f = parseYaml(fixture('tenant.yaml'));
  f.authority.current = {};
  const out = compileContext({ fixture: f, proofRegistry: registry });
  assert.notEqual(out.health.status, 'VALID');
  assert.ok(out.health.reasons.some((x) => /authority/i.test(x)));
});

test('stale authority is visible and degrades health', () => {
  const f = parseYaml(fixture('tenant.yaml'));
  f.authority.current.freshness = 'STALE';
  const out = compileContext({ fixture: f, proofRegistry: registry });
  assert.equal(out.health.status, 'DEGRADED');
  assert.ok(out.health.reasons.some((x) => /STALE/.test(x)));
});

test('conflicts are preserved instead of silently resolved', () => {
  const f = parseYaml(fixture('tenant.yaml'));
  f.authority.conflicts = [
    { claim: 'A', source: 'one', revision: '1', authority_class: 'CANONICAL_ARCHITECTURE', freshness: 'CURRENT' },
    { claim: 'not A', source: 'two', revision: '2', authority_class: 'CANONICAL_ARCHITECTURE', freshness: 'CURRENT' },
  ];
  const out = compileContext({ fixture: f, proofRegistry: registry });
  assert.equal(out.authority.conflicts.length, 2);
  assert.equal(out.health.status, 'DEGRADED');
});

test('research context cannot promote itself to canonical authority', () => {
  const f = parseYaml(fixture('tenant.yaml'));
  f.research_context.items[0].authority_class = 'CANONICAL_ARCHITECTURE';
  const out = compileContext({ fixture: f, proofRegistry: registry });
  assert.equal(out.health.status, 'INVALID');
  assert.ok(out.health.reasons.some((x) => /RESEARCH_ONLY/.test(x)));
});

test('unknown change class remains explicitly uncovered', () => {
  const f = parseYaml(fixture('tenant.yaml'));
  f.task.change_classes.push('ALIEN_CHANGE_CLASS');
  const out = compileContext({ fixture: f, proofRegistry: registry });
  assert.ok(out.proof_context.uncovered_change_classes.includes('ALIEN_CHANGE_CLASS'));
  assert.equal(out.health.status, 'DEGRADED');
});

test('reordering equivalent list inputs does not change emitted bytes', () => {
  const a = parseYaml(fixture('tenant.yaml'));
  const b = structuredClone(a);
  b.task.change_classes.reverse();
  b.semantic_context.owners.reverse();
  b.semantic_context.historical_failure_classes.reverse();
  const ta = compileText({ fixtureText: fs.readFileSync(path.join(ROOT, 'scripts/agent-control/research/fixtures/tenant.yaml'), 'utf8'), proofRegistryText: registryText });
  const tb = compileText({ fixtureText: stringifyYaml(b), proofRegistryText: registryText });
  assert.equal(ta, tb);
});

test('snapshot SHA mutation changes output', () => {
  const f = parseYaml(fixture('tenant.yaml'));
  const a = compileContext({ fixture: f, proofRegistry: registry });
  f.snapshot.main_sha = 'f'.repeat(40);
  const b = compileContext({ fixture: f, proofRegistry: registry });
  assert.notDeepEqual(a, b);
});

test('excluded sources preserve source revision and reason for audit', () => {
  const f = parseYaml(fixture('tenant.yaml'));

  f.excluded.sources = [
    {
      source: 'architecture/stale-map.yaml',
      revision: 'abc123',
      reason: 'STALE',
    },
  ];

  const out = compileContext({ fixture: f, proofRegistry: registry });

  assert.deepEqual(out.excluded.sources, [
    {
      source: 'architecture/stale-map.yaml',
      revision: 'abc123',
      reason: 'STALE',
    },
  ]);
});

test('negative control: removing a required semantic proof breaks the TENANT expectation', () => {
  const mutatedRegistry = structuredClone(registry);

  mutatedRegistry.profiles.TENANT_AUTHORITY_DATA_BOUNDARY.semantic_proofs =
    mutatedRegistry.profiles.TENANT_AUTHORITY_DATA_BOUNDARY.semantic_proofs.filter(
      (proof) => !/pagination/i.test(proof),
    );

  const out = compileContext({
    fixture: parseYaml(fixture('tenant.yaml')),
    proofRegistry: mutatedRegistry,
  });

  assert.throws(
    () => assertTenantProofProfile(out),
    { name: 'AssertionError' },
  );
});

test('negative control: claim cannot outrank its source authority', () => {
  const mutated = parseYaml(fixture('tenant.yaml'));

  mutated.semantic_context.invariants[0].source_authority_class =
    'HISTORICAL_EVIDENCE';

  mutated.semantic_context.invariants[0].authority_class =
    'EXECUTION_AUTHORITY';

  const out = compileContext({
    fixture: mutated,
    proofRegistry: registry,
  });

  assert.equal(out.health.status, 'INVALID');

  assert.ok(
    out.health.reasons.some((reason) =>
      /authority promotion forbidden/i.test(reason),
    ),
  );
});

test('negative control: unknown source authority class is INVALID', () => {
  const mutated = parseYaml(fixture('tenant.yaml'));

  mutated.semantic_context.invariants[0].source_authority_class =
    'ALIEN_AUTHORITY';

  const out = compileContext({
    fixture: mutated,
    proofRegistry: registry,
  });

  assert.equal(out.health.status, 'INVALID');

  assert.ok(
    out.health.reasons.some((reason) =>
      /unknown source_authority_class/i.test(reason),
    ),
  );
});