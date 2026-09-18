# KF-EXEC-K12-001 Surgical Package

Level: **L2 — SURGICALLY HARDENED / NO CODE CHANGES AUTHORIZED**

## Mission

Build the proof-admission and test-isolation substrate that all later packages rely on.

This package does **not** add business features. It makes later claims like "tenant isolation passed", "migration is safe", or "provider retry is idempotent" trustworthy and reproducible.

## Product outcome

An implementation agent should be unable to claim a packet is proven when:
- required cases are missing/skipped;
- the wrong test scope ran;
- Turbo replayed cached output while the claim says fresh;
- setup/collection errored;
- unsafe/shared/prod-like resources were used;
- cleanup failed;
- a candidate altered its own acceptance manifest;
- only test counts, not expected case identities, matched.

## Dependency position

```text
KF-EXEC-K12-001
      ↓
proof substrate for every later package
```

No downstream package may treat itself as L5 Proven until K12 proof admission is itself admitted.

## Implementation sub-slices

1. **K12-A — Native test report characterization**
2. **K12-B — Accepted policy manifest**
3. **K12-C — Independent proof evaluator**
4. **K12-D — Resource admission/isolation**
5. **K12-E — Cleanup/child-process receipts**
6. **K12-F — CI binding and negative controls**

## Stop conditions

Stop and return to ChatGPT if:
- the current test runner cannot expose stable case identity/report data without replacing the test framework;
- safe resource identity cannot be determined before write-capable setup;
- CI architecture has materially changed from the characterized baseline;
- a package requires OS constitution/workflow changes outside current authorization;
- proof semantics would need weakening to preserve current green status.

## Source baseline seams

Known fixed-baseline files:
- `package.json`
- `turbo.json`
- `.github/workflows/ci-cd.yml`
- `apps/server/vitest.config.ts`
- `apps/server/vitest.unit.config.ts`
- `apps/server/vitest.integration.config.ts`
- `apps/server/vitest.smoke.config.ts`
- `apps/server/src/core/config/gate-vacuity.spec.ts`
- `apps/server/test/app-module-boots.integration.test.ts`

These are starting points only. Current main must be re-characterized before edits.
