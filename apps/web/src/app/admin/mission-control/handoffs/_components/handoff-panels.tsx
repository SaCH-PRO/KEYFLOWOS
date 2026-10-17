"use client";

import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HANDOFF_STAGES,
  safeHandoffUrl,
  type HandoffChainMessage,
  type HandoffEvidence,
  type HandoffFreshness,
  type HandoffSnapshot,
  type HandoffStage,
  type HandoffTaskSummary,
  type HandoffUnmatched,
  type HandoffView,
} from "@/lib/api/handoff-monitor";

const STAGE_LABELS: Record<string, string> = {
  POSTED: "Posted",
  ACKNOWLEDGED: "Acknowledged",
  WORKING_LAST_OBSERVED: "Working (last observed)",
  RETURNED: "Returned",
  RETURN_CONSUMED: "Return consumed",
  DECISION_RECORDED: "Decision recorded",
};

const TONE = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  bad: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  muted: "border-border/60 bg-slate-900/60 text-muted-foreground",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
} as const;

type Tone = keyof typeof TONE;

export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex max-w-full items-center break-all rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE[tone])}>
      {children}
    </span>
  );
}

/** A link only to this repository's GitHub pages; anything else is plain text. */
export function SourceLink({ url, label }: { url: string | null | undefined; label: string }) {
  const safe = safeHandoffUrl(url);
  if (!safe) return <span className="text-muted-foreground">{label}</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary hover:underline">
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function time(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : `${d.toISOString().replace("T", " ").slice(0, 19)}Z`;
}

function age(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 120) return `${seconds}s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 8) : "—");

function freshnessTone(status: HandoffFreshness["status"] | undefined): Tone {
  if (status === "FRESH") return "good";
  if (status === "DEGRADED" || status === "PARTIAL") return "warn";
  if (status === "STALE" || status === "NO_DATA") return "bad";
  return "muted";
}

export function stageTone(stage: HandoffStage | undefined): Tone {
  if (!stage || stage.status === "NOT_OBSERVED") return "muted";
  if (stage.status === "LAST_OBSERVED") return "info";
  return "good";
}

export function reviewTone(outcome: string): Tone {
  if (outcome === "PASS") return "good";
  if (outcome === "CHANGES_REQUIRED") return "warn";
  return "muted";
}

export function SourceBar({ snapshot, viewerRefreshedAt }: { snapshot: HandoffSnapshot; viewerRefreshedAt: string | null }) {
  const f = snapshot.freshness;
  const v = snapshot.view;
  return (
    <div className="grid gap-3 rounded-2xl border border-border/70 bg-slate-950/70 p-4 text-xs md:grid-cols-4" data-testid="handoff-source-bar">
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Source</div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={snapshot.mode === "LIVE" ? "info" : snapshot.mode === "FIXTURE" ? "warn" : "muted"}>{snapshot.mode}</Badge>
          <Badge tone={freshnessTone(f?.status)} title={f?.detail ?? undefined}>
            <span data-testid="handoff-freshness">{f?.status ?? "NO_DATA"}</span>
          </Badge>
        </div>
        <div className="text-muted-foreground">Issue #80, read with GET requests only</div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Collection</div>
        <div>Last success: <span data-testid="handoff-last-success">{time(f?.last_success_at)}</span></div>
        <div>Last attempt: {time(f?.last_attempt_at)} ({f?.last_attempt_outcome ?? "—"})</div>
        <div>
          Coverage: {f?.coverage?.status ?? "—"}
          {f?.coverage?.comments_observed !== undefined ? ` · ${f.coverage.comments_observed}/${f.coverage.comments_expected ?? "?"} comments` : ""}
          {f ? ` · generation ${f.generation}` : ""}
        </div>
        {f?.backoff_until ? <div className="text-amber-300">Backing off until {time(f.backoff_until)}</div> : null}
        {f?.error ? <div className="break-words text-rose-300">{f.error}</div> : null}
      </div>
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Authority record</div>
        {v ? (
          v.authority_record.verified ? (
            <div>Verified · newest {v.authority_record.newest?.message_id ?? "—"}</div>
          ) : (
            <div className="text-rose-300">{v.authority_record.code}: {v.authority_record.reason}</div>
          )
        ) : (
          <div className="text-muted-foreground">—</div>
        )}
        <div className="text-muted-foreground">Viewer refreshed {time(viewerRefreshedAt)}. A viewer refresh is not a receipt of any RETURN.</div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Worker availability</div>
        <div className="flex items-center gap-2">
          <Badge tone="muted"><span data-testid="handoff-worker-status">{v?.worker.status ?? "UNKNOWN"}</span></Badge>
          <Badge tone="muted">{v?.worker.connection ?? "NOT_CONNECTED"}</Badge>
        </div>
        <div className="text-muted-foreground">{v?.worker.basis ?? "No validated telemetry is connected."}</div>
      </div>
    </div>
  );
}

export function TaskList({ tasks, selected, onSelect }: { tasks: HandoffTaskSummary[]; selected: number | null; onSelect: (id: number) => void }) {
  if (tasks.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No requests observed.</div>;
  return (
    <ul className="space-y-2" data-testid="handoff-task-list">
      {tasks.map((t) => (
        <li key={t.task_id}>
          <button
            type="button"
            onClick={() => onSelect(t.task_id)}
            data-testid={`handoff-task-${t.task_id}`}
            className={cn(
              "w-full rounded-xl border px-3 py-2 text-left text-xs transition-colors",
              selected === t.task_id ? "border-primary/50 bg-primary/10" : "border-border/60 bg-slate-900/70 hover:border-border",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground">{t.request.message_id}</span>
              <span className="shrink-0 text-muted-foreground">{t.request.pr_number ? `PR #${t.request.pr_number}` : "no PR"}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge tone={t.delivery.stage === "POSTED" ? "muted" : "good"}>{STAGE_LABELS[t.delivery.stage]}</Badge>
              <Badge tone={reviewTone(t.review.outcome)}>review {t.review.outcome}</Badge>
              {t.problems.length ? <Badge tone="bad">{t.problems.length} problem(s)</Badge> : null}
            </div>
            <div className="mt-1 truncate text-muted-foreground">
              {t.delivery.pending ? `Pending: ${t.delivery.pending.party}` : ""} · {time(t.request.created_at)}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function EvidenceLine({ evidence }: { evidence: HandoffEvidence | null }) {
  if (!evidence) return <span className="text-muted-foreground">no evidence</span>;
  return (
    <span className="space-x-1">
      <SourceLink url={evidence.url} label={evidence.message_id ?? `comment ${evidence.comment_id}`} />
      <span className="text-muted-foreground">· {evidence.sender ?? "?"} via {evidence.author ?? "?"} · {time(evidence.created_at)}</span>
    </span>
  );
}

function Fact({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-slate-900/70 p-3" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1 space-y-1 text-xs">{children}</div>
    </div>
  );
}

function ChainMessage({ m }: { m: HandoffChainMessage }) {
  return (
    <div className="rounded-xl border border-border/60 bg-slate-950/80 p-3 text-xs" data-testid={`handoff-chain-${m.comment_id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{m.message_type ?? m.kind}</span>
        <SourceLink url={m.url} label={m.message_id ?? `comment ${m.comment_id}`} />
        <span className="text-muted-foreground">{time(m.created_at)}</span>
        {m.edit_state !== "UNEDITED" ? <Badge tone="bad">{m.edit_state}</Badge> : null}
        {m.authority.status !== "NOT_AUTHORITY" ? (
          <Badge tone={m.authority.status === "VALID" ? "info" : "bad"}>authority {m.authority.status}</Badge>
        ) : null}
        {!m.usable ? <Badge tone="bad">not usable evidence</Badge> : null}
        {m.redactions ? <Badge tone="warn">{m.redactions} redacted</Badge> : null}
      </div>
      <div className="mt-1 text-muted-foreground">
        GitHub account <span className="text-foreground">{m.provenance.github_author ?? "?"}</span> · claimed sender{" "}
        <span className="text-foreground">{m.provenance.claimed_sender ?? "—"}</span>
        {m.provenance.claimed_model ? <> · claimed model <span className="text-foreground">{m.provenance.claimed_model}</span></> : null}
        {m.provenance.shared_account ? " · shared account: sender and model are self-reported" : ""}
      </div>
      {m.refs.findings_ref ? (
        <div className="mt-1">
          Findings: <SourceLink url={m.refs.findings_ref.safe_url} label={m.refs.findings_ref.safe_url ? "open findings" : `unrecognised link (not opened): ${m.refs.findings_ref.raw}`} />
        </div>
      ) : null}
      {m.envelope_problems.length ? <div className="mt-1 text-rose-300">Envelope: {m.envelope_problems.join("; ")}</div> : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">Published text</summary>
        {/* Plain text only: never parsed as Markdown or HTML, no images, no embeds. */}
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-2 text-[11px] text-foreground/90">{m.body}</pre>
      </details>
    </div>
  );
}

export function TaskDetail({ task }: { task: NonNullable<HandoffView["task"]> }) {
  if ("missing" in task) {
    return <div className="py-8 text-center text-sm text-muted-foreground">That request is not in the current snapshot.</div>;
  }
  const stageCards = HANDOFF_STAGES.map((name) => ({ name, stage: task.stages[name] }));
  return (
    <div className="space-y-4" data-testid="handoff-task-detail">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{task.request.message_id}</h2>
          <SourceLink url={task.request.url} label="open request" />
          {task.request.pr_number ? (
            <SourceLink url={`https://github.com/SaCH-PRO/KEYFLOWOS/pull/${task.request.pr_number}`} label={`PR #${task.request.pr_number}`} />
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {task.request.message_type} · packet {task.request.packet_id ?? "—"} · {task.requester} → {task.responder.role} ({task.responder.basis}) ·
          head {short(task.request.source_head)} · authority {task.request.authority_status}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3" data-testid="handoff-stages">
        {stageCards.map(({ name, stage }) => (
          <div key={name} className="rounded-xl border border-border/60 bg-slate-900/70 p-3 text-xs" data-testid={`handoff-stage-${name}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{STAGE_LABELS[name]}</span>
              <Badge tone={stageTone(stage)}>{stage.status}</Badge>
            </div>
            <div className="mt-1"><EvidenceLine evidence={stage.evidence} /></div>
            {name === "WORKING_LAST_OBSERVED" ? (
              <div className="mt-1 text-muted-foreground">
                {stage.status === "NOT_OBSERVED" ? "No task-bound progress message." : `Age ${age(stage.age_seconds)}${stage.clock_skew_suspected ? " (clock skew suspected)" : ""}.`} Liveness: UNKNOWN.
              </div>
            ) : null}
            {stage.disposition ? (
              <div className="mt-1">
                Disposition <span className="font-medium">{stage.disposition}</span> · {stage.classification}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-5">
        <Fact label="Delivery" testId="handoff-fact-delivery">
          <div className="font-medium">{STAGE_LABELS[task.delivery.stage]}</div>
          {task.delivery.gaps.length ? <div className="text-amber-300">Gaps: {task.delivery.gaps.join(", ")}</div> : null}
          {task.delivery.pending ? <div>Pending: <span className="font-medium">{task.delivery.pending.party}</span> — {task.delivery.pending.reason}</div> : null}
        </Fact>
        <Fact label="Review outcome" testId="handoff-fact-review">
          <Badge tone={reviewTone(task.review.outcome)}>{task.review.outcome}</Badge>
          <div>Unresolved substantive findings: {task.review.unresolved_substantive_findings ?? "—"}</div>
          {task.review.findings_ref ? (
            <SourceLink url={task.review.findings_ref.safe_url} label={task.review.findings_ref.safe_url ? "open findings" : "findings link not recognised"} />
          ) : null}
          {task.review.basis ? <div className="text-muted-foreground">Per {task.review.basis}</div> : null}
        </Fact>
        <Fact label="Revision" testId="handoff-fact-revision">
          <div>Requested {short(task.revision.requested_head)} · returned {short(task.revision.returned_head)}</div>
          <div>Match: <span className="font-medium">{task.revision.status}</span></div>
          <div>
            Current PR head {short(task.revision.current_pr_head)} ({task.revision.current_pr_state ?? "unknown"}):{" "}
            <span className="font-medium">{task.revision.current_status}</span>
          </div>
        </Fact>
        <Fact label="Merge authority" testId="handoff-fact-merge">
          <Badge tone={task.merge_authority.status === "GRANTED" ? "info" : "muted"}>{task.merge_authority.status}</Badge>
          <div className="text-muted-foreground">{task.merge_authority.basis}</div>
        </Fact>
        <Fact label="Evidence confidence" testId="handoff-fact-confidence">
          <Badge tone={task.confidence === "HIGH" ? "good" : task.confidence === "MEDIUM" ? "warn" : "muted"}>{task.confidence}</Badge>
          {task.sender_alias_used ? <div className="text-muted-foreground">A historical sender spelling was matched.</div> : null}
        </Fact>
      </div>

      {task.problems.length ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          {task.problems.map((p) => <div key={p}>{p}</div>)}
        </div>
      ) : null}

      {task.mismatched.length ? (
        <div className="space-y-1 text-xs" data-testid="handoff-mismatched">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Replies that did not match this request</div>
          {task.mismatched.map((m) => (
            <div key={`${m.comment_id}-${m.reason}`}>
              <Badge tone="bad">{m.reason}</Badge> <EvidenceLine evidence={m} /> <span className="text-muted-foreground">{m.detail}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Published messages</div>
        {task.chain.map((m) => <ChainMessage key={m.comment_id} m={m} />)}
      </div>
    </div>
  );
}

export function UnmatchedList({ items }: { items: HandoffUnmatched[] }) {
  if (!items.length) return <div className="text-xs text-muted-foreground">Every reply-shaped message matched a request.</div>;
  return (
    <div className="space-y-1 text-xs" data-testid="handoff-unmatched">
      {items.map((u) => (
        <div key={u.comment_id}>
          <Badge tone="warn">{u.reason}</Badge> <EvidenceLine evidence={u} /> <span className="text-muted-foreground">{u.detail}</span>
        </div>
      ))}
    </div>
  );
}
