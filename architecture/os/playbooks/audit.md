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
6. Journal (`architecture/os/journal/<date>-audit-<hour>.md`).

## DONE means
Inbox empty; every probe has a journaled result (including "unreachable");
STATE §Runtime timestamps are this run's.
