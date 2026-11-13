# KEYFLOWOS — OTel / Langfuse Compatibility Packet Derivation

Status: READ-ONLY DERIVATION COMPLETE / NOT RELEASED
Date: 2026-10-06
Validated live main observed: 6fdffc26c7c7748d5c09900535c97c197864ab54
Canonical owners: issue #130 Assurance Fabric + issue #151 Harness/Eval Convergence
Historical product rationale: issue #42
Parent R&D ledger: issue #153

## 1. Packet identity

Candidate packet:
KF-ASSURANCE-OTEL-LANGFUSE-COMPAT-001

State:
DERIVED / READY-BUT-HELD / NOT RELEASED

This packet is second in priority after KF-EXEC-AUTH-FAIL-CLOSED-001.

## 2. Time-bounded trigger

Current live code in apps/server/src/modules/ai/langfuse.service.ts sends legacy trace/generation events to:

/api/public/ingestion

Current official Langfuse documentation states:
- OpenTelemetry is the supported trace-ingestion path.
- the legacy trace/observation ingestion API is deprecated.
- Langfuse Cloud removes the legacy ingestion path on 2026-11-16.
- the replacement is OTLP/HTTP OpenTelemetry trace ingestion.
- Langfuse v4 supports current OpenTelemetry ingestion and current SDKs/exporters.

Primary current sources:
- https://langfuse.com/docs/api-and-data-platform/features/public-api
- https://langfuse.com/faq/all/deprecated-api-migration
- https://langfuse.com/docs/compatibility

Therefore this is not speculative optimization. It is a compatibility deadline.

## 3. Current repository state

Validated:
- LangfuseService is env-gated.
- it uses raw fetch with Basic authentication.
- it generates a fresh random Langfuse trace ID for each completed model call.
- it emits one trace-create plus one generation-create event.
- it is called from the model-gateway cost-recording seam.
- failures are swallowed with warnings so observability cannot take down the model call.
- the repository contains target-architecture references to OpenTelemetry, but no recovered server-side canonical OTel implementation.
- no OpenInference package/runtime was recovered.
- KEY already has correlationId/sessionId/commandId concepts across HTTP, Cortex, audit, saga and execution paths.

Important semantic gap:
the current Langfuse trace ID is not the canonical KEY correlation identity and is generated only at export time.

## 4. Packet goal

Migrate the existing AI trace export away from deprecated legacy Langfuse ingestion onto a vendor-neutral OpenTelemetry trace path while preserving KEY's native identity and failure semantics.

This packet is NOT:
- a full distributed-observability rewrite;
- a Langfuse product migration programme;
- a new evidence store;
- a new eval framework;
- a new business audit system;
- authority or outcome truth.

## 5. Canonical architecture

KEY identity remains primary:

request/session/command/correlation identity
-> AI model attempt span
-> provider/model/tool/contract/fallback attributes
-> OpenTelemetry
-> optional Langfuse OTLP exporter

Important:
OTel trace_id is transport identity.
KEY correlationId/commandId/sessionId remain business/runtime lineage attributes.

Do not replace existing KEY identity with a vendor trace ID.

## 6. Minimum intended scope

Likely semantic files:
- apps/server/src/modules/ai/langfuse.service.ts
- apps/server/src/modules/ai/langfuse.service.spec.ts
- apps/server/src/modules/ai/model-gateway.service.ts
- apps/server/src/modules/ai/provider-choice.spec.ts or targeted gateway tracing tests
- apps/server/src/modules/ai/ai.module.ts only if dependency/provider wiring requires it
- package manifest/lockfile only for the minimum official OpenTelemetry libraries if separately authorized by the packet

Potential small native type:
AiModelAttemptTrace or equivalent.

No Prisma migration.
No new database.
No Mission Control UI.
No change to Evidence/Outcome truth.
No external production traffic during proof.
No prompt/eval dataset work.
No general server tracing in this packet unless necessary for a clean OTel boot seam.

## 7. Required semantic improvements

### A. Preserve canonical KEY lineage

Every AI trace/span should be able to carry, when known:
- businessId;
- correlationId;
- sessionId;
- commandId;
- task category;
- provider;
- model;
- contract type;
- fallback state;
- source/streaming mode.

Existing correlation identity must not be silently replaced by random exporter-only identity.

### B. Trace attempts, not only final success

Current tracing is biased toward completed cost-recorded calls.

Minimum target should distinguish:
- attempt started;
- provider success;
- provider error;
- timeout/refusal where recoverable;
- fallback transition;
- final response.

The packet does not need full agent/tool tracing yet, but must not encode final success as if failed attempts never occurred.

### C. Exporter failure is visible but non-fatal

Preserve:
- model execution must not fail because Langfuse/OTel exporter is down.

Add:
- exporter degradation/error must be observable;
- no silent claim that tracing is healthy if exports fail.

### D. Privacy-by-default

Do not export full prompts/responses by default in this compatibility packet.

Default span content should be metadata/identities/counters only unless a later explicit privacy policy authorizes content.

This avoids turning observability into an uncontrolled PII/secret store.

### E. No-fake-green compatibility

The packet is not complete merely because code compiles.

Proof must establish:
- no legacy trace/observation ingestion call remains on the active tracing path;
- emitted payload reaches an OTLP/OpenTelemetry exporter interface;
- a disabled exporter remains a no-op;
- exporter error does not break model execution;
- exporter error is observable;
- correlation attributes are preserved.

## 8. OpenTelemetry/OpenInference boundary

This packet should establish OTel transport first.

OpenInference semantic conventions are valuable but should only be added where their current JS support and field semantics are verified during implementation characterization.

Do not delay the compatibility fix merely to build every future OpenInference attribute.

Recommended layering:
1. OTel-valid spans;
2. KEY-native semantic attributes;
3. OpenInference-compatible attributes where stable and useful;
4. replaceable exporters.

## 9. Dependency policy

If official OTel JS packages are required, the implementation packet must name and justify the minimum set.

Do not add:
- a second APM runtime;
- a separate collector service unless required;
- LangSmith/Phoenix/Weave SDKs;
- a generic plugin framework.

A direct OTLP exporter to the already configured Langfuse destination is preferable to adding a new service topology for this bounded deadline packet.

A collector can remain a later deployment option.

## 10. Proof obligations

OTEL-LF-P01 — legacy path removed from active trace export:
A completed AI call does not POST trace/observation events to the deprecated legacy ingestion endpoint.

OTEL-LF-P02 — OTLP path:
A test exporter/HTTP fixture proves the new trace path emits valid OTel/OTLP-compatible trace data.

OTEL-LF-P03 — disabled mode:
Without Langfuse/OTel config, tracing is a no-op and the AI call succeeds.

OTEL-LF-P04 — exporter outage:
Exporter timeout/error does not fail the model call.

OTEL-LF-P05 — outage visibility:
Exporter failure increments/logs an explicit degraded signal; it is not silent green.

OTEL-LF-P06 — lineage:
businessId and available KEY correlation/session/command identity are present as trace/span attributes.

OTEL-LF-P07 — failed attempt:
A primary-provider failure followed by fallback leaves evidence of both the failed attempt and successful fallback.

OTEL-LF-P08 — privacy:
Default test payload contains no full raw prompt/response content unless explicitly enabled by a separately admitted policy.

OTEL-LF-P09 — exact model/provider:
Trace identifies the exact provider/model selected for each attempt.

OTEL-LF-P10 — mutation control:
Restoring the legacy /api/public/ingestion path causes the compatibility proof to fail.

## 11. Failure semantics

The packet must distinguish:
- AI/provider failure;
- telemetry exporter failure;
- telemetry configuration disabled;
- telemetry configuration invalid.

Telemetry failure may degrade observability but must never be mislabeled as AI success/failure.

## 12. Ownership boundaries

#130 Assurance Fabric:
owns observability/proof obligations and runtime-assurance semantics.

#151 Harness/Eval convergence:
owns trace/evaluation semantic distinctions and no-fake-green evaluator rules.

ModelGateway:
owns provider execution and exposes model-attempt events/metadata.

Langfuse:
remains an optional exporter/backend.

Evidence/Outcome:
remains canonical effect/outcome truth.

## 13. Collision analysis

PR #133 under #130 currently changes:
- assurance controller/module;
- proof-obligation service/tests;
- app.module.ts.

This packet may need ai.module.ts and dependency manifests but should not redesign ProofObligationService.

If PR #133 is still active at release time:
- re-check exact file overlap;
- avoid app.module.ts if possible by containing OTel wiring inside AiModule;
- otherwise wait/rebase rather than creating conflicting assurance infrastructure.

PR #147 ACTION-001 changes Flow/action/autonomy files but does not currently include LangfuseService or ModelGatewayService.

Even with low file overlap, release remains subject to control-plane sequencing and #110 status.

## 14. Stop conditions

Stop rather than widen if:
- current main already migrated Langfuse before release;
- official Langfuse compatibility guidance materially changes;
- the fix requires a full server-wide instrumentation rewrite;
- exporter introduction requires a new production service/collector not authorized by packet scope;
- a current active PR owns the same semantic files;
- prompt/response content export would be required to claim compatibility;
- the packet begins modifying Evidence/Outcome or admission authority.

## 15. Release ordering

Priority order remains:
1. KF-EXEC-AUTH-FAIL-CLOSED-001
2. KF-ASSURANCE-OTEL-LANGFUSE-COMPAT-001
3. later CognitiveFunction / structured-output honesty and Context Genome/capability/eval tranches according to dependency availability.

Because the Langfuse deadline is 2026-11-16, packet 2 should not be allowed to drift indefinitely once packet 1 clears its release slot.

No implementation is authorized by this document.
