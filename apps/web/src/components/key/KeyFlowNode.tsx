"use client";

/**
 * KeyFlowNode — Individual flow node component
 * Renders a distinct visual per node type with color-coded styling,
 * input/output ports, selection highlight, error state, and hover effects.
 */

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Play,
  GitFork,
  Clock,
  Brain,
  Merge,
  Split,
  Hourglass,
  Repeat,
  ShieldAlert,
  Bell,
  Wand2,
  Filter,
  Settings,
} from "lucide-react";
import {
  type FlowNodeUI,
  type FlowNodeType,
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
} from "./flow-studio-types";

/* ------------------------------------------------------------------ */
/*  Icon mapping                                                       */
/* ------------------------------------------------------------------ */
const NODE_ICONS: Record<FlowNodeType, React.ElementType> = {
  trigger: Zap,
  action: Play,
  condition: GitFork,
  delay: Clock,
  ai_decision: Brain,
  merge: Merge,
  split: Split,
  wait_for: Hourglass,
  loop: Repeat,
  error_handler: ShieldAlert,
  notification: Bell,
  transform: Wand2,
  filter: Filter,
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface KeyFlowNodeProps {
  node: FlowNodeUI;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: React.MouseEvent) => void;
  onPortMouseDown: (
    nodeId: string,
    portId: string,
    type: "input" | "output",
    e: React.MouseEvent
  ) => void;
  onPortMouseUp: (
    nodeId: string,
    portId: string,
    type: "input" | "output"
  ) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function KeyFlowNode({
  node,
  isSelected,
  onSelect,
  onDragStart,
  onPortMouseDown,
  onPortMouseUp,
  onContextMenu,
}: KeyFlowNodeProps) {
  const color = NODE_TYPE_COLORS[node.type];
  const label = node.data.label || NODE_TYPE_LABELS[node.type];
  const Icon = NODE_ICONS[node.type];
  const hasConfig = Object.keys(node.data.config).length > 0;

  /* Memoize dynamic styles to avoid recalculation */
  const styles = useMemo(
    () => ({
      nodeBorder: isSelected
        ? `2px solid ${color}`
        : node.hasError
          ? "2px solid #F44336"
          : "1px solid rgba(255,255,255,0.08)",
      nodeShadow: isSelected
        ? `0 0 0 2px ${color}33, 0 8px 32px rgba(0,0,0,0.4)`
        : "0 4px 16px rgba(0,0,0,0.3)",
      headerBg: `linear-gradient(135deg, ${color}22, ${color}0D)`,
      portFill: color,
    }),
    [isSelected, node.hasError, color]
  );

  return (
    <motion.div
      className="absolute select-none"
      style={{
        left: node.position.x,
        top: node.position.y,
        width: 200,
        zIndex: isSelected ? 20 : 10,
      }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      onMouseDown={(e) => {
        /* ignore if clicking a port */
        const target = e.target as HTMLElement;
        if (target.closest("[data-port]")) return;
        onSelect(node.id);
        onDragStart(node.id, e);
      }}
      onContextMenu={(e) => onContextMenu(e, node.id)}
    >
      {/* Main node card */}
      <div
        className="rounded-xl overflow-hidden bg-[#1A1D21] backdrop-blur-sm"
        style={{
          border: styles.nodeBorder,
          boxShadow: styles.nodeShadow,
        }}
      >
        {/* Header strip with icon + label */}
        <div
          className="flex items-center gap-2.5 px-3.5 py-2.5"
          style={{ background: styles.headerBg }}
        >
          {/* Icon */}
          <div
            className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
            style={{ backgroundColor: `${color}25` }}
          >
            <Icon size={14} style={{ color }} />
          </div>

          {/* Label */}
          <span className="text-[13px] font-medium text-[#E8EAED] truncate flex-1 leading-tight">
            {label}
          </span>

          {/* Config badge */}
          {hasConfig && (
            <Settings
              size={12}
              className="text-[#9AA0A6] shrink-0"
              style={{ color: `${color}AA` }}
            />
          )}
        </div>

        {/* Body */}
        <div className="px-3.5 py-2">
          {/* Type badge */}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: `${color}18`,
              color,
            }}
          >
            {NODE_TYPE_LABELS[node.type]}
          </span>

          {/* Module / Action hint */}
          {(node.data.module || node.data.action) && (
            <p className="mt-1.5 text-[11px] text-[#9AA0A6] truncate">
              {node.data.module}
              {node.data.action ? ` / ${node.data.action}` : ""}
            </p>
          )}

          {/* Error indicator */}
          {node.hasError && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#F44336]">
              <ShieldAlert size={12} />
              <span>Configuration error</span>
            </div>
          )}

          {/* Executing indicator */}
          {node.isExecuting && (
            <div className="mt-2 flex items-center gap-1.5">
              <motion.div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: color }}
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
              <span
                className="text-[11px] font-medium"
                style={{ color }}
              >
                Executing...
              </span>
            </div>
          )}
        </div>

        {/* Input ports */}
        {node.inputs.map((port) => (
          <PortDot
            key={port.id}
            port={port}
            color={color}
            side="left"
            onMouseDown={(e) => onPortMouseDown(node.id, port.id, "input", e)}
            onMouseUp={() => onPortMouseUp(node.id, port.id, "input")}
          />
        ))}

        {/* Output ports */}
        {node.outputs.map((port) => (
          <PortDot
            key={port.id}
            port={port}
            color={color}
            side="right"
            onMouseDown={(e) => onPortMouseDown(node.id, port.id, "output", e)}
            onMouseUp={() => onPortMouseUp(node.id, port.id, "output")}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Port sub-component                                                  */
/* ------------------------------------------------------------------ */
interface PortDotProps {
  port: { id: string; label?: string; position: { x: number; y: number } };
  color: string;
  side: "left" | "right";
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
}

function PortDot({ port, color, side, onMouseDown, onMouseUp }: PortDotProps) {
  return (
    <div
      data-port
      data-port-id={port.id}
      className="absolute group cursor-crosshair"
      style={{
        [side]: -7,
        top: 38 + (port.position?.y || 0),
        width: 14,
        height: 14,
      }}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      title={port.label || `${side === "left" ? "Input" : "Output"} port`}
    >
      {/* Port circle */}
      <div
        className="w-full h-full rounded-full border-2 border-[#1A1D21] transition-transform duration-150 group-hover:scale-125"
        style={{ backgroundColor: color }}
      />
      {/* Tooltip label on hover */}
      {port.label && (
        <span
          className="absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-[#9AA0A6] whitespace-nowrap pointer-events-none bg-[#2A2D31] px-1.5 py-0.5 rounded"
          style={{ [side === "left" ? "right" : "left"]: 18 }}
        >
          {port.label}
        </span>
      )}
    </div>
  );
}
