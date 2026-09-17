# KEYFLOWOS Whole-OS Proof Architecture

Checkpoint: WOC-2026-09-17-01
Status: ACCEPTED PROOF SEQUENCING CANDIDATE / NOT EXECUTED

## Proof thesis

A green command is evidence only when the required scope, case identities, source/build, environment, attempt, results, cleanup and evaluator are all known.

Proof receipt dimensions:
- scope;
- source/build identity;
- run/attempt identity;
- collection/discovery;
- exact case identity set;
- execution outcomes/errors/skips;
- freshness/cache provenance;
- isolation/resource ownership;
- child process/provider cleanup;
- raw report hash/reference;
- independent evaluation;
- release scope.

## P0 — Static/contract admission

Must prove:
- expected cases are actually discovered;
- no required case missing/duplicated/skipped/todo;
- configuration/source gate non-vacuity;
- accepted manifest independent of candidate;
- source/build identity;
- no gate weakening.

## P1 — Isolated service/contract proof

Use unit/contract tests for deterministic laws:
- authority algebra;
- capability normalization;
- state transitions;
- value-stage arithmetic;
- policy invalidation;
- billable-period calculation;
- projection adapters.

Mock-only success cannot claim provider/DB/concurrency truth.

## P2 — Database/migration/concurrency proof

Dedicated ephemeral DB/resources.

Required classes include:
- concurrent grant/authority mutation;
- approval/execution CAS;
- booking-slot concurrent reservation;
- occurrence/claim races;
- hard-budget reservations;
- idempotency/retry;
- partial transaction windows;
- schema/backfill/constraint migration;
- rollback/forward-repair floor;
- legacy data ambiguity.

## P3 — Provider sandbox / external-effect proof

Where provider sandboxes/test accounts exist:
- webhook authenticity;
- tenant/account binding;
- provider-native idempotency;
- callback replay;
- provider success/local persistence failure;
- outcome unknown reconciliation;
- revoke/reconnect/cleanup dependency;
- payment/refund/settlement;
- email/message delivery evidence;
- voice/session/provider webhooks;
- model usage/provider-cost evidence.

Never use production customer resources for proof.

## P4 — Integrated journey proof

Browser/API/worker integrated slices:
- Business Birth + authority;
- governed action and approval;
- customer/public booking/order/quote/payment;
- project/contract/document completion;
- connector/webhook/recovery;
- Command Center source degradation;
- conversation text/voice;
- subscription/entitlement/metering;
- privacy correction/deletion.

Integrated proof checks frontend claims against backend canonical truth.

## P5 — Negative controls

Every major proof family includes a deliberate invalid case that must fail:
- wrong tenant;
- revoked authority;
- stale approval;
- duplicate occurrence;
- missing required case;
- wrong environment;
- provider invalid signature;
- stale connector generation;
- crossed portal contact;
- voice stream substitution;
- over-budget hard admission;
- source evidence withdrawn.

If the negative control passes, the proof is invalid.

## P6 — Migration/withdrawal proof

For each migration:
- old state inventory;
- deterministic mapping;
- ambiguous bucket and manual policy;
- backfill counts + semantic checks;
- dual-read/write compare if used;
- late writer detection;
- historical reconstruction;
- rollback floor;
- old writer disabled;
- old reader removal after observation.

## P7 — Performance/operability

Measure only after semantic correctness:
- hot authority resolution;
- Command Center fan-in;
- event/recovery backlog;
- provider callback latency;
- long-running work lag;
- ledger/report projections;
- voice latency;
- public availability/checkout;
- AI admission/usage writes.

Optimize with evidence; do not denormalize truth prematurely.

## P8 — Release/canary

Only after explicit release authorization:
- isolated proof accepted;
- migration dry-run accepted;
- release scope declared;
- canary population/resource bounded;
- feature flag is exposure only;
- stop/revoke path independent;
- observability and reconciliation live;
- rollback/forward-repair tested;
- no safety invariant disabled by flag.

## Existing designed inventories

Retain rather than duplicate:
- J13: 44 designed cases, zero bindings/execution;
- J8: 24 designed cases;
- J9: 26 designed cases;
- J20: 20 designed cases;
- J21: 16 designed cases;
- J22: 18 designed cases;
- J24: proof-admission analytical challenges and safe-change conditions;
- earlier J18/J23 proof obligations.

These inventories are obligations, not passed tests.

## Whole-OS proof exit condition

KEYFLOWOS may be called migrated/proven only when:
1. all mandatory Wave invariants have executable bindings;
2. required cases are fresh and complete at the declared scope;
3. deployed schema/data match the accepted migration state;
4. provider/deployment conformance is established where external reality matters;
5. no unresolved high-impact legacy writer bypass remains;
6. frontend/public/voice projections agree with canonical truth;
7. recovery/cleanup debt is known and bounded;
8. independent proof admission accepts the receipts;
9. production release itself has separately authorized evidence.

No percentage alone satisfies this condition.
