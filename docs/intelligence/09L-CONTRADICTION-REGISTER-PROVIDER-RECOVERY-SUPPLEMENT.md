# KeyFlowOS Contradiction Register — Provider Recovery Supplement

Status: CANONICAL CONTINUATION OF `09K-CONTRADICTION-REGISTER-RECOVERY-SUPPLEMENT.md`

Canonical sequence continues after C101.

---

## C102 — durable internal retry identity vs fresh provider request identity

**Status:** VERIFIED ACTIVE CONTRADICTION

OutboundDelivery preserves one durable delivery row across attempts, but the current ChannelAdapter contract does not carry a first-class stable provider idempotency/effect identity.

Thus a retry can be:

```text
internally: same delivery
externally: fresh provider request
```

Target resolution: one KeyFlow EffectId maps to provider-native idempotency when available or reconciliation-first semantics when it is not.

Affected kernels: K7, K8, K9, K11.
Affected journeys: J5, J9, J14, J18, J23.

---

## C103 — one logical Instagram delivery vs multiple unpersisted provider sub-operations

**Status:** VERIFIED ACTIVE CONTRADICTION

Instagram publishing creates a provider media container and then publishes it, but the successful first-stage container identity is not durably checkpointed before the second stage.

The local model sees one delivery attempt while external reality can already contain a reusable/partially completed provider operation.

Target resolution: persist provider sub-operation checkpoints and resume/reconcile rather than restarting opaque multi-stage effects.

Affected kernels: K8, K9, K11.
Affected journeys: J9, J14, J18, J23.

No production implementation is authorized by this supplement.
