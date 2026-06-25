"use client";

/**
 * KeyFlowNodePalette — Draggable node palette sidebar
 * Categorized, searchable list of node types. Drag items onto the canvas
 * to create new nodes. Collapsible categories with icons & descriptions.
 */

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Search,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import {
  type FlowNodeType,
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
} from "./flow-studio-types";

/* ------------------------------------------------------------------ */
/*  Palette item definition                                            */
/* ------------------------------------------------------------------ */
interface PaletteItemDef {
  type: FlowNodeType;
  category: string;
  description: string;
}

const PALETTE_ITEMS: PaletteItemDef[] = [
  /* Triggers */
  {
    type: "trigger",
    category: "Triggers",
    description: "Start a flow when an event occurs",
  },
  /* Actions */
  {
    type: "action",
    category: "Actions",
    description: "Execute a module action",
  },
  {
    type: "notification",
    category: "Actions",
    description: "Send a notification or alert",
  },
  {
    type: "transform",
    category: "Actions",
    description: "Transform and map data fields",
  },
  /* Flow Control */
  {
    type: "condition",
    category: "Flow Control",
    description: "Branch based on a condition",
  },
  {
    type: "delay",
    category: "Flow Control",
    description: "Wait for a specified duration",
  },
  {
    type: "wait_for",
    category: "Flow Control",
    description: "Wait for an event or signal",
  },
  {
    type: "loop",
    category: "Flow Control",
    description: "Iterate over a collection",
  },
  {
    type: "merge",
    category: "Flow Control",
    description: "Merge multiple branches",
  },
  {
    type: "split",
    category: "Flow Control",
    description: "Split into parallel branches",
  },
  {
    type: "filter",
    category: "Flow Control",
    description: "Filter items by criteria",
  },
  {
    type: "error_handler",
    category: "Flow Control",
    description: "Catch and handle errors",
  },
  /* Logic / AI */
  {
    type: "ai_decision",
    category: "AI",
    description: "AI-powered decision making",
  },
];

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

const CATEGORY_ORDER = ["Triggers", "Actions", "Flow Control", "AI"];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface KeyFlowNodePaletteProps {
  onDragStartNode: (type: FlowNodeType) => void;
  isOpen?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function KeyFlowNodePalette({
  onDragStartNode,
  isOpen = true,
}: KeyFlowNodePaletteProps) {
  const [search, setSearch] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set()
  );

  /* Group & filter items */
  const groupedItems = useMemo(() => {
    const filtered = PALETTE_ITEMS.filter((item) => {
      const term = search.toLowerCase();
      return (
        NODE_TYPE_LABELS[item.type].toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.category.toLowerCase().includes(term)
      );
    });

    const groups = new Map<string, PaletteItemDef[]>();
    for (const item of filtered) {
      const list = groups.get(item.category) || [];
      list.push(item);
      groups.set(item.category, list);
    }
    return groups;
  }, [search]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  if (!isOpen) return null;

  return (
    <div className="w-[260px] h-full bg-[#131518] border-r border-[#2A2D31] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <h3 className="text-sm font-semibold text-[#E8EAED] mb-3">
          Node Palette
        </h3>

        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5F6368]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes..."
            className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
          />
        </div>
      </div>

      {/* Scrollable categories */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
        {CATEGORY_ORDER.map((category) => {
          const items = groupedItems.get(category);
          if (!items || items.length === 0) return null;

          const isCollapsed = collapsedCategories.has(category);

          return (
            <div key={category} className="mb-1">
              {/* Category header */}
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider text-[#9AA0A6] hover:bg-[#1A1D21] transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                <span>{category}</span>
                <span className="ml-auto text-[10px] text-[#5F6368]">
                  {items.length}
                </span>
              </button>

              {/* Items */}
              <AnimatePresence initial={false}>
                {!isCollapsed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    {items.map((item) => (
                      <PaletteNodeItem
                        key={item.type}
                        item={item}
                        onDragStart={() => onDragStartNode(item.type)}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* Empty state */}
        {groupedItems.size === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Search size={24} className="text-[#3C4043] mb-2" />
            <p className="text-[12px] text-[#5F6368]">
              No nodes match your search
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Individual palette item                                            */
/* ------------------------------------------------------------------ */
function PaletteNodeItem({
  item,
  onDragStart,
}: {
  item: PaletteItemDef;
  onDragStart: () => void;
}) {
  const color = NODE_TYPE_COLORS[item.type];
  const Icon = NODE_ICONS[item.type];
  const label = NODE_TYPE_LABELS[item.type];

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("flow-node-type", item.type);
        e.dataTransfer.effectAllowed = "copy";
        onDragStart();
      }}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing hover:bg-[#1E2024] transition-colors group mb-0.5"
    >
      {/* Grip handle */}
      <GripVertical
        size={12}
        className="text-[#3C4043] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      />

      {/* Icon */}
      <div
        className="flex items-center justify-center w-7 h-7 rounded-md shrink-0"
        style={{ backgroundColor: `${color}20` }}
      >
        <Icon size={14} style={{ color }} />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-[#E8EAED] truncate leading-tight">
          {label}
        </p>
        <p className="text-[10px] text-[#5F6368] truncate leading-tight">
          {item.description}
        </p>
      </div>
    </div>
  );
}
