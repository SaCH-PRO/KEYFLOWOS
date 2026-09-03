# KeyFlowOS Contradiction Register — Booking / Temporal Supplement

Status: CANONICAL CONTINUATION OF the KeyFlowOS contradiction register after `09C-CONTRADICTION-REGISTER-CONSEQUENCE-OWNERSHIP-SUPPLEMENT.md`

Canonical sequence continues after C073.

---

## C074 — requested booking target status vs actual transition occurrence

**Status:** VERIFIED ACTIVE CONTRADICTION

Requesting `COMPLETED` can recreate completion consequences even when the booking was already completed because current booking mutation is target-value based rather than occurrence/CAS based.

Target resolution: explicit booking transition machine with expected-state atomicity and one committed occurrence identity.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J4, J18, J23.

---

## C075 — shared scheduled-job namespace vs consumer ownership

**Status:** VERIFIED ACTIVE CONTRADICTION

Multiple subsystems write distinct job types into `ScheduledAgentJob`, while CrossModuleAgent polls every due PENDING row regardless of job type and can mark jobs completed even when it has no actuator for them.

Target resolution: explicit type/capability ownership/router and fail-closed handling for unknown/unregistered job contracts.

Affected kernels: K5, K7, K8, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

---

## C076 — scheduled checkpoint uniqueness vs due-job execution ownership

**Status:** VERIFIED ACTIVE CONTRADICTION

The shared scheduled-job model supports semantic checkpoint uniqueness, yet worker implementations generally fetch PENDING rows and perform side effects before any atomic claim.

Target resolution: preserve checkpoint identity, add explicit occurrence/worker claim semantics.

Affected kernels: K7, K9, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

---

## C077 — one-time referral entitlement vs mutable Contact.custom flags

**Status:** VERIFIED ACTIVE CONTRADICTION

Referral reward one-time semantics are represented by mutable referred-contact metadata and referrer balance fields rather than an atomic entitlement/ledger transition.

Target resolution: unique reward entitlement + transactional financial mutation + evidence.

Affected kernels: K6, K8, K10, K11.
Affected journeys: J3, J4, J7, J18.

---

## C078 — source-state filtered project transition vs unconditional final update

**Status:** VERIFIED ACTIVE CONTRADICTION

ProjectRevenueListener describes its behavior as idempotent because it initially selects source-state projects, but the subsequent update does not enforce that source state. Concurrent handlers can both publish a transition occurrence.

Target resolution: canonical transition owner / expected-state CAS.

Affected kernels: K6, K7, K8, K11.
Affected journeys: J4, J7, J8, J18.

---

## C079 — rich booking-event fan-out vs absent consequence ownership graph

**Status:** VERIFIED ACTIVE CONTRADICTION

`booking.completed` legitimately drives many business consequences, but their one-time/repeatable/cadence and authority relationships are spread across separate services with no shared occurrence/consequence graph.

Target resolution: preserve modular consumers while making material consequence ownership, causality, coexistence and replay semantics explicit.

Affected kernels: K3, K5, K6, K7, K8, K9, K10, K11.
Affected journeys: J3, J4, J6, J7, J8, J9, J10, J14, J18, J23.

---

# Pool law

```text
SHARED PERSISTENCE OR EVENT FAN-OUT
does not imply
SHARED EXECUTION OWNERSHIP
```

Every executable job/event consumer requires explicit routing, claim and outcome semantics.

No production implementation is authorized by this supplement.
