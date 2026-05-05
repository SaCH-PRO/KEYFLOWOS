"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getContactRelationshipEdgeLabel } from "@keyflow/shared";
import type { NetworkContact, RelationshipEdge } from "@/lib/client";

type GraphProps = {
  rootId?: string | null;
  nodes: NetworkContact[];
  edges: RelationshipEdge[];
  height?: number;
  onNodeClick?: (contactId: string) => void;
};

type SimNode = NetworkContact & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  depth: number;
};

function nameOf(c: NetworkContact): string {
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || c.companyName || "Contact";
}

const WIDTH = 600;

/**
 * Lightweight force-directed graph. Implements a small in-house simulation
 * (charge repulsion + spring constraints + centering gravity) so we don't
 * need to ship a heavy graph library to clients. The simulation runs in a
 * RAF loop, cools over ~250 ticks, and freezes the root node (when set) at
 * the center for a stable orientation.
 */
export function NetworkGraph({ rootId, nodes, edges, height = 360, onNodeClick }: GraphProps) {
  const [hover, setHover] = useState<string | null>(null);
  const [, force] = useState(0);
  const simRef = useRef<SimNode[]>([]);
  const rafRef = useRef<number | null>(null);

  // Compute BFS depths from the root for visual styling and link distances.
  const depths = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adj.has(e.fromContactId)) adj.set(e.fromContactId, new Set());
      if (!adj.has(e.toContactId)) adj.set(e.toContactId, new Set());
      adj.get(e.fromContactId)!.add(e.toContactId);
      adj.get(e.toContactId)!.add(e.fromContactId);
    }
    const map = new Map<string, number>();
    const seedRoot = rootId ?? nodes[0]?.id ?? null;
    if (!seedRoot) return map;
    map.set(seedRoot, 0);
    const queue: string[] = [seedRoot];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = map.get(cur)!;
      for (const nb of adj.get(cur) ?? []) {
        if (!map.has(nb)) {
          map.set(nb, d + 1);
          queue.push(nb);
        }
      }
    }
    for (const n of nodes) if (!map.has(n.id)) map.set(n.id, 99);
    return map;
  }, [edges, nodes, rootId]);

  // (Re)initialize the simulation when the input changes.
  useEffect(() => {
    if (nodes.length === 0) {
      simRef.current = [];
      force((v) => v + 1);
      return;
    }
    const cx = WIDTH / 2;
    const cy = height / 2;
    simRef.current = nodes.map((c, i) => {
      const isRoot = rootId === c.id;
      const angle = (i / nodes.length) * Math.PI * 2;
      const radius = isRoot ? 0 : 60 + (depths.get(c.id) ?? 1) * 40;
      return {
        ...c,
        depth: depths.get(c.id) ?? 1,
        x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 10,
        y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 10,
        vx: 0,
        vy: 0,
      };
    });

    const linksByNode = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!linksByNode.has(e.fromContactId)) linksByNode.set(e.fromContactId, new Set());
      if (!linksByNode.has(e.toContactId)) linksByNode.set(e.toContactId, new Set());
      linksByNode.get(e.fromContactId)!.add(e.toContactId);
      linksByNode.get(e.toContactId)!.add(e.fromContactId);
    }

    const REPULSION = 1400;
    const SPRING = 0.04;
    const REST_LEN = 80;
    const DAMPING = 0.82;
    const GRAVITY = 0.012;
    const MAX_TICKS = 260;
    let tick = 0;

    const step = () => {
      const sim = simRef.current;
      const byId = new Map(sim.map((n) => [n.id, n]));
      const cx = WIDTH / 2;
      const cy = height / 2;
      // Charge repulsion (O(n^2) — fine for sub-200-node networks).
      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          const a = sim[i];
          const b = sim[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist2 = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(dist2);
          const force = REPULSION / dist2;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      // Spring constraints.
      for (const e of edges) {
        const a = byId.get(e.fromContactId);
        const b = byId.get(e.toContactId);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const diff = dist - REST_LEN;
        const fx = (dx / dist) * diff * SPRING;
        const fy = (dy / dist) * diff * SPRING;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      // Gravity toward center keeps disconnected components in view.
      for (const n of sim) {
        n.vx += (cx - n.x) * GRAVITY;
        n.vy += (cy - n.y) * GRAVITY;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        // Pin root.
        if (rootId && n.id === rootId) {
          n.x = cx;
          n.y = cy;
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.x += n.vx;
        n.y += n.vy;
        // Clamp to viewport.
        n.x = Math.max(20, Math.min(WIDTH - 20, n.x));
        n.y = Math.max(20, Math.min(height - 20, n.y));
      }
      tick++;
      force((v) => v + 1);
      if (tick < MAX_TICKS) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [nodes, edges, depths, rootId, height]);

  const positions = simRef.current;
  const byId = useMemo(() => new Map(positions.map((n) => [n.id, n])), [positions]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-xs text-muted-foreground border border-dashed border-border/40 rounded-xl">
        No connections yet. Add a relationship to start mapping the network.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/40 bg-white/[0.02] overflow-hidden">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full h-auto" role="img" aria-label="Relationship graph">
        {edges.map((e) => {
          const from = byId.get(e.fromContactId);
          const to = byId.get(e.toContactId);
          if (!from || !to) return null;
          const isRootEdge = rootId && (from.id === rootId || to.id === rootId);
          const highlight = hover && (e.fromContactId === hover || e.toContactId === hover);
          return (
            <line
              key={e.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={highlight ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-border) / 0.5)"}
              strokeWidth={highlight ? 1.5 : isRootEdge ? 1 : 0.6}
              opacity={highlight ? 0.95 : 0.6}
            />
          );
        })}
        {positions.map((n) => {
          const isRoot = n.id === rootId;
          const r = isRoot ? 18 : n.depth === 1 ? 12 : 8;
          const fill =
            isRoot
              ? "hsl(var(--kf-accent1))"
              : n.depth === 1
              ? "hsl(var(--kf-accent2))"
              : "hsl(var(--kf-muted))";
          return (
            <g
              key={n.id}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onNodeClick?.(n.id)}
              style={{ cursor: onNodeClick ? "pointer" : "default" }}
            >
              <circle cx={n.x} cy={n.y} r={r} fill={fill} stroke="hsl(var(--kf-background))" strokeWidth={1.5} />
              <text
                x={n.x}
                y={n.y + r + 12}
                textAnchor="middle"
                fontSize={10}
                fill="hsl(var(--kf-foreground))"
                pointerEvents="none"
              >
                {nameOf(n).slice(0, 18)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-3 px-3 py-2 text-[10px] text-muted-foreground border-t border-border/30">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-[hsl(var(--kf-accent1))]" /> Root
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-[hsl(var(--kf-accent2))]" /> 1st degree
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-[hsl(var(--kf-muted))]" /> 2nd degree
        </span>
        {hover && (() => {
          const node = byId.get(hover);
          const incident = edges.filter((e) => e.fromContactId === hover || e.toContactId === hover);
          return (
            <span className="ml-auto truncate">
              {node ? nameOf(node) : ""} · {incident.length} link{incident.length === 1 ? "" : "s"}
              {incident.slice(0, 2).map((e) => ` · ${getContactRelationshipEdgeLabel(e.type)}`).join("")}
            </span>
          );
        })()}
      </div>
    </div>
  );
}
