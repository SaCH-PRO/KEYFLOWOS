"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  RefreshCw,
  Plus,
  Loader2,
  Play,
  Pause,
  Trash2,
  Copy,
  TrendingUp,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { UnifiedPageShell } from "@/components/layout/unified-page-shell";
import {
  listFlows,
  createFlow,
  deleteFlow,
  publishFlow,
  type AutomationFlow,
} from "@/lib/api/flow";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { ListPageSkeleton } from "@/components/ui/skeleton";

function statusBadge(status: string) {
  switch (status) {
    case "ACTIVE":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Active
        </span>
      );
    case "DRAFT":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium flex items-center gap-1">
          <Clock className="w-3 h-3" /> Draft
        </span>
      );
    case "PAUSED":
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-medium flex items-center gap-1">
          <Pause className="w-3 h-3" /> Paused
        </span>
      );
    default:
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
          {status}
        </span>
      );
  }
}

export default function FlowsPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<string>("ALL");

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await listFlows(businessId, { limit: 50 });
      setFlows(res.data?.items ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [businessId]);

  const handleCreate = async () => {
    if (!businessId) return;
    setCreating(true);
    try {
      const res = await createFlow(businessId, {
        name: "New Flow",
        description: "",
        category: "general",
      });
      if (res.data) {
        router.push(`/app/flows/${res.data.id}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    if (!confirm("Delete this flow?")) return;
    await deleteFlow(businessId, id);
    await load();
  };

  const handlePublish = async (id: string) => {
    if (!businessId) return;
    await publishFlow(businessId, id);
    await load();
  };

  const filtered =
    filter === "ALL"
      ? flows
      : flows.filter((f) => f.status === filter);

  if (!businessId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Select a business to view flows.</p>
      </div>
    );
  }

  return (
    <UnifiedPageShell
      title="Flows"
      subtitle="Automations, templates, and execution history."
      icon={RefreshCw}
      maxWidth="5xl"
      headerActions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/app/flows/templates")}
          >
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Templates
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={creating}>
            {creating ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5 mr-1.5" />
            )}
            New Flow
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SectionCard className="p-3">
          <p className="text-2xl font-bold">{flows.length}</p>
          <p className="text-xs text-muted-foreground">Total flows</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-2xl font-bold">{flows.filter((f) => f.status === "ACTIVE").length}</p>
          <p className="text-xs text-muted-foreground">Active</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-2xl font-bold">{flows.filter((f) => f.status === "DRAFT").length}</p>
          <p className="text-xs text-muted-foreground">Drafts</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-2xl font-bold">
            {flows.reduce((sum, f) => {
              const runs = (f.metrics?.totalRuns as number) ?? 0;
              return sum + runs;
            }, 0)}
          </p>
          <p className="text-xs text-muted-foreground">Total runs</p>
        </SectionCard>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        {["ALL", "ACTIVE", "DRAFT", "PAUSED"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === s
                ? "bg-foreground text-background"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            {s === "ALL" ? `All (${flows.length})` : s}
          </button>
        ))}
      </div>

      {/* Flow list */}
      <SectionCard>
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Your Flows</h2>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        {loading && flows.length === 0 ? (
          <ListPageSkeleton />
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Zap className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">
              {flows.length === 0 ? "No flows yet" : "No flows match this filter"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              {flows.length === 0
                ? "Create your first flow or start from a template to automate follow-ups, reminders, and lead capture."
                : "Try a different status filter."}
            </p>
            {flows.length === 0 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/app/flows/templates")}
                >
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  Browse Templates
                </Button>
                <Button size="sm" onClick={handleCreate} disabled={creating}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  New Flow
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map((flow) => (
              <div
                key={flow.id}
                className="p-4 flex items-start gap-3 hover:bg-muted/40 transition-colors"
              >
                <div className="mt-0.5 text-primary">
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => router.push(`/app/flows/${flow.id}`)}
                      className="text-sm font-medium hover:underline truncate"
                    >
                      {flow.name}
                    </button>
                    {statusBadge(flow.status)}
                    {flow.riskTier > 2 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                        Risk {flow.riskTier}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {flow.description || flow.goal || flow.category}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      {flow.triggerSummary || "Manual trigger"}
                    </span>
                    {(flow.metrics?.totalRuns as number) > 0 && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Play className="w-3 h-3" />
                        {(flow.metrics?.totalRuns as number) ?? 0} runs
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      Updated {new Date(flow.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {flow.status === "DRAFT" && (
                    <button
                      onClick={() => handlePublish(flow.id)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-emerald-400 transition-colors"
                      title="Publish"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {flow.status === "ACTIVE" && (
                    <button
                      onClick={() => router.push(`/app/flows/${flow.id}`)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
                      title="Edit"
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(flow.id)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </UnifiedPageShell>
  );
}
