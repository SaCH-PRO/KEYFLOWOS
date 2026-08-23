# Cross-session coordination

This repo is routinely worked on by a dozen concurrent Claude sessions. This
directory holds the machinery that stops them destroying each other's work.

## Why it exists

On 2026-08-23 a session finished and verified a change — an edit to
`apps/web/src/lib/api.ts` plus a new passing test file — and both silently
vanished mid-run. `git status` came back clean, as though the work had never
happened. Another session's untracked `probe-*.js` scripts went the same way.

**The cause was not a careless repo-global sweep.** The session responsible had
launched a mapping workflow, saw unexplained source edits appear in a tree it
believed only its own agents were touching, reasonably concluded one had gone
wrong, and ran:

```
git checkout -- apps/web/src/lib/api.ts apps/web/src/lib/__tests__/api-refresh-retry.test.ts
rm -f apps/web/src/lib/__tests__/api-get-dedupe.test.ts
```

Scoped paths. Correct instincts. Work destroyed anyway — because **nothing could
tell it another session owned those files.** That is the gap this guard closes,
and it is why the claim registry matters more than the command blocklist.

A third harm mode showed up the same afternoon, and it is the subtlest of the
three because **no destructive command is involved and both sessions behave
correctly**. The git index is shared by every session in one working tree. One
session runs `git add <its own paths>`; another runs a plain `git commit` — no
`-a`, no `add -A` — and git commits the *whole index*, including the first
session's files, under the second's message.

Verified rather than assumed: commit `35f42129` ("the truth playbook runs on
Linux too") contains one intended file plus four that another session had merely
staged, and *none* of the dozen other dirty files a repo-global `add` would have
swept. That commit is also why the session whose files were taken saw
`git diff --cached` come back empty moments after staging them — the index had
already been consumed.

`git add -A` is guarded too, but note it was **not** what happened here. Both of
this guard's original theories about how work goes missing turned out to be
wrong; the checks below are built on what was actually reproduced.

## What is enforced

`session-guard.mjs` runs as a `PreToolUse` hook (wired in `.claude/settings.json`).

| Guard | Trigger | Decision |
|---|---|---|
| Targeted revert/delete of a peer's file | `git checkout -- <path>` / `git restore <path>` / `git clean -f <path>` / `rm` / `mv` naming a file (or parent dir) another live session claims | **ask**, naming the holder — *this is the vector that caused the incident* |
| Committing a shared index | any `git commit` while the index holds a file a peer claims | **ask**, with the `git reset -- <paths>` eviction — *this is how four files reached an unrelated commit* |
| Whole-tree staging | `git add -A` / `git add .` / `git commit -a` while a peer's file is dirty | **ask**, listing whose work would be swept in |
| Repo-global destructive git | `git stash` / `checkout -- .` / `restore .` / `clean -f` / `reset --hard` / `checkout -f`, **and** the tree is dirty | **deny**, naming the scoped command to use instead |
| File claim conflict | Another live session edited this exact file in the last 30 min | **ask**, naming the holder |

All automatic. Claims are recorded on every write, so nothing has to be
declared — a protocol that relies on sessions remembering to announce
themselves is a protocol that fails.

The path checks work by matching command tokens **against existing claims**, not
by parsing paths properly. `git checkout main` yields the token `main`, which no
claim will ever match, so the false-positive rate stays near zero without a
shell parser.

### What is deliberately NOT blocked

`git stash push -- <paths>`, scoped `git checkout -- <unclaimed path>`,
`git clean -f -- <path>`, `git reset --soft`, `stash list/show/pop/apply/drop`,
branch checkouts, `git add <explicit paths>`, `git commit -m`, deleting your own
claimed files, `rm -rf node_modules`, and every non-git command.

Verified across **46 cases** — 19 claim-aware, 7 shared-index, 20 repo-global
regression — with zero false positives. A guard that blocks
normal work gets switched off, and a switched-off guard protects nothing.

## Escape hatch

Prefix the command with `KF_SESSION_GUARD=off`:

```bash
KF_SESSION_GUARD=off git stash
```

Explicit and greppable. Check with the other sessions before using it.

## Working alongside other sessions

The guard is a backstop, not a substitute for coordinating:

1. **`ListAgents`** — see who else is live in this repo.
2. **`SendMessage`** — tell a peer what you are about to touch, or ask before
   editing a file it holds.
3. **Scope your git.** Always `-- <paths>`. Never the bare form.
4. **Commit early.** Uncommitted work is the only work at risk. A commit on a
   branch is safe from everything above.
5. **Shared mutable state has no guard** — be careful with
   `packages/db/prisma/migrations/` (a new migration is a shared resource), the
   dev database, and ports 3001 / 5000.

## Failure behaviour

The guard **fails open**: malformed input, a corrupt registry, a missing git
binary, or any thrown error results in the operation being allowed, with a note
on stderr. Breaking the tool would be worse than the harm it prevents.

## State

`.claude/coordination/sessions/*.json` — one record per live session, holding
its claims. Gitignored: it is machine-local runtime state. Sessions unseen for
45 minutes are reaped automatically; claims expire after 30.

## Testing a change to the guard

It takes JSON on stdin and prints a hook decision on stdout:

```bash
echo '{"session_id":"t","tool_input":{"command":"git status"}}' \
  | node .claude/hooks/session-guard.mjs bash

echo '{"session_id":"t","tool_input":{"file_path":"apps/web/src/lib/api.ts"}}' \
  | node .claude/hooks/session-guard.mjs edit
```

An empty `{}` means allow. Note there is **no `jq` on this machine** — use node
for any JSON handling in hook commands.
