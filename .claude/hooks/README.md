# Cross-session coordination

This repo is routinely worked on by a dozen concurrent Claude sessions. This
directory holds the machinery that stops them destroying each other's work.

## Why it exists

On 2026-08-23 a session finished and verified a change — an edit to
`apps/web/src/lib/api.ts` plus a new passing test file — and both silently
vanished mid-run. `git status` came back clean, as though the work had never
happened. It was only noticed because a test started failing for an impossible
reason.

The cause is structural, not careless: **repo-global git commands act on the
whole tree and cannot tell whose work they are discarding.** `git stash`,
`git checkout -- .`, `git clean -fd` and `git reset --hard` each take out every
dirty file in the repository, including thirteen other sessions' in-progress
work. Nothing warns either side.

## What is enforced

`session-guard.mjs` runs as a `PreToolUse` hook (wired in `.claude/settings.json`).

| Guard | Trigger | Decision |
|---|---|---|
| Repo-global destructive git | `git stash` / `checkout -- .` / `restore .` / `clean -f` / `reset --hard` / `checkout -f`, **and** the tree is dirty | **deny**, naming the scoped command to use instead |
| File claim conflict | Another live session edited this exact file in the last 30 min | **ask**, naming the holder |

Both are automatic. Claims are recorded on every write, so nothing has to be
declared — a protocol that relies on sessions remembering to announce
themselves is a protocol that fails.

### What is deliberately NOT blocked

`git stash push -- <paths>`, `git checkout -- <path>`, `git clean -f -- <path>`,
`git reset --soft`, `stash list/show/pop/apply/drop`, branch checkouts, and every
non-git command. Verified against 23 ordinary git commands with zero false
positives. A guard that blocks normal work gets switched off, and a switched-off
guard protects nothing.

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
