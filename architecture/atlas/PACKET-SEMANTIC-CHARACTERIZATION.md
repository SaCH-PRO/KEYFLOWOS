# Atlas Packet Semantic Characterization

Status: EVIDENCE SNAPSHOT / UNRESOLVED SOURCE CONTRADICTIONS  
Date checked: 2026-10-05  
Intelligence ref: `docs/keyflow-intelligence-foundation`

## Purpose

Characterize how the 35 execution packets identify their semantic impact on canonical journeys and kernels before the Atlas creates reverse-index edges.

This document records source shape. It does not repair or reinterpret the canonical intelligence branch.

## Current result

The execution programme contains 35 packet documents. Their semantic headers are not fully normalized.

### Explicit named journey + kernel mappings

Most packet documents use:

```
Primary kernels: K...
Primary journeys: J...
```

These can be deterministically projected to `KF-KERNEL-###` and `KF-JOURNEY-###` identities.

### Broad-scope packets

These packets use broad semantic scope rather than explicit journey IDs:

| Packet | Journey scope |
|---|---|
| KF-EXEC-INTEGRATED-001 | all constellations |
| KF-EXEC-MIGRATE-001 | all |
| KF-EXEC-OPS-001 | all |
| KF-EXEC-RELEASE-001 | all |
| KF-EXEC-WITHDRAW-001 | all migrated |
| KF-EXEC-WITHDRAW-002 | all migrated |

The Atlas records those scopes as `ALL_CONSTELLATIONS`, `ALL_CANONICAL`, or `ALL_MIGRATED`.

It does **not** expand them into individual journey edges while the canonical journey catalogue itself is contradicted.

## Missing standardized semantic headers

The following packet documents do not expose both standardized `Primary kernels` and `Primary journeys` headers:

- `KF-EXEC-AUTH-001` — neither standardized header found.
- `KF-EXEC-EXTFX-001` — neither standardized header found.
- `KF-EXEC-K12-001` — neither standardized header found.
- `KF-EXEC-GROWTH-001` — kernel header present; primary journey header absent.
- `KF-EXEC-NETWORK-001` — kernel header present; primary journey header absent.
- `KF-EXEC-SPACE-001` — kernel header present; primary journey header absent.

This does not prove those packets have no semantic ownership. It proves the metadata is not expressed in the standardized form consumed by the current deterministic indexer.

## J26 contradiction

Two packet documents explicitly reference `J26`:

- `KF-EXEC-EXPERIENCE-001` — `Primary journeys: J1/J2/J17/J21/J26`
- `KF-EXEC-PLAYBOOK-001` — `Primary journeys: J2/J6/J15/J18/J23/J26`

However:

- `docs/intelligence/03-ANALYSIS-MAP.md` explicitly lists `KF-JOURNEY-001` through `KF-JOURNEY-025`;
- the same file says exactly 25 canonical journeys are currently defined;
- `docs/intelligence/handoff/CURRENT-STATE.yaml` reports coverage of 26 journeys / 26 dossiers.

Therefore `J26` is currently an **unresolved semantic reference**, not a canonical Atlas node.

The existence of J26 references may explain the 25-versus-26 count disagreement, but it does not identify a canonical name, definition, owner, or dossier and therefore does not resolve the contradiction.

## Atlas handling rules

1. Explicit valid journey/kernel IDs become accepted semantic edges.
2. Broad scopes remain broad until their expansion denominator is trustworthy.
3. Unknown IDs become contradiction nodes.
4. Missing standardized metadata becomes a visible packet semantic gap.
5. Characterization seams from packet documents remain `requires_revalidation: true`; they do not become live code edges merely because a packet names them.
6. The source intelligence branch must be reconciled at the source before the Atlas can mark these contradictions resolved.

## Why this matters for Mission Control

Mission Control should eventually be able to show, for every packet:

```
packet
-> primary journeys
-> consumer journeys
-> primary kernels
-> broad scope if applicable
-> unresolved semantic references
-> characterization seams
-> validated code reachability
-> proof / PR / checkpoint
```

A packet with incomplete semantic metadata should show **PARTIAL / CONTRADICTED**, not a green completion percentage.
