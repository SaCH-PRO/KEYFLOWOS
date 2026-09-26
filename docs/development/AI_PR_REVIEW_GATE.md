# AI PR Review Gate

Status: introduced by KF-AI-PR-REVIEW-GATE-001 (directive CG-DIRECTIVE-AI-PR-REVIEW-GATE-001).

AI pull-request review is a required, exact-head admission input. A PR is not
admissible until its current semantic head has a completed review from a pinned
AI reviewer, and every substantive AI finding carries a recorded disposition.
This is in addition to every existing prerequisite; nothing existing was relaxed.

## Pieces

| Piece | File | Role |
|---|---|---|
| Reviewer policy (Copilot) | `.github/copilot-instructions.md` | Repository-wide instructions, the only file Copilot code review reads. Merge-critical text sits inside its 4000-character read window. |
| Reviewer policy (Codex) | `AGENTS.md` `## Review guidelines` | Same priorities for Codex. |
| Review trigger (Copilot) | ruleset "KEYFLOWOS Copilot Review" (existing, unchanged) | Requests Copilot on open, on every push, and on drafts. |
| Review trigger (Codex) | native + `.github/workflows/ai-review-request.yml` | Codex reviews natively on open and draft->ready. The workflow posts one `@codex review` per semantic push. |
| Evaluator | `scripts/agent-control/lib/ai-review.mjs` (+ `lib/ai-review-collect.mjs` for evidence) | One pure rule, used by both paths below. |
| PR-visible check | `.github/workflows/ai-review-gate.yml` -> `scripts/agent-control/ai-review-gate.mjs` | Evaluates the current head on every relevant PR event and writes the ledger. |
| Admission | `scripts/agent-control/auto-merge-admitted.mjs` -> `lib/admission.mjs` (`ai_review`) | The autopilot merge path computes the AI verdict **itself**, from trusted `main`, for the exact head it would merge. |
| Proof | `scripts/agent-control/tests/ai-review.spec.mjs`, `admission.spec.mjs`, `negative-controls.yaml` (NC-AIGATE-*) | Fixtures and mutation controls. |

## What passes

1. **Identity.** A review counts only when its author is a pinned reviewer bot:
   GitHub login **and** GraphQL node id **and** actor type `Bot`
   (`copilot-pull-request-reviewer` `BOT_kgDOCnlnWA`, `chatgpt-codex-connector`
   `BOT_kgDOC98s_g`). `github-actions`, humans, and look-alike accounts never count.
   The gate's own ledger and the request comment are written by
   `github-actions` and so can never satisfy it.
2. **Exact head.** The review's commit is the PR head, or an ancestor whose later
   commits touch only `.agent-control/**` (the repository's semantic-head rule).
   A review on any other commit is stale. A relation that cannot be proved (the
   compare fails, the history was rewritten) is also stale.
3. **Completed.** Reviews in `PENDING`/`DISMISSED` state, reviews without a
   commit, bodies that record the reviewer failing ("unable to review", usage
   limits), and Codex reviews whose stated "Reviewed commit" disagrees with the
   review's commit all fail closed.
4. **Required reviewer.** Copilot must have a current review. It is the only
   reviewer that is re-requested on every push and leaves an attributable review
   when it finds nothing. Codex's clean result is only a thumbs-up reaction,
   which has no commit, so Codex cannot be required. **Codex findings still
   block.**
5. **Findings.** Every inline thread opened by a reviewer bot is a finding
   (`F-<comment id>`). Severity comes from the reviewer: a `KF-SEVERITY:` tag in
   the comment, a Codex `P0`-`P3` badge, or Copilot's own overview
   (`alt="High severity"` next to `#discussion_r<id>`). Only `STYLE` is
   non-blocking. `LOW` and untagged (`UNCLASSIFIED`) findings block until
   dispositioned, because the gate cannot tell them from real risk.
6. **Disposition.** A finding clears only through a reply in its thread from an
   authorized dispositioner (`SaCH-PRO`, the same allowlist as #80 authority),
   as a line of its own:
   - `KF-DISPOSITION: RESOLVED fixed_in=<40-char sha>`. The sha must descend
     from the commit the finding was raised on and be in the head's history.
   - `KF-DISPOSITION: REJECTED_WITH_EVIDENCE` followed by at least 40
     characters of evidence.
   The newest disposition wins. Resolving the thread in the UI, or a later
   summary review that no longer lists the finding, never clears it.
7. **Deletion and editing.** Findings are remembered in evidence nobody can
   delete: the gate appends a **register** review (a `github-actions` COMMENT
   review, marker `kf-ai-review-gate:register`) whenever it sees finding ids the
   register does not hold yet. A submitted review cannot be deleted, and an edit
   by anyone but the gate writer fails every later evaluation
   (`finding_register_edited`). Copilot's own overview review also lists its
   finding ids the moment it is posted. Ledger comments and comment-deletion
   events are read too. A remembered finding that no longer exists is `DELETED`
   and blocks until a PR conversation comment
   `KF-DISPOSITION: REJECTED_WITH_EVIDENCE finding=<id> <evidence>` names it.
   A reviewer's comment or review edited by anyone but a reviewer bot is no
   longer the reviewer's statement: an edited finding loses its severity tag
   (so it cannot be downgraded to STYLE) and an edited review does not count.
8. **Completeness.** Unread pagination, a head that moved during evaluation,
   or any API error fails the check.

## Re-evaluation and storms

The gate re-runs on `pull_request` (opened, synchronize, reopened,
ready_for_review), `pull_request_review` (submitted, edited, dismissed) and
`pull_request_review_comment` (created, edited, deleted). One concurrency group
per PR with cancel-in-progress collapses bursts to the newest evaluation, and
admission reads the newest run at the exact head. The expected sequence after a
push is: fail (review not posted yet), then pass or fail on the review.

PR conversation comments (a PR-level disposition, a deleted ledger) arrive as
`issue_comment`, whose runs belong to `main`, not the PR head.
`.github/workflows/ai-review-redispatch.yml` therefore dispatches the gate
(`workflow_dispatch`, the one event GITHUB_TOKEN may trigger) on the PR's head
branch. The gate re-checks that the dispatched commit is still the PR head.
`issue_comment` and `workflow_dispatch` both run from the default branch's
workflow definitions, so this path only goes live after merge.

The Codex request fires only on `synchronize`, only for non-draft same-repo PRs,
only when the push changed a file outside `.agent-control/**`, never for a
same-tree force push, and at most once per head (marker
`<!-- kf-ai-review-request head=<sha> -->`).

The check is deliberately **not** in the autopilot's `workflow_run` list, since
every evaluation would otherwise post an AUTO_EVENT to #80, and it is not in
`REQUIRED_WORKFLOWS`. Admission does not read its conclusion at all. It
re-evaluates the rule itself at merge time (`ai_review_admission` in the policy).

Two live observations on PR #94 drove this:
- Gate runs triggered by **Copilot's** review events end `action_required`:
  GitHub holds workflows whose triggering actor is that bot until someone
  approves them. Codex- and human-triggered runs are not held. The newest run at
  a head can therefore be a stall, not a verdict. The merge path's own
  evaluation does not depend on any run.
- A `pull_request*` run executes the PR's own copy of the workflow, so a PR can
  make its check green (Codex finding on #94). The merge path runs from `main`.

## Durable evidence

- Inline findings: the reviewer's own review threads, with their commit.
- Reviewer summary: the reviewer's own review body, with its commit.
- Gate ledger: one PR comment per head
  (`<!-- kf-ai-review-gate:ledger head=<sha> -->`) listing current, stale and
  rejected reviews, every finding with severity, disposition and blocking state,
  and the high-risk surfaces touched. The job summary carries the same ledger.

## High-risk surfaces

Changed paths and patches are classified into auth, authorization, tenancy,
payments, billing, refunds, data deletion, destructive migrations (patch
contains DROP/TRUNCATE/DELETE/type or NOT NULL change), production
configuration, deployment/control-plane authority, and external provider side
effects. They are listed in the ledger for explicit review. A truncated file
list is reported as unclassified, never as low risk.

## Trust model and residual risk

- The verdict job is read-only and runs the evaluator from the PR's **base**
  commit, so a PR cannot change the rule that judges it. The one exception is
  bootstrap: while the base predates the gate (this packet's own PR), the PR's
  copy runs, and the ledger says so.
- The workflow file itself comes from the PR for `pull_request*` events, as for
  every existing check here, so the **check** can be forged by a PR that edits
  it. Autopilot **admission** cannot: it recomputes the verdict from `main`.
  For human merges the fix is the ruleset below, pinned to `main`.
- Residual: a repository writer who deletes a **Codex** finding comment before
  any gate run registers it removes it from view. Codex's review body does not
  list ids, unlike Copilot's overview. The Codex review event itself triggers a
  registering run, which is not held, and the deletion event triggers another.
  GitHub's audit log is the only complete record.
- Residual: the high-risk classifier is path/patch based and over-flags (for
  example, docs that mention `deleteMany`). That is fail-safe, but noisy.
- The reviewer is independent of the implementer. The implementer can
  disposition a finding but cannot produce a review; REJECTED_WITH_EVIDENCE
  dispositions are visible in the ledger for ChatGPT integration review.

## Activation outside this packet (requires owner authority)

`main` has no branch protection and no required status checks; the only active
ruleset requests Copilot review. Today only the autopilot merge path enforces
admission. Enforcing the gate for human merges too needs a repository ruleset
"require workflows to pass" rule for `.github/workflows/ai-review-gate.yml`
pinned to `main` (so a PR cannot substitute its own copy), ideally together with
the existing required workflows. It also needs a decision on approving
Copilot-triggered runs. That is a settings change, and the workflow must exist
on `main` first, so it is a post-merge step for the repository owner, not part
of this branch.
