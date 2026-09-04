# KeyFlowOS Contradiction Register — Scheduled Recovery Supplement

Status: CANONICAL CONTINUATION OF `09L-CONTRADICTION-REGISTER-PROVIDER-RECOVERY-SUPPLEMENT.md`

Canonical sequence continues after C103.

---

## C104 — durable scheduled intent vs one-shot terminal FAILED semantics

**Status:** VERIFIED ACTIVE CONTRADICTION

`ScheduledAgentJob` exists to preserve future business work across time, but representative consumers convert execution error directly into terminal `FAILED` without an observed generic retry/backoff/finality/dead-letter contract.

Thus:

```text
work intent: durable future business obligation/action
failure model: one attempt then opaque FAILED
```

Target resolution: each work type declares whether failure is retryable, final, expired, superseded or requires operator repair, with attempt/recovery evidence preserved.

Affected kernels: K7, K8, K11.
Affected journeys: J4, J6, J9, J10, J18, J23.

No production implementation is authorized by this supplement.
