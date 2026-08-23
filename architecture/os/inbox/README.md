---
kind: inbox
writers: [audit-cycle, uptime-monitor, any-probe]
---

# Findings inbox

Runtime findings land here as append-only JSONL, one file per source per day:
`<source>-<YYYY-MM-DD>.jsonl`. The audit cycle drains this directory to zero
every run — a file that survives two audit runs is itself a finding.

## Line schema

```json
{"ts":"2026-08-23T06:11:02Z","source":"uptime-monitor","severity":"fail","check":"healthz.commit","detail":"deployed 8a740f12 != origin/main 3f431dd3","evidence":"curl -s https://keyflowos.com/api/healthz | jq .commit"}
```

- `ts` — ISO 8601 UTC.
- `source` — producer id (`audit-cycle`, `uptime-monitor`, `probe-routes`, …).
- `severity` — `info | warn | fail`, matching DiagnosticsService's
  pass/warn/fail CheckResult vocabulary (pass is not reported; absence of a
  finding is the pass).
- `check` — stable dot-case id; the audit cycle keys escalation on it
  (same `check` failing 2 consecutive runs escalates, mirroring
  uptime-monitor's 2-consecutive-failures rule).
- `detail` — human sentence.
- `evidence` — a re-runnable command. The derivation-command rule extended to
  runtime: a finding you cannot re-run is an anecdote, not a finding.

## Triage (audit playbook §4)

| severity | Disposition |
|---|---|
| fail | GitHub issue labeled `runtime-finding` + STATE.md §Runtime row |
| warn | STATE.md §Runtime row + journal |
| info | journal only |

Processed files are deleted in the same commit that records their triage.
An empty inbox while probes were unreachable is a `fail`, never "all clear"
(gate-vacuity, runtime edition).
