# Wave 10 (FOLLOW11) — work in progress, NOT verified

This branch (`wip/wave10`) preserves wave-10 packet work that stopped when the
build agents hit their weekly usage limit (resets 2026-11-16). It is **not**
the version to launch: use `claude/elegant-curie-7azpsb`, which carries only
verified work (full server/web suites, both typechecks, all proof manifests at
the exact head, Release 0 gate MET).

Base: `d08eff32` (trial-X, wave 9 landed). Packet specs: `w10-packets.json`
(owner rulings D-102..D-115 in `docs/reconstruction/BUILD-MAP-001.md`).

| Packet | State on this branch | What remains |
|---|---|---|
| W10-LOW-RUNWAY (D-107) | built, both reviews, repaired | full check, then land |
| W10-QUALIFICATION-PUBLIC (SEC-V123-3) | built, both reviews (accept), repaired | full check, then land |
| W10-DATA-CLEANUP-SCRIPTS (SF-1, D-115) | built, both reviews, repaired | full check, then land |
| W10-REOPEN-REVERSALS (D-102) | built, both reviews | repair the 11 findings in `open-review-findings.json` |
| W10-CLAIM-LEASE (D-103) | built, both reviews | repair the 5 findings |
| W10-RISC-RESET (D-113) | built, both reviews | repair the 6 findings (1 blocking) |
| W10-CORTEX-CHAT-SCOPE (W9 cortex residuals) | partial build, security review only | finish item 4, correctness review, repair (1 blocking) |
| W10-BOOKING-BUFFER (CR-W9KAT-1) | built, not reviewed | both reviews, repair |
| W10-MONEY-SIGNALS-REST (D-100/D-63) | built, not reviewed | both reviews, repair |
| W10-OWNER-MEMBERSHIP (D-104) | partial: 38 fixture-census suites still fail | finish the fixture census, reviews, repair |
| W10-BOOKS-EXPORTS (CR-BSX-03) | partial build (tests-first and part of the fix) | finish, reviews, repair |
| W10-WEB-CLIENT-MISSING-ID, -REFUND-CHARGE-DOOR, -STORE-PAYMENT-INTENT, -WIPAY-KEY (D-105), -PAYPAL-CURRENCY (D-106), -MARKPAID-ACTOR-REQUIRED, -STORE-ORDER-PAID (D-112), -GOOGLE-DOORS-REST (D-99), -KEY-PLAN-SCOPE (D-114), -DISPATCH-STATUS, -ADVISOR-TIMELINE | not started | build, reviews, repair |

The individual packet heads are merged here in that order; each packet's own
commits keep their `test(...) ... tests first` / `fix(...)` messages.
