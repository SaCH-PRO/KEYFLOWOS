"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Card, ContentContainer, PageHeader, Badge } from "@keyflow/ui";
import { Plus, Workflow, Users, Mail, MessageCircle, Phone, Clock, GitBranch, Copy, Trash2, BarChart3, TrendingUp, Trophy } from "lucide-react";
import {
  CrmSequence,
  SequenceKpi,
  createSequence,
  deleteSequence,
  duplicateSequence,
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

export default function SequencesListPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [sequences, setSequences] = useState<CrmSequence[]>([]);
  const [kpis, setKpis] = useState<Record<string, SequenceKpi>>({});
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

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

      {loading ? (
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
      )}
    </ContentContainer>
  );
}
