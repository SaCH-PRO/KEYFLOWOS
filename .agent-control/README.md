# .agent-control

This directory contains machine-readable control-plane artifacts for active implementation packets.

For `impl/*` pull requests:

- `active-packet.yaml` is directive-owned. It records the packet released by ChatGPT, source main, branch, state, health, allowed scope and proof obligations.
- `claude-return.yaml` is implementer-owned until review. Claude records source head, characterization, changes, proof results, discoveries and open questions.
- ChatGPT sets the final `review_status` after integration review.

These files are not substitutes for the canonical packet or PR. They are compact admission artifacts that allow repository gates to reject silent scope drift and unreviewed merge readiness.

Do not place secrets, provider credentials, production data or large logs here.


## source_head

`source_head` is the final semantic implementation commit, not necessarily the branch tip. Commits after it are permitted only for `.agent-control/**` metadata. Any later code/schema/migration/test change invalidates the return and requires a new semantic head plus refreshed proof evidence.

## programme-state.yaml

`programme-state.yaml` is a **reviewed checkpoint of a derived projection**. It
is not live state and not authority, and it is expected to be older than the
newest message on issue #80.

Execution authority is the newest valid ChatGPT `DIRECTIVE` / `REVIEW` / `HOLD`
/ `RESUME` on issue #80. The live programme state is the fold of every typed
authority message newer than this checkpoint over it:

```bash
node scripts/agent-control/status.mjs --verify
```

Do not hand-edit this file to bring it up to date. Moving the checkpoint (a
re-anchor) is a reviewed semantic change authorized by ChatGPT; the reducer's
proofs pin the current anchor and the recorded history after it.

See "Control-state precedence" and "Typed authority effects" in
`docs/development/AGENT_CONTROL_PLANE.md`, and
`docs/intelligence/CANONICAL-SOURCE.md` for where each kind of truth lives.

## active-packet.yaml and claude-return.yaml on `main`

These are per-PR admission artifacts. The gate reads them at an `impl/*` PR's
head, never from `main`. On `main` they are whatever the last merged `impl/*`
PR left behind: they describe a packet that has merged, and are not a pointer
to the active one.

`.worker/` holds local worker runtime state (lock, log, processed-directive
cursor) and is git-ignored.
