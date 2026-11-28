# Owner question format

Procedural memory. How the orchestrator asks the owner for a decision and records the answer.

## Rules

1. **Batch.** Collect questions in `ORCHESTRATOR-STATE.md` section 4 and ask them together. Interrupt the owner
   with a single question only when work is blocked and no safe default exists.
2. **Keep working.** Apply the safest default meanwhile (the one that exposes least and is easiest to reverse),
   say which default is applied, and carry on with everything that does not depend on the answer.
3. **Recommendation first, plain language.** No packet ids or file paths in the question itself unless the owner
   needs them. Say what a user of the product would see under each option.
4. **Record at once.** When the owner answers, post the ruling on the active control room (issue #273; archived
   predecessor: #80 at GitHub's 2,500-comment cap — roll over to a new control-room issue at 2,350 comments) as the next
   D-nnn in the same turn, then put it in `docs/reconstruction/BUILD-MAP-001.md` (and any new packet in
   `V1-PLAN-RECUT.json`) in the next rulings commit. Until that commit is on main, list the ruling in
   `ORCHESTRATOR-STATE.md` section 2.
5. **Never infer a ruling.** An old ruling on a similar question, or a reviewer's opinion, is not an answer. The
   one case where silence counts is the one D-222 gives: a recommended ruling the owner has not answered within 48
   hours is taken as PROVISIONAL and may be reversed. Record it as PROVISIONAL, with the date asked, and never use
   it for a Release 0 evidence change. A ruling given in conversation that is not yet on #273 is not durable:
   record it before acting on it.

## Template (one per question, numbered, sent together)

```text
<N>. <The decision, as a question, in one sentence.>
Recommended: <option>, because <one sentence>.
Other option(s): <option> - <what changes for the business owner or their customer>.
If you do not answer: <the default being applied now>, which is reversible by <how>.
Why now: <what it blocks, or "nothing is blocked">.
```

## Recording template (issue #273, then BUILD-MAP-001.md)

```text
D-<nnn> | <Short name>: <the ruling in the owner's terms, complete enough to apply without the conversation>. (owner ruling <date>, <where it was given>) | <packets created or affected>
```

Number in one sequence: read the last D-nnn on issue #273 (the newest comments; earlier rulings live on archived #80),
in `BUILD-MAP-001.md` and in `ORCHESTRATOR-STATE.md` section 2 before choosing the next number; #273 is the one that is
always current. A withdrawn ruling keeps its number and is marked withdrawn (D-247 is an example); it is never reused or
deleted.
