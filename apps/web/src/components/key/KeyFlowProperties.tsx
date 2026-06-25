"use client";

/**
 * KeyFlowProperties — Slide-out properties panel for selected node
 * Dynamic form based on node type. Supports Action, Condition, Delay,
 * Trigger, AI Decision, and generic fallback configurations.
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Save,
  RotateCcw,
  Settings,
  Play,
  GitFork,
  Clock,
  Zap,
  Brain,
  Plus,
  Trash2,
  ChevronDown,
} from "lucide-react";
import {
  type FlowNodeUI,
  type FlowNodeType,
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
} from "./flow-studio-types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface KeyFlowPropertiesProps {
  node: FlowNodeUI | null;
  onUpdate: (id: string, updates: Partial<FlowNodeUI["data"]>) => void;
  onClose: () => void;
  isOpen: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function KeyFlowProperties({
  node,
  onUpdate,
  onClose,
  isOpen,
}: KeyFlowPropertiesProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [labelDraft, setLabelDraft] = useState("");

  /* Sync draft when node changes */
  useEffect(() => {
    if (node) {
      setDraft({ ...node.data.config });
      setLabelDraft(node.data.label);
    }
  }, [node?.id]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {node && (
        <motion.div
          initial={{ x: 340, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 340, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
          className="absolute right-0 top-[52px] bottom-0 w-[320px] bg-[#131518] border-l border-[#2A2D31] flex flex-col overflow-hidden z-40 shadow-[-8px_0_32px_rgba(0,0,0,0.3)]"
        >
          {/* Header */}
          <PropertiesHeader node={node} onClose={onClose} />

          {/* Scrollable form */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Label field (all types) */}
            <FormField label="Label">
              <input
                type="text"
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
              />
            </FormField>

            {/* Type-specific configuration */}
            <TypeSpecificForm
              nodeType={node.type}
              draft={draft}
              setDraft={setDraft}
              nodeData={node.data}
            />
          </div>

          {/* Footer actions */}
          <div className="shrink-0 border-t border-[#2A2D31] px-4 py-3 flex items-center gap-2">
            <button
              onClick={() => {
                if (node) {
                  onUpdate(node.id, {
                    label: labelDraft,
                    config: draft,
                  });
                }
              }}
              className="flex-1 flex items-center justify-center gap-2 h-9 rounded-lg bg-[#4EA8FF] hover:bg-[#3D96EC] text-white text-[12px] font-medium transition-colors"
            >
              <Save size={13} />
              Save
            </button>
            <button
              onClick={() => {
                if (node) {
                  setDraft({ ...node.data.config });
                  setLabelDraft(node.data.label);
                }
              }}
              className="flex items-center justify-center gap-2 h-9 px-3 rounded-lg border border-[#2A2D31] text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#2A2D31] text-[12px] font-medium transition-colors"
            >
              <RotateCcw size={13} />
              Reset
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */
function PropertiesHeader({
  node,
  onClose,
}: {
  node: FlowNodeUI;
  onClose: () => void;
}) {
  const color = NODE_TYPE_COLORS[node.type];
  const typeLabel = NODE_TYPE_LABELS[node.type];

  return (
    <div
      className="shrink-0 px-4 py-3 border-b border-[#2A2D31] flex items-center gap-3"
      style={{
        background: `linear-gradient(135deg, ${color}12, transparent)`,
      }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}25` }}
      >
        <Settings size={15} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-[#E8EAED] truncate">
          {node.data.label || typeLabel}
        </p>
        <p className="text-[10px] text-[#5F6368] uppercase tracking-wider">
          {typeLabel} Configuration
        </p>
      </div>
      <button
        onClick={onClose}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5F6368] hover:text-[#E8EAED] hover:bg-[#2A2D31] transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Type-specific form switcher                                        */
/* ------------------------------------------------------------------ */
function TypeSpecificForm({
  nodeType,
  draft,
  setDraft,
  nodeData,
}: {
  nodeType: FlowNodeType;
  draft: Record<string, unknown>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  nodeData: FlowNodeUI["data"];
}) {
  const updateField = (key: string, value: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  switch (nodeType) {
    case "action":
      return (
        <ActionNodeForm
          draft={draft}
          updateField={updateField}
          nodeData={nodeData}
        />
      );
    case "condition":
      return <ConditionNodeForm draft={draft} updateField={updateField} />;
    case "delay":
      return <DelayNodeForm draft={draft} updateField={updateField} />;
    case "trigger":
      return <TriggerNodeForm draft={draft} updateField={updateField} />;
    case "ai_decision":
      return <AIDecisionNodeForm draft={draft} updateField={updateField} />;
    case "loop":
      return <LoopNodeForm draft={draft} updateField={updateField} />;
    case "filter":
      return <FilterNodeForm draft={draft} updateField={updateField} />;
    default:
      return <GenericNodeForm draft={draft} updateField={updateField} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Action node form                                                   */
/* ------------------------------------------------------------------ */
function ActionNodeForm({
  draft,
  updateField,
  nodeData,
}: {
  draft: Record<string, unknown>;
  updateField: (k: string, v: unknown) => void;
  nodeData: FlowNodeUI["data"];
}) {
  const modules = [
    "Contacts",
    "Communications",
    "Finance",
    "Device",
    "Email",
    "Timeline",
  ];
  const actionsByModule: Record<string, string[]> = {
    Contacts: ["Create", "Update", "Delete", "Find", "List", "Merge"],
    Communications: ["Send", "Receive", "Log", "Schedule"],
    Finance: ["Create Invoice", "Record Payment", "Generate Report"],
    Device: ["Register", "Update", "Deactivate", "Ping"],
    Email: ["Send Email", "Draft Email", "Reply", "Forward"],
    Timeline: ["Create Event", "Update Event", "Delete Event"],
  };

  const selectedModule = (draft.module as string) || nodeData.module || "";
  const availableActions = actionsByModule[selectedModule] || [];

  return (
    <>
      <SectionTitle icon={<Play size={12} />} title="Action Settings" />

      <FormField label="Module">
        <select
          value={selectedModule}
          onChange={(e) => {
            updateField("module", e.target.value);
            updateField("action", "");
          }}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] appearance-none transition-colors"
        >
          <option value="">Select module...</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Action">
        <select
          value={(draft.action as string) || nodeData.action || ""}
          onChange={(e) => updateField("action", e.target.value)}
          disabled={!selectedModule}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] appearance-none transition-colors disabled:opacity-40"
        >
          <option value="">Select action...</option>
          {availableActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Parameters (JSON)">
        <textarea
          value={JSON.stringify(draft.params || {}, null, 2)}
          onChange={(e) => {
            try {
              updateField("params", JSON.parse(e.target.value));
            } catch {
              /* allow invalid JSON while typing */
            }
          }}
          rows={5}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[11px] text-[#E8EAED] font-mono focus:outline-none focus:border-[#4EA8FF] transition-colors resize-none"
        />
      </FormField>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Condition node form                                                */
/* ------------------------------------------------------------------ */
function ConditionNodeForm({
  draft,
  updateField,
}: {
  draft: Record<string, unknown>;
  updateField: (k: string, v: unknown) => void;
}) {
  const operators = [
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "contains",
    "starts_with",
    "ends_with",
    "is_empty",
    "is_not_empty",
  ];

  return (
    <>
      <SectionTitle icon={<GitFork size={12} />} title="Condition Settings" />

      <FormField label="Field">
        <input
          type="text"
          value={(draft.field as string) || ""}
          onChange={(e) => updateField("field", e.target.value)}
          placeholder="e.g. contact.status"
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>

      <FormField label="Operator">
        <div className="relative">
          <select
            value={(draft.operator as string) || "equals"}
            onChange={(e) => updateField("operator", e.target.value)}
            className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] appearance-none transition-colors"
          >
            {operators.map((op) => (
              <option key={op} value={op}>
                {op.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5F6368] pointer-events-none"
          />
        </div>
      </FormField>

      <FormField label="Value">
        <input
          type="text"
          value={(draft.value as string) || ""}
          onChange={(e) => updateField("value", e.target.value)}
          placeholder="Comparison value"
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>

      <FormField label="True branch label">
        <input
          type="text"
          value={(draft.trueLabel as string) || "Yes"}
          onChange={(e) => updateField("trueLabel", e.target.value)}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>

      <FormField label="False branch label">
        <input
          type="text"
          value={(draft.falseLabel as string) || "No"}
          onChange={(e) => updateField("falseLabel", e.target.value)}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Delay node form                                                    */
/* ------------------------------------------------------------------ */
function DelayNodeForm({
  draft,
  updateField,
}: {
  draft: Record<string, unknown>;
  updateField: (k: string, v: unknown) => void;
}) {
  const units = ["milliseconds", "seconds", "minutes", "hours", "days"];

  return (
    <>
      <SectionTitle icon={<Clock size={12} />} title="Delay Settings" />

      <FormField label="Duration">
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={(draft.duration as number) || 0}
            onChange={(e) =>
              updateField("duration", parseInt(e.target.value, 10) || 0)
            }
            className="flex-1 bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] transition-colors"
          />
          <select
            value={(draft.unit as string) || "seconds"}
            onChange={(e) => updateField("unit", e.target.value)}
            className="w-[110px] bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] appearance-none transition-colors"
          >
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </FormField>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Trigger node form                                                  */
/* ------------------------------------------------------------------ */
function TriggerNodeForm({
  draft,
  updateField,
}: {
  draft: Record<string, unknown>;
  updateField: (k: string, v: unknown) => void;
}) {
  const eventTypes = [
    "webhook",
    "schedule",
    "manual",
    "record_created",
    "record_updated",
    "record_deleted",
    "email_received",
    "form_submitted",
  ];

  return (
    <>
      <SectionTitle icon={<Zap size={12} />} title="Trigger Settings" />

      <FormField label="Event Type">
        <div className="relative">
          <select
            value={(draft.eventType as string) || ""}
            onChange={(e) => updateField("eventType", e.target.value)}
            className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] appearance-none transition-colors"
          >
            <option value="">Select event type...</option>
            {eventTypes.map((et) => (
              <option key={et} value={et}>
                {et.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5F6368] pointer-events-none"
          />
        </div>
      </FormField>

      {(draft.eventType === "schedule" || draft.eventType === "webhook") && (
        <FormField label="Configuration (JSON)">
          <textarea
            value={JSON.stringify(draft.triggerConfig || {}, null, 2)}
            onChange={(e) => {
              try {
                updateField("triggerConfig", JSON.parse(e.target.value));
              } catch {
                /* allow invalid JSON while typing */
              }
            }}
            rows={5}
            className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[11px] text-[#E8EAED] font-mono focus:outline-none focus:border-[#4EA8FF] transition-colors resize-none"
          />
        </FormField>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Decision node form                                              */
/* ------------------------------------------------------------------ */
function AIDecisionNodeForm({
  draft,
  updateField,
}: {
  draft: Record<string, unknown>;
  updateField: (k: string, v: unknown) => void;
}) {
  const options = (draft.options as string[]) || ["Option A", "Option B"];

  const addOption = () => {
    updateField("options", [...options, `Option ${String.fromCharCode(67 + options.length - 2)}`]);
  };

  const removeOption = (idx: number) => {
    if (options.length <= 2) return;
    const next = options.filter((_, i) => i !== idx);
    updateField("options", next);
  };

  const updateOption = (idx: number, value: string) => {
    const next = options.map((o, i) => (i === idx ? value : o));
    updateField("options", next);
  };

  return (
    <>
      <SectionTitle icon={<Brain size={12} />} title="AI Decision Settings" />

      <FormField label="Prompt">
        <textarea
          value={(draft.prompt as string) || ""}
          onChange={(e) => updateField("prompt", e.target.value)}
          placeholder="Enter the AI decision prompt..."
          rows={4}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors resize-none"
        />
      </FormField>

      <FormField label="Model">
        <input
          type="text"
          value={(draft.model as string) || "gpt-4o"}
          onChange={(e) => updateField("model", e.target.value)}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>

      {/* Options list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-[#9AA0A6]">
            Output Options
          </span>
          <button
            onClick={addOption}
            className="flex items-center gap-1 text-[11px] text-[#4EA8FF] hover:text-[#3D96EC] transition-colors"
          >
            <Plus size={12} />
            Add
          </button>
        </div>
        {options.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(idx, e.target.value)}
              className="flex-1 bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-1.5 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] transition-colors"
            />
            <button
              onClick={() => removeOption(idx)}
              disabled={options.length <= 2}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#5F6368] hover:text-[#F44336] hover:bg-[#F4433618] transition-colors disabled:opacity-30"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Loop node form                                                     */
/* ------------------------------------------------------------------ */
function LoopNodeForm({
  draft,
  updateField,
}: {
  draft: Record<string, unknown>;
  updateField: (k: string, v: unknown) => void;
}) {
  return (
    <>
      <SectionTitle icon={<Clock size={12} />} title="Loop Settings" />

      <FormField label="Collection source">
        <input
          type="text"
          value={(draft.collection as string) || ""}
          onChange={(e) => updateField("collection", e.target.value)}
          placeholder="e.g. contacts, input.items"
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>

      <FormField label="Iterator variable name">
        <input
          type="text"
          value={(draft.iterator as string) || "item"}
          onChange={(e) => updateField("iterator", e.target.value)}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>

      <FormField label="Max iterations (0 = unlimited)">
        <input
          type="number"
          min={0}
          value={(draft.maxIterations as number) || 0}
          onChange={(e) =>
            updateField("maxIterations", parseInt(e.target.value, 10) || 0)
          }
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Filter node form                                                   */
/* ------------------------------------------------------------------ */
function FilterNodeForm({
  draft,
  updateField,
}: {
  draft: Record<string, unknown>;
  updateField: (k: string, v: unknown) => void;
}) {
  return (
    <>
      <SectionTitle icon={<Clock size={12} />} title="Filter Settings" />

      <FormField label="Field path">
        <input
          type="text"
          value={(draft.field as string) || ""}
          onChange={(e) => updateField("field", e.target.value)}
          placeholder="e.g. contact.status"
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>

      <FormField label="Match mode">
        <select
          value={(draft.matchMode as string) || "include"}
          onChange={(e) => updateField("matchMode", e.target.value)}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] focus:outline-none focus:border-[#4EA8FF] appearance-none transition-colors"
        >
          <option value="include">Include matching</option>
          <option value="exclude">Exclude matching</option>
        </select>
      </FormField>

      <FormField label="Values (comma-separated)">
        <input
          type="text"
          value={(draft.values as string) || ""}
          onChange={(e) => updateField("values", e.target.value)}
          placeholder="active, pending, verified"
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[12px] text-[#E8EAED] placeholder-[#5F6368] focus:outline-none focus:border-[#4EA8FF] transition-colors"
        />
      </FormField>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Generic fallback form                                              */
/* ------------------------------------------------------------------ */
function GenericNodeForm({
  draft,
  updateField,
}: {
  draft: Record<string, unknown>;
  updateField: (k: string, v: unknown) => void;
}) {
  return (
    <>
      <SectionTitle icon={<Settings size={12} />} title="Configuration" />

      <FormField label="Config (JSON)">
        <textarea
          value={JSON.stringify(draft, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              Object.keys(parsed).forEach((k) => {
                updateField(k, parsed[k]);
              });
            } catch {
              /* allow invalid JSON while typing */
            }
          }}
          rows={10}
          className="w-full bg-[#1A1D21] border border-[#2A2D31] rounded-lg px-3 py-2 text-[11px] text-[#E8EAED] font-mono focus:outline-none focus:border-[#4EA8FF] transition-colors resize-none"
        />
      </FormField>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  UI helpers                                                          */
/* ------------------------------------------------------------------ */
function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-medium text-[#9AA0A6]">
        {label}
      </label>
      {children}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-1 pb-1">
      <span className="text-[#4EA8FF]">{icon}</span>
      <span className="text-[11px] font-semibold text-[#E8EAED] uppercase tracking-wider">
        {title}
      </span>
    </div>
  );
}
