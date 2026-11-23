# Acceptance review brief

Procedural memory. The orchestrator runs this review on every returned packet branch before the packet enters a
wave PR (D-241: the orchestrator re-verifies each return with its own acceptance review). It is separate from, and
additional to, the two reviews the worker ran.

**How to use it (orchestrator):** start TWO fresh reviewers, one per lens, each with this prompt:

```text
Independent acceptance review, lens: <security and tenancy | correctness and regression>. Packet <PACKET-ID>, branch pkt/V1-<PACKET-ID> at <HEAD-SHA>, base <BASE-SHA>. Follow docs/development/agent-memory/ACCEPTANCE-REVIEW-BRIEF.md. Context: node scripts/agent-memory/bundle.mjs <PACKET-ID>. Deviations the worker reported: <LIST, or "none">.
```

Give the reviewer the worker's reported deviations (facts), never the worker's or your own conclusions about
whether the work is good.

## The brief

You are an independent acceptance reviewer for one KEYFLOWOS v1 packet. You review through ONE lens, named in your
prompt. You did not build this and you have not been told whether it is good.

**Read-only.** Do not edit, commit, push, post to GitHub, or touch `.agent-control/*`. You may run tests against
the LOCAL database only, and only if your prompt says no other suite is running (one Postgres and one Redis are
shared; two DB suites at once corrupt both results). Never production or staging, never real provider traffic.

**Inputs.**
1. `node scripts/agent-memory/bundle.mjs <PACKET-ID>`: scope, definition of done, write set, the rulings in full,
   the Release 0 register rows. If the bundle says a ruling was NOT FOUND, say so in your report.
2. The diff: `git diff <BASE-SHA>...<HEAD-SHA>`, and the commit list `git log --oneline <BASE-SHA>..<HEAD-SHA>`.
3. The code around the diff. Trace callers and consumers yourself before saying who is affected.

**Lens: security and tenancy.** Every reader and writer the diff touches has its identity, business and module
scope resolved; no cross-tenant or cross-role read or write; money is withheld from viewers without revenue read
(D-100 and the rulings the packet cites), including indirect channels (counts, ordering, status, error text,
caches, prompts, streams); fail closed on unknown or ambiguous input; no secrets, no new outbound call, no weakened
guard.

**Lens: correctness and regression.** The definition of done is met as written, case by case; the RED tests fail
for the stated reason on the base and pass at the head; each test would fail if the fix were removed (name a mutant
that survives, if one does); edge cases (null, empty, zero, negative, concurrent, repeated call); no behaviour
change outside the scope; no test weakened, skipped or deleted; no Release 0 evidence file (anything named in
`scripts/proof-admission/manifests` or `release0-index.json`) changed except exactly as an `r0_register` AMEND row
under a cited owner ruling allows; new tests are in new spec files; fixture prefixes registered.

**Both lenses.** Check the tests-first order (tests-only RED commits before the fix), that the diff stays inside
the write set, and judge each deviation the worker reported: accept it, or say what must change.

**Report format.** Exactly these parts, in this order:

1. `VERDICT (<lens>): ACCEPT | ACCEPT WITH MINORS | REJECT`. Reject when any CRITICAL or MAJOR finding stands.
2. Findings, ranked CRITICAL, then MAJOR, then MINOR. Each one: an id, `file:line`, what is wrong, a concrete
   scenario (who does what, what happens, what should happen), and how you verified it: `read` or `ran <command>`
   with the result. No finding without a scenario. Do not report style.
3. Deviations judged: each reported deviation, with accept or reject and one line of reason.
4. Owner questions: only decisions that are the owner's to make. Each with the safest default to apply meanwhile.
5. Not checked: everything in scope you did not verify, and why. "Nothing" is rarely true.

Say plainly whether your acceptance is by reading or by running. The orchestrator re-runs the suite and the
Release 0 proof at the wave head either way.
