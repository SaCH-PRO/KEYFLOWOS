/**
 * Flow Studio Type Definitions
 * Shared types for the KeyFlowOS Visual Flow Builder
 */

export type FlowNodeType =
  | "trigger"
  | "action"
  | "condition"
  | "delay"
  | "ai_decision"
  | "merge"
  | "split"
  | "wait_for"
  | "loop"
  | "error_handler"
  | "notification"
  | "transform"
  | "filter";

export interface Port {
  id: string;
  label?: string;
  type: "input" | "output";
  position: { x: number; y: number };
}

export interface FlowNodeUI {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: {
    label: string;
    config: Record<string, unknown>;
    module?: string;
    action?: string;
  };
  inputs: Port[];
  outputs: Port[];
  hasError?: boolean;
  isExecuting?: boolean;
}

export interface FlowEdgeUI {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
  label?: string;
  condition?: string;
}

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodes: FlowNodeUI[];
  edges: FlowEdgeUI[];
  tags: string[];
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface FlowStudioState {
  nodes: FlowNodeUI[];
  edges: FlowEdgeUI[];
  selectedNodeId: string | null;
  viewport: ViewportState;
  flowName: string;
  isDirty: boolean;
  lastExecuted: string | null;
}

export const NODE_TYPE_COLORS: Record<FlowNodeType, string> = {
  trigger: "#4CAF50",
  action: "#2196F3",
  condition: "#FF9800",
  delay: "#9C27B0",
  ai_decision: "#00BCD4",
  merge: "#795548",
  split: "#607D8B",
  wait_for: "#E91E63",
  loop: "#3F51B5",
  error_handler: "#F44336",
  notification: "#8BC34A",
  transform: "#FFC107",
  filter: "#009688",
};

export const NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
  trigger: "Trigger",
  action: "Action",
  condition: "Condition",
  delay: "Delay",
  ai_decision: "AI Decision",
  merge: "Merge",
  split: "Split",
  wait_for: "Wait For",
  loop: "Loop",
  error_handler: "Error Handler",
  notification: "Notification",
  transform: "Transform",
  filter: "Filter",
};

export interface NodePaletteItem {
  type: FlowNodeType;
  category: string;
  description: string;
}
