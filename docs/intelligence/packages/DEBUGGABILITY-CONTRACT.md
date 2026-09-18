# KEYFLOWOS Debuggability & Observability Contract

Version: 1

## Goal

A production incident or failed proof should be diagnosable by tracing one semantic occurrence across UI/API/domain/worker/provider/evidence layers.

## Universal correlation fields

Where applicable every package should propagate:

```text
traceId
requestId
businessId
actorPrincipalId
effectiveAuthorityRevision
capabilityId
controlRequirementId
controlEvidenceId
clearanceId
occurrenceId
effectId
attemptId
provider
providerAccountId
providerObjectId
sourceEventId
parentOccurrenceId
causationId
correlationId
packageId
codeVersion
```

Not every event uses every field. IDs that do not exist must be omitted, not invented.

## Universal diagnostic stages

```text
RECEIVED
VALIDATED
AUTHORIZED
CLAIMED
DISPATCHED
PROVIDER_ACCEPTED
PROVIDER_OBSERVED
DOMAIN_APPLIED
EVIDENCE_RECORDED
RECONCILED
COMPLETED
FAILED_PRE_EFFECT
FAILED_POST_EFFECT
UNKNOWN_EXTERNAL_OUTCOME
CANCELLED
SUPERSEDED
```

Packages may specialize stages but must map back to these semantics.

## Error taxonomy

- `KF_INPUT_*` — validation/schema/business-rule input;
- `KF_AUTHN_*` — authentication;
- `KF_AUTHZ_*` — authority/capability/clearance;
- `KF_CONFLICT_*` — optimistic/concurrency/claim conflicts;
- `KF_PROVIDER_*` — provider request/response;
- `KF_EFFECT_UNKNOWN_*` — external outcome uncertain;
- `KF_PERSIST_*` — local persistence;
- `KF_EVIDENCE_*` — evidence/receipt/report gap;
- `KF_MIGRATION_*` — legacy/backfill/cutover;
- `KF_PROOF_*` — test/admission/isolation;
- `KF_PRIVACY_*` — redaction/retention/access;
- `KF_INTERNAL_*` — unexpected invariant violation.

## Log requirements

Structured logs should make these questions answerable:

1. What semantic occurrence was this?
2. Which business/actor/capability authorized it?
3. Which attempt made which external/domain effect?
4. Did an external effect possibly happen?
5. Which local consequences were committed?
6. Which evidence is missing?
7. Is retry safe, repair-only, or forbidden?
8. What code/package version produced the state?

## Redaction

Never log:
- raw access/refresh/API tokens;
- passwords/secrets;
- full payment credentials;
- sensitive document contents;
- unnecessary full message bodies;
- private health/sensitive fields.

Prefer stable opaque IDs + field presence/hash classifications where debugging needs correlation.

## Metrics

Each package should define only actionable metrics, typically:
- attempts;
- successes;
- pre-effect failures;
- post-effect failures;
- unknown outcomes;
- retries;
- reconciliation repairs;
- duplicate-claim prevented;
- stale/current-policy rejection;
- latency histograms;
- backlog/age when async.

No vanity metric should substitute for semantic outcome.

## Debug receipt

Every admitted proof/run should be able to emit a compact receipt containing:
- package ID/version;
- source SHA;
- run ID;
- resource IDs;
- case IDs;
- trace/correlation samples;
- failures/skips;
- cleanup result;
- evaluator verdict.
