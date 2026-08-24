---
kind: playbook
cycle: audit
cadence: "0 1,7,13,19 * * *"   # 6-hourly; the 07:00 run follows truth
budget: 10 minutes; curl + triage, no builds
---

# Audit cycle — probe production, drain the inbox

**The NEVER list of `architecture/os/OS.md` binds this run. Read-only against
production — GET probes only, never a deploy, never a write. Zero reachable
endpoints is a `fail` finding ("I could not see"), never "all clear".**

Write targets (direct to main): `architecture/os/state/STATE.md` §Runtime
rows only, `architecture/os/inbox/**` (deletions), `architecture/os/
journal/**`. This cycle never opens PRs; it opens issues.

Secrets: `PROD_BASE` (e.g. `https://keyflowos.com`) from routine config.
Never echo tokens into logs, findings, or commits.

## Production reachability (two paths)

There are two ways to learn prod health, and step 1 uses whichever is
available — direct if egress allows it, CI otherwise. Neither is assumed:
zero confirmation from *either* path is still a `fail`.

1. **Direct** (needs egress to `keyflowos.com` + `api.keyflowos.com`): full
   probing including the commit-drift check. The cloud routine's egress does
   NOT reach these today — the 2026-08-24T01:02Z run got `403 Forbidden` on
   `CONNECT keyflowos.com:443` from its own egress proxy (confirmed via
   `$HTTPS_PROXY/__agentproxy/status`). Restore this path by allowlisting the
   two hosts in the cloud environment's egress settings (a human action in
   Claude Code cloud config); it is the only path that yields prod's commit.
2. **Via CI** (needs only GitHub, which this session has — it files issues):
   `.github/workflows/uptime-monitor.yml` probes prod every ~5 min from
   GitHub's runners, and its run *conclusion* is a debounced health signal —
   `scripts/uptime-monitor.sh` exits 1 only after 2 consecutive failures, 2 on
   misconfig, 0 otherwise (verified 2026-08-24; recent runs all `success`).
   Step 1b reads it with `gh run list`. This confirms up/down but NOT prod's
   deployed commit, so the commit-drift check is unavailable until path 1 is
   restored.

## Steps

1. Prod health — try direct, fall back to CI:
   a. **Direct probe** — skip to (b) if egress to `$PROD_BASE` is blocked (a
      `403` / `connect_rejected` on CONNECT, per `$HTTPS_PROXY/__agentproxy/status`):
      - `curl -s $PROD_BASE/api/healthz` → assert `.commit` equals
        `git ls-remote origin main | cut -f1` (the assertion deploy.sh makes
        once, made continuously). Mismatch older than one deploy window →
        `warn` finding `healthz.commit`.
      - `curl -s -o /dev/null -w '%{http_code}' $PROD_BASE/api/readyz` → 200,
        else `fail` finding `readyz.status`.
      - `curl -s $PROD_BASE/api/healthz/events` → queue counts; waiting+delayed
        > 200 → `warn`; failedCount > 0 → `warn` finding
        `queue.business-events.failed`.
      - Diagnostics (only if `ADMIN_BEARER` is configured — AuthGuard +
        super-admin): `curl -s -H "Authorization: Bearer $ADMIN_BEARER"
        $PROD_BASE/api/diagnostics/infrastructure` → any check `fail` →
        `diagnostics.<check name>`; watch `Token Encryption Key Source`, the
        evidence gate for the packages/db prod guard. No secret → `info`
        `diagnostics.unprobed` (an unprobed surface is recorded, never assumed
        healthy).
   b. **CI fallback** — egress blocked. Derive prod health from the uptime
      monitor: `gh run list --repo <owner/repo> --workflow uptime-monitor.yml
      --limit 5 --json conclusion,status,createdAt,databaseId`. Take the most
      recent `status: completed` run:
      - `conclusion: success` AND `createdAt` within 30 min → prod healthy →
        `info` finding `prod.health.via-ci` (journal only), quoting the run id
        and time. This REPLACES `prod.unreachable`: health was confirmed, just
        indirectly, so it is NOT a fail.
      - `conclusion: failure` → prod may be down ≥10 min OR the monitor is
        misconfigured. `gh run view <id> --log | tail -40` to distinguish
        (uptime-monitor.sh exit 1 = prod down; exit 2 = missing
        `PROD_BASE_URL`). File `fail` `prod.down.via-ci` (real outage) or
        `warn` `uptime-monitor.misconfig`, citing the run.
      - No `completed` run within 30 min → the watcher itself is dark → `warn`
        `uptime-monitor.stale`.
      - Commit-drift is unavailable on this path → `info`
        `commit-drift.unavailable` (journal): restore by allowlisting egress.
      - `gh` unavailable too → neither path works → `fail` `prod.unreachable`
        (the original blind-probe finding).
2. Route parity (direct path only — SKIP entirely if step 1 fell back to CI;
   the oracle must hit prod's routes and has no CI substitute): probe every
   row of `architecture/os/state/ROUTE_PARITY.md` § Ledger with
   `node scripts/os/probe-routes.mjs --base $PROD_BASE/api --routes <tmpfile>`.
   - A ledgered path now answering 401/200 → the endpoint SHIPPED: journal
     "candidate for removal" (burndown shrinks the ledger).
   - Exit 2 (oracle blind) on the DIRECT path (egress was expected to work but
     a control misbehaved) → `fail` finding `probe.oracle-blind`; stop
     trusting this section. On the CI path this step is skipped, not failed —
     journal `route-parity.skipped-no-egress` (`info`), do not re-file
     `probe.oracle-blind` every run for a known egress gap.
3. Write findings as JSONL lines to
   `architecture/os/inbox/audit-cycle-<date>.jsonl` per the schema in
   `architecture/os/inbox/README.md`.
4. Drain the ENTIRE inbox (including files other producers left):
   - `fail` → GitHub issue labeled `runtime-finding` (dedupe: search open
     issues for the `check` id first) + STATE §Runtime row.
   - `warn` → STATE §Runtime row + journal.
   - `info` → journal.
   - Escalation memory: same `check` failing 2 consecutive audit runs →
     issue even at `warn` (mirrors uptime-monitor's 2-failure paging).
5. Delete processed inbox files in the same commit that records their triage.
6. Before every `git commit`: `git diff --cached --name-only` must list
   exactly your intended paths — a shared index sweeps a peer's staged files
   into your commit otherwise (see truth.md §9). `git reset -- <foreign
   paths>` first.
7. Journal (`architecture/os/journal/<date>-audit-<hour>.md`).

## DONE means
Inbox empty; every probe has a journaled result (including "unreachable");
STATE §Runtime timestamps are this run's.
