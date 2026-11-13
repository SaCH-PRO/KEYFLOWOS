# Correctness and reliability backlog

Status: **backlog of candidate packets. Read-only findings. No item is released, and nothing here authorizes implementation.**
Derived: 2026-10-11, by reading `main` `98ee0202499ba87fa4ee13d58a2a9075016225bd`. Nothing was executed against the application or a database.

Each item is small enough to be one bounded packet, and none needs a schema change or a migration. Paths are under `apps/server/src/modules/` unless rooted.

Confidence: **confirmed** means the quoted lines were read on that commit. **Likely** means the code was read and the failing path depends on a condition not exercised. Four items (REL-01, REL-03, KEY-01 and one withheld item) were read a second time by a different session before this file was written.

Two access-control findings are **not in this file**. This repository is public, and they are reported to the operator directly. They are counted in the ranking as AC-01 and AC-02.

## Ranking

| # | Id | Area | Consequence | Confidence |
|---|---|---|---|---|
| 1 | AC-01 | business application | access control (withheld) | confirmed |
| 2 | REL-01 | scheduling | a scheduled customer message is never sent | confirmed |
| 3 | KEY-01 | KEY runtime | a plan's steps run twice | confirmed |
| 4 | REL-03 | scheduling | recurring invoices stop until restart | confirmed |
| 5 | REL-02 | scheduling | a follow-up email and task are sent twice | code confirmed, trigger likely |
| 6 | KEY-04 | KEY runtime | an "idempotent" action runs twice under a race | confirmed |
| 7 | KEY-02 | KEY runtime | a plan waiting for approval is recorded as failed | confirmed |
| 8 | REL-04 | scheduling | a customer receives a second invoice | likely |
| 9 | KEY-03 | KEY runtime | an approved step never runs | likely |
| 10 | AC-02 | business application | access control (withheld) | likely |

## Platform and scheduling

### REL-01 — the cross-module poller completes other owners' jobs without running them

`flow/cross-module-agent.service.ts` polls every 60 seconds for every due `PENDING` `ScheduledAgentJob`, with no filter on `jobType` (lines 244–251). A job type it does not know is logged as "Unknown job type" (line 277) and then marked `COMPLETED` like any other (line 258).

Other services own some of those types and poll for them hourly: `conversion/abandoned-cart-recovery.service.ts` (`abandoned_cart_recovery`), `conversion/review-solicitation.service.ts`, and `conversion/lead-magnet.service.ts` writes `lead_magnet_enroll`.

Failing scenario: an abandoned-cart recovery job falls due. Within 60 seconds this poller marks it completed. The hourly owner finds nothing pending. The recovery email is never sent, and nothing records a failure.

Scope: one file; filter by the job types this poller executes. Proof: a real database; seed a due `abandoned_cart_recovery` row, run the poller, the row must still be `PENDING`; control with the filter removed. Overlap: `KF-EXEC-TIME-001` targets this fabric.

### REL-02 — the same poller has no claim and no in-flight guard

A bare `setInterval` (lines 235–239) reads due jobs, executes each, then updates it (255–258). Two overlapping runs, or two server instances, execute the same job.

Mitigations found: a unique key stops duplicate rows, transactional emails carry a `dedupeKey`, and the production compose file runs one `api` service. Not covered: the quote follow-up path, which creates a CRM task and sends a Gmail message (lines 407 and 418) with no dedupe key.

Failing scenario: a tick longer than 60 seconds (the batch is 50 jobs), or a second instance, sends the follow-up email and creates the urgent task twice.

Scope: claim with a conditional `updateMany … where status = PENDING` before executing, and an in-flight guard. Proof: two concurrent runs on a real database, with the mail call stubbed and asserted once. Overlap: `KF-EXEC-TIME-001` ("one claimant").

### REL-03 — the recurring-invoice guard can stick forever

`commerce/recurring-invoice.service.ts` line 218–219: `if (this.running) return []; this.running = true;`. The next statement is an awaited query outside any `try`. The only reset is at line 344, after the loop. There is no `finally`.

Failing scenario: that query rejects once (a dropped connection). `running` stays true. Every later run returns immediately, so no recurring invoice is generated until the process restarts, with no error after the first.

Scope: one file. Proof: reject the query once; the next call must process.

### REL-04 — a recurring invoice is sent before its schedule advances

Same file: the invoice is created (line 250), transitioned to `SENT` (281), and only then is `nextRunDate` updated (287), outside a transaction. If that update fails, the schedule is still due.

Failing scenario: the customer receives a second invoice on the next run.

Proof: a real database with the update forced to fail.

## KEY agent runtime

### KEY-01 — `executePlan` does not claim the plan

`key-cortex/key-cortex-planner.service.ts` lines 377–387 read the plan and then set `status: 'running'` unconditionally. The step loop skips only on `stopped`. The route is in `key-cortex/key-cortex-goals.controller.ts`.

Failing scenario: a double submit, or a second submit after completion, runs every step of the plan again, including steps with external effects.

Scope: the planner only; make the transition to `running` conditional on the prior status and act on whether it applied. Proof: a real database, two concurrent calls, count executor invocations.

### KEY-02 — a plan paused for approval is recorded as failed

Same file, lines 484–486: the check for `waiting_approval` reads the steps as loaded before execution, while the status is written only to the database (459–461). The plan result is then recorded as failed and the saga is failed.

### KEY-03 — an approved plan-queue step may never run again

`ai/plan-executor.service.ts` (419–423) re-enqueues an approved step under the same idempotency key. `ai/queue.service.ts` (109) uses that key as the job id and keeps failed jobs for seven days. `ai/action-dispatcher.service.ts` (80–84) returns the logged earlier failure for the key. Read across three files, not exercised.

Proof: a real queue and database; approve a step and assert the tool runs once.

### KEY-04 — `KeyIdempotencyService.check` is not a claim

`key-cortex/key-idempotency.service.ts` lines 33–51 look the key up and then create it; a comment at 68–69 says a pending key is treated as new, last writer wins; the stored `requestHash` is never compared. The action boundary (`key-autonomy/action-boundary/key-action-boundary.service.ts`, 626–632) claims by insert inside a transaction, which is the correct shape.

## Leads checked and not listed

- No global guard exists; that is known and tracked by `core/auth/public-surface.spec.ts`.
- Webhook handlers verify signatures; the code-executor route uses a one-time token.
- No controller takes the tenant from the request body in the `{ businessId, ...body }` form; `core/auth/tenant-body-override.spec.ts` gates it.
- Pollers that already claim atomically: WhatsApp, the social scheduler, the communications delivery queue, email marketing.
- `core/scheduling/safe-interval.ts` contains a rejected promise correctly; it keeps no guard state, so overlap protection is each caller's job.
- Open PRs: #158 (tenant-scoping of BusinessGoal writes, correctness), #160 (planner tool name forcing the legacy registry, correctness), #161, #162, #134 (features).

## Not examined

`apps/web`; about 40 further schedulers; payment and keystore handlers; tool bodies in `flow-orchestrator.service.ts`; raw SQL; the transactional-email drain; whether existing specs already cover KEY-03.

## Before any item becomes a packet

Each needs a ChatGPT DIRECTIVE, a no-edit characterization against the `main` of that day, and the proof named in the item against a real database. REL-01 and REL-02 sit inside `KF-EXEC-TIME-001`'s scope and should be reconciled with it rather than run beside it.
