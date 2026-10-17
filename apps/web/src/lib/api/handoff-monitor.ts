import { apiGet } from "@/lib/api";

/**
 * Typed client for the owner console's read-only handoff viewer
 * (GET /api/admin/mission-control/handoffs, SUPER_ADMIN only).
 * Shapes mirror scripts/agent-control/lib/handoff-projector.mjs.
 */

export type HandoffStageName =
  | "POSTED"
  | "ACKNOWLEDGED"
  | "WORKING_LAST_OBSERVED"
  | "RETURNED"
  | "RETURN_CONSUMED"
  | "DECISION_RECORDED";

export const HANDOFF_STAGES: HandoffStageName[] = [
  "POSTED",
  "ACKNOWLEDGED",
  "WORKING_LAST_OBSERVED",
  "RETURNED",
  "RETURN_CONSUMED",
  "DECISION_RECORDED",
];

export interface HandoffEvidence {
  comment_id: number;
  message_id: string | null;
  message_type: string | null;
  sender: string | null;
  author: string | null;
  created_at: string;
  url: string | null;
}

export interface HandoffStage {
  status: "OBSERVED" | "LAST_OBSERVED" | "NOT_OBSERVED";
  evidence: HandoffEvidence | null;
  evidence_count: number;
  age_seconds?: number | null;
  liveness?: string;
  clock_skew_suspected?: boolean;
  disposition?: string | null;
  classification?: "AUTHORITY" | "EVIDENCE_ONLY";
}

export interface HandoffReference {
  raw: string;
  safe_url: string | null;
  control_comment_id: number | null;
}

export interface HandoffTaskSummary {
  task_id: number;
  request: HandoffEvidence & {
    packet_id: string | null;
    pr_number: number | null;
    source_main: string | null;
    source_head: string | null;
    control_effect: string | null;
    authority_status: string;
    authority_problems: string[];
  };
  requester: string;
  responder: { role: string; basis: string };
  stages: Record<HandoffStageName, HandoffStage>;
  review: {
    outcome: "PASS" | "CHANGES_REQUIRED" | "NOT_RUN" | "UNKNOWN";
    unresolved_substantive_findings: number | null;
    findings_ref: HandoffReference | null;
    basis: string | null;
  };
  revision: {
    requested_head: string | null;
    returned_head: string | null;
    status: string;
    current_pr_head: string | null;
    current_pr_state: string | null;
    current_status: string;
  };
  merge_authority: { status: "GRANTED" | "NOT_GRANTED"; basis: string };
  confidence: "HIGH" | "MEDIUM" | "NONE";
  sender_alias_used: boolean;
  delivery: { stage: HandoffStageName; gaps: HandoffStageName[]; pending: { party: string; reason: string } | null };
  returns_count: number;
  related_count: number;
  mismatched_count: number;
  problems: string[];
}

export interface HandoffMessageSummary {
  comment_id: number;
  url: string | null;
  author: string | null;
  created_at: string;
  edit_state: "UNEDITED" | "EDITED" | "AMENDED_BOT_STATUS" | "UNKNOWN";
  kind: "CONTROL" | "AUTO_EVENT" | "UNSTRUCTURED";
  noise: boolean;
  message_id: string | null;
  message_type: string | null;
  sender: string | null;
  recipient: string | null;
  in_reply_to: string | null;
  packet_id: string | null;
  pr_number: number | null;
  authority_status: string;
  usable: boolean;
  envelope_problems: string[];
  redactions: number;
  excerpt: string;
}

export interface HandoffChainMessage extends Omit<HandoffMessageSummary, "authority_status"> {
  body: string;
  authority: { claimed_type: string | null; status: string; problems: string[] };
  provenance: {
    github_author: string | null;
    claimed_sender: string | null;
    claimed_model: string | null;
    claimed_session: string | null;
    shared_account?: boolean;
    note?: string;
  };
  revision: { source_main: string | null; source_head: string | null; reviewed_head: string | null };
  refs: { ack_ref: HandoffReference | null; findings_ref: HandoffReference | null; return_comment_id: number | null };
}

export interface HandoffUnmatched extends HandoffEvidence {
  reason: string;
  detail: string | null;
}

export interface HandoffFreshness {
  status: "FRESH" | "STALE" | "DEGRADED" | "PARTIAL" | "NO_DATA" | "NOT_YET_COLLECTED";
  detail: string | null;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_attempt_outcome: string | null;
  confirmed_unchanged_at?: string | null;
  generation: number;
  stale_after_seconds: number | null;
  snapshot_age_seconds: number | null;
  backoff_until: string | null;
  coverage: {
    status: "COMPLETE" | "PARTIAL" | "FAILED";
    mode: string | null;
    pages: number | null;
    comments_observed?: number;
    comments_expected?: number | null;
    deletions_detected?: number;
    reason: string | null;
  } | null;
  error: string | null;
}

export interface HandoffView {
  observed_at: string;
  authority_record: { verified: boolean; code?: string; reason?: string; newest?: { message_id: string; comment_id: number } | null };
  provenance: { shared_accounts: Array<{ login: string; senders: string[] }>; note: string };
  worker: { status: string; connection: string; basis: string };
  counts: Record<string, number>;
  tasks: HandoffTaskSummary[];
  unmatched: HandoffUnmatched[];
  feed: HandoffMessageSummary[];
  noise_hidden: number;
  task:
    | (HandoffTaskSummary & {
        stage_evidence: Record<HandoffStageName, HandoffEvidence[]>;
        chain: HandoffChainMessage[];
        related: HandoffEvidence[];
        mismatched: HandoffUnmatched[];
      })
    | { task_id: number; missing: true }
    | null;
}

export interface HandoffSnapshot {
  mode: "LIVE" | "FIXTURE" | "NOT_CONFIGURED" | "UNAVAILABLE";
  detail: string | null;
  refresh_hint_ms: number;
  freshness: HandoffFreshness | null;
  view: HandoffView | null;
}

export async function fetchHandoffSnapshot(options: { task?: number | null; includeNoise?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.task) params.set("task", String(options.task));
  if (options.includeNoise) params.set("noise", "1");
  const query = params.toString();
  return apiGet<HandoffSnapshot>(`/api/admin/mission-control/handoffs${query ? `?${query}` : ""}`);
}

const SAFE_SOURCE_URL =
  /^https:\/\/github\.com\/SaCH-PRO\/KEYFLOWOS\/(issues|pull)\/\d{1,7}(#(issuecomment-\d{1,12}|pullrequestreview-\d{1,12}|discussion_r\d{1,12}))?$/;

/** The viewer renders a link only for this repository's GitHub pages; the server checks the same. */
export function safeHandoffUrl(url: string | null | undefined): string | null {
  return typeof url === "string" && SAFE_SOURCE_URL.test(url) ? url : null;
}
