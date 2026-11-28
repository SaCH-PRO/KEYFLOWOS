# Checklists (repeatable, any tool)

Every recurring task, broken into steps. Each step is one action with a check you can see.

- Copy the checklist for your task into your CLAIM or RETURN, and tick each box only when its check passed.
- A step you cannot do is a HANDOFF (see `BOARD.md`), never a silent skip.
- The checks come from what went wrong in this programme (B-programme-tooling-and-lessons, the November lessons in
  `ORCHESTRATOR-STATE.md` section 5).

How each step is done is in `LIVE-PROOF-RUNBOOK.md` ("runbook") and `WAVE-RUNBOOK.md`. This file says what must be true.

## A. Start of any session (every tool, every time)

- [ ] Read `BOARD.md` at the root of branch `coord/board`, the latest `ORCHESTRATOR-STATE.md`, and #273 (active control
      room; #80 is archived at the 2,500-comment cap; roll over to a new issue at 2,350 comments) since your last visit.
- [ ] Find your lane's rows on the board. Work only on items your lane owns, or unowned items you claim (step B1).
- [ ] Check the services: `pg_isready` and `redis-cli ping` (restart them if down). Check `node -v` matches `.nvmrc`.
- [ ] If an item you own says HANDOFF to you, read its handoff comment before touching its branch.

## B. Packet (one P0–P3 item of the v1 plan)

1. **Claim.**
   - [ ] The packet has `"track": "launch"` in the plan (D-263), or the owner assigned it to you on #273 (the board
         only mirrors an owner's assignment; a lane never gives itself a follow-on packet).
   - [ ] `git ls-remote origin refs/heads/pkt/V1-<ID>` prints nothing.
   - [ ] Create the branch on the right base (main, or the stack top it depends on), and make a claim commit no
         other lane can make:
         `git switch -c pkt/V1-<ID> <base> && git commit --allow-empty -m "claim <ID> <lane> $(date -u +%FT%T.%NZ)"`
   - [ ] Push it so that it is refused if the branch exists (one line):
         `git push --force-with-lease=refs/heads/pkt/V1-<ID>: origin HEAD:refs/heads/pkt/V1-<ID>`
   - [ ] `git ls-remote origin refs/heads/pkt/V1-<ID>` prints your own `git rev-parse HEAD`. If the push was refused,
         or the sha is not yours, another lane owns the packet: pick another, and never delete or force-push its
         branch.
   - [ ] Post a CLAIM on #273. Set the board row to your lane and `claimed`.
2. **Read.**
   - [ ] Run `node scripts/agent-memory/bundle.mjs <ID> --ref <plan ref>`: scope, definition of done, write set,
         Release 0 rows.
   - [ ] Read every file in the write set, and every caller of what you will change.
   - [ ] List every entry point to the behaviour (a second button, panel or route that does the same thing). On
         2026-11-24 a second "New Quote" button was missed.
3. **RED.**
   - [ ] Write the tests named in the definition of done, and a browser spec if one is named.
   - [ ] Run them. Each RED case fails for its stated reason (read the message), and each control passes.
   - [ ] Run the test file's **exit code**: 0 apart from the intended failures, with no "Errors" or "Unhandled"
         lines.
   - [ ] Commit the tests only (`... RED ... (tests only)`) and push.
4. **Fix.**
   - [ ] Change only write-set files. Any other file is a departure: note it and say why.
   - [ ] The touched folders pass with **exit code 0**, and no "Errors" line.
   - [ ] Web: a type check that really runs, with **0 errors**: `tsc --noEmit` in a real install, or
         `tsc --noEmit -p tsconfig.json --types node` in a worktree with symlinked `node_modules`. There, plain
         `tsc` stops at "Cannot find type definition file for 'next'" (TS2688) and checks nothing: on 2026-11-24 it
         hid four real errors that broke the production build. eslint 0 on changed files. Server: tsc.
   - [ ] Commit the fix and push.
5. **Prove (D-265).**
   - [ ] Every packet: the tests of every folder it touched (exit code 0) and the type check, at the final head.
   - [ ] UI change: a live or mocked browser run, RED at the base build and green at the head, at every width the
         layout changes. Check 375, 768, 1024 and 1440, not only two.
   - [ ] A Release 0 bound suite (`release0-edited-suites.json`) or a manifest-bound file changed: `proof:release0`
         at the packet head as well (runbook §1).
   - [ ] The full server suite and `proof:release0` otherwise run at the wave head (checklist C).
6. **Review.**
   - [ ] Two fresh reviewers (security/tenancy/process; correctness/regression), each in a detached worktree.
   - [ ] Each reviewer gets the bundle, the diff range and your claims, never your conclusions.
   - [ ] Every CRITICAL and MAJOR is closed tests-first (a tests-only commit, then the fix), or ruled out of scope by
         the owner. Every other real finding is fixed, or listed as open in the RETURN.
   - [ ] A confirmation review of the repair delta. No commits after the last review.
7. **Never**, at any step: production or staging, real provider traffic, a weakened or skipped test or gate, a
   Release 0 evidence edit without an owner ruling (an `r0_register` AMEND), fabricated evidence, secrets in chat or
   code.
8. **Return.**
   - [ ] Post a RETURN on #273: branch, head, RED and fix shas, files, departures, the proof totals as printed,
         review verdicts and how each finding closed, and what is open.
   - [ ] Set the board row to `returned`. Update `ORCHESTRATOR-STATE.md` section 3. Push both.

## C. Wave (packets that are returned, to one PR)

- [ ] Every packet in the wave is `returned`, with both reviews and a confirmation accepted at its head.
- [ ] Packets built by another session or lane: your own two-lens acceptance review at the packet head (D-241,
      `ACCEPTANCE-REVIEW-BRIEF.md`), with its findings closed, before the packet enters the wave.
- [ ] Cut the wave branch from current `origin/main` in a **new, empty** worktree. Check the path does not exist
      first.
- [ ] Compact two commits per packet (WAVE-RUNBOOK §1). For stacked packets, take each packet's delta over the
      previous tip.
- [ ] `git diff <stack top> HEAD` prints nothing. `.agent-control` matches main.
- [ ] `scripts/check-branch-divergence.sh origin/main HEAD --max-commits 25 --max-files 50` says OK, or split the
      wave.
- [ ] Run a secret scan over the changed files. Push.
- [ ] Wave-head proof: server tsc, build, suite, Release 0 (R0 EXIT GATE MET, exact-head receipt); web typegen,
      tsc, vitest (exit 0), lint `--max-warnings 26`. Run the live journeys the packets touch.
- [ ] Open the PR from the template, with the totals as printed. Set the board row to `pr-open`.

## D. Merge (D-239; one at a time, in the board's merge order)

- [ ] The board's merge order says it is this PR's turn, and every PR before it is merged. The order is the owner's
      (D-272); only an owner ruling changes it.
- [ ] Merge current main into the wave if main moved. Re-run checklist C's proof at the new head.
- [ ] CI is green at the **exact** head sha: every required check finished, none pending.
- [ ] Both reviews accept at that head (a confirmation review if anything changed since).
- [ ] Head sha, mergeability and the scope ledger (packets and files) are re-verified.
- [ ] Merge with a merge commit (not squash, not rebase), with the expected head sha pinned.
- [ ] After: `node scripts/agent-memory/status.mjs`, rewrite `ORCHESTRATOR-STATE.md`, update the board, post
      PROGRESS on #273.
- [ ] Never: a production deploy (the owner's step, D-266), a staging change, or bypassing a gate.

## E. Handoff (a limit is near, or the lane is stopping)

- [ ] Everything committed is pushed: `git status` is clean and the branch head equals the remote.
- [ ] Each item you own has, on the board: its exact head, the last step done, and the next step written as a
      command or a checklist line.
- [ ] Post a HANDOFF on #273 naming the item, the receiving lane (or "any lane"), and the board row.
- [ ] Note anything running (a suite, a review) as "running, result not recorded": the next lane re-runs it.

## F. Review by an advisory model (ChatGPT, Kimi or Gemini in a browser)

- [ ] The owner pastes the RETURN and the diff range into the advisory model.
- [ ] The owner relays its findings to #273 as a REVIEW (advisory), and the owning lane triages each one: fix it
      tests-first or answer it.
- [ ] An advisory review is extra, never one of the two required reviews.
