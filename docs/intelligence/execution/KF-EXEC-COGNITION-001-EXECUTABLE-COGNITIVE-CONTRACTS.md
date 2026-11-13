# KF-EXEC-COGNITION-001 — Executable Cognitive Contracts

Status: DRAFT / NO IMPLEMENTATION AUTHORIZATION  
Primary kernel owners: K5 for business capability identity; K9 for provider reality; K12 for proof  
AI-layer owner: ExecutableCognitiveContract  
Baseline: `main@6fdffc26c7c7748d5c09900535c97c197864ab54`

## Objective

Replace the current dual-source cognitive output contract pattern with a single executable contract definition while preserving current behavior and public type compatibility.

Current path:

```text
TypeScript interface
+
handwritten validateOutputContract switch
+
expectedContract name in ModelGatewayService
```

Target:

```text
ExecutableCognitiveContract
 -> inferred TypeScript type
 -> runtime validation
 -> provider-neutral schema projection
 -> model/provider strategy consumption
 -> characterization/proof
```

This packet does not authorize a provider/runtime migration.

## Current evidence

Primary source:
- `apps/server/src/modules/ai/ai-output-contracts.ts`

Primary consumers:
- `apps/server/src/modules/ai/model-gateway.service.ts`
- `apps/server/src/modules/calendar/calendar-insight.service.ts`
- `apps/server/src/modules/business-genesis/market-strategy-ai-generator.service.ts`
- `apps/server/src/modules/business-genesis/business-genesis.service.ts`
- `apps/server/src/modules/site/presence/storefront-intelligence.service.ts`

Existing proof:
- `model-gateway.service.spec.ts` has valid-contract and contract-violation coverage.

Dependency evidence:
- server already depends on `zod@^3.24.0`;
- no current repository JSON-Schema conversion helper was found.

## Accepted invariants

1. One semantic contract definition is authoritative.
2. TypeScript type and runtime validator cannot drift independently.
3. Provider schema, when exposed, is derived from the same semantic definition.
4. Existing contract-name compatibility is preserved unless separately versioned.
5. Invalid structured output cannot be treated as valid because parsing succeeded syntactically.
6. Contract validation itself grants no business authority.
7. No external effect is performed by this packet.
8. Contract correction/retry policy is out of scope until COG-004; this packet only exposes typed validation outcomes.

## Scope

### Characterize first

For every current `ContractType`:
- record required fields;
- nested requirements;
- enum/range constraints;
- permissive fields currently accepted;
- exact invalid cases currently rejected;
- direct consumers and casts/fallback behavior.

Do not "improve" schemas during migration without an explicit delta.

### Add executable schemas

Create one schema per current contract and a typed registry keyed by current `ContractType`.

Preferred form:

```ts
const cognitiveContracts = {
  chat_response: ChatResponseSchema,
  ...
} as const;
```

Public type names should be derived aliases where compatibility requires them.

### Replace handwritten validation

`validateOutputContract` may remain as a compatibility function temporarily, but its result must be produced from the executable schema registry, not a switch containing independent semantics.

### Preserve fallback

`coerceToContract` remains behaviorally compatible until a later explicit correction-policy packet.

### Provider-neutral schema projection

A provider-schema adapter must be derived from the executable schema.

**Gate:** current Zod is v3 and no existing converter was found. The implementer must return a design/evidence decision before adding a new dependency, upgrading Zod, or relying on unstable Zod internals.

A staged commit that unifies runtime validation/types but has not solved provider projection must report **PARTIAL**, never COMPLETE.

## Explicit non-goals

- no LangGraph/Pydantic AI/Microsoft Agent Framework runtime;
- no tool registry migration;
- no CapabilityView work;
- no provider retry changes;
- no ActionDispatcher changes;
- no approval/interrupt changes;
- no database migration;
- no external provider calls;
- no contract semantic tightening hidden inside refactor.

## Characterization cases

At minimum:

- each existing contract accepts one representative currently-valid payload;
- missing required field behavior;
- wrong primitive type;
- wrong array/object shape;
- enum violations;
- numeric boundary behavior where current validator enforces a range;
- nested object behavior;
- unknown/additional-field behavior;
- `null` versus `undefined` behavior;
- `coerceToContract` fallback behavior;
- malformed JSON at ModelGateway boundary remains distinct from schema-invalid parsed JSON.

## Proof cases

| ID | Requirement |
|---|---|
| COG1-P01 | all current ContractType names resolve to exactly one executable schema |
| COG1-P02 | exported derived types compile for current consumers |
| COG1-P03 | compatibility validator delegates only to schema registry |
| COG1-P04 | representative current-valid fixtures remain valid |
| COG1-P05 | representative current-invalid fixtures remain invalid |
| COG1-P06 | nested/enum/range behavior matches characterized baseline or documented approved delta |
| COG1-P07 | model-gateway contract violation still fails closed |
| COG1-P08 | no provider/network call is required by packet proof |
| COG1-P09 | provider schema projection is mechanically derived from the executable contract before full completion |
| COG1-P10 | changing one schema field changes type/runtime/provider projection together or proof rejects the mismatch |

## Implementation ordering

1. no-edit characterization return;
2. add characterization fixtures/tests;
3. add executable schemas without changing gateway behavior;
4. derive public type aliases;
5. redirect compatibility validator to schemas;
6. prove current consumers;
7. decide/prove provider-neutral schema projection path;
8. integrate projection without changing provider selection;
9. remove redundant handwritten semantic validation only after proof;
10. independent review.

## Stop conditions

Return without implementation if:
- a current contract's real accepted shape cannot be determined;
- consumer compatibility requires an undocumented semantic change;
- provider-schema derivation would require a broad Zod major upgrade without inventory;
- proposed adapter uses undocumented runtime internals without explicit acceptance;
- tests require live provider credentials;
- another contract registry is proposed instead of replacing the duplicate source.

## Completion meaning

`KF-EXEC-COGNITION-001 COMPLETE` means:

- one executable schema source owns every selected current cognitive contract;
- runtime validation and TS types derive from it;
- provider-neutral schema projection is derived from it;
- current behavior is characterized and passing at declared scope;
- no live provider dependency was required;
- independent review found no second semantic contract source.

Compilation alone is not completion.
