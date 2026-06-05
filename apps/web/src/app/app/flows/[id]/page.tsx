"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getFlow,
  updateFlow,
  publishFlow,
  deleteFlow,
  testFlow,
  type AutomationFlow,
  type FlowVersion,
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

  useEffect(() => {
    if (!businessId || !flowId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await getFlow(businessId, flowId);
        if (!cancelled && res.data) {
          setFlow(res.data);
          setVersions(res.data.versions ?? []);
          setName(res.data.name);
          setDescription(res.data.description ?? "");
          setGoal(res.data.goal ?? "");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [businessId, flowId]);

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
      alert("Test run started. Check the runs tab for results.");
    } finally {
      setTesting(false);
    }
  };

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
    </div>
  );
}
