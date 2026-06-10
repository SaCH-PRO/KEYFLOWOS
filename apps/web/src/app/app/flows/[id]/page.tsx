"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Zap,
  Loader2,
  ArrowLeft,
  Play,
  Trash2,
  Save,
  CheckCircle2,
  Clock,
  TrendingUp,
  History,
  XCircle,
  ChevronDown,
  ChevronUp,
  Activity,
  Timer,
  AlertTriangle,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getFlow,
  updateFlow,
  publishFlow,
  deleteFlow,
  testFlow,
  listFlowRuns,
  getFlowRunSteps,
  type AutomationFlow,
  type FlowVersion,
  type FlowRun,
  type FlowRunStep,
} from "@/lib/api/flow";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";

export default function FlowDetailPage() {
  const router = useRouter();
  const params = useParams();
  const flowId = params.id as string;
  const businessId = getStoredBusinessId() ?? "";

  const [flow, setFlow] = useState<AutomationFlow | null>(null);
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [_runLoading, _setRunLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runSteps, setRunSteps] = useState<Record<string, FlowRunStep[]>>({});

  const fetchRuns = useCallback(async () => {
    if (!businessId || !flowId) return;
    const runsRes = await listFlowRuns(businessId, flowId, { limit: 20 });
    if (runsRes.data) {
      setRuns(runsRes.data.items);
    }
  }, [businessId, flowId]);

  useEffect(() => {
    if (!businessId || !flowId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [flowRes, runsRes] = await Promise.all([
          getFlow(businessId, flowId),
          listFlowRuns(businessId, flowId, { limit: 20 }),
        ]);
        if (!cancelled && flowRes.data) {
          setFlow(flowRes.data);
          setVersions(flowRes.data.versions ?? []);
          setName(flowRes.data.name);
          setDescription(flowRes.data.description ?? "");
          setGoal(flowRes.data.goal ?? "");
        }
        if (!cancelled && runsRes.data) {
          setRuns(runsRes.data.items);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [businessId, flowId]);

  // Live polling when any run is RUNNING
  useEffect(() => {
    if (!businessId || !flowId) return;
    const hasRunning = runs.some((r) => r.status === "RUNNING");
    if (!hasRunning) return;

    const interval = setInterval(() => {
      fetchRuns();
    }, 3000);

    return () => clearInterval(interval);
  }, [businessId, flowId, runs, fetchRuns]);

  const handleSave = async () => {
    if (!businessId || !flowId) return;
    setSaving(true);
    try {
      await updateFlow(businessId, flowId, { name, description, goal });
      // refresh
      const res = await getFlow(businessId, flowId);
      if (res.data) {
        setFlow(res.data);
        setVersions(res.data.versions ?? []);
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!businessId || !flowId) return;
    setPublishing(true);
    try {
      await publishFlow(businessId, flowId);
      const res = await getFlow(businessId, flowId);
      if (res.data) {
        setFlow(res.data);
        setVersions(res.data.versions ?? []);
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleTest = async () => {
    if (!businessId || !flowId) return;
    setTesting(true);
    try {
      await testFlow(businessId, flowId, { payload: {} });
      // Refresh runs
      const runsRes = await listFlowRuns(businessId, flowId, { limit: 20 });
      if (runsRes.data) setRuns(runsRes.data.items);
    } finally {
      setTesting(false);
    }
  };

  const toggleRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (!runSteps[runId] && businessId && flowId) {
      const res = await getFlowRunSteps(businessId, flowId, runId);
      if (res.data) {
        setRunSteps((prev) => ({ ...prev, [runId]: res.data!.items }));
      }
    }
  };

  const runMetrics = useMemo(() => {
    const total = runs.length;
    const completed = runs.filter((r) => r.status === "COMPLETED").length;
    const failed = runs.filter((r) => r.status === "FAILED").length;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const completedDurations = runs
      .filter((r) => r.status === "COMPLETED" && r.startedAt && r.completedAt)
      .map((r) => new Date(r.completedAt!).getTime() - new Date(r.startedAt).getTime());

    const avgDuration =
      completedDurations.length > 0
        ? completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length
        : 0;

    return { total, successRate, avgDuration, failed };
  }, [runs]);

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const handleDelete = async () => {
    if (!businessId || !flowId) return;
    if (!confirm("Delete this flow permanently?")) return;
    await deleteFlow(businessId, flowId);
    router.push("/app/flows");
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Flow not found.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => router.push("/app/flows")}
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
          Back to Flows
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => router.push("/app/flows")}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              {flow.name}
            </h1>
            {flow.status === "ACTIVE" ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Active
              </span>
            ) : flow.status === "DRAFT" ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium flex items-center gap-1">
                <Clock className="w-3 h-3" /> Draft
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {flow.status}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {flow.category} • {flow.triggerSummary || "Manual trigger"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 mr-1.5" />
            )}
            Test
          </Button>
          {flow.status === "DRAFT" && (
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={publishing}
            >
              {publishing ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
              )}
              Publish
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-red-400 hover:text-red-300"
            onClick={handleDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Editor */}
      <SectionCard className="p-4 space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Goal</label>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5 mr-1.5" />
            )}
            Save
          </Button>
        </div>
      </SectionCard>

      {/* Versions */}
      <SectionCard>
        <div className="p-4 border-b border-border/60">
          <h2 className="text-sm font-semibold">Versions</h2>
        </div>
        {versions.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No versions yet. Save changes to create a version.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {versions.map((v) => (
              <div key={v.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Version {v.version}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.status} • {new Date(v.createdAt).toLocaleDateString()}
                    {v.publishedAt && ` • Published ${new Date(v.publishedAt).toLocaleDateString()}`}
                  </p>
                </div>
                {v.status === "PUBLISHED" && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Metrics */}
      {flow.metrics && Object.keys(flow.metrics).length > 0 && (
        <SectionCard>
          <div className="p-4 border-b border-border/60">
            <h2 className="text-sm font-semibold">Metrics</h2>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Object.entries(flow.metrics).map(([key, value]) => (
              <div key={key}>
                <p className="text-xs text-muted-foreground capitalize">{key.replace(/_/g, " ")}</p>
                <p className="text-lg font-semibold">{String(value)}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Run Metrics */}
      {runs.length > 0 && (
        <SectionCard>
          <div className="p-4 border-b border-border/60">
            <h2 className="text-sm font-semibold">Run Metrics</h2>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Total Runs</p>
              <p className="text-lg font-semibold flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-primary" />
                {runMetrics.total}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Success Rate</p>
              <p className="text-lg font-semibold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                {runMetrics.successRate}%
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg Duration</p>
              <p className="text-lg font-semibold flex items-center gap-1.5">
                <Timer className="w-4 h-4 text-blue-400" />
                {runMetrics.avgDuration > 0 ? formatDuration(runMetrics.avgDuration) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Failed</p>
              <p className="text-lg font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                {runMetrics.failed}
              </p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Run History */}
      <SectionCard>
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            Run History
          </h2>
          <span className="text-xs text-muted-foreground">{runs.length} runs</span>
        </div>
        {runs.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No runs yet. Click Test to run this flow manually.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {runs.map((run) => (
              <div key={run.id}>
                <button
                  onClick={() => toggleRun(run.id)}
                  className="w-full p-4 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left"
                >
                  {run.status === "COMPLETED" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : run.status === "FAILED" ? (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{run.status}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                    </div>
                    {run.error && (
                      <p className="text-[10px] text-red-400 truncate">{run.error}</p>
                    )}
                  </div>
                  {expandedRunId === run.id ? (
                    <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                </button>
                {expandedRunId === run.id && (
                  <div className="px-4 pb-4 pl-11">
                    {runSteps[run.id] ? (
                      <div className="space-y-2">
                        {runSteps[run.id].map((step, idx) => {
                          const isCurrent = run.currentNodeId === step.nodeId;
                          const duration =
                            step.startedAt && step.completedAt
                              ? new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()
                              : null;

                          return (
                            <div
                              key={step.id}
                              className={`flex items-center gap-2 text-xs p-2 rounded-md ${
                                step.status === "COMPLETED"
                                  ? "bg-emerald-500/5"
                                  : step.status === "FAILED"
                                  ? "bg-red-500/5"
                                  : "bg-muted/30"
                              }`}
                            >
                              <span className="text-muted-foreground w-4">{idx + 1}</span>
                              <span className="font-medium capitalize">{step.nodeType.replace(/_/g, " ")}</span>
                              {isCurrent && (
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                </span>
                              )}
                              <span className="ml-auto flex items-center gap-2">
                                {duration !== null && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatDuration(duration)}
                                  </span>
                                )}
                                <span
                                  className={`text-[10px] ${
                                    step.status === "COMPLETED"
                                      ? "text-emerald-400"
                                      : step.status === "FAILED"
                                      ? "text-red-400"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {step.status}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Loading steps...
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
