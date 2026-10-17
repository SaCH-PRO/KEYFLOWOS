# Handoff monitor (H1): read-only ChatGPT ↔ Claude communication viewer

Packet KF-META-HANDOFF-MONITOR-001, scope issue #178, directive
CG-DIR-HANDOFF-UI-001. This is operator-authorized meta observability. It is
not a node of the programme DAG, and it does not authorize any merge or
deployment.

The owner console page `/admin/mission-control/handoffs` shows what ChatGPT
and Claude actually published on issue #80, and which handoff step each
request has evidence for. It is read only: no control on it sends, retries,
merges or releases anything, and nothing it shows is control authority.

## What it shows

A **task** is one request: a DIRECTIVE or REVIEW from the `chatgpt` sender.
Its handoff has six stages, each observed separately with its source comment:

| Stage | Evidence |
|---|---|
| POSTED | the request comment |
| ACKNOWLEDGED | an ACK from the addressed responder whose `in_reply_to` is the request, for the same PR and head. It shows that the work was claimed, not that anyone is still running |
| WORKING_LAST_OBSERVED | the newest task-bound PROGRESS/MOMENTUM/CONTRADICTION, with its age. Liveness is always UNKNOWN |
| RETURNED | the responder's RETURN naming the request (or its matched ACK). A declared `reviewed_head` must equal the requested head, and a declared `ack_ref` must name a matched ACK |
| RETURN_CONSUMED | the requester naming that RETURN (`in_reply_to` and/or `return_comment_id`, which must agree). Loading or refreshing this page never consumes anything |
| DECISION_RECORDED | the requester reply that records `review_status`/`decision`, classified AUTHORITY (a valid authority message) or EVIDENCE_ONLY |

The following are reported separately, never folded into one badge:

- review outcome (PASS / CHANGES_REQUIRED / NOT_RUN / UNKNOWN, as the RETURN declares it);
- revision validity: requested vs returned head, and the returned head vs the PR's current head (CURRENT / SUPERSEDED / UNKNOWN);
- merge authority: GRANTED only from a valid PACKET_ADMISSION authority message with `merge_authority: true`;
- evidence confidence;
- whose response is pending.

Correlation is by explicit reference only: the logical id in `in_reply_to`, the
comment ids in `ack_ref`/`return_comment_id`, the role, the PR and the
revision. A shared packet id or PR number never links two messages. Anything
that does not match is listed under the task as a mismatch (WRONG_SENDER,
WRONG_PR, WRONG_REVISION, ACK_REF_MISMATCH, CONFLICTING_RETURN_REFERENCE,
DUPLICATE_LOGICAL_ID, BEFORE_REQUEST, ...). Otherwise it goes to the unmatched
list (NO_REFERENCE, UNRESOLVED_REFERENCE, AMBIGUOUS_REFERENCE,
NOT_USABLE_EVIDENCE, NOT_A_HANDOFF_STAGE).

Two historical facts of #80 are encoded explicitly, not guessed:

- **Sender spellings.** The Claude role has signed as `claude-code` and
  `claude-worker`. `SENDER_ALIASES` matches exactly those and caps confidence
  at MEDIUM.
- **Revision rule.** Revision equality applies only where a revision is
  claimed: an ACK's head, a RETURN's `reviewed_head`, and a receipt.
  Implementation RETURNs report the head they produced (`PRODUCED_HEAD`).

Every body is read through `scripts/agent-control/lib/control-envelope.mjs`
unchanged. An edited or malformed comment is not usable evidence. An edited
comment from an allowlisted author makes the authority record show
AUTHORITY_EDITED. An amended autopilot status shows as AMENDED_BOT_STATUS, not
as edited authority.

**Provenance.** Every message on #80 is posted by the one `SaCH-PRO` account,
whichever agent wrote it. The page shows the GitHub account and the claimed
sender/model side by side, and says the latter are self-reported. There is no
model-identity verification.

**Worker availability** is UNKNOWN / NOT_CONNECTED in H1. The hosted
autopilot's `claude is not on PATH` describes the GitHub runner, not the local
worker.

## Owners and files

| Concern | Path |
|---|---|
| projector (pure; the one implementation) | `scripts/agent-control/lib/handoff-projector.mjs` |
| collector + cached monitor (GET-only) | `scripts/agent-control/lib/handoff-collector.mjs` |
| fixture transport (tests, CLI, loopback) | `scripts/agent-control/lib/handoff-fixture-transport.mjs` |
| CLI JSON snapshot | `scripts/agent-control/handoff-snapshot.mjs` |
| endpoint | `apps/server/src/modules/admin-platform/handoff-monitor.controller.ts` (`GET /api/admin/mission-control/handoffs`, `AuthGuard` + `AdminGuard`) |
| service (loads the shared modules) | `apps/server/src/modules/admin-platform/handoff-monitor.service.ts` |
| page, components, client | `apps/web/src/app/admin/mission-control/handoffs/`, `apps/web/src/lib/api/handoff-monitor.ts` |
| fixtures | `scripts/agent-control/fixtures/handoff-irp177.json` (real #177 chain, verbatim public comments), `handoff-hostile.json` (synthetic) |

### Reintegration with PR #146 and PR #172

PR #146 (`1190c223`, Atlas stack, draft and conflicted) registers
`ProjectMissionControlController` at the bare `api/admin/mission-control`
route, has its own GitHub `fetch` helper and token variables, and adds the page
`/admin/mission-control`. None of it is merged here. This work owns only the
`/handoffs` sub-path, the `HandoffMonitor*` classes and the separate client
file, so the routes, controllers and client modules do not collide.

When #146 is integrated:

- keep both controllers in `AdminPlatformModule`, or move this GET into
  #146's controller as `@Get('handoffs')`, but not both;
- make #146's GitHub reader use `handoff-collector.mjs`, its request
  allowlist and transport, instead of a second reader of the same API;
- link `/admin/mission-control` to `/handoffs` and keep one nav entry.

PR #172 (`49c85968`) is the future owner of local worker observation
(`worker-status.mjs`, `lib/worker-observation.mjs`). H1 renders no worker
state. H2 should feed validated telemetry from that owner into `worker`,
replacing UNKNOWN, rather than add a second worker reader.

## Configuration

| Variable | Effect |
|---|---|
| `KEYFLOW_HANDOFF_MONITOR_GITHUB_TOKEN` | read credential for live mode. Absent means NOT_CONFIGURED: the monitor is off and makes no request. The token is sent only in the `Authorization` header to `api.github.com`, and is never returned or logged |
| `KEYFLOW_HANDOFF_MONITOR_FIXTURE` | path to a fixture file; loopback proof only, refused when `NODE_ENV=production` |
| `KEYFLOW_HANDOFF_MONITOR_REFRESH_MS` | server refresh target, clamped to 10 s–10 min (default 30 s) |
| `KEYFLOW_REPOSITORY_ROOT` | where `scripts/agent-control` lives, if not found by walking up from the server |

No hosted environment has these set, and none should be set without a
separate authorization.

## Collection and freshness

- **Requests.** GET only, to `issues/80`, `issues/80/comments` and `pulls/<n>`
  of this repository, enforced by `allowedRequest()` before every request,
  next-page links included.
- **Refresh cadence.** Demand-driven: a request refreshes the cache when it
  is older than the refresh target, and concurrent requests share one
  refresh. The browser polls about every 15 s while the tab is visible and
  pauses when it is hidden.
- **Full vs incremental passes.** A full paginated pass runs at start and
  every 10 minutes, and detects deletions. In between, an incremental `since`
  pass with a 5-minute overlap picks up edits. When the issue's comment count
  disagrees with what was read, a full pass runs at once.
- **Separate timestamps.** Source event times, `last_success_at`,
  `last_attempt_at`, `generation` and `coverage` are reported separately. A
  failed or partial collection never advances `last_success_at`, and the last
  good snapshot is kept and shown as DEGRADED, then STALE (after 3 minutes). A
  304 confirms a fetch (`confirmed_unchanged_at`) without touching event times
  or the generation.
- **Errors.** Backoff is exponential, and on a rate limit it waits until the
  reset. Error text has known credential patterns redacted.
- **Cache.** In process memory only. A restart starts empty and rebuilds on
  the next request. No database schema is involved.

## Running it

CLI over a fixture, or live with a read token in the environment:

```sh
node scripts/agent-control/handoff-snapshot.mjs --fixture=scripts/agent-control/fixtures/handoff-irp177.json --task=6229439023
node scripts/agent-control/handoff-snapshot.mjs --live --task=6229439023   # KEYFLOW_HANDOFF_MONITOR_GITHUB_TOKEN or GH_TOKEN
```

The loopback proof uses fixtures only: no database, Redis, scheduler or
provider. First install, build the workspace packages and the server
(`pnpm install`, `pnpm db:generate`, the `@keyflow/shared`, `@keyflow/db` and
`@keyflow/api` builds, then `cd apps/server && pnpm build`). Then:

```sh
# 1. The compiled handoff route alone, on 127.0.0.1:3101.
node apps/server/test/handoff-monitor-loopback.cjs \
  --fixture=scripts/agent-control/fixtures/handoff-irp177.json,scripts/agent-control/fixtures/handoff-hostile.json \
  --port=3101 --web-origin=http://127.0.0.1:5055 --tokens-out=/tmp/handoff-tokens.json
#    (or add --self-test to check the endpoint without a browser and exit)

# 2. The web app pointed at it.
cd apps/web && NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3101 npx next dev --webpack -H 127.0.0.1 -p 5055

# 3. The browser proof: the real page against the real endpoint, no mocks.
cd apps/web && E2E_NO_SERVER=1 E2E_BASE_URL=http://127.0.0.1:5055 \
  HANDOFF_LOOPBACK_TOKENS=/tmp/handoff-tokens.json HANDOFF_SCREENSHOT_DIR=/tmp/handoff-shots \
  npx playwright test e2e/admin-handoffs.spec.ts --workers=1
```

To look at the page by hand, put the SUPER_ADMIN token from the tokens file in
`localStorage` as the admin login does (`kf_admin_token`,
`kf_admin_user_cache` with `role: "SUPER_ADMIN"`, `kf_auth_mode=admin`). The
loopback signs tokens with a random per-run secret, so they are worthless
anywhere else. The app shell's offline banner on the loopback is expected,
because the other APIs it polls are not running.

## Proof

| Proof | Command |
|---|---|
| projector/collector acceptance matrix | `node --test scripts/agent-control/tests/handoff-monitor.spec.mjs` |
| endpoint through the real AuthMiddleware and guards, cold and warm cache | `cd apps/server && npx vitest run src/modules/admin-platform/handoff-monitor.controller.spec.ts` |
| compiled server + default ESM loader | `node apps/server/test/handoff-monitor-loopback.cjs --fixture=... --self-test` |
| browser | `apps/web/e2e/admin-handoffs.spec.ts`. It skips without the loopback, and CI does not run web e2e |
| negative controls, collector/projector | `NC-HANDOFF-*` in `scripts/agent-control/negative-controls.yaml` (CI, Windows worker proof) |
| negative controls, endpoint guards | `node scripts/proof-admission/negative-controls.mjs --manifest scripts/proof-admission/manifests/handoff-monitor-negative-controls.json` |

## Limits (H1)

- **Production image.** It copies only `apps/server/dist`, so the shared
  modules are absent and the endpoint answers UNAVAILABLE. Shipping the
  monitor needs a separately authorized packaging decision (copy
  `scripts/agent-control/lib` into the image, or build the modules into the
  server).
- **Deletions.** A deleted comment is found only by a full pass or a count
  mismatch. Before that, the snapshot can still show it, and the coverage line
  says when the last full pass ran.
- **Telemetry.** There is no local worker telemetry (H2) and no alert
  transport (H3).
- **Receipts.** No ChatGPT daemon or receipt is ever produced. A RETURN stays
  "awaiting chatgpt consumption" until ChatGPT posts a reply that names it.
- **Redaction** covers common token formats only; it is not a secret detector.
