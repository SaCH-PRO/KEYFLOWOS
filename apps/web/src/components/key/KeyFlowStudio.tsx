"use client";

/**
 * KeyFlowStudio — Canvas-based visual flow builder for KeyFlowOS
 * The main orchestrator component: canvas with grid, drag-and-drop,
 * 13 node types, bezier connections, selection, context menu, zoom/pan,
 * minimap, toolbar, node palette, template gallery, save/load, execute.
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Copy,
  Trash2,
  Play,
  LayoutTemplate,
  X,
  Check,
  Sparkles,
  MousePointer2,
} from "lucide-react";
import {
  type FlowNodeUI,
  type FlowEdgeUI,
  type FlowNodeType,
  type FlowTemplate,
  type ViewportState,
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
} from "./flow-studio-types";
import { KeyFlowNode } from "./KeyFlowNode";
import { KeyFlowProperties } from "./KeyFlowProperties";
import { KeyFlowToolbar } from "./KeyFlowToolbar";
import { KeyFlowNodePalette } from "./KeyFlowNodePalette";

/* ── helpers ──────────────────────────────────────────────────────── */
let _idCounter = 0;
const uid = () => `n_${++_idCounter}_${Date.now().toString(36)}`;
const eid = () => `e_${++_idCounter}_${Date.now().toString(36)}`;

const GRID_SIZE = 20;
const SNAP = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE;
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Create a fresh node at (x,y) */
function createDefaultNode(
  type: FlowNodeType,
  x: number,
  y: number
): FlowNodeUI {
  const inputs: FlowNodeUI["inputs"] =
    type === "trigger" ? [] : [{ id: "in-1", type: "input", position: { x: 0, y: 0 } }];

  const outputs: FlowNodeUI["outputs"] = [
    { id: "out-1", type: "output", position: { x: 0, y: 0 }, label: "Next" },
  ];

  if (type === "condition") {
    outputs[0].label = "True";
    outputs.push({
      id: "out-2",
      type: "output",
      position: { x: 0, y: 14 },
      label: "False",
    });
  }
  if (type === "split") {
    outputs.push({
      id: "out-2",
      type: "output",
      position: { x: 0, y: 14 },
      label: "Branch B",
    });
    outputs.push({
      id: "out-3",
      type: "output",
      position: { x: 0, y: 28 },
      label: "Branch C",
    });
  }

  return {
    id: uid(),
    type,
    position: { x, y },
    data: { label: NODE_TYPE_LABELS[type], config: {} },
    inputs,
    outputs,
  };
}

/** Cubic bezier path between two points */
function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = Math.abs(x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/** Port absolute centre on canvas */
function portCenter(
  node: FlowNodeUI,
  portId: string,
  zoom: number
): { x: number; y: number } | null {
  const port =
    node.inputs.find((p) => p.id === portId) ??
    node.outputs.find((p) => p.id === portId);
  if (!port) return null;
  const isInput = node.inputs.some((p) => p.id === portId);
  const sideX = isInput ? 0 : 200;
  const portY = 38 + (port.position?.y || 0) + 7;
  return {
    x: (node.position.x + sideX) * zoom,
    y: (node.position.y + portY) * zoom,
  };
}

/* ── built-in templates ────────────────────────────────────────────── */
const BUILT_IN_TEMPLATES: FlowTemplate[] = [
  {
    id: "welcome-flow",
    name: "Welcome Flow",
    description: "Send a welcome email when a new contact is created",
    category: "Onboarding",
    tags: ["email", "contacts"],
    nodes: [
      createDefaultNode("trigger", 100, 100),
      createDefaultNode("action", 400, 100),
      createDefaultNode("notification", 700, 100),
    ],
    edges: [],
  },
  {
    id: "ai-classifier",
    name: "AI Classifier",
    description: "Use AI to classify incoming messages and route them",
    category: "AI",
    tags: ["ai", "routing"],
    nodes: [
      createDefaultNode("trigger", 100, 100),
      createDefaultNode("ai_decision", 400, 100),
      createDefaultNode("action", 700, 60),
      createDefaultNode("action", 700, 160),
    ],
    edges: [],
  },
  {
    id: "approval-process",
    name: "Approval Process",
    description: "Multi-step approval with conditions and delays",
    category: "Workflow",
    tags: ["approval", "conditions"],
    nodes: [
      createDefaultNode("trigger", 100, 100),
      createDefaultNode("condition", 400, 100),
      createDefaultNode("delay", 700, 60),
      createDefaultNode("notification", 700, 180),
    ],
    edges: [],
  },
];

/* ── default viewport ─────────────────────────────────────────────── */
const DEFAULT_VIEWPORT: ViewportState = { x: 0, y: 0, zoom: 1 };

/* ── main component ───────────────────────────────────────────────── */
export interface KeyFlowStudioProps {
  initialFlowName?: string;
  initialNodes?: FlowNodeUI[];
  initialEdges?: FlowEdgeUI[];
  onSave?: (state: {
    name: string;
    nodes: FlowNodeUI[];
    edges: FlowEdgeUI[];
  }) => void;
  onExecute?: (state: {
    name: string;
    nodes: FlowNodeUI[];
    edges: FlowEdgeUI[];
  }) => void;
}

export function KeyFlowStudio({
  initialFlowName = "New Flow",
  initialNodes,
  initialEdges,
  onSave,
  onExecute,
}: KeyFlowStudioProps) {
  /* ── state ─────────────────────────────────────────────────────── */
  const [nodes, setNodes] = useState<FlowNodeUI[]>(initialNodes ?? []);
  const [edges, setEdges] = useState<FlowEdgeUI[]>(initialEdges ?? []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [flowName, setFlowName] = useState(initialFlowName);
  const [isDirty, setIsDirty] = useState(false);
  const [lastExecuted, setLastExecuted] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT);

  /* Connection-drag state */
  const [connDrag, setConnDrag] = useState<{
    fromNode: string;
    fromPort: string;
    curX: number;
    curY: number;
  } | null>(null);

  /* Context menu state */
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);

  /* Undo/redo stacks (limit 50) */
  const [undoStack, setUndoStack] = useState<
    { nodes: FlowNodeUI[]; edges: FlowEdgeUI[] }[]
  >([]);
  const [redoStack, setRedoStack] = useState<
    { nodes: FlowNodeUI[]; edges: FlowEdgeUI[] }[]
  >([]);

  /* Refs for drag / pan */
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const panRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  /* ── derived ────────────────────────────────────────────────────── */
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  /* ── push history snapshot ──────────────────────────────────────── */
  const snapshot = useCallback(() => {
    setUndoStack((prev) =>
      [...prev, { nodes, edges }].slice(-50)
    );
    setRedoStack([]);
    setIsDirty(true);
  }, [nodes, edges]);

  /* ── undo / redo ────────────────────────────────────────────────── */
  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const snap = prev[prev.length - 1];
      setRedoStack((r) => [...r, { nodes, edges }]);
      setNodes(snap.nodes);
      setEdges(snap.edges);
      return prev.slice(0, -1);
    });
  }, [nodes, edges]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const snap = prev[prev.length - 1];
      setUndoStack((u) => [...u, { nodes, edges }]);
      setNodes(snap.nodes);
      setEdges(snap.edges);
      return prev.slice(0, -1);
    });
  }, [nodes, edges]);

  /* ── keyboard shortcuts ─────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((mod && e.key === "z" && e.shiftKey) || (mod && e.key === "y")) {
        e.preventDefault();
        handleRedo();
      }
      if (mod && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedNodeId) handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo, selectedNodeId]);

  /* ── canvas drag-and-drop (new node from palette) ──────────────── */
  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("flow-node-type") as FlowNodeType;
      if (!type) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const y = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const node = createDefaultNode(
        type,
        snapToGrid ? SNAP(x - 100) : x - 100,
        snapToGrid ? SNAP(y - 30) : y - 30
      );
      snapshot();
      setNodes((prev) => [...prev, node]);
      setSelectedNodeId(node.id);
    },
    [viewport, snapToGrid, snapshot]
  );

  /* ── node dragging ──────────────────────────────────────────────── */
  const handleNodeDragStart = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      dragRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        origX: node.position.x,
        origY: node.position.y,
      };
    },
    [nodes]
  );

  /* ── panning ────────────────────────────────────────────────────── */
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      /* Only left-click on empty canvas starts pan */
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-node]") || target.closest("[data-port]"))
        return;
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: viewport.x,
        origY: viewport.y,
      };
      setSelectedNodeId(null);
    },
    [viewport]
  );

  /* ── mouse move (drag node + pan + conn line) ──────────────────── */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      /* Node drag */
      if (dragRef.current) {
        const { id, startX, startY, origX, origY } = dragRef.current;
        const dx = (e.clientX - startX) / viewport.zoom;
        const dy = (e.clientY - startY) / viewport.zoom;
        let nx = origX + dx;
        let ny = origY + dy;
        if (snapToGrid) {
          nx = SNAP(nx);
          ny = SNAP(ny);
        }
        setNodes((prev) =>
          prev.map((n) => (n.id === id ? { ...n, position: { x: nx, y: ny } } : n))
        );
      }
      /* Pan */
      if (panRef.current) {
        const { startX, startY, origX, origY } = panRef.current;
        setViewport((v) => ({
          ...v,
          x: origX + (e.clientX - startX),
          y: origY + (e.clientY - startY),
        }));
      }
      /* Connection drag line */
      if (connDrag) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          setConnDrag((c) =>
            c
              ? {
                  ...c,
                  curX: e.clientX - rect.left - viewport.x,
                  curY: e.clientY - rect.top - viewport.y,
                }
              : null
          );
        }
      }
    };

    const onUp = () => {
      if (dragRef.current) {
        setIsDirty(true);
        dragRef.current = null;
      }
      panRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [viewport, snapToGrid, connDrag]);

  /* ── zoom (wheel) ───────────────────────────────────────────────── */
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        setViewport((v) => ({
          ...v,
          zoom: clamp(v.zoom + delta, 0.2, 3),
        }));
      }
    },
    []
  );

  /* ── port interactions ──────────────────────────────────────────── */
  const handlePortMouseDown = useCallback(
    (
      nodeId: string,
      portId: string,
      type: "input" | "output",
      e: React.MouseEvent
    ) => {
      e.stopPropagation();
      if (type !== "output") return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setConnDrag({
        fromNode: nodeId,
        fromPort: portId,
        curX: e.clientX - rect.left - viewport.x,
        curY: e.clientY - rect.top - viewport.y,
      });
    },
    [viewport]
  );

  const handlePortMouseUp = useCallback(
    (nodeId: string, portId: string, type: "input" | "output") => {
      if (!connDrag) return;
      if (type !== "input") {
        setConnDrag(null);
        return;
      }
      /* Create edge */
      const exists = edges.some(
        (e) =>
          e.source === connDrag.fromNode &&
          e.sourcePort === connDrag.fromPort &&
          e.target === nodeId &&
          e.targetPort === portId
      );
      if (!exists && connDrag.fromNode !== nodeId) {
        snapshot();
        setEdges((prev) => [
          ...prev,
          {
            id: eid(),
            source: connDrag.fromNode,
            sourcePort: connDrag.fromPort,
            target: nodeId,
            targetPort: portId,
          },
        ]);
      }
      setConnDrag(null);
    },
    [connDrag, edges, snapshot]
  );

  /* ── context menu ───────────────────────────────────────────────── */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: e.clientX, y: e.clientY, nodeId });
    },
    []
  );

  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  /* ── actions ────────────────────────────────────────────────────── */
  const handleDeleteSelected = useCallback(() => {
    if (!selectedNodeId) return;
    snapshot();
    setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setEdges((prev) =>
      prev.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
      )
    );
    setSelectedNodeId(null);
  }, [selectedNodeId, snapshot]);

  const handleDuplicateNode = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      snapshot();
      const clone: FlowNodeUI = {
        ...node,
        id: uid(),
        position: {
          x: node.position.x + 40,
          y: node.position.y + 40,
        },
        data: { ...node.data, config: { ...node.data.config } },
        inputs: node.inputs.map((p) => ({ ...p })),
        outputs: node.outputs.map((p) => ({ ...p })),
      };
      setNodes((prev) => [...prev, clone]);
      setSelectedNodeId(clone.id);
    },
    [nodes, snapshot]
  );

  const handleSave = useCallback(() => {
    onSave?.({ name: flowName, nodes, edges });
    setIsDirty(false);
  }, [flowName, nodes, edges, onSave]);

  const handleExecute = useCallback(() => {
    onExecute?.({ name: flowName, nodes, edges });
    setLastExecuted(new Date().toISOString());
  }, [flowName, nodes, edges, onExecute]);

  const handleNodeUpdate = useCallback(
    (id: string, updates: Partial<FlowNodeUI["data"]>) => {
      snapshot();
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...updates,
                  config: { ...n.data.config, ...(updates.config ?? {}) },
                },
              }
            : n
        )
      );
    },
    [snapshot]
  );

  /* ── zoom helpers ───────────────────────────────────────────────── */
  const zoomIn = () =>
    setViewport((v) => ({ ...v, zoom: clamp(v.zoom + 0.15, 0.2, 3) }));
  const zoomOut = () =>
    setViewport((v) => ({ ...v, zoom: clamp(v.zoom - 0.15, 0.2, 3) }));
  const zoomReset = () => setViewport((v) => ({ ...v, zoom: 1 }));
  const zoomFit = () => {
    if (nodes.length === 0) {
      setViewport(DEFAULT_VIEWPORT);
      return;
    }
    const xs = nodes.map((n) => n.position.x);
    const ys = nodes.map((n) => n.position.y);
    const minX = Math.min(...xs) - 100;
    const maxX = Math.max(...xs) + 300;
    const minY = Math.min(...ys) - 100;
    const maxY = Math.max(...ys) + 200;
    const rect = canvasRef.current?.getBoundingClientRect();
    const cw = rect?.width ?? 800;
    const ch = rect?.height ?? 600;
    const zx = cw / (maxX - minX);
    const zy = ch / (maxY - minY);
    const zoom = clamp(Math.min(zx, zy) * 0.85, 0.2, 3);
    setViewport({
      x: -minX * zoom + (cw - (maxX - minX) * zoom) / 2,
      y: -minY * zoom + (ch - (maxY - minY) * zoom) / 2,
      zoom,
    });
  };

  /* ── template application ───────────────────────────────────────── */
  const applyTemplate = (tpl: FlowTemplate) => {
    snapshot();
    const idMap = new Map<string, string>();
    const newNodes = tpl.nodes.map((n) => {
      const newId = uid();
      idMap.set(n.id, newId);
      return { ...n, id: newId };
    });
    const newEdges = tpl.edges
      .map((e) => {
        const s = idMap.get(e.source);
        const t = idMap.get(e.target);
        if (!s || !t) return null;
        return { ...e, id: eid(), source: s, target: t };
      })
      .filter(Boolean) as FlowEdgeUI[];
    setNodes(newNodes);
    setEdges(newEdges);
    setFlowName(tpl.name);
    setShowTemplates(false);
    setIsDirty(true);
  };

  /* ── minimap bounds ─────────────────────────────────────────────── */
  const minimapData = useMemo(() => {
    if (nodes.length === 0) return null;
    const xs = nodes.map((n) => n.position.x);
    const ys = nodes.map((n) => n.position.y);
    return {
      minX: Math.min(...xs) - 50,
      maxX: Math.max(...xs) + 250,
      minY: Math.min(...ys) - 50,
      maxY: Math.max(...ys) + 150,
    };
  }, [nodes]);

  /* ── render ─────────────────────────────────────────────────────── */
  return (
    <div className="w-full h-screen bg-[#0D0D0E] flex flex-col overflow-hidden relative">
      {/* Toolbar */}
      <KeyFlowToolbar
        flowName={flowName}
        onFlowNameChange={setFlowName}
        onSave={handleSave}
        onExecute={handleExecute}
        onSchedule={() => {}}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomFit={zoomFit}
        onZoomReset={zoomReset}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDeleteSelected={handleDeleteSelected}
        canUndo={canUndo}
        canRedo={canRedo}
        hasSelection={!!selectedNodeId}
        isDirty={isDirty}
        lastExecuted={lastExecuted}
        snapToGrid={snapToGrid}
        onToggleSnap={() => setSnapToGrid((v) => !v)}
        showMinimap={showMinimap}
        onToggleMinimap={() => setShowMinimap((v) => !v)}
        onOpenTemplates={() => setShowTemplates(true)}
        zoom={viewport.zoom}
      />

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Node palette */}
        <KeyFlowNodePalette onDragStartNode={() => {}} />

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing"
          onDragOver={handleCanvasDragOver}
          onDrop={handleCanvasDrop}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleWheel}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxMenu(null);
          }}
        >
          {/* Grid background */}
          <GridBackground zoom={viewport.zoom} />

          {/* Transformed canvas content */}
          <div
            className="absolute inset-0 origin-top-left"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
              willChange: "transform",
            }}
          >
            {/* SVG edge layer */}
            <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
              {/* Existing edges */}
              {edges.map((edge) => {
                const src = nodes.find((n) => n.id === edge.source);
                const tgt = nodes.find((n) => n.id === edge.target);
                if (!src || !tgt) return null;
                const p1 = portCenter(src, edge.sourcePort, 1);
                const p2 = portCenter(tgt, edge.targetPort, 1);
                if (!p1 || !p2) return null;
                return (
                  <g key={edge.id}>
                    <path
                      d={bezierPath(p1.x, p1.y, p2.x, p2.y)}
                      fill="none"
                      stroke="#4EA8FF"
                      strokeWidth={2}
                      opacity={0.7}
                    />
                    {/* Arrowhead */}
                    <circle cx={p2.x} cy={p2.y} r={3} fill="#4EA8FF" opacity={0.9} />
                    {/* Label */}
                    {edge.label && (
                      <text
                        x={(p1.x + p2.x) / 2}
                        y={(p1.y + p2.y) / 2 - 6}
                        textAnchor="middle"
                        fill="#9AA0A6"
                        fontSize={10}
                        fontFamily="Inter, sans-serif"
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Active connection drag line */}
              {connDrag && (() => {
                const src = nodes.find((n) => n.id === connDrag.fromNode);
                if (!src) return null;
                const p1 = portCenter(src, connDrag.fromPort, 1);
                if (!p1) return null;
                const x2 = (connDrag.curX) / viewport.zoom;
                const y2 = (connDrag.curY) / viewport.zoom;
                return (
                  <path
                    d={bezierPath(p1.x, p1.y, x2, y2)}
                    fill="none"
                    stroke="#4EA8FF"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    opacity={0.6}
                  />
                );
              })()}
            </svg>

            {/* Node layer */}
            {nodes.map((node) => (
              <div key={node.id} data-node={node.id}>
                <KeyFlowNode
                  node={node}
                  isSelected={node.id === selectedNodeId}
                  onSelect={setSelectedNodeId}
                  onDragStart={handleNodeDragStart}
                  onPortMouseDown={handlePortMouseDown}
                  onPortMouseUp={handlePortMouseUp}
                  onContextMenu={handleContextMenu}
                />
              </div>
            ))}
          </div>

          {/* Minimap */}
          {showMinimap && minimapData && (
            <Minimap
              nodes={nodes}
              edges={edges}
              viewport={viewport}
              bounds={minimapData}
              onChangeViewport={setViewport}
            />
          )}

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <MousePointer2
                  size={40}
                  className="mx-auto text-[#2A2D31] mb-3"
                />
                <p className="text-[14px] text-[#5F6368] font-medium">
                  Drag nodes from the palette to start building
                </p>
                <p className="text-[12px] text-[#3C4043] mt-1">
                  Or select a template from the toolbar
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Properties panel */}
        <KeyFlowProperties
          node={selectedNode}
          onUpdate={handleNodeUpdate}
          onClose={() => setSelectedNodeId(null)}
          isOpen={!!selectedNodeId}
        />
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {ctxMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="fixed z-[100] bg-[#1A1D21] border border-[#2A2D31] rounded-xl shadow-glass overflow-hidden min-w-[160px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              onClick={() => {
                handleDuplicateNode(ctxMenu.nodeId);
                setCtxMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#E8EAED] hover:bg-[#2A2D31] transition-colors"
            >
              <Copy size={14} className="text-[#4EA8FF]" />
              Duplicate
            </button>
            <button
              onClick={() => {
                setSelectedNodeId(ctxMenu.nodeId);
                setCtxMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#E8EAED] hover:bg-[#2A2D31] transition-colors"
            >
              <Play size={14} className="text-[#4CAF50]" />
              Configure
            </button>
            <div className="border-t border-[#2A2D31]" />
            <button
              onClick={() => {
                snapshot();
                setNodes((prev) =>
                  prev.filter((n) => n.id !== ctxMenu.nodeId)
                );
                setEdges((prev) =>
                  prev.filter(
                    (e) =>
                      e.source !== ctxMenu.nodeId &&
                      e.target !== ctxMenu.nodeId
                  )
                );
                if (selectedNodeId === ctxMenu.nodeId)
                  setSelectedNodeId(null);
                setCtxMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#F44336] hover:bg-[#F4433618] transition-colors"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Template gallery modal */}
      <AnimatePresence>
        {showTemplates && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowTemplates(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="bg-[#1A1D21] border border-[#2A2D31] rounded-2xl shadow-glass w-[560px] max-h-[70vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A2D31]">
                <div className="flex items-center gap-3">
                  <LayoutTemplate size={18} className="text-[#4EA8FF]" />
                  <h2 className="text-[15px] font-semibold text-[#E8EAED]">
                    Template Gallery
                  </h2>
                </div>
                <button
                  onClick={() => setShowTemplates(false)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5F6368] hover:text-[#E8EAED] hover:bg-[#2A2D31] transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Template list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {BUILT_IN_TEMPLATES.map((tpl) => (
                  <motion.button
                    key={tpl.id}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => applyTemplate(tpl)}
                    className="w-full text-left bg-[#131518] border border-[#2A2D31] rounded-xl p-4 hover:border-[#4EA8FF44] transition-colors group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#4EA8FF18] flex items-center justify-center shrink-0 group-hover:bg-[#4EA8FF25] transition-colors">
                        <Sparkles size={18} className="text-[#4EA8FF]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-[13px] font-semibold text-[#E8EAED]">
                            {tpl.name}
                          </p>
                          <span className="text-[9px] font-medium text-[#5F6368] uppercase tracking-wider bg-[#2A2D31] px-1.5 py-0.5 rounded">
                            {tpl.category}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#9AA0A6] mb-2">
                          {tpl.description}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {tpl.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[9px] text-[#5F6368] bg-[#1A1D21] px-1.5 py-0.5 rounded-full border border-[#2A2D31]"
                            >
                              {tag}
                            </span>
                          ))}
                          <span className="text-[10px] text-[#3C4043] ml-auto">
                            {tpl.nodes.length} nodes
                          </span>
                        </div>
                      </div>
                      <div className="w-6 h-6 rounded-full border-2 border-[#2A2D31] group-hover:border-[#4CAF50] flex items-center justify-center shrink-0 mt-1">
                        <Check
                          size={12}
                          className="text-[#4CAF50] opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Grid Background                                                    */
/* ═══════════════════════════════════════════════════════════════════ */
function GridBackground({ zoom }: { zoom: number }) {
  const size = GRID_SIZE * zoom;
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `
          linear-gradient(to right, #1F2225 1px, transparent 1px),
          linear-gradient(to bottom, #1F2225 1px, transparent 1px)
        `,
        backgroundSize: `${size}px ${size}px`,
        opacity: 0.6,
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Minimap                                                            */
/* ═══════════════════════════════════════════════════════════════════ */
function Minimap({
  nodes,
  edges,
  viewport,
  bounds,
  onChangeViewport,
}: {
  nodes: FlowNodeUI[];
  edges: FlowEdgeUI[];
  viewport: ViewportState;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  onChangeViewport: (v: ViewportState) => void;
}) {
  const mapW = 160;
  const mapH = 100;
  const scaleX = mapW / (bounds.maxX - bounds.minX);
  const scaleY = mapH / (bounds.maxY - bounds.minY);
  const scale = Math.min(scaleX, scaleY);

  const toMap = (x: number, y: number) => ({
    mx: (x - bounds.minX) * scale,
    my: (y - bounds.minY) * scale,
  });

  return (
    <div className="absolute bottom-4 right-4 w-[168px] h-[108px] bg-[#131518]/90 border border-[#2A2D31] rounded-lg overflow-hidden shadow-glass z-30">
      <svg width={mapW} height={mapH} className="block">
        {/* Nodes */}
        {nodes.map((n) => {
          const { mx, my } = toMap(n.position.x, n.position.y);
          const color = NODE_TYPE_COLORS[n.type];
          return (
            <rect
              key={n.id}
              x={mx}
              y={my}
              width={40 * scale}
              height={20 * scale}
              rx={3}
              fill={color}
              opacity={0.7}
            />
          );
        })}

        {/* Edges */}
        {edges.map((e) => {
          const src = nodes.find((n) => n.id === e.source);
          const tgt = nodes.find((n) => n.id === e.target);
          if (!src || !tgt) return null;
          const p1 = toMap(src.position.x + 100, src.position.y + 10);
          const p2 = toMap(tgt.position.x + 100, tgt.position.y + 10);
          return (
            <line
              key={e.id}
              x1={p1.mx}
              y1={p1.my}
              x2={p2.mx}
              y2={p2.my}
              stroke="#4EA8FF"
              strokeWidth={1}
              opacity={0.5}
            />
          );
        })}

        {/* Viewport rect */}
        {(() => {
          const { mx, my } = toMap(-viewport.x / viewport.zoom, -viewport.y / viewport.zoom);
          /* approximate visible area */
          return (
            <rect
              x={mx}
              y={my}
              width={mapW / viewport.zoom * scale}
              height={mapH / viewport.zoom * scale}
              fill="none"
              stroke="#4EA8FF"
              strokeWidth={1.5}
              rx={2}
              opacity={0.8}
            />
          );
        })()}
      </svg>
    </div>
  );
}
