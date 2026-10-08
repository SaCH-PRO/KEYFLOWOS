# Development-Speed Trace 004D — Context Compiler Prototype Specification

Status: READY FOR OFFLINE PROTOTYPE
Authority: RESEARCH ONLY
Depends on:
- CONTEXT-BUNDLE-SCHEMA.yaml
- PROOF-PROFILES.yaml
- Trace 004B control-plane sample
- Trace 004C TENANT sample

## Goal

Implement the smallest deterministic offline compiler that can prove or falsify the ContextBundle hypothesis without touching the live Claude worker or creating a new source of truth.

## Proposed location

`scripts/agent-control/research/compile-context.mjs`

Rationale:
- reuses the existing dependency-free agent-control YAML codec;
- remains adjacent to the development control substrate;
- explicit `research/` namespace prevents accidental production authority;
- no new runtime service/module/database.

## Inputs v0

Required:
- repository root;
- packet/task fixture or active packet;
- explicit repository snapshot SHA;
- proof profile registry.

Optional:
- architecture module registry;
- execution-path map;
- historical hotspot/failure profile fixture;
- R&D references.

v0 MUST NOT scrape arbitrary prose and ask an LLM to decide truth.

## Deterministic pipeline

```
read explicit inputs
  -> validate required shapes
  -> resolve task change classes
  -> select matching proof profiles
  -> collect declared semantic context
  -> attach source revisions + authority classes
  -> detect stale/missing/conflicting required sources
  -> sort all unordered collections canonically
  -> emit ContextBundle YAML
  -> parse emitted YAML
  -> compare normalized object
```

## Reuse

Use `scripts/agent-control/lib/yaml.mjs` rather than adding a YAML dependency.

The existing codec is deliberately dependency-free and fail-closed for unsupported YAML constructs because it already parses admission evidence.

Do not modify that codec merely to make the research prototype convenient.

## v0 non-goals

- no issue #80 network fetch;
- no GitHub mutation;
- no Claude prompt injection;
- no automatic architecture promotion;
- no learned ranking;
- no LLM summarization;
- no production worker integration;
- no new database;
- no universal semantic-owner inference.

These can be considered only after deterministic core proof.

## Required tests

### Determinism
Same input fixture and generator version -> byte-identical output.

### Round trip
Generated YAML -> existing parseYaml -> normalized object equals pre-serialization object.

### Missing authority
Required authority absent -> DEGRADED or INVALID, never VALID.

### Stale source
Explicitly stale required source -> visible freshness + degraded health.

### Conflict preservation
Two contradictory canonical claims -> both retained under unresolved/conflicts; compiler does not pick a winner.

### Research containment
RESEARCH_ONLY claim cannot appear as CANONICAL_ARCHITECTURE or EXECUTION_AUTHORITY.

### Proof-profile selection
CONTROL packet selects CONTROL_AUTHORITY_STATE.
TENANT packet selects TENANT_AUTHORITY_DATA_BOUNDARY.
EXTFX fixture selects EXTERNAL_EFFECT_CERTAINTY.

### Unknown class
Unknown change class does not silently receive a generic proof profile; it remains visible as an uncovered class.

### Exclusion audit
Excluded sources retain reason and revision where available.

## Negative controls

The prototype should include at least these mutation checks:
1. remove required authority -> VALID must become DEGRADED/INVALID;
2. mutate research authority class upward -> validation must fail;
3. remove selected semantic proof -> fixture expectation must fail;
4. alter snapshot SHA -> byte output must change;
5. reorder source input -> semantically equivalent output remains byte-identical after canonical sorting.

This directly reuses the repository's successful mutation-sensitivity philosophy.

## Success criteria

The prototype advances from CONTRACTED to PROTOTYPED only if:
- deterministic;
- dependency-free beyond existing repository code;
- all tests pass;
- negative controls prove test sensitivity;
- control-plane + TENANT fixtures produce expected profile selection;
- EXTFX third-domain fixture works without changing the compiler architecture;
- no production/control authority path is modified.

## Promotion gate

Even successful prototype evidence does NOT authorize Claude-worker integration.

Next:
prototype -> measured dry run -> architecture anti-duplication review -> canonical target contract -> implementation packet -> production proof.

