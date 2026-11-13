# Independent Flow candidate review

**Disposition: no substantive blocker found in the prepared two-file correction. This is review of a local candidate, not application admission or proof that main is fixed.**

Root independently read the entire patch, the unchanged resolver and protected update path, the actual-service proof harness, its compatibility controls, the expanded existing Vitest specification and recorded results. Source main is `98ee0202499ba87fa4ee13d58a2a9075016225bd`.

The changed runtime condition is sufficient for the declared selective-read failure: a legacy result can return only after the typed read completed without failure. A failed typed read therefore reaches the existing restricted/degraded fallback, and the existing update guard refuses before `AiMemory.upsert` or the success audit. The patch preserves successful typed precedence, legacy compatibility after confirmed absence, defaults, blocklists and admin ownership. The explicit transaction reader follows the same rule. No new architecture interface, schema or runtime dependency is introduced.

Root replayed the unchanged actual-service harness separately at **2026-10-17T22:15:49.811Z**, writing a new local result directory. Node v24.19.0 / Linux produced:

| Variant | Passed | Failed requirements |
| --- | --- | --- |
| Unchanged main | 10 of 13 | P2, W1, R1 |
| Candidate | 13 of 13 | None |
| Old unsafe condition restored | 10 of 13 | P2, W1, R1 |

The unchanged-source protected-write case records one synthetic policy upsert and one synthetic success audit; the candidate records zero of each and the expected `ServiceUnavailableException`. External network attempts and real database/provider calls were zero. The full local Root replay JSON has SHA-256 `5a1446f297ad6b8ebcfe69e819fb462f0b4b29198d3d4cb78284bf7357fc8d82`; it is retained locally, not included as a second raw transcript in this publication. The published compact proof contains the corresponding preparer's independently recorded outcomes.

The prepared Vitest evidence was inspected: original specification 5/5; expanded specification 9/12 before correction, 12/12 for the candidate, and the same three failures after the mutation; zero skips. Root did not rerun that suite a second time. The candidate identities remain those in `candidate-manifest.json`.

## Limits and owner handoff

This review covers the narrow resolver correction and its selective-failure regressions. Optional caller mode overrides, request-wide authority, Flow role-envelope/CRM actor propagation, Cortex result consumption, cross-field supervised policy and ACTION D4/D6 remain separate obligations. The harness omits the optional mode override and does not establish that every action path is safe.

The candidate still requires the existing owner's implementation handoff, adoption against then-current source, hosted Node 20 and required complete-project proof, normal admission/integration, post-merge verification and durable checkpoint. No worker assignment, authority event, source-branch update, ready transition, merge, production effect or product completion credit was made by this review.
