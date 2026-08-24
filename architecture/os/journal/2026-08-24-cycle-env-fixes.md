---
kind: journal
cycle: maintenance (hand-run, isolated worktree C:/kf-os off origin/main)
date: 2026-08-24
outcome: fixed — both cloud cycles' environment-dependency bugs diagnosed; truth playbook corrected
---

# The loop's first cycles both hit one root cause

The truth and audit cloud routines both ran overnight and both stopped short —
and the reason is the same: **the cloud routine environment lacks the external
dependencies the cycles' commands assume.**

- **Audit (01:02Z, cf3c9af0):** every prod probe returned unreachable. Cause
  was the session's egress proxy rejecting `keyflowos.com:443` (403 on
  CONNECT), NOT a production outage — the cycle diagnosed this precisely with
  `curl -v` + `$HTTPS_PROXY/__agentproxy/status` and wrote "health unconfirmed"
  instead of "prod down." Verified from an unrestricted machine: prod was
  healthy (healthz 200, ~12d uptime). Filed #64/#65.
- **Truth (07:18Z, f981a2b1):** the gate suite came back 19 files / 5 tests
  failed / 125 skipped, so it stopped and filed #66. But it ran the bare
  `npx vitest run` (default config), which collects the `test/**` integration
  and e2e suites that need Postgres + Redis. The cloud container has neither,
  so those suites' `beforeAll` threw → vitest's "skipped" → false red. Verified
  from an unrestricted machine: `pnpm test:unit` (the DB-free `src/**/*.spec.ts`
  config, all structural gates) passes 3475/0/0. **Main is not red.**

## What was fixed (this run)

- `truth.md` step 2: add the explicit `pnpm --filter @keyflow/db db:generate`
  the cycle had to discover — `turbo.json` declares it but the `--filter build`
  invocations bypass turbo's graph.
- `truth.md` step 3: run the DB-free unit config (`pnpm test:unit`), not the
  full `npx vitest run`. All structural/ledger gates live in `src/**/*.spec.ts`
  and need no DB; the integration/e2e suite is CI's job (CI provisions the DB).
  This also realigns the "quote the shuffle seed" instruction, which only the
  unit config actually satisfies (the default config has no shuffle — the truth
  cycle correctly noticed and recorded that mismatch).
- `audit.md`: **implemented option 2** (a later pass). Step 1 now tries the
  direct probe and, when egress is blocked, falls back to reading prod health
  from the `uptime-monitor.yml` workflow's most recent run conclusion via
  `gh run list` — a path the cloud session already has. Verified the signal is
  real: `scripts/uptime-monitor.sh` exits 1 only after 2 consecutive failures
  (debounced), 2 on misconfig, 0 otherwise, and the workflow's recent runs are
  all `success` at ~11-13 min cadence. The fallback confirms up/down but not
  prod's commit, so the commit-drift check stays a direct-path-only capability
  (records `commit-drift.unavailable` when blocked). Route parity is skipped
  (not failed) on the CI path — the oracle has no CI substitute.

## Commit-drift restored without egress (deploy-drift.yml)

The one thing the CI health-fallback could not cover was commit-drift (is prod
running current code?) — the cloud can't read prod's `/healthz.commit`. Closed
it where both halves ARE available: a new daily workflow `deploy-drift.yml`
runs on a GitHub runner (which reaches prod), reads prod's healthz commit, and
compares it to main via the GitHub compare API (`scripts/deploy-drift-check.sh`)
— no local git history, no prod egress from the cloud. Its run conclusion is
the signal the audit reads in step 1b (`success` = current, `failure` =
drifted). Age is the primary threshold (default >7d behind), commit count a
backstop (>200), because commit count is noisy during active development.
Verified locally against real prod both ways: alerts at default thresholds,
silent under generous ones.

**Live finding this surfaced:** prod (`ea9a21fc6dca`) is **~12 days / 52
commits behind main** — the first undeployed commit dates to 2026-08-12. This
is deploy.sh's postmortem shape (it was born from prod sitting 221 commits / 11
days behind). None of today's operating-layer or fix work is deployed. The
drift workflow will flag this every day until a deploy happens; the deploy
decision is the human's.

## Left for the human / follow-up

- The audit egress allowlist (`keyflowos.com` + `api.keyflowos.com` in the
  cloud env) is a settings action only the account owner can take. It is no
  longer blocking — the CI fallback makes the audit useful without it — but
  it is the ONLY path that restores the commit-drift check (prod's deployed
  commit vs origin/main), which nothing else can observe.
- The audit routine PROMPT embeds a "shape of the run" summary that still says
  "probe prod /healthz…"; update it via RemoteTrigger to mention the CI
  fallback, mirroring the truth-prompt fix, so the routine's embedded summary
  agrees with the playbook it also tells the agent to follow.
- The truth routine's PROMPT embeds a summary that also says "run the full gate
  suite (npx vitest run)"; it must be updated via RemoteTrigger to match this
  playbook, or the routine keeps running the DB-dependent config.
- #66 should be updated with this environmental root cause (not a code
  regression) and closed once the prompt+playbook fix is live.

## Corrections
- **Both "the cycle failed" signals were environment, not defect** — same trap
  the audit cycle's own Corrections named ("a blocked host is not a production
  incident"). The general rule now proven twice: a cloud cycle that reports red
  must be reproduced on an unrestricted machine before the red is believed. The
  cycles run on isolated clones (good for hygiene) but that isolation is also
  what strips the DB and the prod-network they assume.
- **The worktree tool can't isolate inside this repo layout** — a worktree
  under `.claude/worktrees/` is nested in the main checkout and git resolves
  its working tree to the parent, so the tool refuses it. An *external*
  worktree (`git worktree add C:/kf-os origin/main`, entered by path) works and
  is what this fix was authored in — off origin/main, clear of the diverged
  local main and the other sessions' uncommitted work.
