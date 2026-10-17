"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { fetchHandoffSnapshot, type HandoffSnapshot } from "@/lib/api/handoff-monitor";
import { Badge, SourceBar, SourceLink, TaskDetail, TaskList, UnmatchedList, time } from "./_components/handoff-panels";

/**
 * Read-only view of ChatGPT <-> Claude handoffs on issue #80
 * (KF-META-HANDOFF-MONITOR-001). It shows what was published and which
 * handoff step the record evidences. It has no controls that send, retry,
 * merge or release anything.
 */
export default function AdminHandoffs() {
  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [showNoise, setShowNoise] = useState(false);
  const [viewerRefreshedAt, setViewerRefreshedAt] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    const res = await fetchHandoffSnapshot({ task: selected, includeNoise: showNoise });
    // A slow response must not overwrite a newer one.
    if (seq !== requestSeq.current) return;
    if (res.data) {
      setSnapshot(res.data);
      setError(null);
      // Open the newest request until the owner picks one.
      const first = res.data.view?.tasks[0]?.task_id;
      if (selected === null && first !== undefined) setSelected(first);
    } else {
      setError(res.error ?? "Could not load the handoff snapshot.");
    }
    setViewerRefreshedAt(new Date().toISOString());
  }, [selected, showNoise]);

  // Load now, then refresh while visible; pause while the tab is hidden.
  const interval = snapshot?.refresh_hint_ms ?? 15_000;
  useEffect(() => {
    const initial = setTimeout(load, 0);
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(load, interval);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(initial);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, interval]);

  const view = snapshot?.view ?? null;
  const tasks = view?.tasks ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ArrowLeftRight className="h-5 w-5" /> Agent handoffs
          </h1>
          <p className="text-sm text-muted-foreground">
            What ChatGPT and Claude published on issue #80, and which handoff step each request has evidence for. Read only.
          </p>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200" data-testid="handoff-error">{error}</div> : null}

      {snapshot && !view ? (
        <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-6 text-sm" data-testid="handoff-unavailable">
          <Badge tone="muted">{snapshot.mode}</Badge>
          <p className="mt-2 text-muted-foreground">{snapshot.detail ?? snapshot.freshness?.error ?? "No snapshot has been collected yet."}</p>
        </div>
      ) : null}

      {snapshot ? <SourceBar snapshot={snapshot} viewerRefreshedAt={viewerRefreshedAt} /> : null}

      {view ? (
        <>
          {view.provenance.shared_accounts.length ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200" data-testid="handoff-provenance">
              {view.provenance.shared_accounts.map((s) => (
                <div key={s.login}>
                  GitHub account {s.login} posts as {s.senders.join(", ")}. Sender and model are self-reported; GitHub proves only the account.
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
            <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-3">
              <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Requests ({view.counts.tasks})</div>
              <TaskList tasks={tasks} selected={selected} onSelect={setSelected} />
            </div>
            <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-4">
              {view.task ? <TaskDetail task={view.task} /> : <div className="text-sm text-muted-foreground">Select a request.</div>}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-4 space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Unmatched or ambiguous replies ({view.unmatched.length})</div>
            <UnmatchedList items={view.unmatched} />
          </div>

          <div className="rounded-2xl border border-border/70 bg-slate-950/70 p-4 space-y-2" data-testid="handoff-feed">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Recent messages</div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={showNoise} onChange={(e) => setShowNoise(e.target.checked)} data-testid="handoff-noise-toggle" />
                Show autopilot events{view.noise_hidden ? ` (${view.noise_hidden} hidden)` : ""}
              </label>
            </div>
            {view.feed.map((m) => (
              <div key={m.comment_id} className="rounded-xl border border-border/60 bg-slate-900/70 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span className="font-medium text-foreground">{m.message_type ?? m.kind}</span>
                  <SourceLink url={m.url} label={m.message_id ?? `comment ${m.comment_id}`} />
                  <span>{m.sender ?? "—"} via {m.author ?? "?"}</span>
                  {m.in_reply_to ? <span>↩ {m.in_reply_to}</span> : null}
                  <span>{time(m.created_at)}</span>
                  {m.edit_state !== "UNEDITED" ? <Badge tone="bad">{m.edit_state}</Badge> : null}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-foreground/80">{m.excerpt}</div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
