# Reconstruction Programme — Product-first Execution Plan

Prepared: Thursday, 2026-10-29 (America/Port_of_Spain).  
Status: PLAN AND DOCUMENTATION ONLY; no automatic scheduled worker or implementation grant. This schedule is a target for active, authorized execution in subsequent sessions, not background work currently running.

## Revised priority

A. Product specification and real customer outcome: CRITICAL PATH.  
B. Exhaustive historical / KEY cognition / agent-development archaeology: SUPPORTING, may continue independently, but must not block product packets.

## Materiality and disposition

- **Spec claim (full schema)** only if it affects user-visible behavior, customer/business data or interface contract, identity/tenancy/permissions/security/privacy, money/ledger/external side effects, resilience/recovery, or material build-order/module/API/test dependency.
- **Preserved research note** for optional developer speed, historical naming, folder organization, experimental cognition, ideas without adoption, or minor developer UX: indexed and recoverable, not a full 15-field requirement unless it proves a dependency on correct delivery or a measurable benefit.
- **Reviewed no material claim** for sources that contain nothing relevant to either category; record reason/source revision. Never silently discard.
- Research already retained in evidence claims is not demoted/deleted. New detailed meta analysis is paused until first product spec and pilot exist.

## Timebox and four dated pre-freeze tranches

| Tranche | Target period | Product deliverable | Exit gate |
|---|---|---|---|
| T0 | Oct 29–Nov 1, 2026 | Short product constitution; ranked KEEP/MERGE/DEFER/CUT module map; Contacts v1 spec and dry-run packet | Source-backed document + testable acceptance; identify unknowns |
| T1 | Nov 2–Nov 5, 2026 | Contacts vertical pilot on exact current main: staging/test replay, smallest bounded correction if needed, independent review | Honest PASS/FAIL/BLOCKED verdict, logs and non-mock data/tenant proof |
| T2 | Nov 6–Nov 12, 2026 | Quote/invoice/manual-payment/ledger module specifications and release-0 journey tests | Financial correctness and end-to-end contract, remaining failure inventory |
| T3 | Nov 13–Nov 19, 2026 | Onboarding, public results, Cockpit read-state and cross-module contract; resolve v1 core scope | Operator-reviewed v1 spec candidate; unresolved blockers explicitly identified |

**Target specification freeze: Thursday, 2026-11-19.** This applies to the *first release/v1 product contract*, not the entire lifetime KEY/KEYFLOWOS corpus. If executable proof or critical security evidence is missing, label affected contract FROZEN_WITH_OPEN_BLOCKERS or extend the actual freeze explicitly. Never claim a green freeze from a date alone.

After freeze: new findings enter a change-intake record with source, materiality, compatibility, regression risk, affected packets, approver and disposition. Routine historical material does not reopen v1 by default. Critical security, data-loss, money or tenant-isolation findings can block/reopen a contract when independently verified.

## Pilot selection and authority

**First pilot: Contacts**, because current main has a real model, service, REST controller, web page and tests. The goal is NOT to regenerate the CRM from scratch; it is to test whether a one-file implementation contract enables focused diagnosis, correction and verification.

Release 0 issue #186 sets product target; issue #80 and the existing Agent Control protocol govern Claude-worker directives and grants. A spec or draft packet is NOT a DIRECTIVE. Implementation must await the currently applicable authority, a fresh source SHA, staging access, a safe test environment and independent review. Production stays read-only.

## Historical PR backlog triage (57 open at census)

Metadata-only inventory is not sufficient to close an open PR. Cheap initial triage is welcome: identify candidates for ALREADY_MERGED_EQUIVALENT / STALE_BASE / SUPERSEDED / EXTRACTION_PENDING / STILL_ACTIVE / NEEDS_REVIEW. Reconcile code ownership, proposed intent, patch/diff, newer replacement and references before recommending closure. Never close/merge PRs automatically; user/operator authorization and existing gates remain required.

## Completion reporting

Every tranche reports:
- new product claims and cumulative product-claim count;
- new KEY cognition / shared / development-system claims and counts;
- source metadata coverage and deep-review coverage separately;
- accepted versus draft/superseded/rejected/unknown findings;
- self-contained module specs created, pilot proof outcomes, blockers;
- exact SHAs and any stale evidence;
- late evidence intake and impact on target freeze.

Existing initial ledger: PRODUCT 0, KEY 1, SHARED 2, DEVELOPMENT 8 (11 total). These baseline counts exclude the product claims drafted after this correction. No milestone counting can be presented as a percent of actual implementation correctness.

## Stop rules

Stop scope expansion whenever a tranche lacks its promised product artifact, a source is too stale to bind, the proposed packet creates duplicate ownership, or execution would bypass a control gate. A timebox ends in a documented disposition and known unknowns, not unbounded archaeology. Deep history review can continue but cannot delay a validated product journey solely to improve archival completeness.
