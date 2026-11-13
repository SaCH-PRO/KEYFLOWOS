#!/usr/bin/env python3
"""Rebuild the reviewable local two-file template. No Git or network mutation."""
from pathlib import Path
import hashlib
import json
import re
import difflib

ROOT = Path(__file__).resolve().parent
PARENT = "b30acfa7dcd4fdf96c67747ff8c4a66e4026937e"
manifest = json.loads((ROOT / "source-manifest.json").read_text())
for item in manifest["files"]:
    data = (ROOT / "source" / item["path"]).read_bytes()
    actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    assert actual == item["git_blob_sha"], item["path"]
    assert hashlib.sha256(data).hexdigest() == item["sha256"], item["path"]

def one(text, old, new):
    assert text.count(old) == 1, (old, text.count(old))
    return text.replace(old, new, 1)

def section(text, key, value):
    pattern = rf"(?ms)^{re.escape(key)}:.*?(?=^\S|\Z)"
    hits = list(re.finditer(pattern, text))
    assert len(hits) == 1, (key, len(hits))
    return text[:hits[0].start()] + value.rstrip() + "\n\n" + text[hits[0].end():]

files = {}
for name in ("active-packet.yaml", "claude-return.yaml"):
    source = ROOT / "source/.agent-control" / name
    text = source.read_text()
    text = one(text,
        "  - CG-REVIEW-KF155-006   # 6240050804; exact semantic evidence and explicit contradiction ruling; NO_STATE_CHANGE",
        "  - CG-REVIEW-KF155-006   # 6240050804; exact semantic evidence and explicit contradiction ruling; NO_STATE_CHANGE\n"
        "  - __ADMISSION_MESSAGE_ID__   # later exact-target admission only; bind to its real comment before publication")
    text = one(text, "current_authority_message_id: CG-REVIEW-KF155-006",
               "current_authority_message_id: __ADMISSION_MESSAGE_ID__")
    text = one(text, "current_authority_comment_id: 6240050804",
               "current_authority_comment_id: __ADMISSION_COMMENT_ID__")
    text = one(text, "review_status: PENDING_CHATGPT_REVIEW", "review_status: ACCEPT_FOR_ADMISSION")
    if name == "active-packet.yaml":
        text = one(text, "in_reply_to: CG-REVIEW-KF155-006", "in_reply_to: __ADMISSION_MESSAGE_ID__")
        text = one(text, "review_record_update:", "previous_record_update_b30acfa7:")
        text += """# Local template only until bind-admission.mjs validates a real later REVIEW.
admission_record_update:
  actor: chatgpt
  authority_message_id: __ADMISSION_MESSAGE_ID__
  authority_comment_id: __ADMISSION_COMMENT_ID__
  authority_url: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-__ADMISSION_COMMENT_ID__
  prepared_from_artifact_head: b30acfa7dcd4fdf96c67747ff8c4a66e4026937e
  scope: two control artifacts only; narrow parsed-command semantics remain fe791816
  status: ACCEPT_FOR_ADMISSION
  control_effect: NO_STATE_CHANGE
  semantic_evidence: claude-return.yaml semantic_review; actual review 6240050804 and Copilot 5559828652
  artifact_identity: observed from Git after publication; no self-referential SHA is stored
  exact_head_checks: PENDING for the artifact that carries this file
  prior_return: 6112455909 was consumed by review 6240050804; preserve it as history, do not consume it twice or request another worker RETURN
  worker_action: none; the separately released assignment is unchanged
  draft_transition: NOT_AUTHORIZED
  merge: NOT_AUTHORIZED
  production_or_provider_effects: NOT_AUTHORIZED
  programme_credit: ZERO
"""
    else:
        text = one(text,
            "# This file is a pre-RETURN record. The RETURN is posted on #80 after every\n"
            "# check on the head that carries this file has finished, with no further branch\n"
            "# mutation. That RETURN is the final evidence envelope.",
            "# The repository requires every branch artifact to retain the pre-RETURN shape.\n"
            "# The prior worker RETURN is already consumed by review 6240050804. This\n"
            "# admission record neither consumes it again nor requests another worker RETURN.\n"
            "# New artifact-head outcomes belong in a separate post-check evidence receipt.")
        text = section(text, "summary", """summary: >
  Control-only admission record by ChatGPT under the exact-target authority
  bound below. ACCEPT_FOR_ADMISSION covers only the parsed-command narrowing
  at fe791816, on base 98ee0202. Historical b30acfa7 results are retained under
  ci.previous_head_b30acfa7. The new artifact identity is learned after
  publication and its exact_head_proof entries remain PENDING. The PR stays
  draft, merge_authority stays false, and no worker assignment, ready
  transition, merge, production effect or programme credit is granted.""")
        text = section(text, "health_reason", """health_reason: >
  YELLOW for the new artifact's proof collection and later integration
  decisions. Review 6240050804 settles contradiction 6023151885 and supplies
  the existing narrow semantic evidence. The bounded code has no newly
  asserted defect. This record does not advance the global programme
  projection, change the separately released worker, or grant merge.""")
        review = """semantic_review:
  implementer: claude
  reviews:
    - provider: copilot
      reviewer: copilot-pull-request-reviewer[bot]
      reviewed_head: b30acfa7dcd4fdf96c67747ff8c4a66e4026937e
      outcome: NOT_RUN
      reason: quota_exhausted
      unresolved_substantive_findings: []
      evidence_location: https://github.com/SaCH-PRO/KEYFLOWOS/pull/155#pullrequestreview-5559828652
    - provider: chatgpt
      reviewer: chatgpt
      reviewed_head: fe79181638e373584c3ca3184a39343a132040cd
      outcome: PASS
      reason: null
      unresolved_substantive_findings: []
      evidence_location: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240050804

"""
        text = one(text, "semantic_head_review:\n", review + "semantic_head_review:\n")
        text = one(text,
            "  admission_state: PENDING; the top-level semantic_review block is reserved for the separate admission record",
            "  admission_state: ACCEPT_FOR_ADMISSION; the top-level semantic_review block records the actual provider-neutral evidence")
        text = one(text,
            "  record_ownership: >\n"
            "    ChatGPT transcribes review 6240050804 here without changing admission\n"
            "    status. At a separate admission decision, ChatGPT records semantic_review\n"
            "    at top level together with the chosen review_status after the applicable\n"
            "    checks. This evidence block does not itself grant admission or merge.",
            "  record_ownership: >\n"
            "    This historical transcription is retained from b30acfa7. The top-level\n"
            "    semantic_review block records the later admission evidence. The\n"
            "    historical block does not grant merge or final-artifact proof.")
        text = one(text,
            "  current_packet_authority:\n"
            "    message_id: CG-REVIEW-KF155-006\n"
            "    comment_id: 6240050804\n"
            "    url: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240050804\n"
            "    effect: NO_STATE_CHANGE\n"
            "    disposition: SEMANTIC_PASS_AND_REANCHOR_CONTRADICTION_SETTLED",
            "  current_packet_authority:\n"
            "    message_id: __ADMISSION_MESSAGE_ID__\n"
            "    comment_id: __ADMISSION_COMMENT_ID__\n"
            "    url: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-__ADMISSION_COMMENT_ID__\n"
            "    effect: NO_STATE_CHANGE\n"
            "    disposition: ACCEPT_FOR_ADMISSION\n"
            "  semantic_and_contradiction_authority:\n"
            "    message_id: CG-REVIEW-KF155-006\n"
            "    comment_id: 6240050804\n"
            "    url: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6240050804")
        text = one(text,
            "    programme projection. Review 006 uses NO_STATE_CHANGE and this file\n"
            "    does not change that projection or claim packet admission. The latest",
            "    programme projection. This record also uses NO_STATE_CHANGE and\n"
            "    does not advance that projection or claim a checkpoint. The latest")
        text = one(text, "  preparation_parent: a597c692fcb102de558dd832d88738c0402f69a2",
                   "  preparation_parent: b30acfa7dcd4fdf96c67747ff8c4a66e4026937e")
        text = one(text,
            "  pending_admission: >\n"
            "    The controlling REVIEW records SEMANTIC_PASS, not ACCEPT_FOR_ADMISSION\n"
            "    or READY_TO_MERGE. Keep this PR draft and its status pending. Re-read\n"
            "    new artifact-head workflows and evidence before the separate decision.",
            "  admission_boundary: >\n"
            "    The bound controlling REVIEW admits the narrow parsed-command scope.\n"
            "    Keep the PR draft and record each new artifact-head check separately.\n"
            "    No ready-for-review or merge decision is made by this record.")
        text = one(text,
            "    Pending review_status and draft are both retained. An eventual ready\n",
            "    The PR must remain draft; its merge flags remain false. An eventual ready\n")
        text = one(text,
            "  hosted_skip_scope: hosted skips are disclosed in ci.previous_head_a597c692 and must be re-read at any later artifact head",
            "  hosted_skip_scope: hosted skips are disclosed in ci.previous_head_a597c692 and ci.previous_head_b30acfa7 and must be re-read at any later artifact head")
        history = """  previous_head_b30acfa7:
    source_head: fe79181638e373584c3ca3184a39343a132040cd
    artifact_head: b30acfa7dcd4fdf96c67747ff8c4a66e4026937e
    base_sha: 98ee0202499ba87fa4ee13d58a2a9075016225bd
    evidence_receipt: https://github.com/SaCH-PRO/KEYFLOWOS/pull/155#issuecomment-6240756683
    receipt_kind: post-check evidence only; not a new worker RETURN or admission decision
    workflow_conclusions: all five required workflow names succeeded at this historical artifact
    worker_proof:
      run_id: 39065353286
      url: https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/39065353286
      windows_job: 117491746313
      windows_tests: 516 total; 515 passed; zero failed; one skipped
      ubuntu_job: 117491746470
      ubuntu_tests: 492 total; 491 passed; zero failed; one skipped
      negative_controls: 193/193 LIVE; no missing, extra, duplicated or vacuous manifest entry
      runtime: Node 20.18.1 on the hosted runners
    ci:
      run_id: 39065353293
      url: https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/39065353293
      server: 4428/4428
      web: 210/210
      k12_self_test: 16/16 at its declared self-test scope only
    proof_limits:
      authenticated_gh_cursor: NOT_RUN on both hosted runners; the cursor idempotency test requires PowerShell and authenticated gh
      dependency_audit: FAILED; 260 reported advisories, 12 critical, 107 high, 118 moderate, 23 low; not a count of verified exploitable paths
      intended_trufflehog_coverage: NOT_RUN; base main could not be resolved, zero bytes and zero chunks scanned
      hawkscan: NOT_RUN; missing key guarded the actual scan
      remediation: existing PR 114 and issue 115; no production-security qualification or new scanner assignment
    applicability: named historical artifact only; none of these outcomes is evidence for the new artifact
"""
        text = one(text, "  this_head: PENDING.", history + "  this_head: PENDING.")
        text = one(text,
            "exact_head_proof:   # the head that carries this file; PENDING until the RETURN reports the outcome",
            "exact_head_proof:   # the new artifact; outcomes are read in a separate post-check evidence receipt")
        text = one(text,
            "  this_head: PENDING. The workflows run on the head that carries this file once it is on the remote, and are read from the live runs for the RETURN.",
            "  this_head: PENDING. Read actual outcomes after publication into a separate post-check evidence receipt; no new worker RETURN is requested.")
        text = one(text,
            "    - root review and publication of this control-only evidence update, if accepted\n"
            "    - the required workflows and applicable proof on the future artifact head\n"
            "    - inspection and disposition of actual failed, skipped or unavailable proof on that head\n"
            "    - final post-check evidence and separate ChatGPT admission decision",
            "    - bind the real later exact-target admission REVIEW and publish only these two control files\n"
            "    - the required workflows and applicable proof on the future artifact head\n"
            "    - inspection and disposition of actual failed, skipped or unavailable proof on that head\n"
            "    - record new post-check evidence without duplicating the consumed worker RETURN")
        text = one(text,
            "  dast: DAST (HawkScan) is a required exact-head check; its result for this head is PENDING until the RETURN.",
            "  dast: DAST (HawkScan) is a required exact-head check; its result for this head is PENDING and actual scan execution must be recorded separately.")
        text = section(text, "next_action", """next_action: >
  Bind the real later exact-target admission REVIEW only at the safe worker
  handoff, then publish the two control files from unchanged parent b30acfa7.
  Observe the new artifact SHA and re-read its lineage, checks, reviews and
  proof limits. Keep the PR draft and merge_authority false. No new worker
  RETURN, source mutation, ready transition, merge or assignment is requested.
  Any later integration needs distinct current authority and proof.""")
        text += """admission_record_update:
  actor: chatgpt
  authority_message_id: __ADMISSION_MESSAGE_ID__
  authority_comment_id: __ADMISSION_COMMENT_ID__
  authority_url: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-__ADMISSION_COMMENT_ID__
  control_effect: NO_STATE_CHANGE
  prepared_from_artifact_head: b30acfa7dcd4fdf96c67747ff8c4a66e4026937e
  previous_return_consumed_by: 6240050804
  previous_return_comment_id: 6112455909
  return_reconsumption: NOT_AUTHORIZED
  worker_action: none
  draft_transition: NOT_AUTHORIZED
  merge: NOT_AUTHORIZED
  production_or_provider_effects: NOT_AUTHORIZED
"""
    files[name] = text
    out = ROOT / "candidate/.agent-control" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
patch = "".join("".join(difflib.unified_diff(
    (ROOT/"source/.agent-control"/name).read_text().splitlines(True),
    text.splitlines(True),
    fromfile="a/.agent-control/"+name,
    tofile="b/.agent-control/"+name,
)) for name, text in files.items())
(ROOT/"admission-candidate.patch").write_text(patch)
print(json.dumps({"written":list(files),"status":"LOCAL_UNBOUND_TEMPLATE","parent":PARENT}))
