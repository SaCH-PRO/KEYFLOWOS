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

## Environment prerequisite (unresolved 2026-08-24)

The cloud routine's egress must allow `keyflowos.com` and `api.keyflowos.com`.
It does not today: the 2026-08-24T01:02Z run got `403 Forbidden` on
`CONNECT keyflowos.com:443` from the session's own egress proxy (confirmed via
`$HTTPS_PROXY/__agentproxy/status`), so every probe returned unreachable and
the cycle correctly filed `prod.unreachable`/`probe.oracle-blind` (#64/#65)
rather than "prod is down" (verified independently: prod was healthy, 200).
Until this is resolved the audit cycle runs but can confirm nothing about
production. Two fixes, in preference order:
1. **Allowlist the two hosts** in the cloud environment's egress settings
   (a human action in Claude Code cloud config). Keeps this playbook intact.
2. **Read health from CI instead of probing prod.** The cloud session *can*
   reach GitHub (it files issues), and `.github/workflows/uptime-monitor.yml`
   probes prod every 5 min from GitHub's runners. Deriving prod health from
   that workflow's recent run conclusions (`gh run list --workflow "Uptime
   monitor"`) needs no prod egress — but first verify `scripts/uptime-monitor.sh`
   exits non-zero on failure, or the run conclusion won't reflect health.

## Steps

1. Health triple:
   - `curl -s $PROD_BASE/api/healthz` → assert `.commit` equals
     `git ls-remote origin main | cut -f1` (the same assertion deploy.sh makes
     once, made continuously). Mismatch older than one deploy window → `warn`
     finding `healthz.commit`.
   - `curl -s -o /dev/null -w '%{http_code}' $PROD_BASE/api/readyz` → 200,
     else `fail` finding `readyz.status`.
   - `curl -s $PROD_BASE/api/healthz/events` → queue counts; waiting+delayed
     > 200 → `warn`; failed > 0 → `warn` finding `queue.business-events.failed`.
   - Diagnostics (only if the `ADMIN_BEARER` routine secret is configured —
     the endpoints sit behind AuthGuard + super-admin):
     `curl -s -H "Authorization: Bearer $ADMIN_BEARER" $PROD_BASE/api/diagnostics/infrastructure`
     → any check `fail` → finding named `diagnostics.<check name>`; pay
     particular attention to `Token Encryption Key Source`, the evidence gate
     for the pending packages/db prod guard. No secret configured → `info`
     finding `diagnostics.unprobed` (an unprobed surface is recorded, never
     assumed healthy).
2. Route parity: probe every row of
   `architecture/os/state/ROUTE_PARITY.md` § Ledger with
   `node scripts/os/probe-routes.mjs --base $PROD_BASE/api --routes <tmpfile>`.
   - A ledgered path now answering 401/200 → the endpoint SHIPPED: journal
     "candidate for removal" (burndown shrinks the ledger).
   - Exit 2 (oracle blind) → `fail` finding `probe.oracle-blind`; stop
     trusting this section's results.
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
