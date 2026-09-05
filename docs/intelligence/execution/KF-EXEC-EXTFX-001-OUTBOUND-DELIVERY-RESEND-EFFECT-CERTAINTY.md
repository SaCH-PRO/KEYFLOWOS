# KF-EXEC-EXTFX-001 — OutboundDelivery + Resend Effect Certainty

**Status: DRAFTED / ARCHITECTURALLY READY / DO NOT EXECUTE WITHOUT EXPLICIT IMPLEMENTATION AUTHORIZATION**

Implementation truth baseline:

```text
repository: SaCH-PRO/KEYFLOWOS
branch: main
head: 168732d0e2226e11ed033c14fbdf7b3ea5344a41
code-bearing forensic baseline: d7c5b86cfa276d75ffa42d5f1707c43704dc9f21
```

Canonical architecture inputs:

- `docs/intelligence/13-IMPLEMENTATION-HANDOFF-PROTOCOL.md`
- `docs/intelligence/14-STANDARDS-RESEARCH-INNOVATION-METHOD.md`
- `docs/intelligence/investigations/J23-J18-L6-UNIFIED-CONVERGENCE-MATRIX.md`
- `docs/intelligence/investigations/J23-J18-L6-EXACT-FIELD-STATUS-MAPPING.md`
- `docs/intelligence/investigations/J23-J18-L6-LIVE-ROW-MIGRATION-COMPATIBILITY.md`
- `docs/intelligence/investigations/J23-J18-L6-PROVIDER-CONTRACT-IDEMPOTENCY-RECONCILIATION-MATRIX.md`
- `docs/intelligence/investigations/J23-J18-L6-RECOVERY-AUTHORITY-REPRESENTATION.md`
- `docs/intelligence/investigations/J23-J18-L6-CHARACTERIZATION-CONCURRENCY-CRASH-PROOF-INVENTORY.md`
- `docs/intelligence/investigations/J1-J25-J2-J15-J6-J14-J23-J18-BACKWARD-REAUDIT.md`
- `docs/intelligence/investigations/J23-J18-BOUNDED-KF-EXEC-READINESS-ASSESSMENT.md`

Canonical roots:

```text
F149 provider/transport failure certainty collapse
F159 OutboundDelivery provider success can fall into RetryPending/Failed after post-provider local error
C109 provider-successful OutboundDelivery vs local RetryPending/Failed
KF-REC-048 shared recovery contract
```

---

# CONTROL HEADER FOR CLAUDE CODE / KIMI CODE / CODEX

```text
KEYFLOWOS IMPLEMENTATION PACKET — KF-EXEC-EXTFX-001

DO NOT IMPLEMENT THIS PACKET unless the human/architecture command center explicitly promotes it from DRAFTED to AUTHORIZED.

When authorized:
- remain within this packet's accepted architecture;
- revalidate main HEAD before editing;
- if main has code-bearing changes affecting these files, stop and report the delta before implementation;
- do not create a universal WorkOccurrence, Attempt, RecoveryOccurrence or DLQ system;
- strengthen OutboundDelivery/DeliveryEvent and current adapter seams first;
- if repository evidence contradicts the packet, stop and report it rather than coding around it;
- do not weaken effect identity, provider certainty or consequence-completeness invariants to fit current statuses;
- do not claim tests passed unless actually executed;
- return commit/diff identity, changed files, invariant mapping, exact tests executed, migration evidence, residual risks and additional discovered consumers.
```

---

# 1. Objective

Change **only the Resend-backed OutboundDelivery execution slice** so one logical email delivery cannot be duplicated merely because KeyFlow crashes or fails locally after Resend accepted the email.

The slice must establish these properties:

```text
one durable OutboundDelivery intent
→ one stable EffectId
→ immutable material effect snapshot/fingerprint
→ one active attempt generation at a time
→ stable Resend idempotency identity across safe same-effect retries
→ provider success retained as provider success
→ local consequence failure becomes consequence repair
→ never generic provider re-send after confirmed provider success
```

This is not a generic retry refactor.

---

# 2. Current-state evidence

## 2.1 Current claim seam

`apps/server/src/modules/communications/delivery-queue.service.ts`

Current `claimDeliveries()`:

```text
find candidate rows
→ updateMany where id + prior status
→ set status = Sending
→ winner reloads full delivery
```

This is a useful CAS-like claim seam.

## 2.2 Current provider/local phase collapse

Current `executeDelivery()` places:

```text
adapter.publish()
→ OutboundDelivery Published update
→ DeliveryEvent success
→ content.published / delivery.completed EventEmitter2 emissions
→ campaign-contact update
→ content aggregate update
```

inside one broad `try` path.

The catch then normalizes **any thrown error** through the provider adapter and can schedule `RetryPending` or `Failed`.

Therefore:

```text
Resend accepts email
→ later DB/local consequence throws
→ catch treats local failure as adapter/provider failure
→ retry can call Resend again
```

This is F159/C109.

## 2.3 Current attempt number is allocated too late

Current code computes:

```text
attemptNumber = delivery.retryCount + 1
```

after `adapter.publish()` returns.

Therefore a crash during/after provider call can occur before durable attempt-start evidence exists.

## 2.4 Current Resend adapter

`apps/server/src/modules/communications/adapters/resend-email-adapter.ts`

- sends through `SystemEmailService.sendTransactional()`;
- returns provider email ID as `externalPostId`;
- classifies some message-text errors as transient/permanent;
- does not currently receive an effect/attempt/idempotency execution context.

## 2.5 Current SystemEmailService

`apps/server/src/modules/notifications/system-email.service.ts`

- uses `resend@^4.8.0`;
- calls `client.emails.send(payload)`;
- has no current idempotency-key input;
- is also used for platform transactional email, so changes must be additive/backward compatible.

## 2.6 Existing test seam

`apps/server/src/modules/communications/adapters/esp-fallback.spec.ts`

Already characterizes:
- Gmail remains preferred when connected;
- Resend fallback selection;
- fallback feature flag;
- recipient/subject/body pass-through;
- missing recipient handling;
- some transient/permanent normalization.

No inspected test currently proves post-provider crash certainty or same-effect provider idempotency.

---

# 3. Accepted target invariants

## I1 — one delivery row is one effect identity in this slice

```text
WorkOccurrenceId = OutboundDelivery.id
EffectId         = OutboundDelivery.id
```

for Resend-backed outbound email **only**, provided I2 is satisfied.

Do not generalize this identity rule to every work family/provider automatically.

## I2 — same EffectId means same material effect

Before the first provider attempt, persist enough immutable effect material to guarantee that retry sends the same effect.

At minimum bind/snapshot material semantics such as:

```text
tenant/business
destination/provider account identity
recipient email
sender identity used by Resend
subject
html/text body
material attachments if supported in this path
relevant provider options
```

Then compute an `effectFingerprint` over canonical material data.

A retry must use the stored effect snapshot, not silently recompute from mutable `OutboundContent`/`OutboundVariant` state.

Material mutation after effect binding requires a new delivery/effect or explicit supersession policy; it may not reuse the old EffectId with different provider parameters.

## I3 — attempt identity exists before provider PONR

A durable attempt generation must be allocated before calling Resend.

```text
EffectId E
AttemptId A1
→ provider call
```

A retry creates A2 but preserves E.

## I4 — at most one active attempt owner

Two scheduler replicas must not both own the same delivery attempt.

The existing CAS claim should be strengthened as needed with attempt generation/lease semantics.

Transport status alone is not sufficient evidence of provider outcome.

## I5 — provider idempotency binds to EffectId

For Resend:

```text
EffectId + effectFingerprint
→ stable provider-safe idempotency key
```

Safe same-effect replay uses the same provider idempotency identity and identical material payload.

KeyFlow's EffectId is durable beyond Resend's provider retention window.

## I6 — provider success is monotonic evidence

Once Resend success/provider email ID is confirmed:

```text
providerOutcome = SUCCEEDED_CONFIRMED
```

A later local DB/event/content/contact error may not regress providerOutcome to provider failure or make the provider create/send eligible for generic retry.

## I7 — consequence repair is separate from provider retry

After provider success:

```text
provider effect phase = done
local consequence phase = INCOMPLETE | REPAIRING | COMPLETE
```

Repair only missing local consequences.

## I8 — OUTCOME_UNKNOWN is explicit

If KeyFlow cannot prove whether provider accepted the send:

```text
OUTCOME_UNKNOWN
```

is permitted/required.

If current verified Resend idempotency semantics make replay of the same key/payload safe inside the provider retention window, that replay is a **reconciliation-safe same-effect retry**, not evidence that the previous attempt definitely failed.

Outside the verified safe idempotency window, unknown outcome must not be blindly resent.

## I9 — tenant scope remains explicit

`businessId` binds the delivery/effect. Provider operation IDs, attempt IDs or idempotency keys alone never authorize lookup/mutation across businesses.

## I10 — learning/events cannot redefine truth

`content.published`, `delivery.completed` and AI listener processing are downstream notifications/learning signals, not canonical provider outcome truth.

---

# 4. Journey impact

Primary:

```text
J23 Temporal Flow / Long-Running Work
J18 Failure → Recovery
```

Material adjacent:

```text
J6  Proactive KEY / Autonomy — if proactive work creates these deliveries
J14 External Ingress — later provider lifecycle callbacks, not full scope here
J15 Approval/Governance — current recovery authorization law; no broad control-plane change in this packet
J2  Governed Action — effect/attempt identity semantics
```

---

# 5. Kernel impact

```text
K7  Temporal Work
K8  Evidence / Outcome
K9  External Reality
K11 Recovery / Reliability
K3  Governance — bounded retry validity only where current source already carries authority context
K6  State legality — content/contact state consequences
```

K10 Financial Truth is explicitly out of scope.

---

# 6. Target-state contract

## 6.1 Orthogonal semantic axes

Do not encode all meaning into `OutboundDelivery.status`.

The slice must be able to answer independently:

```text
logical/transport state
attempt identity/ownership
provider outcome certainty
local consequence completeness
```

Compatibility may retain existing statuses during migration.

Candidate semantic provider outcomes:

```text
NOT_ATTEMPTED
ATTEMPT_IN_FLIGHT
SUCCEEDED_CONFIRMED
FAILED_CONFIRMED
OUTCOME_UNKNOWN
```

Candidate consequence states:

```text
NOT_STARTED
INCOMPLETE
REPAIRING
COMPLETE
```

Physical names/types may follow repository conventions, but the semantics may not be collapsed.

## 6.2 Effect snapshot

First provider attempt:

```text
read current delivery + destination + effective variant/content
→ canonicalize material provider payload
→ persist immutable effect snapshot + fingerprint
→ all later same-effect attempts use that snapshot
```

Do not use mutable content as retry input after effect binding.

## 6.3 Claim + attempt allocation

Target ordering:

```text
eligible delivery
→ atomic delivery claim
→ atomically allocate next attempt generation
→ persist AttemptId / attempt-start evidence + start timestamp + lease/recovery marker
→ provider call
```

If implementation uses a lease, lease expiry means **attempt ownership expired**, not “provider effect definitely did not happen.”

A stale in-flight attempt must enter certainty/reconciliation logic before another unsafe provider effect.

## 6.4 Provider phase

Provider call is isolated from local consequence handling.

Conceptual shape:

```text
providerResult = call Resend with:
  immutable snapshot
  stable idempotency key

if provider returns success + email ID:
  durably persist providerOutcome=SUCCEEDED_CONFIRMED
  externalPostId=email ID
  consequenceState=INCOMPLETE

if provider explicitly rejects before effect and contract proves no send:
  providerOutcome=FAILED_CONFIRMED
  apply retry/final policy

if network/transport result is ambiguous:
  providerOutcome=OUTCOME_UNKNOWN
  use provider idempotency contract/current safe window to determine legal next action
```

Do not classify error certainty solely from human-readable message substrings if structured SDK/provider information exists.

## 6.5 Consequence phase

After provider success, run idempotent consequence completion without calling provider again.

Owned first-slice consequences:

### C1 — provider result on OutboundDelivery

Must be durable.

### C2 — attempt/outcome DeliveryEvent evidence

Must be durable and bound to AttemptId.

### C3 — provider email ID

Must be retained through existing `externalPostId` unless repository evidence proves a stronger existing provider-operation field.

### C4 — campaign contact SENT update

Treat as durable domain consequence where the delivery owns it.

Must be safe to repeat.

### C5 — OutboundContent aggregate status

Treat as derived durable aggregate consequence.

Must be recomputable/idempotent from delivery states.

### C6 — `content.published` / `delivery.completed` EventEmitter2 notifications

Current inspected consumers route these into AI listener processing. Unless implementation discovery finds a load-bearing consumer, classify these as **best-effort derivative notifications**, not a prerequisite for provider-effect convergence.

If implementation discovery finds a material business side effect behind these events, **STOP**: the packet must be reopened to decide whether a durable handoff/outbox is required.

## 6.6 Completion rule

Do not mark `consequenceState=COMPLETE` until all required durable first-slice consequences are complete or durably handed off under an accepted idempotent contract.

`Published` may remain a compatibility/product status for provider success, but it must not be the only evidence of consequence completeness.

---

# 7. Existing seams to strengthen

Use before creating replacements:

1. `OutboundDelivery.id` — slice-local WorkOccurrenceId/EffectId.
2. `OutboundDelivery` existing claim/status/retry/provider-ID fields.
3. `DeliveryEvent` — evolve for attempt-start/outcome evidence.
4. `DeliveryQueueService.claimDeliveries()` — retain CAS principle.
5. `ChannelAdapter` — extend with optional provider-effect execution context rather than smuggling identity into generic metadata.
6. `ResendEmailAdapter` — first provider implementation of effect/idempotency context.
7. `SystemEmailService.sendTransactional()` — additive optional idempotency input; preserve all current transactional-email callers.
8. `MARKETING_ESP_FALLBACK` — provider disable seam, not semantic rollout gate.

Do not create:
- `OutboundDeliveryV2`;
- generic `WorkOccurrence` table;
- generic `Attempt` table unless the allowed existing seams fail the required proof and architecture command center approves reopening;
- generic recovery engine.

---

# 8. Allowed persistence change envelope

Exact ORM names may be adapted only if equivalent semantics already exist. The implementer must not omit a required fact merely to minimize migration size.

## Required durable facts on/around OutboundDelivery

```text
effect fingerprint
immutable provider payload/effect snapshot or equivalent immutable binding
attempt sequence/current AttemptId
attempt started timestamp
attempt ownership/lease expiry or equivalent stale-owner detector
provider outcome certainty
first provider-attempt timestamp / enough data to enforce provider idempotency retention safety
consequence completeness state
```

Reuse existing:

```text
externalPostId
retryCount / maxRetries
nextRetryAt
resultSnapshot where appropriate
DeliveryEvent
```

## Preferred physical strategy

First evaluate additive fields on `OutboundDelivery` plus additive attempt linkage/evidence on `DeliveryEvent`.

A domain-specific attempt table is not preferred unless the existing event seam cannot satisfy deterministic crash/concurrency proof.

A universal attempt table is prohibited in this packet.

## Historical rows

All new fields must be nullable/default-safe for legacy data unless a separately proven backfill is supplied.

Do not manufacture provider certainty or effect snapshots for historical rows when source evidence is absent.

---

# 9. Adapter contract evolution

`ChannelAdapter.publish()` currently receives connection, destination and payload only.

The target should add an explicit optional execution/effect context, conceptually:

```ts
interface ProviderEffectContext {
  effectId: string;
  attemptId: string;
  effectFingerprint: string;
  providerIdempotencyKey?: string;
}
```

Exact type naming can follow repository style.

Do **not** hide EffectId/idempotency identity inside `payload.meta`; that mixes business payload with execution-control semantics.

Provider capability metadata may be additive/optional, conceptually:

```text
request_idempotency.support = supported | unsupported_confirmed | unconfirmed | not_applicable
retention / safe-window metadata where known
operation-id availability
```

Only Resend needs to consume this in the first packet. Do not refactor every adapter beyond compile compatibility.

---

# 10. Resend SDK implementation rule

Installed package at baseline:

```text
resend ^4.8.0
```

Before coding the call, verify **the installed SDK type/signature and current primary Resend documentation** for how an idempotency key is supplied.

Do not guess the API shape from memory.

If the installed SDK does not expose the required idempotency mechanism but current provider API does:

- report the mismatch;
- propose the smallest provider-client change;
- do not silently bypass idempotency or upgrade unrelated dependencies.

`SystemEmailService.sendTransactional()` must accept idempotency context additively so existing signup/password/system-email calls behave unchanged when no key is provided.

---

# 11. Retry / recovery rules for this slice

## Confirmed pre-effect failure

May schedule same-effect retry when budget/current validity permit.

## Provider-idempotent ambiguous failure inside verified safe window

May repeat **same EffectId + same effect snapshot + same provider idempotency key**.

This is safe replay/reconciliation, not proof the previous provider attempt failed.

## Provider success confirmed

Never call provider create/send again for this EffectId.

Only consequence repair may run.

## Unknown outcome after provider idempotency safe window

Do not blind re-send.

Transition/project to operator attention/reconciliation semantics.

No generic “old Sending means retry” rule.

## Final confirmed failure

Only after retry policy is exhausted or provider outcome is conclusively nonretryable/final.

---

# 12. Action fingerprint / immutable snapshot rules

Canonicalization must be deterministic.

At minimum include the exact provider material Resend sees.

Do not include volatile fields that change without altering effect semantics, such as timestamps generated solely for logging.

Do include material sender/recipient/body/subject/provider options.

If attachments are supported through this path, bind attachment identities/content hashes as appropriate.

Store enough snapshot information to actually reproduce the same provider request on safe retry; a hash alone is insufficient if the mutable source can change.

Privacy/security:
- do not duplicate secrets/tokens into the snapshot;
- do not place OAuth/API credentials in DeliveryEvent/result data;
- minimize copied customer content beyond what is necessary to reproduce/audit the effect;
- follow existing data retention rules.

---

# 13. Exact likely affected files

Known primary files:

```text
packages/db/prisma/schema.prisma
packages/db/prisma/migrations/<new migration>/...
apps/server/src/modules/communications/delivery-queue.service.ts
apps/server/src/modules/communications/adapters/channel-adapter.interface.ts
apps/server/src/modules/communications/adapters/resend-email-adapter.ts
apps/server/src/modules/notifications/system-email.service.ts
apps/server/src/modules/communications/adapters/esp-fallback.spec.ts
```

Expected new/expanded proof files, naming may follow repository convention:

```text
apps/server/src/modules/communications/delivery-queue.service.spec.ts
apps/server/src/modules/communications/adapters/resend-effect-certainty.spec.ts
apps/server/test/... bounded persistence/concurrency integration test if unit config cannot use real DB
```

Potentially inspected but do not modify unless evidence requires:

```text
apps/server/src/modules/communications/adapters/adapter-registry.service.ts
apps/server/src/modules/ai/ai.listener.ts
apps/server/src/core/event-bus/events.types.ts
infrastructure/production.env.template
```

If additional material consumers/writers of `OutboundDelivery.status`, `retryCount`, `externalPostId`, `resultSnapshot`, `DeliveryEvent.attemptNumber` or `SystemEmailService.sendTransactional()` are discovered, report them before expanding scope.

---

# 14. Prohibited shortcuts

1. **No broad catch around provider + all local consequence code.**
2. **No treating local DB error as provider error.**
3. **No `status=Failed` as the sole proof that Resend did not send.**
4. **No retry using mutable current content after EffectId is bound.**
5. **No new EffectId per retry.**
6. **No same AttemptId reused for a genuinely new provider attempt.**
7. **No idempotency key generated randomly per attempt.**
8. **No provider idempotency key persisted as if it were eternal provider protection.**
9. **No historical backfill that labels ambiguous `Sending/Failed/RetryPending` as confirmed failure.**
10. **No `setTimeout`/process-local timer as durable recovery ownership.**
11. **No event-emitter success notification as authoritative completion evidence.**
12. **No universal workflow/recovery/attempt table.**
13. **No implementing Gmail/Meta/Twilio idempotency inside this packet.**
14. **No changing transactional signup/password emails to require an idempotency key.**
15. **No hiding effect-control identity in `payload.meta`.**
16. **No broad UI/Temporal Work Projection build in this packet.**
17. **No Recovery Control Twin/Attention Gradient implementation yet.**

---

# 15. Migration / data characterization

Before any data backfill or rollout, run read-only characterization in the appropriate safe environment.

The implementer must produce equivalent queries/results for:

```text
Resend-backed OutboundDelivery count by status
status × age buckets
Sending rows older than normal execution window
RetryPending/Failed rows by retryCount/maxRetries
externalPostId coverage by status
resultSnapshot coverage by status
recipient/contact/campaign linkage coverage
rows whose content/variant has changed since delivery creation if this can be inferred
```

Do not run destructive repair in the same step.

Historical classification:

```text
externalPostId/provider success evidence present
→ provider success candidate, inspect consequence completeness

Sending/Failed/RetryPending without provider evidence
→ AMBIGUOUS unless other evidence proves outcome

Published + provider ID
→ provider success candidate; consequence state still must be checked
```

No old ambiguous row becomes automatically eligible for re-send under the new semantics.

---

# 16. Characterization tests — preserve before target behavior changes

Add/preserve tests proving current product expectations:

### CH-01 adapter selection
Connected Gmail remains Gmail; fallback-only path resolves Resend.

### CH-02 fallback gate
`MARKETING_ESP_FALLBACK=off` refuses Resend fallback.

### CH-03 recipient/content pass-through
Current valid Resend delivery still receives recipient, subject and material body.

### CH-04 missing connection/adapter
Fails without provider call.

### CH-05 due-time claim
Only eligible due Queued/Scheduled/RetryPending rows are claimed.

### CH-06 CAS competition
Two claimers cannot both win ordinary claim of same status generation.

### CH-07 current product consequences
Document current campaign-contact/content aggregate semantics so target repair does not silently remove them.

### CH-08 event consumers
Characterize current material consumers of `content.published` / `delivery.completed`; if only learning/AI listeners, record that fact in implementation return packet.

---

# 17. Acceptance / proof ratchets

No claim of completion without executing the applicable proof.

## P1 — unit / contract

### AC-01 effect snapshot determinism
Same material provider request → same fingerprint; material recipient/subject/body/sender change → different fingerprint.

### AC-02 same-effect retry snapshot
After first bind, changing source content does not alter payload used for retry of existing EffectId.

### AC-03 idempotency key stability
A1 and A2 for same EffectId/fingerprint use same provider idempotency key.

### AC-04 new effect identity changes key
New OutboundDelivery/effect gets different provider idempotency identity.

### AC-05 error certainty
Structured/provider-known rejection, ambiguity and local consequence error classify into distinct paths.

## P2 — persistence integration

### AC-06 attempt allocated before provider call
Durable AttemptId/start evidence exists before simulator records provider invocation.

### AC-07 provider success persistence
Provider email ID + provider success certainty survive service/process recreation.

### AC-08 consequence incomplete survives restart
After provider success and injected local consequence failure, restart sees `SUCCEEDED_CONFIRMED + INCOMPLETE` and does not call provider again.

### AC-09 legacy ambiguity
Old fixture rows without evidence remain ambiguous; no invented provider outcome.

### AC-10 tenant isolation
Two businesses with similar provider/contact values cannot see/mutate each other's effect/attempt/recovery state.

## P3 — deterministic provider simulator

Simulator must support at least:

```text
accept + return email ID
reject before effect
accept + drop/throw before caller receives response
same idempotency key replay → same provider object/no second effect
changed payload same key → conflict/failure
```

### AC-11 FI-03 accept then response lost
Same-key safe replay does not create second provider effect.

### AC-12 FI-04 success returned then local provider-result persistence fails
Recovery uses same-key reconciliation/replay inside safe provider window; provider operation count remains 1.

### AC-13 FI-05 provider result persisted then contact/content update fails
Repair performs no provider call; provider operation count remains 1.

### AC-14 provider success + local failure never becomes provider FAILED
Provider outcome remains monotonic.

### AC-15 outside safe idempotency window
Ambiguous provider outcome does not blindly re-send.

## P4 — concurrency

### AC-16 two replica claimers
Exactly one active attempt generation is allocated for one claim generation.

### AC-17 stale attempt ownership
Lease/owner expiry triggers certainty/recovery path; it does not assert provider failure.

### AC-18 terminal non-regression
Late failure bookkeeping cannot regress confirmed provider success.

## P5 — optional provider sandbox

When implementation authorization includes external sandbox use, verify current Resend idempotency behavior against a test account. Do not rely on live customer email addresses.

Record exact provider-side evidence and test IDs. Deterministic simulator proof remains required even if sandbox passes.

---

# 18. Exact test commands to report when authorized

Use repository-supported commands; do not claim these were executed by this packet author.

Likely targeted commands after files exist:

```bash
pnpm --filter server exec vitest run apps/server/src/modules/communications/adapters/esp-fallback.spec.ts
pnpm --filter server exec vitest run apps/server/src/modules/communications/delivery-queue.service.spec.ts
pnpm --filter server typecheck
```

If paths are resolved relative to `apps/server`, adjust commands to the actual Vitest root and report the exact commands used.

For persistence/concurrency tests, use the repository's integration-test configuration and a disposable test database. Do not claim concurrency/transaction proof from mock-only tests.

Also report:

```bash
pnpm --filter db exec prisma validate
pnpm --filter db exec prisma generate
```

if schema changes are part of the authorized implementation.

Do not run `prisma migrate reset`, destructive repair, or production migrations as part of ordinary packet proof.

---

# 19. Rollout gate

`MARKETING_ESP_FALLBACK` controls whether Resend fallback exists. It is not enough for semantic rollout.

Add/identify a separate bounded rollout gate, conceptual name:

```text
OUTBOUND_RESEND_EFFECT_CERTAINTY_V1
```

Naming may follow existing feature-flag conventions.

Requirements:
- default off until migration/schema deployed and tests pass;
- enable in test/staging first;
- can be tenant/environment bounded if existing feature system supports it;
- disabling the new execution path must not delete/overwrite new evidence;
- no rollback may turn provider-confirmed success into failure.

Do not build a new feature-flag platform for this packet.

---

# 20. Failure / rollback strategy

## Schema migration fails

No behavior switch. Existing nullable/additive fields leave legacy path intact.

## New execution path fails proof

Keep rollout gate off. Preserve characterization evidence. Do not widen scope to “fix it by adding a workflow engine.” Return contradiction/evidence to architecture command center.

## Provider outcome becomes unknown

Do not blind re-send outside provider-safe replay semantics. Surface/retain unknown state for reconciliation/operator attention.

## Consumer missed

If a newly discovered consumer depends on `Failed/Published/RetryPending` semantics materially, stop before changing that consumer. Report it for packet expansion/re-audit.

## Consequence repair repeatedly fails

Provider effect remains success. Local consequence state remains incomplete/failed-repair evidence. Do not reset effect identity or resend provider request.

## Rollback to legacy code after new evidence exists

Legacy code must not reinterpret new provider-success evidence as permission to re-send. If this cannot be guaranteed, rollout must remain disabled until rollback compatibility is solved.

---

# 21. Explicit non-goals

- no Gmail certainty/idempotency changes;
- no Twilio/WhatsApp changes;
- no Meta/social changes;
- no provider delete/reversal;
- no Resend lifecycle-webhook ingestion unless needed to satisfy a mandatory proof and separately approved;
- no K10/payment/refund work;
- no global webhook apply-state work;
- no AI plan/BullMQ changes;
- no generic action dispatcher convergence;
- no universal temporal projection implementation;
- no UI redesign;
- no adaptive Recovery Budget;
- no Recovery Control Twin persistence;
- no counterfactual simulation.

---

# 22. Stop conditions — coding agent must escalate

Stop rather than improvise if any of these is found:

1. `OutboundDelivery` is reused for multiple materially distinct provider send effects in the Resend path.
2. Material provider payload cannot be snapshotted/bound without changing product semantics beyond this packet.
3. Existing Resend SDK/provider contract at implementation time does not support the assumed safe idempotency property.
4. Current installed SDK requires a broad dependency upgrade to use idempotency.
5. `content.published` / `delivery.completed` has a load-bearing material consumer requiring exactly-once durable handoff.
6. A new generic Attempt/Workflow/Recovery table appears necessary to pass the bounded proof.
7. Background tenant scoping cannot safely support the required queries/mutations without broader tenancy architecture changes.
8. Another writer can mutate the same delivery/effect in a way that defeats the claim/fingerprint model.
9. Historical data requires destructive rewrite to enable the new path.
10. Main advanced with code-bearing changes in these paths after the packet baseline.

Escalation must include exact source evidence and a proposed smallest architecture adjustment; do not silently redesign.

---

# 23. Mandatory implementation return packet

When this packet is eventually authorized and implemented, return:

## A. Git identity

```text
branch
commit SHA(s)
PR URL/number if any
baseline revalidated SHA
```

## B. Complete changed-file list

Grouped by:
- schema/migration;
- execution semantics;
- provider adapter;
- tests;
- rollout/config;
- docs.

## C. Invariant map

For I1–I10:

```text
invariant
→ implementation location
→ proof/test location
→ executed result
```

## D. Additional discoveries

Especially:
- alternate OutboundDelivery writers;
- status consumers;
- event listeners;
- unexpected Resend/SystemEmail callers;
- tenant middleware interactions;
- provider SDK limitations.

## E. Tests actually executed

Exact command + exit/result + skipped/failing tests + environment.

## F. Migration evidence

- migration file;
- Prisma validation/generation;
- read-only legacy row distributions;
- any backfill performed;
- rollout gate state.

## G. Provider proof

Simulator operation counts/IDs and, if authorized, sandbox evidence.

## H. Residual risk

No “all fixed” summary without explicitly stating what remains outside this packet.

---

# 24. Adversarial review prompt

After primary implementation, give Kimi/Gemini/another independent reviewer this packet + implementation diff and ask it specifically to search for:

```text
provider call reachable without stable effect idempotency context
second provider call after provider success evidence
attempt identity allocated after PONR
mutable payload used on retry
status-based failure certainty collapse
post-provider local errors entering provider retry branch
stale Sending rows blindly resent
idempotency retention-window violation
cross-tenant recovery by provider/effect ID
local consequence not idempotent
new evidence ignored by legacy rollback path
EventEmitter listener that is more load-bearing than packet assumed
parallel hidden delivery writer/executor
schema fields that duplicate rather than clarify canonical truth
```

Reviewer should not redesign the platform; report packet violations and contradictory evidence.

---

# 25. Packet verdict

```text
PACKET ID: KF-EXEC-EXTFX-001
SCOPE: Resend-backed OutboundDelivery only
ARCHITECTURE STATUS: READY
IMPLEMENTATION STATUS: UNAUTHORIZED
```

The packet is intentionally narrow but nontrivial. If it cannot prove provider-effect certainty without a universal workflow/recovery framework, that failure is useful architecture evidence and should reopen the target before KeyFlow expands the pattern to AI plans, webhooks or money.
