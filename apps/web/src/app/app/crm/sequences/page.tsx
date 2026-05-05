"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Card, ContentContainer, PageHeader, Badge } from "@keyflow/ui";
import { Plus, Workflow, Users, Mail, MessageCircle, Phone, Clock, GitBranch, Copy, Trash2, BarChart3, TrendingUp, Trophy, ExternalLink } from "lucide-react";
import {
  AllVariantStepReport,
  CrmSequence,
  SequenceKpi,
  createSequence,
  deleteSequence,
  duplicateSequence,
  fetchAllSequenceVariantReports,
  fetchSequences,
  fetchSequencesSummary,
} from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  active: "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))] border-[hsl(var(--kf-success))]/30",
  paused: "bg-[hsl(var(--kf-warning))]/15 text-[hsl(var(--kf-warning))] border-[hsl(var(--kf-warning))]/30",
};

const NODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  whatsapp: MessageCircle,
  sms: Phone,
  wait: Clock,
  branch: GitBranch,
  end: Workflow,
};

function formatCurrencyShort(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "TTD",
      maximumFractionDigits: 0,
      notation: value > 9999 ? "compact" : "standard",
    }).format(value);
  } catch {
    return `$${value.toFixed(0)}`;
  }
}

type TabKey = "sequences" | "variants";

export default function SequencesListPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [sequences, setSequences] = useState<CrmSequence[]>([]);
  const [kpis, setKpis] = useState<Record<string, SequenceKpi>>({});
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<TabKey>("sequences");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const id = (await ensureWorkspace()) ?? getStoredBusinessId();
      if (cancelled || !id) return;
      setBusinessId(id);
      const [{ data: seqs }, { data: summary }] = await Promise.all([
        fetchSequences(id),
        fetchSequencesSummary(id),
      ]);
      if (cancelled) return;
      setSequences(seqs ?? []);
      const map: Record<string, SequenceKpi> = {};
      for (const k of summary ?? []) map[k.sequenceId] = k;
      setKpis(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const reload = () => {
    if (!businessId) return;
    startTransition(() => {
      void Promise.all([fetchSequences(businessId), fetchSequencesSummary(businessId)]).then(([{ data: seqs }, { data: summary }]) => {
        setSequences(seqs ?? []);
        const map: Record<string, SequenceKpi> = {};
        for (const k of summary ?? []) map[k.sequenceId] = k;
        setKpis(map);
      });
    });
  };

  const handleCreate = async () => {
    if (!businessId) return;
    const name = window.prompt("Name your sequence", "Untitled sequence");
    if (!name) return;
    const startId = `n_${Date.now()}_start`;
    const endId = `n_${Date.now()}_end`;
    const { data, error } = await createSequence(businessId, {
      name,
      graph: {
        version: 1,
        startNodeId: startId,
        nodes: [
          { id: startId, type: "email", position: { x: 240, y: 80 }, data: { subject: "", body: "", delayDays: 0 } },
          { id: endId, type: "end", position: { x: 240, y: 280 } },
        ],
        edges: [{ id: `e_${Date.now()}`, source: startId, target: endId, branch: "default" }],
      },
    });
    if (error || !data) {
      toast.error(error ?? "Failed to create sequence");
      return;
    }
    router.push(`/app/crm/sequences/${data.id}`);
  };

  const handleDuplicate = async (id: string) => {
    if (!businessId) return;
    const { error } = await duplicateSequence(businessId, id);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Sequence duplicated");
    reload();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!businessId) return;
    if (!window.confirm(`Archive "${name}"?`)) return;
    const { error } = await deleteSequence(businessId, id);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Sequence archived");
    reload();
  };

  const tabBtn = (key: TabKey, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        tab === key
          ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
      }`}
    >
      {label}
    </button>
  );

  return (
    <ContentContainer>
      <PageHeader
        title="Sequences"
        subtitle="Visual multi-channel sequences for outreach and follow-ups."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/app/crm/sequences/lifecycle">
              <Button variant="subtle" size="sm">
                <BarChart3 className="w-4 h-4 mr-1" /> Lifecycle report
              </Button>
            </Link>
            <Button onClick={handleCreate} disabled={!businessId}>
              <Plus className="w-4 h-4 mr-1" /> New sequence
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-1 border-b border-border/40 mb-4">
        {tabBtn("sequences", "Sequences")}
        {tabBtn("variants", "Variant performance")}
      </div>

      {tab === "sequences" ? (
        loading ? (
          <div className="text-sm text-muted-foreground py-12 text-center">Loading sequences…</div>
        ) : sequences.length === 0 ? (
          <Card padding="lg" className="text-center space-y-3">
            <Workflow className="w-10 h-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No sequences yet.</p>
            <Button onClick={handleCreate} disabled={!businessId} variant="subtle">
              <Plus className="w-4 h-4 mr-1" /> Create your first sequence
            </Button>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sequences.map((seq) => {
              const nodes = seq.graph?.nodes ?? [];
              const types = Array.from(new Set(nodes.map((n) => n.type)));
              const kpi = kpis[seq.id];
              return (
                <Card key={seq.id} padding="lg" className="space-y-3 hover:border-[hsl(var(--kf-accent1))]/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/app/crm/sequences/${seq.id}`} className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{seq.name}</p>
                      {seq.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{seq.description}</p>
                      )}
                    </Link>
                    <Badge className={STATUS_STYLES[seq.status] ?? STATUS_STYLES.draft}>
                      {seq.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {types.map((t) => {
                      const Icon = NODE_ICONS[t] ?? Workflow;
                      return (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/40 text-[10px] text-muted-foreground"
                        >
                          <Icon className="w-3 h-3" />
                          {t}
                        </span>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {kpi?.enrolled ?? seq.enrollmentCount ?? 0} enrolled
                    </span>
                    <span>{nodes.length} nodes</span>
                  </div>
                  {kpi && kpi.enrolled > 0 && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/30 text-[11px]">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-[hsl(var(--kf-info))]" />
                        <span className="text-muted-foreground">Reply</span>
                        <span className="ml-auto tabular-nums font-medium">{Math.round(kpi.replyRate * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Trophy className="w-3 h-3 text-[hsl(var(--kf-success))]" />
                        <span className="text-muted-foreground">Won</span>
                        <span className="ml-auto tabular-nums font-medium">
                          {kpi.attributedDeals > 0
                            ? formatCurrencyShort(kpi.attributedValue, kpi.currency)
                            : "—"}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1 pt-1 border-t border-border/30">
                    <Link href={`/app/crm/sequences/${seq.id}`} className="flex-1">
                      <Button variant="subtle" size="sm" className="w-full">
                        Open builder
                      </Button>
                    </Link>
                    <Link
                      href={`/app/crm/sequences/${seq.id}/analytics`}
                      className="p-2 rounded-md hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                      title="Analytics"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                    </Link>
                    <button
                      onClick={() => handleDuplicate(seq.id)}
                      className="p-2 rounded-md hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
                      title="Duplicate"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(seq.id, seq.name)}
                      className="p-2 rounded-md hover:bg-[hsl(var(--kf-error))]/15 text-muted-foreground hover:text-[hsl(var(--kf-error))] transition-colors"
                      title="Archive"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : (
        <VariantPerformancePanel businessId={businessId} sequences={sequences} />
      )}
    </ContentContainer>
  );
}

function VariantPerformancePanel({
  businessId,
  sequences,
}: {
  businessId: string | null;
  sequences: CrmSequence[];
}) {
  const [reports, setReports] = useState<AllVariantStepReport[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [sequenceFilter, setSequenceFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    void fetchAllSequenceVariantReports(businessId).then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast.error(error);
      setReports(data ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [businessId]);

  const channels = useMemo(() => {
    const set = new Set<string>();
    (reports ?? []).forEach((r) => set.add(r.channel));
    return Array.from(set).sort();
  }, [reports]);

  const filtered = useMemo(() => {
    return (reports ?? []).filter((r) => {
      if (sequenceFilter !== "all" && r.sequenceId !== sequenceFilter) return false;
      if (channelFilter !== "all" && r.channel !== channelFilter) return false;
      if (statusFilter !== "all" && r.sequenceStatus !== statusFilter) return false;
      return true;
    });
  }, [reports, sequenceFilter, channelFilter, statusFilter]);

  const totalSends = useMemo(
    () => filtered.reduce((sum, r) => sum + r.variants.reduce((s, v) => s + v.sent, 0), 0),
    [filtered],
  );

  if (!businessId || loading) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading variant performance…</div>;
  }

  if ((reports?.length ?? 0) === 0) {
    return (
      <Card padding="lg" className="text-center space-y-3">
        <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No send nodes found yet. Add email, WhatsApp, or SMS steps to your sequences to see variant performance here.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card padding="md" className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Sequence"
          value={sequenceFilter}
          onChange={setSequenceFilter}
          options={[
            { value: "all", label: "All sequences" },
            ...sequences.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <FilterSelect
          label="Channel"
          value={channelFilter}
          onChange={setChannelFilter}
          options={[
            { value: "all", label: "All channels" },
            ...channels.map((c) => ({ value: c, label: c })),
          ]}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
          ]}
        />
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} send {filtered.length === 1 ? "node" : "nodes"} · {totalSends.toLocaleString()} sends
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card padding="lg" className="text-center text-sm text-muted-foreground">
          No send nodes match the current filters.
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <VariantNodeRow key={`${r.sequenceId}:${r.nodeId}`} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-border/50 rounded-md px-2 py-1.5 text-xs text-foreground min-w-[140px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function pct(n: number) {
  return `${Math.round(n * 1000) / 10}%`;
}

function VariantNodeRow({ report }: { report: AllVariantStepReport }) {
  const ChannelIcon = NODE_ICONS[report.channel] ?? Workflow;
  const totalSent = report.variants.reduce((s, v) => s + v.sent, 0);
  return (
    <Card padding="md" className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link
              href={`/app/crm/sequences/${report.sequenceId}`}
              className="font-medium text-foreground hover:text-[hsl(var(--kf-accent1))] truncate"
            >
              {report.sequenceName}
            </Link>
            <Badge className={STATUS_STYLES[report.sequenceStatus] ?? STATUS_STYLES.draft}>
              {report.sequenceStatus}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/40 text-[10px] text-muted-foreground">
              <ChannelIcon className="w-3 h-3" /> {report.channel}
            </span>
            <span className="text-sm font-semibold">{report.nodeLabel}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{totalSent.toLocaleString()} sends</span>
          </div>
        </div>
        <Link
          href={`/app/crm/sequences/${report.sequenceId}?node=${encodeURIComponent(report.nodeId)}`}
          className="inline-flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))] hover:underline"
        >
          Jump to node <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {report.variants.length === 0 ? (
        <div className="text-xs text-muted-foreground">No variants configured on this node.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/40">
                <th className="text-left font-medium py-1.5 pr-2">Variant</th>
                <th className="text-right font-medium py-1.5 px-2 tabular-nums">Sent</th>
                <th className="text-right font-medium py-1.5 px-2 tabular-nums">Open</th>
                <th className="text-right font-medium py-1.5 px-2 tabular-nums">Click</th>
                <th className="text-right font-medium py-1.5 px-2 tabular-nums">Reply</th>
                <th className="text-right font-medium py-1.5 pl-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.variants.map((v) => (
                <tr key={v.variantId} className="border-b border-border/20 last:border-b-0">
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">{v.label}</span>
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums">{v.sent.toLocaleString()}</td>
                  <td className="text-right py-1.5 px-2 tabular-nums">{v.sent ? pct(v.openRate) : "—"}</td>
                  <td className="text-right py-1.5 px-2 tabular-nums">{v.sent ? pct(v.clickRate) : "—"}</td>
                  <td className="text-right py-1.5 px-2 tabular-nums">{v.sent ? pct(v.replyRate) : "—"}</td>
                  <td className="text-right py-1.5 pl-2">
                    {v.isWinner ? (
                      <span className="inline-flex items-center gap-1 text-[hsl(var(--kf-success))]">
                        <Trophy className="w-3 h-3" /> Winner
                      </span>
                    ) : v.isPromoted ? (
                      <span className="inline-flex items-center gap-1 text-[hsl(var(--kf-accent1))]">
                        <Trophy className="w-3 h-3" /> Promoted
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.winnerVariantId && (
            <div className="text-[11px] text-muted-foreground mt-2">
              Winner confidence: {pct(report.winnerConfidence)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
