"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Mail,
  MessageCircle,
  Phone,
  Clock,
  GitBranch,
  CheckCircle2,
  Trash2,
  X,
  Save,
  Play,
  Pause,
  AlertCircle,
} from "lucide-react";
import { Button, ContentContainer, Badge, Input } from "@keyflow/ui";
import {
  CrmSequenceDetail,
  SequenceEdge,
  SequenceGraph,
  SequenceNode,
  SequenceNodeType,
  fetchSequenceDetail,
  updateSequence,
} from "@/lib/client";
import { ensureWorkspace, getStoredBusinessId } from "@/lib/workspace";

const NODE_META: Record<SequenceNodeType, { icon: React.ComponentType<{ className?: string }>; label: string; color: string }> = {
  email: { icon: Mail, label: "Email", color: "border-[hsl(var(--kf-info))]/40 bg-[hsl(var(--kf-info))]/[0.06]" },
  whatsapp: { icon: MessageCircle, label: "WhatsApp", color: "border-emerald-500/40 bg-emerald-500/[0.06]" },
  sms: { icon: Phone, label: "SMS", color: "border-violet-500/40 bg-violet-500/[0.06]" },
  wait: { icon: Clock, label: "Wait", color: "border-slate-500/40 bg-slate-500/[0.06]" },
  branch: { icon: GitBranch, label: "Branch", color: "border-[hsl(var(--kf-warning))]/40 bg-[hsl(var(--kf-warning))]/[0.06]" },
  end: { icon: CheckCircle2, label: "End", color: "border-[hsl(var(--kf-success))]/40 bg-[hsl(var(--kf-success))]/[0.06]" },
};

const MERGE_FIELDS = [
  "{{contact.firstName}}",
  "{{contact.lastName}}",
  "{{contact.email}}",
  "{{contact.phone}}",
  "{{contact.companyName}}",
  "{{business.name}}",
];

const NODE_W = 220;
const NODE_H = 120;

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function validateGraph(graph: SequenceGraph): string[] {
  const errors: string[] = [];
  if (graph.nodes.length === 0) {
    errors.push("Sequence must have at least one node");
    return errors;
  }
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (!graph.startNodeId || !ids.has(graph.startNodeId)) {
    errors.push("Sequence must have a start node");
  }
  // Check reachability
  const reachable = new Set<string>();
  const queue: string[] = graph.startNodeId ? [graph.startNodeId] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    graph.edges.filter((e) => e.source === id).forEach((e) => queue.push(e.target));
  }
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      errors.push(`Node "${node.data?.label ?? node.type}" is unreachable`);
    }
    const outgoing = graph.edges.filter((e) => e.source === node.id);
    if (node.type === "end") {
      if (outgoing.length > 0) errors.push("End node cannot have outgoing edges");
      continue;
    }
    if (node.type === "branch") {
      const yes = outgoing.find((e) => e.branch === "yes");
      const no = outgoing.find((e) => e.branch === "no");
      if (!yes || !no) errors.push("Branch node must have both yes and no edges");
    } else if (outgoing.length === 0) {
      errors.push(`Node "${node.data?.label ?? node.type}" needs an outgoing connection`);
    }
  }
  // Cycle detection
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(id: string): boolean {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const e of graph.edges.filter((x) => x.source === id)) {
      if (dfs(e.target)) return true;
    }
    stack.delete(id);
    return false;
  }
  if (graph.startNodeId && dfs(graph.startNodeId)) {
    errors.push("Sequence has a cycle");
  }
  return errors;
}

export default function SequenceBuilderPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sequenceId = params?.id;

  const [businessId, setBusinessId] = useState<string | null>(null);
  const [sequence, setSequence] = useState<CrmSequenceDetail | null>(null);
  const [graph, setGraph] = useState<SequenceGraph | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pendingEdgeFrom, setPendingEdgeFrom] = useState<{ nodeId: string; branch?: "yes" | "no" | "default" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sequenceId) return;
    let cancelled = false;
    void (async () => {
      const id = (await ensureWorkspace()) ?? getStoredBusinessId();
      if (cancelled || !id) return;
      setBusinessId(id);
      const { data, error } = await fetchSequenceDetail(id, sequenceId);
      if (cancelled) return;
      if (error || !data) {
        toast.error(error ?? "Failed to load sequence");
        router.push("/app/crm/sequences");
        return;
      }
      setSequence(data);
      setName(data.name);
      setDescription(data.description ?? "");
      setStatus(data.status);
      setGraph(data.graph ?? { version: 1, startNodeId: null, nodes: [], edges: [] });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sequenceId, router]);

  const errors = useMemo(() => (graph ? validateGraph(graph) : []), [graph]);
  const selectedNode = useMemo(
    () => (selectedNodeId && graph ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [selectedNodeId, graph],
  );

  const updateNode = useCallback((id: string, updater: (n: SequenceNode) => SequenceNode) => {
    setGraph((prev) => {
      if (!prev) return prev;
      return { ...prev, nodes: prev.nodes.map((n) => (n.id === id ? updater(n) : n)) };
    });
  }, []);

  const addNode = useCallback((type: SequenceNodeType) => {
    setGraph((prev) => {
      if (!prev) return prev;
      const id = newId("n");
      const x = 80 + (prev.nodes.length % 4) * (NODE_W + 60);
      const y = 80 + Math.floor(prev.nodes.length / 4) * (NODE_H + 80);
      const node: SequenceNode = {
        id,
        type,
        position: { x, y },
        data: type === "wait"
          ? { delayDays: 1, delayHours: 0, label: "Wait 1 day" }
          : type === "branch"
            ? { condition: "no_reply", waitForDays: 3, label: "Replied?" }
            : type === "end"
              ? { label: "End" }
              : { subject: "", body: "", delayDays: 0, label: NODE_META[type].label },
      };
      const startNodeId = prev.startNodeId ?? (type !== "end" ? id : null);
      return { ...prev, nodes: [...prev.nodes, node], startNodeId };
    });
  }, []);

  const removeNode = useCallback((id: string) => {
    setGraph((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== id),
        edges: prev.edges.filter((e) => e.source !== id && e.target !== id),
        startNodeId: prev.startNodeId === id ? null : prev.startNodeId,
      };
    });
    setSelectedNodeId(null);
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (pendingEdgeFrom) {
      if (pendingEdgeFrom.nodeId === nodeId) {
        setPendingEdgeFrom(null);
        return;
      }
      setGraph((prev) => {
        if (!prev) return prev;
        const filtered = prev.edges.filter(
          (e) => !(e.source === pendingEdgeFrom.nodeId && (e.branch ?? "default") === (pendingEdgeFrom.branch ?? "default")),
        );
        const newEdge: SequenceEdge = {
          id: newId("e"),
          source: pendingEdgeFrom.nodeId,
          target: nodeId,
          branch: pendingEdgeFrom.branch ?? "default",
        };
        return { ...prev, edges: [...filtered, newEdge] };
      });
      setPendingEdgeFrom(null);
      return;
    }
    setSelectedNodeId(nodeId);
  }, [pendingEdgeFrom]);

  const removeEdge = useCallback((edgeId: string) => {
    setGraph((prev) => prev ? { ...prev, edges: prev.edges.filter((e) => e.id !== edgeId) } : prev);
  }, []);

  const setStartNode = useCallback((id: string) => {
    setGraph((prev) => prev ? { ...prev, startNodeId: id } : prev);
  }, []);

  // Drag nodes
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    e.preventDefault();
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    dragRef.current = {
      id: nodeId,
      offsetX: e.clientX - (node.position?.x ?? 0),
      offsetY: e.clientY - (node.position?.y ?? 0),
    };
  }, [graph]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const { id, offsetX, offsetY } = dragRef.current;
      updateNode(id, (n) => ({ ...n, position: { x: Math.max(0, e.clientX - offsetX), y: Math.max(0, e.clientY - offsetY) } }));
    }
    function onUp() { dragRef.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateNode]);

  const handleSave = useCallback(async (newStatus?: string) => {
    if (!businessId || !sequenceId || !graph) return;
    const targetStatus = newStatus ?? status;
    if (targetStatus === "active") {
      const errs = validateGraph(graph);
      if (errs.length > 0) {
        toast.error(`Cannot activate: ${errs[0]}`);
        return;
      }
    }
    setSaving(true);
    try {
      const { data, error } = await updateSequence(businessId, sequenceId, {
        name: name.trim() || "Untitled sequence",
        description: description.trim() || undefined,
        graph,
        status: targetStatus,
      });
      if (error || !data) throw new Error(error ?? "Failed to save");
      setStatus(data.status);
      toast.success(targetStatus === "active" ? "Sequence activated" : targetStatus === "paused" ? "Sequence paused" : "Sequence saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [businessId, sequenceId, graph, name, description, status]);

  if (loading || !graph || !sequence) {
    return (
      <ContentContainer>
        <div className="text-sm text-muted-foreground py-12 text-center">Loading sequence…</div>
      </ContentContainer>
    );
  }

  // Build edge svg paths
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const canvasWidth = Math.max(1200, ...graph.nodes.map((n) => (n.position?.x ?? 0) + NODE_W + 80));
  const canvasHeight = Math.max(700, ...graph.nodes.map((n) => (n.position?.y ?? 0) + NODE_H + 80));

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/40 bg-card/40 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Link href="/app/crm/sequences" className="p-2 rounded-md hover:bg-muted/30">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border-0 outline-none text-base font-semibold flex-1 min-w-0"
            placeholder="Untitled sequence"
          />
          <Badge className={status === "active" ? "bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))]" : status === "paused" ? "bg-[hsl(var(--kf-warning))]/15 text-[hsl(var(--kf-warning))]" : "bg-slate-500/15 text-slate-300"}>
            {status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {errors.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--kf-warning))]">
              <AlertCircle className="w-3.5 h-3.5" />
              {errors.length} issue{errors.length === 1 ? "" : "s"}
            </span>
          )}
          <Button variant="subtle" size="sm" onClick={() => handleSave()} disabled={saving}>
            <Save className="w-3.5 h-3.5 mr-1" /> Save draft
          </Button>
          {status !== "active" ? (
            <Button size="sm" onClick={() => handleSave("active")} disabled={saving || errors.length > 0}>
              <Play className="w-3.5 h-3.5 mr-1" /> Activate
            </Button>
          ) : (
            <Button variant="subtle" size="sm" onClick={() => handleSave("paused")} disabled={saving}>
              <Pause className="w-3.5 h-3.5 mr-1" /> Pause
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left palette */}
        <aside className="w-44 border-r border-border/40 bg-card/30 p-3 space-y-2 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Add node</p>
          {(Object.keys(NODE_META) as SequenceNodeType[]).map((t) => {
            const Icon = NODE_META[t].icon;
            return (
              <button
                key={t}
                onClick={() => addNode(t)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-medium hover:scale-[1.02] transition-transform ${NODE_META[t].color}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {NODE_META[t].label}
              </button>
            );
          })}
          {errors.length > 0 && (
            <div className="mt-4 p-2 rounded-lg border border-[hsl(var(--kf-warning))]/30 bg-[hsl(var(--kf-warning))]/10 text-[10px] text-[hsl(var(--kf-warning))] space-y-1">
              <p className="font-semibold">Validation issues:</p>
              <ul className="space-y-0.5 list-disc list-inside">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </aside>

        {/* Canvas */}
        <div ref={canvasRef} className="flex-1 overflow-auto bg-background relative">
          <div
            className="relative"
            style={{ width: canvasWidth, height: canvasHeight, backgroundImage: "radial-gradient(circle, hsl(var(--border)/0.4) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
          >
            <svg className="absolute inset-0 pointer-events-none" width={canvasWidth} height={canvasHeight}>
              {graph.edges.map((edge) => {
                const s = nodeMap.get(edge.source);
                const t = nodeMap.get(edge.target);
                if (!s || !t) return null;
                const sx = (s.position?.x ?? 0) + NODE_W / 2;
                const sy = (s.position?.y ?? 0) + NODE_H;
                const tx = (t.position?.x ?? 0) + NODE_W / 2;
                const ty = t.position?.y ?? 0;
                const my = (sy + ty) / 2;
                const path = `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`;
                const color = edge.branch === "yes" ? "hsl(var(--kf-success))" : edge.branch === "no" ? "hsl(var(--kf-error))" : "hsl(var(--border))";
                return (
                  <g key={edge.id}>
                    <path d={path} stroke={color} strokeWidth={2} fill="none" />
                    {edge.branch && edge.branch !== "default" && (
                      <text x={(sx + tx) / 2} y={my - 6} fill={color} fontSize={10} textAnchor="middle" className="font-semibold uppercase">
                        {edge.branch}
                      </text>
                    )}
                    <circle
                      cx={(sx + tx) / 2}
                      cy={my}
                      r={8}
                      fill="hsl(var(--background))"
                      stroke={color}
                      strokeWidth={1.5}
                      className="pointer-events-auto cursor-pointer"
                      onClick={() => removeEdge(edge.id)}
                    >
                      <title>Remove edge</title>
                    </circle>
                    <text x={(sx + tx) / 2} y={my + 3} fill={color} fontSize={10} textAnchor="middle" className="pointer-events-none select-none font-bold">×</text>
                  </g>
                );
              })}
            </svg>

            {graph.nodes.map((node) => {
              const meta = NODE_META[node.type];
              const Icon = meta.icon;
              const isSelected = selectedNodeId === node.id;
              const isStart = graph.startNodeId === node.id;
              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={() => handleNodeClick(node.id)}
                  className={`absolute rounded-xl border-2 p-3 cursor-move shadow-md hover:shadow-lg transition-shadow ${meta.color} ${isSelected ? "ring-2 ring-[hsl(var(--kf-accent1))]" : ""}`}
                  style={{ left: node.position?.x ?? 0, top: node.position?.y ?? 0, width: NODE_W, minHeight: NODE_H }}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <Icon className="w-3.5 h-3.5" />
                      {meta.label}
                      {isStart && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]">START</span>}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); removeNode(node.id); }} className="text-muted-foreground hover:text-[hsl(var(--kf-error))]">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  {node.type === "email" || node.type === "whatsapp" || node.type === "sms" ? (
                    <>
                      {node.type === "email" && (
                        <p className="text-[10px] text-muted-foreground truncate mb-0.5">
                          {node.data?.subject || <em className="opacity-60">No subject</em>}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground line-clamp-2">
                        {node.data?.body || <em className="opacity-60">No content yet</em>}
                      </p>
                      <p className="text-[9px] text-muted-foreground/60 mt-1">
                        Wait {node.data?.delayDays ?? 0}d {node.data?.delayHours ?? 0}h
                      </p>
                    </>
                  ) : node.type === "wait" ? (
                    <p className="text-xs text-muted-foreground">
                      {node.data?.delayDays ?? 0} day{(node.data?.delayDays ?? 0) === 1 ? "" : "s"}, {node.data?.delayHours ?? 0}h
                    </p>
                  ) : node.type === "branch" ? (
                    <p className="text-xs text-muted-foreground">
                      If <span className="font-semibold">{node.data?.condition ?? "no_reply"}</span> within {node.data?.waitForDays ?? 3} day(s)
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sequence ends here.</p>
                  )}

                  {/* Connection handles */}
                  {node.type !== "end" && (
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                      {node.type === "branch" ? (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPendingEdgeFrom({ nodeId: node.id, branch: "yes" }); }}
                            className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-[hsl(var(--kf-success))]/40 bg-[hsl(var(--kf-success))]/15 text-[hsl(var(--kf-success))] hover:bg-[hsl(var(--kf-success))]/25"
                          >
                            YES →
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPendingEdgeFrom({ nodeId: node.id, branch: "no" }); }}
                            className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-[hsl(var(--kf-error))]/40 bg-[hsl(var(--kf-error))]/15 text-[hsl(var(--kf-error))] hover:bg-[hsl(var(--kf-error))]/25"
                          >
                            NO →
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPendingEdgeFrom({ nodeId: node.id, branch: "default" }); }}
                          className="px-1.5 py-0.5 text-[9px] font-bold rounded border border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/25"
                        >
                          {pendingEdgeFrom?.nodeId === node.id ? "Click target…" : "→ Connect"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {graph.nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Add a node from the left panel to begin.
              </div>
            )}
          </div>
        </div>

        {/* Right inspector */}
        <aside className="w-80 border-l border-border/40 bg-card/30 overflow-y-auto">
          {!selectedNode ? (
            <div className="p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Sequence</p>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="kf-input w-full text-xs mt-1 min-h-[80px]"
                  placeholder="What is this sequence for?"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {graph.nodes.length} node{graph.nodes.length === 1 ? "" : "s"} · {graph.edges.length} edge{graph.edges.length === 1 ? "" : "s"} · {sequence.enrollments?.length ?? 0} enrolled
              </p>
              <div className="pt-3 border-t border-border/40">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">Active enrollments</p>
                {sequence.enrollments && sequence.enrollments.length > 0 ? (
                  <div className="space-y-1.5">
                    {sequence.enrollments.slice(0, 8).map((e) => (
                      <div key={e.id} className="text-xs flex items-center justify-between">
                        <span className="truncate">{e.contactName}</span>
                        <Badge className="text-[9px]">{e.status}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No contacts enrolled yet.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {NODE_META[selectedNode.type].label} node
                </p>
                <button onClick={() => setSelectedNodeId(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <label className="block">
                <span className="text-[11px] text-muted-foreground">Label</span>
                <Input
                  value={selectedNode.data?.label ?? ""}
                  onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, label: e.target.value } }))}
                  className="text-xs mt-1"
                />
              </label>

              {(selectedNode.type === "email" || selectedNode.type === "whatsapp" || selectedNode.type === "sms") && (
                <>
                  {selectedNode.type === "email" && (
                    <label className="block">
                      <span className="text-[11px] text-muted-foreground">Subject</span>
                      <Input
                        value={selectedNode.data?.subject ?? ""}
                        onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, subject: e.target.value } }))}
                        className="text-xs mt-1"
                        placeholder="Hi {{contact.firstName}}…"
                      />
                    </label>
                  )}
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Message body</span>
                    <textarea
                      value={selectedNode.data?.body ?? ""}
                      onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, body: e.target.value } }))}
                      className="kf-input w-full text-xs mt-1 min-h-[140px] font-mono"
                      placeholder="Write your message…"
                    />
                  </label>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground/70">Insert merge field:</p>
                    <div className="flex flex-wrap gap-1">
                      {MERGE_FIELDS.map((f) => (
                        <button
                          key={f}
                          onClick={() => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, body: (n.data?.body ?? "") + " " + f } }))}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-muted/40 hover:bg-muted/70 font-mono"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[11px] text-muted-foreground">Wait days</span>
                      <Input
                        type="number"
                        min={0}
                        value={selectedNode.data?.delayDays ?? 0}
                        onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, delayDays: Math.max(0, Number(e.target.value) || 0) } }))}
                        className="text-xs mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-muted-foreground">Wait hours</span>
                      <Input
                        type="number"
                        min={0}
                        value={selectedNode.data?.delayHours ?? 0}
                        onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, delayHours: Math.max(0, Number(e.target.value) || 0) } }))}
                        className="text-xs mt-1"
                      />
                    </label>
                  </div>
                </>
              )}

              {selectedNode.type === "wait" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Days</span>
                    <Input
                      type="number"
                      min={0}
                      value={selectedNode.data?.delayDays ?? 0}
                      onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, delayDays: Math.max(0, Number(e.target.value) || 0) } }))}
                      className="text-xs mt-1"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Hours</span>
                    <Input
                      type="number"
                      min={0}
                      value={selectedNode.data?.delayHours ?? 0}
                      onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, delayHours: Math.max(0, Number(e.target.value) || 0) } }))}
                      className="text-xs mt-1"
                    />
                  </label>
                </div>
              )}

              {selectedNode.type === "branch" && (
                <>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Condition</span>
                    <select
                      value={selectedNode.data?.condition ?? "no_reply"}
                      onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, condition: e.target.value as NonNullable<SequenceNode["data"]>["condition"] } }))}
                      className="kf-input w-full text-xs mt-1"
                    >
                      <option value="opened">Opened email</option>
                      <option value="clicked">Clicked link</option>
                      <option value="replied">Replied</option>
                      <option value="no_reply">No reply</option>
                      <option value="engaged">Engaged (any)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-muted-foreground">Wait for (days)</span>
                    <Input
                      type="number"
                      min={1}
                      value={selectedNode.data?.waitForDays ?? 3}
                      onChange={(e) => updateNode(selectedNode.id, (n) => ({ ...n, data: { ...n.data, waitForDays: Math.max(1, Number(e.target.value) || 1) } }))}
                      className="text-xs mt-1"
                    />
                  </label>
                  <p className="text-[10px] text-muted-foreground/70">
                    Connect both <span className="text-[hsl(var(--kf-success))] font-semibold">YES</span> and <span className="text-[hsl(var(--kf-error))] font-semibold">NO</span> branches to downstream nodes.
                  </p>
                </>
              )}

              {selectedNode.type !== "end" && graph.startNodeId !== selectedNode.id && (
                <Button variant="subtle" size="sm" className="w-full" onClick={() => setStartNode(selectedNode.id)}>
                  Set as start node
                </Button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
