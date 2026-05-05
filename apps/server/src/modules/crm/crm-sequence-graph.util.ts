export type SequenceNodeType = 'email' | 'whatsapp' | 'sms' | 'wait' | 'branch' | 'end';

export type BranchConditionType =
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'no_reply'
  | 'engaged'
  | 'not_opened_in_days'
  | 'relationship_health_changed_to'
  | 'best_channel';

export interface SequenceVariant {
  id: string;
  label?: string;
  weight: number;
  subject?: string;
  body?: string;
}

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
    condition?: BranchConditionType;
    waitForDays?: number;
    targetHealth?: 'HOT' | 'WARM' | 'COLD' | 'DORMANT' | 'AT_RISK';
    targetChannel?: 'email' | 'whatsapp' | 'sms' | 'call';
    variants?: SequenceVariant[];
    promotedVariantId?: string | null;
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

export const SEND_NODE_TYPES: SequenceNodeType[] = ['email', 'whatsapp', 'sms'];

export function isSendNode(node: SequenceNode | null | undefined): boolean {
  return !!node && SEND_NODE_TYPES.includes(node.type);
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

    // Variants validation (always-on, even non-strict, since malformed variants break runtime)
    if (isSendNode(n) && Array.isArray(n.data?.variants) && n.data!.variants!.length > 0) {
      const vs = n.data!.variants!;
      if (vs.length > 3) errors.push(`Send node "${n.id}" can have at most 3 variants`);
      const ids = new Set<string>();
      for (const v of vs) {
        if (!v || typeof v !== 'object') {
          errors.push(`Variant on node "${n.id}" must be an object`);
          continue;
        }
        if (!v.id) errors.push(`Variant on node "${n.id}" requires an id`);
        if (ids.has(v.id)) errors.push(`Duplicate variant id "${v.id}" on node "${n.id}"`);
        ids.add(v.id);
        if (typeof v.weight !== 'number' || v.weight < 0) {
          errors.push(`Variant "${v.id}" on node "${n.id}" must have a non-negative weight`);
        }
        if (strict) {
          if (n.type === 'email' && !v.subject?.trim()) {
            errors.push(`Variant "${v.id}" on email node "${n.id}" requires a subject`);
          }
          if (!v.body?.trim()) {
            errors.push(`Variant "${v.id}" on node "${n.id}" requires a body`);
          }
        }
      }
      const totalWeight = vs.reduce((s, v) => s + (typeof v.weight === 'number' ? v.weight : 0), 0);
      if (totalWeight <= 0) errors.push(`Variants on node "${n.id}" must have a combined weight > 0`);
      if (n.data?.promotedVariantId && !ids.has(n.data.promotedVariantId)) {
        errors.push(`Promoted variant "${n.data.promotedVariantId}" on node "${n.id}" does not exist`);
      }
    }

    if (strict) {
      const hasVariants = isSendNode(n) && Array.isArray(n.data?.variants) && n.data!.variants!.length > 0;
      if (n.type === 'email' && !hasVariants) {
        if (!n.data?.subject?.trim()) errors.push(`Email node "${n.id}" requires a subject`);
        if (!n.data?.body?.trim()) errors.push(`Email node "${n.id}" requires a body`);
      }
      if ((n.type === 'whatsapp' || n.type === 'sms') && !hasVariants && !n.data?.body?.trim()) {
        errors.push(`${n.type.toUpperCase()} node "${n.id}" requires a message body`);
      }
      if (n.type === 'wait' && (!n.data || (!n.data.delayDays && !n.data.delayHours))) {
        errors.push(`Wait node "${n.id}" requires a duration`);
      }
      if (n.type === 'branch') {
        const cond = n.data?.condition;
        if (!cond) errors.push(`Branch node "${n.id}" requires a condition`);
        if (cond === 'relationship_health_changed_to' && !n.data?.targetHealth) {
          errors.push(`Branch node "${n.id}" requires a targetHealth`);
        }
        if (cond === 'best_channel' && !n.data?.targetChannel) {
          errors.push(`Branch node "${n.id}" requires a targetChannel`);
        }
        if (
          cond === 'not_opened_in_days' &&
          (typeof n.data?.waitForDays !== 'number' || n.data.waitForDays <= 0)
        ) {
          errors.push(`Branch node "${n.id}" requires a positive waitForDays`);
        }
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

  // Reachability
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

  // Termination
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

  // Cycle detection
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
  const match = edges.find((e) => (e.branch ?? 'default') === branch);
  if (match) return match.target;
  return edges[0].target;
}

export function graphToLegacySteps(graph: SequenceGraph): LegacyStep[] {
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

/**
 * Pick a variant id for a send node using weighted random allocation.
 * If `promotedVariantId` is set, always returns it (winner lock-in).
 * Returns `null` if the node has no variants (legacy single-content send).
 */
export function pickVariantId(node: SequenceNode, rand: () => number = Math.random): string | null {
  const variants = node.data?.variants ?? [];
  if (variants.length === 0) return null;
  if (node.data?.promotedVariantId) {
    const promoted = variants.find((v) => v.id === node.data?.promotedVariantId);
    if (promoted) return promoted.id;
  }
  const totalWeight = variants.reduce((s, v) => s + Math.max(0, v.weight ?? 0), 0);
  if (totalWeight <= 0) return variants[0].id;
  let r = rand() * totalWeight;
  for (const v of variants) {
    const w = Math.max(0, v.weight ?? 0);
    if (r < w) return v.id;
    r -= w;
  }
  return variants[variants.length - 1].id;
}

export function getVariantContent(
  node: SequenceNode,
  variantId: string | null | undefined,
): { subject?: string; body?: string; variantId: string | null } {
  if (variantId && Array.isArray(node.data?.variants)) {
    const v = node.data!.variants!.find((x) => x.id === variantId);
    if (v) return { subject: v.subject ?? node.data?.subject, body: v.body ?? node.data?.body, variantId };
  }
  return { subject: node.data?.subject, body: node.data?.body, variantId: null };
}
