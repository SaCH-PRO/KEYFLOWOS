# KeyFlowOS Finding Register — Scheduled Recovery Supplement

Status: CANONICAL CONTINUATION OF `08L-FINDING-REGISTER-PROVIDER-RECOVERY-SUPPLEMENT.md`

Implementation baseline: `main@d7c5b86cfa276d75ffa42d5f1707c43704dc9f21`

Canonical sequence continues after F153.

---

## F154 — ScheduledAgentJob failures are terminalized without an observed generic retry/backoff/dead-letter recovery lifecycle

**Status:** VERIFIED CODE-PATTERN / SEARCH-SCOPED RECOVERY FINDING

Multiple live `ScheduledAgentJob` consumers catch execution errors and write:

```text
status = FAILED
```

Observed writers include:

- ReviewSolicitationService;
- AbandonedCartRecoveryService;
- CrossModuleAgentService;
- CommerceIntegrationService post-purchase processing.

The `ScheduledAgentJob` model/search surface did not expose a generic retry budget, attempt count, `nextRetryAt`, lease/recovery owner or dead-letter state comparable to OutboundDelivery/BullMQ.

Scoped repository search found no generic `FAILED → PENDING` retry/requeue/repair consumer.

Therefore the current shared scheduler semantics are effectively:

```text
PENDING
→ execute once
→ COMPLETED | FAILED
```

where `FAILED` does not itself encode:

```text
retryable vs final
retry budget
next retry time
failure certainty
operator owner
repair action
```

This is distinct from F123, which covers missing atomic execution ownership. Even with a claim added, recovery semantics would still be incomplete.

Target law:

> A durable scheduler must distinguish retryable attempt failure from final/expired/cancelled work and expose an explicit recovery owner/policy where business semantics require recovery.

Affected kernels: K7, K8, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

---

# Pool law

```text
FAILED
without retry/finality/recovery semantics
is not a sufficient durable-work state
```

No production implementation is authorized by this supplement.
