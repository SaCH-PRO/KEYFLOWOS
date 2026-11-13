# Wave 10 (FOLLOW11) packet records — historical note, 2026-11-12

This folder is a historical record. It is not a work queue and nothing in it
is open.

- `w10-packets.json` holds the specs of the 22 wave-10 packets (groups W10-A,
  W10-B and W10-C), as they were written for the build.
- `open-review-findings.json` holds the review findings that were open on the
  wave-10 work-in-progress branch on 2026-11-11 for four of those packets:
  W10-CLAIM-LEASE, W10-REOPEN-REVERSALS, W10-RISC-RESET and
  W10-CORTEX-CHAT-SCOPE.

Both files come from `claude/elegant-curie-7azpsb-wave10-wip` (commit
`f161fc00`). That branch's own README described it as unverified work in
progress; it is not brought here, and none of that branch's code is.

## What happened to it

- All 22 W10 packets landed. They were built, reviewed and repaired, then
  integrated through the wave-10 trial branches and landed at `fb00af1c`
  (trial-Z3, 2026-11-12). They reached `main` with PR #197, merged as
  `f5d58ef7` on 2026-11-12.
- The owner rulings these packets implement are D-102..D-115 in
  `docs/reconstruction/BUILD-MAP-001.md` section (g). Later rulings that
  amend or confirm them (D-116 and on, recorded during wave 11) are in the
  same table.
- The findings listed in `open-review-findings.json` were repaired before
  landing. Each of the four packets carries a review-repair commit on `main`:
  W10-CLAIM-LEASE `c13351a0`, W10-REOPEN-REVERSALS `416696dc`,
  W10-RISC-RESET `2376af18`, W10-CORTEX-CHAT-SCOPE `bde7f02d`. Some repair
  commits number the findings differently from this file (for example
  SEC-W10CCS-1 and -2 here are SEC-W10CCS-R1 and -R2 there, and the
  W10-REOPEN-REVERSALS security findings were renumbered SEC-W10RR-1..3 and
  CR-REOPEN-1..2 in the repair round).

For the code, read `main`; for the rulings, read BUILD-MAP-001. Do not use
this folder as current state.
