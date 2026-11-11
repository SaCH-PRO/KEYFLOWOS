# Wave 10 (FOLLOW11) — work in progress, NOT verified

This branch (`wip/wave10`) preserves wave-10 packet work in progress. The build
agents hit their weekly usage limit on 2026-11-10; they were available again on
2026-11-11 and the three wave-10 workflows were resumed. It is **not**
the version to launch: use `claude/elegant-curie-7azpsb`, which carries only
verified work (full server/web suites, both typechecks, all proof manifests at
the exact head, Release 0 gate MET).

Base: `d08eff32` (trial-X, wave 9 landed). Packet specs: `w10-packets.json`
(owner rulings D-102..D-115 in `docs/reconstruction/BUILD-MAP-001.md`).

Update 2026-11-11: three packets landed on `claude/elegant-curie-7azpsb`
(trial-Y `b92ed958`). Group C finished: its six packets are built, reviewed
twice and repaired, and merged with one seam fix as `int/trial-Z` (merged
here). That trial branch is in its full check before it lands.

| Packet | State on this branch | What remains |
|---|---|---|
| W10-LOW-RUNWAY (D-107) | landed (trial-Y); second repair round merged here | lands with trial-Z |
| W10-QUALIFICATION-PUBLIC (SEC-V123-3) | landed (trial-Y); second repair round merged here | lands with trial-Z |
| W10-DATA-CLEANUP-SCRIPTS (SF-1, D-115) | landed (trial-Y); second repair round merged here | lands with trial-Z |
| W10-BOOKS-EXPORTS (CR-BSX-03) | built, both reviews accept, no findings | lands with trial-Z |
| W10-BOOKING-BUFFER (CR-W9KAT-1) | built, both reviews, repaired | lands with trial-Z |
| W10-WEB-CLIENT-MISSING-ID | built, both reviews accept, repaired | lands with trial-Z |
| DCS-T07 seam (SEC-W10DCS-1 / CR-W10DCS-1, blocking) | fixed: a D-115 withheld row also needs read on its original module's scope | lands with trial-Z |
| W10-REOPEN-REVERSALS, -CLAIM-LEASE, -RISC-RESET, -CORTEX-CHAT-SCOPE, -MONEY-SIGNALS-REST, -OWNER-MEMBERSHIP | repairs running in the resumed workflows | finish, then integrate |
| W10-REFUND-CHARGE-DOOR, -STORE-PAYMENT-INTENT, -WIPAY-KEY (D-105), -PAYPAL-CURRENCY (D-106), -MARKPAID-ACTOR-REQUIRED, -STORE-ORDER-PAID (D-112), -GOOGLE-DOORS-REST (D-99), -KEY-PLAN-SCOPE (D-114), -DISPATCH-STATUS, -ADVISOR-TIMELINE | building or in review in the resumed workflows | finish, then integrate |

The individual packet heads are merged here in that order; each packet's own
commits keep their `test(...) ... tests first` / `fix(...)` messages.
