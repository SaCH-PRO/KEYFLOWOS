# KEYFLOWOS — Next Chat Rollover

Checkpoint: `PKG-EXTFX-2026-09-19-01`

Paste the following into the new chat:

> Continue KEYFLOWOS from the durable repository state. Do not restart, re-plan from scratch, or recreate EXTFX.
>
> Repository: `SaCH-PRO/KEYFLOWOS`
> Forensic baseline: `main@8f173bfe79f1418159cf4099ea18b0d60d203ec2`
> Current main at handoff: `ebbe8862fa4b7e6ec968db193620ac53f38cd5ff`
> Intelligence branch: `docs/keyflow-intelligence-foundation`
> Active package: `KF-EXEC-EXTFX-001`
> Implementation branch: `impl/kf-exec-extfx-001-resend-certainty`
> Implementation head at handoff: `302ed9fe388ead2a0d7e40f10b82b849b13bb39e`
> Draft PR: `#76`
>
> First read `docs/intelligence/handoff/CURRENT-STATE.yaml`, `CURRENT-HANDOFF.md`, this rollover, and `docs/intelligence/packages/KF-EXEC-EXTFX-001/CHARACTERIZATION-RECEIPT.yaml`. Re-resolve all live heads before editing.
>
> K12 is already merged/proven on main. EXTFX implementation exists in 5 commits; do not recreate it.
>
> The immediate blocker is CI run `35333169059`: security/lint/DAST/divergence are green, but server typecheck fails with nine errors in `delivery-queue.service.ts`; builds/tests were skipped. Fix those exact typing/runtime-boundary errors with the smallest change, preserving EXTFX invariants.
>
> Then rerun full CI. Require migration application, server regression, K12 proof admission, web tests, builds, typecheck, lint, security, DAST and divergence to be green. After green CI, adversarially review EXTFX against its failure/proof matrices before changing PR #76 from draft or merging.
>
> Do not send real provider traffic, mutate production data, deploy production, refresh the programme map, restart scheduled architecture cycles, or silently rebaseline the forensic baseline.

## Current red CI details

`delivery-queue.service.ts` errors:
- nullable `htmlBody` passed to non-nullable optional `PublishPayload.htmlBody` (2 sites);
- several `retryCount` / attempt-number values possibly undefined;
- `ResendDeliveryRuntime` missing `externalPostId`;
- a row lacking included `destination` passed where `ResendDeliveryRuntime` requires it.

PR #76 must remain draft until full proof is green.
