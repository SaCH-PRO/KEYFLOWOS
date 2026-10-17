# Reproducing the 2026-10-17 P0 authority and CI observation

This package records evidence. It does not issue a directive, clear a new hold, retire a formal ruling, admit a PR, grant merge authority, change a checkpoint, or observe an installed worker or production.

## Inputs and scope

The authority snapshot contains 1,422 issue #80 comments, collected through **2026-10-17 05:59:38 UTC**. Its last comment is **6230334535**, created at 05:46:16 UTC. Current-main source for this observation is:

`98ee0202499ba87fa4ee13d58a2a9075016225bd`

The CI evidence was collected through **2026-10-17 06:02:54 UTC** and concerns PR #155 head:

`a597c692fcb102de558dd832d88738c0402f69a2`

| File | Purpose |
|---|---|
| authority-replay-summary.json | Complete summary of the frozen authority replay, all 29 applied effect IDs and declared states, source hashes, hold clearance, authority selection and limitations. |
| pr155-ci-evidence.json | Complete run/job/check inventory in compact form, all skips, inspected test-log summaries, checkout-tree identity and exact Copilot quota evidence. |
| source-and-snapshot-manifest.json | Pinned source Git blob hashes and canonical SHA-256 digests for the comment and repository-truth snapshots. |
| repository-truth.json | The recorded GitHub main, ancestry and PR observations consumed by reconciliation. |
| replay-authority.mjs | Parameterized, offline runner using the unchanged repository modules. |
| verification.json | Actual local verification of the runner and rejection of a mismatched comment snapshot. |

The full issue discussion is intentionally supplied separately. It is **not** embedded in this package. In the collection workspace it is:

`/tmp/kf-authority-review/issue80-comments.json`

The summaries alone cannot reproduce the frozen fold without that complete comment input. A later collection is a separate observation; an edited or later snapshot must not be represented as this one.

## Run the frozen replay

Use a clean, isolated checkout or source copy of the pinned main. The runner verifies 12 repository file blobs before importing any repository module, including all transitive modules used by the pure replay, the checkpoint and the DAG. It writes no repository file and makes no network, GitHub, git, worker or credential calls. Output goes to stdout.

This observation was verified with **Node v24.19.0**. No package installation is needed for the replayed modules.

Current collection-workspace command:

```bash
node /tmp/kf-authority-review/package/replay-authority.mjs \
  --repo-root /tmp/keyflow-p0-review \
  --comments-file /tmp/kf-authority-review/issue80-comments.json \
  --manifest /tmp/kf-authority-review/package/source-and-snapshot-manifest.json \
  --repo-truth-file /tmp/kf-authority-review/package/repository-truth.json \
  > /tmp/kf-authority-review/reproduced-replay.json
```


When the package moves, substitute its new absolute path and the isolated checkout path. Both '--name value' and '--name=value' arguments are supported. The comment input may be a flat REST comment array, REST pagination arrays, or an object with a comments array. It must retain complete bodies, IDs, author, creation/update timestamps and source URLs.

The canonical digest function is exported by the runner. It uses the pinned shared normalizer, canonical field order and chronological/ID ordering. The runner rejects a mismatched comment count/digest, repository snapshot digest or source blob. It does not reset a cursor, edit a checkpoint or infer missing evidence.

Exit 0 means the frozen replay reconciled consistently. Exit 1 means the observed reconciliation or direct-reducer agreement failed. Exit 2 means an input, digest or source check failed. An exit code is not an admission verdict.

## Expected result and interpretation

The reproduced snapshot has **116 authority candidates, 109 valid messages and seven malformed candidates**. All seven malformed candidates precede the reviewed generation-87 checkpoint. Two additional purported authority messages are rejected by the allowlist/sender rules.

The reducer applies **29 newer effects**, reaches generation **116/116**, and reconciles with zero findings. Its latest authority is **CG-DIR-HANDOFF-UI-001 / 6229570731**. The active application remains **KF-EXEC-AUTH-FAIL-CLOSED-001 / PR #155**, FIXING_PROOF_FAILURES/YELLOW, with merge authority false.

The ACTION-001 hold is inactive: **RESUME/HOLD_CLEAR 5998716917** applied at generation 93. The summary preserves this reference and every subsequent applied effect.

### Consistent fold does not mean every descriptive field is current

The unchanged reducer carries some checkpoint descriptions forward. In particular, the retained next_legal_action.reason still says **"ACTION-001 is held; release is a ChatGPT authority action"**, with an October 5 timestamp. The application_frontier field also remains ACTION-001. These retained descriptions are not the effective hold list; the effective list is empty.

The runner exposes these fields separately. Do not promote their stale prose over the typed HOLD_CLEAR. Likewise, do not present CONSISTENT as a claim that every UI description, worker observation, next action or historical timestamp was refreshed.

The historical REVIEW-005 stale-fold condition is absent: both formerly unsupported effect spellings now apply through the admitted compatibility map. **A formal ruling withdrawing the obsolete reanchor instruction is still owed at this snapshot.** This evidence does not itself replace that ruling, move #155's state, establish semantic review, or issue admission. A new typed REVIEW would displace H1 in the current newest-authority selector even with NO_STATE_CHANGE; evidence-only PROGRESS does not.

## CI evidence limits

All five required PR workflows succeeded at the associated PR head. The retrieved inventory contains six workflow runs, 20 workflow jobs and 23 check runs: **14 jobs succeeded and six alternate-event jobs were skipped; 16 checks succeeded and seven were skipped.**

The success labels have two material qualifications:

- The draft Agent Control Gate skipped its non-draft ChatGPT admission step. It provides no non-draft admission pass.
- HawkScan's guard succeeded with HAWK_API_KEY unset, while preparation and scan steps were skipped. **No dynamic scan ran.**

The inspected test logs establish server 4,428 passed, web 210 passed, Windows 515/516 with one named skip, Ubuntu 491/492 with the same named skip, and 193/193 control-plane negative controls live. The separate application-packet 8/8 manifest claim is not independently established by this CI read.

The CI test checkout was synthetic merge 002b44f09f5ec238cb5cb0a7c1e06648f551cdc2. Git objects establish its tree equals the PR head tree f6eda347f98a6f46bc6e842e9b579502c6d33059. Worker proof logs explicitly check out the PR head.

Copilot review 5484373795 is tied to the exact PR head and explicitly reports quota unavailability: **NOT_RUN / quota_exhausted**, never PASS. No workflow, skip count or available review comment grants a merge or deployment.
