export type SequenceNodeType = 'email' | 'whatsapp' | 'sms' | 'wait' | 'branch' | 'end';

export interface SequenceNode {
  id: string;
  type: SequenceNodeType;
  position?: { x: number; y: number };
  data?: {
    subject?: string;
    body?: string;
    label?: string;
    delayDays?: number;
    delayHours?: number;
    condition?: 'opened' | 'clicked' | 'replied' | 'no_reply' | 'engaged';
    waitForDays?: number;
  };
}

export interface SequenceEdge {
  id: string;
  source: string;
  target: string;
  branch?: 'yes' | 'no' | 'default';
}

export interface SequenceGraph {
  nodes: SequenceNode[];
  edges: SequenceEdge[];
  startNodeId: string | null;
  version: number;
}

export interface LegacyStep {
  stepNumber: number;
  type: 'email' | 'whatsapp' | 'sms' | 'call' | 'wait';
  delayDays?: number;
  subject?: string;
  body?: string;
  template?: string;
  notes?: string;
}

export function isSequenceGraph(value: unknown): value is SequenceGraph {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SequenceGraph>;
  return Array.isArray(v.nodes) && Array.isArray(v.edges);
}

export function legacyStepsToGraph(steps: LegacyStep[] | unknown): SequenceGraph {
  const list = Array.isArray(steps) ? (steps as LegacyStep[]) : [];
  if (list.length === 0) {
    const startId = `node_${Math.random().toString(36).slice(2, 9)}`;
    const endId = `node_${Math.random().toString(36).slice(2, 9)}`;
    return {
      nodes: [
        { id: startId, type: 'email', position: { x: 80, y: 80 }, data: {} },
        { id: endId, type: 'end', position: { x: 80, y: 240 }, data: {} },
      ],
      edges: [{ id: `e_${startId}_${endId}`, source: startId, target: endId, branch: 'default' }],
      startNodeId: startId,
      version: 1,
    };
  }
  const nodes: SequenceNode[] = [];
  const edges: SequenceEdge[] = [];
  let prevId: string | null = null;
  list.forEach((step, idx) => {
    const id = `node_step_${idx + 1}`;
    const type: SequenceNodeType =
      step.type === 'call' ? 'wait' : (step.type as SequenceNodeType);
    nodes.push({
      id,
      type,
      position: { x: 80, y: 80 + idx * 160 },
      data: {
        subject: step.subject,
        body: step.body ?? step.template ?? step.notes,
        delayDays: step.delayDays ?? 0,
      },
    });
    if (prevId) {
      edges.push({ id: `e_${prevId}_${id}`, source: prevId, target: id, branch: 'default' });
    }
    prevId = id;
  });
  const endId = 'node_end';
  nodes.push({ id: endId, type: 'end', position: { x: 80, y: 80 + list.length * 160 }, data: {} });
  if (prevId) {
    edges.push({ id: `e_${prevId}_${endId}`, source: prevId, target: endId, branch: 'default' });
  }
  return {
    nodes,
    edges,
    startNodeId: nodes[0]?.id ?? null,
    version: 1,
  };
}

export function ensureGraph(seq: { graph?: unknown; steps?: unknown }): SequenceGraph {
  if (isSequenceGraph(seq.graph)) return seq.graph;
  return legacyStepsToGraph(seq.steps as LegacyStep[]);
}

export interface GraphValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateGraph(graph: SequenceGraph, opts: { strict?: boolean } = {}): GraphValidationResult {
  const strict = opts.strict !== false;
  const errors: string[] = [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  if (nodes.length === 0) errors.push('Sequence must contain at least one node');

  const nodeIds = new Set(nodes.map((n) => n.id));
  const validTypes: SequenceNodeType[] = ['email', 'whatsapp', 'sms', 'wait', 'branch', 'end'];

  for (const n of nodes) {
    if (!n.id) errors.push('Every node must have an id');
    if (!validTypes.includes(n.type)) errors.push(`Invalid node type: ${n.type}`);
    if (strict) {
      if (n.type === 'email') {
        if (!n.data?.subject?.trim()) errors.push(`Email node "${n.id}" requires a subject`);
        if (!n.data?.body?.trim()) errors.push(`Email node "${n.id}" requires a body`);
      }
      if ((n.type === 'whatsapp' || n.type === 'sms') && !n.data?.body?.trim()) {
        errors.push(`${n.type.toUpperCase()} node "${n.id}" requires a message body`);
      }
      if (n.type === 'wait' && (!n.data || (!n.data.delayDays && !n.data.delayHours))) {
        errors.push(`Wait node "${n.id}" requires a duration`);
      }
    }
  }

  for (const e of edges) {
    if (!nodeIds.has(e.source)) errors.push(`Edge "${e.id}" references unknown source "${e.source}"`);
    if (!nodeIds.has(e.target)) errors.push(`Edge "${e.id}" references unknown target "${e.target}"`);
  }

  // Find start node
  const targetSet = new Set(edges.map((e) => e.target));
  const candidateStarts = nodes.filter((n) => !targetSet.has(n.id));
  const startId = graph.startNodeId ?? candidateStarts[0]?.id ?? null;
  if (!startId) errors.push('Could not determine a start node — every node has an incoming edge');

  // Reachability: every non-start node must be reachable from start
  if (startId && nodes.length > 0) {
    const reachable = new Set<string>();
    const stack: string[] = [startId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of edges) {
        if (e.source === cur && !reachable.has(e.target)) stack.push(e.target);
      }
    }
    for (const n of nodes) {
      if (!reachable.has(n.id)) errors.push(`Node "${n.id}" is unreachable from start`);
    }
  }

  // Termination: every path must eventually reach an end node OR a node with no outgoing edges (which becomes an implicit end)
  // We check that every non-end node either has at least one outgoing edge OR we reach an end node.
  const outgoingMap = new Map<string, SequenceEdge[]>();
  for (const e of edges) {
    const arr = outgoingMap.get(e.source) ?? [];
    arr.push(e);
    outgoingMap.set(e.source, arr);
  }
  for (const n of nodes) {
    if (n.type === 'end') continue;
    const out = outgoingMap.get(n.id) ?? [];
    if (out.length === 0) {
      errors.push(`Node "${n.id}" has no outgoing edge — every path must terminate at an End node`);
    }
    if (n.type === 'branch') {
      const branches = new Set(out.map((e) => e.branch ?? 'default'));
      if (!branches.has('yes') || !branches.has('no')) {
        errors.push(`Branch node "${n.id}" must have both "yes" and "no" outgoing edges`);
      }
    }
  }

  // Cycle detection (no cycles allowed for clear termination)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);
  let hasCycle = false;
  function dfs(id: string) {
    if (hasCycle) return;
    color.set(id, GRAY);
    for (const e of outgoingMap.get(id) ?? []) {
      const c = color.get(e.target) ?? WHITE;
      if (c === GRAY) { hasCycle = true; return; }
      if (c === WHITE) dfs(e.target);
    }
    color.set(id, BLACK);
  }
  for (const n of nodes) if (color.get(n.id) === WHITE) dfs(n.id);
  if (hasCycle) errors.push('Sequence contains a cycle — paths must terminate');

  return { ok: errors.length === 0, errors };
}

export function getStartNodeId(graph: SequenceGraph): string | null {
  if (graph.startNodeId) return graph.startNodeId;
  const targets = new Set(graph.edges.map((e) => e.target));
  return graph.nodes.find((n) => !targets.has(n.id))?.id ?? graph.nodes[0]?.id ?? null;
}

export function getNextNodeId(
  graph: SequenceGraph,
  currentNodeId: string,
  branch: 'yes' | 'no' | 'default' = 'default',
): string | null {
  const edges = graph.edges.filter((e) => e.source === currentNodeId);
  if (edges.length === 0) return null;
  // For branch nodes prefer matching branch
  const match = edges.find((e) => (e.branch ?? 'default') === branch);
  if (match) return match.target;
  return edges[0].target;
}

export function graphToLegacySteps(graph: SequenceGraph): LegacyStep[] {
  // Walk default path from start, ignoring branches (best-effort fallback)
  const start = getStartNodeId(graph);
  if (!start) return [];
  const out: LegacyStep[] = [];
  const visited = new Set<string>();
  let cur: string | null = start;
  let n = 1;
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const node = graph.nodes.find((x) => x.id === cur);
    if (!node || node.type === 'end') break;
    if (node.type === 'branch') {
      cur = getNextNodeId(graph, cur, 'yes') ?? getNextNodeId(graph, cur, 'default');
      continue;
    }
    const type: LegacyStep['type'] = node.type === 'wait' ? 'wait' : (node.type as LegacyStep['type']);
    out.push({
      stepNumber: n++,
      type,
      delayDays: node.data?.delayDays ?? 0,
      subject: node.data?.subject,
      body: node.data?.body,
      template: node.data?.body,
    });
    cur = getNextNodeId(graph, cur, 'default');
  }
  return out;
}
