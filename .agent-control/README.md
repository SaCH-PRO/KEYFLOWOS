# .agent-control

This directory contains machine-readable control-plane artifacts for active implementation packets.

For `impl/*` pull requests:

- `active-packet.yaml` is directive-owned. It records the packet released by ChatGPT, source main, branch, state, health, allowed scope and proof obligations.
- `claude-return.yaml` is implementer-owned until review. Claude records source head, characterization, changes, proof results, discoveries and open questions.
- ChatGPT sets the final `review_status` after integration review.

These files are not substitutes for the canonical packet or PR. They are compact admission artifacts that allow repository gates to reject silent scope drift and unreviewed merge readiness.

Do not place secrets, provider credentials, production data or large logs here.
