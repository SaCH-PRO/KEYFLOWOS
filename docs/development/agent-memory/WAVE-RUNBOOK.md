# Wave runbook

Procedural memory. How the orchestrator turns accepted packet branches into one wave PR and merges it.
Sources: `docs/reconstruction/V1-HANDOFF-2026-11-20.md` sections 2 and 5, rulings D-222, D-239, D-240, D-241,
`.github/workflows/branch-divergence.yml`, and the working rules in `docs/reconstruction/handoff/ORCHESTRATOR-STATE.md`.

## 0. Before a packet enters a wave

- The worker's return names branch, head sha, RED and fix shas, suite totals and the R0 line.
- Both acceptance lenses accept at that exact head (`ACCEPTANCE-REVIEW-BRIEF.md`). A repair pushed after acceptance
  is confirmed by both lenses again (`CONFIRMATION-REVIEW-BRIEF.md`, one reviewer per lens). No commits after the
  last review.
- Its dependencies are on main or earlier in the same wave.

## 1. Compact each packet into two commits

The gate in section 3 counts commits, so a packet's full history stays on `pkt/V1-<ID>` and the wave branch gets
exactly two commits per packet. On the wave branch (cut from origin/main):

```bash
ID=<PACKET-ID>; PKT=origin/pkt/V1-$ID; BASE=$(git merge-base origin/main $PKT)
git diff --name-status $BASE $PKT          # the packet's files; note any D (deleted) rows
```

```bash
# 1) tests-only RED commit: only the spec/test files the packet added or changed
git checkout $PKT -- <test files>
git commit -m "test(<area>): RED for pkt/V1-$ID (compacted)"
```

```bash
# 2) fix commit: every other file of the packet (git rm the deleted ones)
git checkout $PKT -- <all other files>
git commit -m "fix(<area>): pkt/V1-$ID (compacted)"
```

```bash
git diff $PKT HEAD -- <the packet's files>   # must print nothing
```

- The subject form `pkt/V1-<ID> (compacted)` is what `scripts/agent-memory/status.mjs` reads to mark the packet
  done with certainty. Keep it exact.
- **Release 0 evidence edits ride the fix commit**, never the RED commit: a manifest or required-case change (only
  where an `r0_register` AMEND row under an owner ruling allows it) lands together with the code it describes, so
  no commit on main has a manifest that disagrees with its tree.
- `apps/server/test/helpers/fixture-prefixes.json`: when two packets both add rows, the result is the union.
- `.agent-control/*` stays at main's copy in a wave PR: `git checkout origin/main -- .agent-control` before pushing.
- The helper that does this is `scripts/agent-memory/compact.sh <pkt-branch> <PACKET-ID> <scope> [hold-regex]`
  (run from a clean wave worktree; `hold-regex` names Release 0 evidence edits that must ride the fix commit).
- When `compact.sh` stops on a conflict in `fixture-prefixes.json` (two packets appended rows at the same place), run
  `scripts/agent-memory/finish-squash.sh <pkt-branch> <PACKET-ID> <scope>`: it keeps both sides' rows (checks the
  JSON and that no prefix repeats), refuses if any other file conflicts, and makes the same two commits.
- A packet built on another packet's branch (e.g. W11-CASH-READERS-LEDGER on W11-RUNWAY-LEDGER-CASH) conflicts with
  that packet's compacted commit. Compact the base packet first; then take the dependent packet's own files
  (`git diff --name-only <its merge of main> <its tip>`) from its tip, after checking main has not changed them since
  the branch merged it (`git diff <that main> origin/main -- <files>` prints nothing), as one RED and one fix commit.

## 2. Prove the wave head

One suite at a time on the one local Postgres and Redis. Never edit the tree while a suite runs. A run with a real
`ECONNREFUSED` is not a result. Never a production or staging database.

Server, in `apps/server`:

```bash
export PATH=/opt/node-22.23.4/bin:$PATH        # Node 22.23.4, the repo's pin (.nvmrc)
set -a; . /home/user/KEYFLOWOS/.env; set +a     # local DATABASE_URL, DIRECT_URL, REDIS_URL
service postgresql start; service redis-server start   # only if they are down
rm -f dist/.tsbuildinfo
pnpm build
pnpm vitest run                                 # about 15 minutes; run in the background, do nothing else to the tree
pnpm proof:release0 -- --skip-build             # must print: R0 EXIT GATE MET
```

First time in a fresh checkout or worktree, before the above, from the repo root:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @keyflow/shared --filter @keyflow/db --filter @keyflow/api build
pnpm db:deploy
```

`pnpm db:generate` can come back from the turbo cache having generated nothing; the suite then fails across hundreds
of files with `Cannot find module '.prisma/client/default'`. That is a setup fault, not a result: run
`npx prisma generate --schema=./prisma/schema.prisma` in `packages/db`, rebuild the three packages, and run again.

Web (when the wave has web changes), in `apps/web`, with `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_SITE_URL` set:

```bash
npx next typegen
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
pnpm vitest run
pnpm lint --max-warnings 26
```

Plus any browser spec a packet's definition of done names. Server typecheck and lint, when a packet asks for them:
`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` in `apps/server`, and
`pnpm --filter server lint --max-warnings 3343`. The two lint caps are the ones CI uses (`.github/workflows/ci-cd.yml`).

Record the totals exactly as printed (for example "768/768", and the R0 line). A reviewer's acceptance is by
reading unless it says it ran something: these runs are yours.

## 3. The branch-divergence gate: 25 commits, 50 files

`.github/workflows/branch-divergence.yml` fails a PR to main that differs from main by more than 25 commits on
either side or more than 50 files. Check before pushing:

```bash
scripts/check-branch-divergence.sh origin/main HEAD --max-commits 25 --max-files 50
```

At two commits per packet plus merges and review repairs, a wave holds roughly eight to ten packets. If a wave is
over, split it into parts (waves 3a and 3b were each split in two); do not ask for an override.

## 4. The PR

One PR per wave, to main. Body from `.github/pull_request_template.md`: keep its headings (Summary, Related
Issue(s), Changes, Testing, Screenshots / Notes, Checklist) and fill them:

- Summary: the wave name and the packet ids.
- Related Issue(s): #273 (active control room; archived predecessor: #80).
- Changes: one line per packet, with its ruling ids.
- Testing: the commands of section 2 with the totals and the R0 line as printed, and for each packet both review
  verdicts. Tick a template checkbox only for a command you ran.
- Notes: Release 0 evidence edits and their ruling; anything outside a write set; open owner questions.

Scan before every push for secret shapes, provider key formats, password literals and `user:pass@` URLs.

## 5. Merge conditions (D-239, D-240)

The orchestrator may merge a v1 wave PR (D-239), and a small CI repair PR that unblocks a wave (D-240), only when
ALL of these hold, checked immediately before the merge:

1. CI is green at the exact head sha (every required check finished, none pending).
2. Both independent reviews (security-tenancy, correctness-regression) accept at that head.
3. Head sha, mergeability and the scope ledger (which packets, which files) are re-verified.
4. Merge commit (not squash, not rebase), with the expected head sha pinned.

**Once the merge queue is on (D-278).** The repository is `KEYFLOWOS/KEYFLOWOS` (an organization, 2026-11-25), and
FU-CI-MERGE-QUEUE gives every required workflow a `merge_group` trigger. When the owner switches the queue on for
`main`, D-239 reads: the orchestrator *enqueues* a wave once conditions 2 and 3 hold and the head's own checks pass,
and the queue merges it when CI passes on the combined head. Until the owner switches it on, the four conditions
above apply unchanged.

Not covered, ever: a production deploy, a staging change, bypassing a gate or branch rule, merging a packet branch
outside a proven wave PR. Review threads that need the owner stay open for the owner. D-239, D-240 and D-241 are
rows in `BUILD-MAP-001.md` on main: read the rows themselves before relying on this summary.

## 6. After every merge (consolidation)

```bash
git fetch origin main
node scripts/agent-memory/status.mjs      # regenerates V1-STATUS.json and V1-STATUS.md from origin/main
```

Then rewrite `ORCHESTRATOR-STATE.md` (remove the merged row from section 3, set the next action for what it
unblocked), post PROGRESS for the wave on #273 (active control room; roll over to a successor issue at 2,350 comments
per `docs/development/agent-memory/README.md`), and commit the regenerated status and the state file in the next
rulings or wave commit. `README.md` in this folder lists the full consolidation rules.
