# Checklists (repeatable, any tool)

Every recurring task, broken into steps. Each step is one action with a check you can see.

- Copy the checklist for your task into your CLAIM or RETURN, and tick each box only when its check passed.
- A step you cannot do is a HANDOFF (see `BOARD.md`), never a silent skip.
- The checks come from what went wrong in this programme (B-programme-tooling-and-lessons, the November lessons in
  `ORCHESTRATOR-STATE.md` section 5).

How each step is done is in `LIVE-PROOF-RUNBOOK.md` and `WAVE-RUNBOOK.md`. This file says what must be true.

## A. Start of any session (every tool, every time)

- [ ] Read `docs/reconstruction/handoff/BOARD.md`, the latest `ORCHESTRATOR-STATE.md`, and #80 since your last
      visit.
- [ ] Find your lane's rows on the board. Work only on items your lane owns, or unowned items you claim (step B1).
- [ ] Check the services: `pg_isready` and `redis-cli ping` (restart them if down). Check `node -v` matches `.nvmrc`.
- [ ] If an item you own says HANDOFF to you, read its handoff comment before touching its branch.

## B. Packet (one P0–P3 item of the v1 plan)

1. **Claim.**
   - [ ] `git ls-remote origin refs/heads/pkt/V1-<ID>` prints nothing.
   - [ ] Create the branch on the right base (main, or the stack top it depends on) and push it.
   - [ ] Post a CLAIM on #80. Set the board row to your lane and `claimed`.
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
   - [ ] Web: `tsc --noEmit` (only the known 'next' type error allowed) and eslint 0 on changed files. Server: tsc.
   - [ ] Commit the fix and push.
5. **Prove (D-265).**
   - [ ] UI change: a live or mocked browser run, RED at the base build and green at the head, at every width the
         layout changes. Check 375, 768, 1024 and 1440, not only two.
   - [ ] Server, a Release 0 bound suite, or a manifest-bound file changed: the full server suite plus
         `proof:release0` at the head (runbook §1).
   - [ ] Otherwise these run at the wave head (checklist C).
6. **Review.**
   - [ ] Two fresh reviewers (security/tenancy/process; correctness/regression), each in a detached worktree.
   - [ ] Each reviewer gets the bundle, the diff range and your claims, never your conclusions.
   - [ ] Every MAJOR is closed tests-first (a tests-only commit, then the fix), or ruled out of scope by the owner.
   - [ ] A confirmation review of the repair delta. No commits after the last review.
7. **Return.**
   - [ ] Post a RETURN on #80: branch, head, RED and fix shas, files, departures, the proof totals as printed,
         review verdicts and how each finding closed, and what is open.
   - [ ] Set the board row to `returned`. Update `ORCHESTRATOR-STATE.md` section 3. Push both.

## C. Wave (packets that are returned, to one PR)

- [ ] Every packet in the wave is `returned`, with both reviews and a confirmation accepted at its head.
- [ ] Cut the wave branch from current `origin/main` in a **new, empty** worktree. Check the path does not exist
      first.
- [ ] Compact two commits per packet (runbook §1). For stacked packets, take each packet's delta over the previous
      tip.
- [ ] `git diff <stack top> HEAD` prints nothing. `.agent-control` matches main.
- [ ] `scripts/check-branch-divergence.sh origin/main HEAD --max-commits 25 --max-files 50` says OK, or split the
      wave.
- [ ] Run a secret scan over the changed files. Push.
- [ ] Wave-head proof: server tsc, build, suite, Release 0 (R0 EXIT GATE MET, exact-head receipt); web typegen,
      tsc, vitest (exit 0), lint `--max-warnings 26`. Run the live journeys the packets touch.
- [ ] Open the PR from the template, with the totals as printed. Set the board row to `pr-open`.

## D. Merge (D-239; one at a time, in the board's merge order)

- [ ] The board's merge order says it is this PR's turn, and every PR before it is merged.
- [ ] Merge current main into the wave if main moved. Re-run checklist C's proof at the new head.
- [ ] CI is green at the **exact** head sha: every required check finished, none pending.
- [ ] Both reviews accept at that head (a confirmation review if anything changed since).
- [ ] Head sha, mergeability and the scope ledger (packets and files) are re-verified.
- [ ] Merge with a merge commit (not squash, not rebase), with the expected head sha pinned.
- [ ] After: `node scripts/agent-memory/status.mjs`, rewrite `ORCHESTRATOR-STATE.md`, update the board, post
      PROGRESS on #80.
- [ ] Never: a production deploy (the owner's step, D-266), a staging change, or bypassing a gate.

## E. Handoff (a limit is near, or the lane is stopping)

- [ ] Everything committed is pushed: `git status` is clean and the branch head equals the remote.
- [ ] Each item you own has, on the board: its exact head, the last step done, and the next step written as a
      command or a checklist line.
- [ ] Post a HANDOFF on #80 naming the item, the receiving lane (or "any lane"), and the board row.
- [ ] Note anything running (a suite, a review) as "running, result not recorded": the next lane re-runs it.

## F. Review by an advisory model (ChatGPT, Kimi or Gemini in a browser)

- [ ] The owner pastes the RETURN and the diff range into the advisory model.
- [ ] The owner relays its findings to #80 as a REVIEW (advisory), and the owning lane triages each one: fix it
      tests-first or answer it.
- [ ] An advisory review is extra, never one of the two required reviews.
