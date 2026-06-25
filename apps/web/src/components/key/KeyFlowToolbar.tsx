"use client";

/**
 * KeyFlowToolbar — Top toolbar for the Flow Studio
 * Flow name editing, save/execute actions, zoom controls, undo/redo,
 * status indicator, snap-to-grid toggle, and minimap toggle.
 */

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Save,
  Play,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Maximize,
  Undo2,
  Redo2,
  Trash2,
  Grid3X3,
  Map,
  Check,
  Circle,
  Clock,
  Calendar,
  Zap,
  Type,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface KeyFlowToolbarProps {
  flowName: string;
  onFlowNameChange: (name: string) => void;
  onSave: () => void;
  onExecute: () => void;
  onSchedule: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onZoomReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  isDirty: boolean;
  lastExecuted: string | null;
  snapToGrid: boolean;
  onToggleSnap: () => void;
  showMinimap: boolean;
  onToggleMinimap: () => void;
  onOpenTemplates: () => void;
  zoom: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function KeyFlowToolbar({
  flowName,
  onFlowNameChange,
  onSave,
  onExecute,
  onSchedule,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onZoomReset,
  onUndo,
  onRedo,
  onDeleteSelected,
  canUndo,
  canRedo,
  hasSelection,
  isDirty,
  lastExecuted,
  snapToGrid,
  onToggleSnap,
  showMinimap,
  onToggleMinimap,
  onOpenTemplates,
  zoom,
}: KeyFlowToolbarProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(flowName);
  const [execDropdownOpen, setExecDropdownOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameDraft(flowName);
  }, [flowName]);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleNameSubmit = () => {
    const trimmed = nameDraft.trim();
    if (trimmed) onFlowNameChange(trimmed);
    else setNameDraft(flowName);
    setIsEditingName(false);
  };

  const execDropdownRef = useRef<HTMLDivElement>(null);

  /* Close dropdown on outside click */
  useEffect(() => {
    if (!execDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        execDropdownRef.current &&
        !execDropdownRef.current.contains(e.target as Node)
      ) {
        setExecDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [execDropdownOpen]);

  return (
    <div className="h-[52px] bg-[#131518] border-b border-[#2A2D31] flex items-center px-4 gap-3 select-none shrink-0 z-50">
      {/* Flow name */}
      <div className="flex items-center gap-2 min-w-0">
        <Type size={14} className="text-[#5F6368] shrink-0" />
        {isEditingName ? (
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNameSubmit();
              if (e.key === "Escape") {
                setNameDraft(flowName);
                setIsEditingName(false);
              }
            }}
            className="bg-[#1A1D21] border border-[#4EA8FF] rounded-md px-2 py-1 text-[13px] text-[#E8EAED] focus:outline-none w-[220px]"
          />
        ) : (
          <button
            onClick={() => setIsEditingName(true)}
            className="text-[13px] font-semibold text-[#E8EAED] hover:text-[#4EA8FF] transition-colors truncate max-w-[220px]"
            title="Click to rename"
          >
            {flowName}
          </button>
        )}

        {/* Save status dot */}
        {isDirty ? (
          <Circle
            size={8}
            className="text-[#FFC34D] fill-[#FFC34D] shrink-0"
            title="Unsaved changes"
          />
        ) : (
          <Check
            size={12}
            className="text-[#4CAF50] shrink-0"
            title="All changes saved"
          />
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-[#2A2D31] mx-1" />

      {/* Save */}
      <ToolbarButton
        onClick={onSave}
        title="Save flow (Ctrl+S)"
        icon={<Save size={15} />}
        label="Save"
        accent={isDirty}
      />

      {/* Execute with dropdown */}
      <div className="relative" ref={execDropdownRef}>
        <div className="flex items-center">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={onExecute}
            className="flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-l-lg bg-[#4CAF50] hover:bg-[#43A047] text-white text-[12px] font-medium transition-colors"
          >
            <Play size={13} fill="white" />
            <span>Execute</span>
          </motion.button>
          <button
            onClick={() => setExecDropdownOpen((v) => !v)}
            className="h-8 px-1.5 rounded-r-lg bg-[#4CAF50] hover:bg-[#43A047] text-white border-l border-[#388E3C] transition-colors"
          >
            <ChevronDown size={13} />
          </button>
        </div>

        <AnimatePresence>
          {execDropdownOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              className="absolute top-full left-0 mt-1.5 bg-[#1A1D21] border border-[#2A2D31] rounded-lg shadow-glass overflow-hidden min-w-[160px] z-50"
            >
              <button
                onClick={() => {
                  onExecute();
                  setExecDropdownOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#E8EAED] hover:bg-[#2A2D31] transition-colors"
              >
                <Zap size={14} className="text-[#4CAF50]" />
                Execute now
              </button>
              <button
                onClick={() => {
                  onSchedule();
                  setExecDropdownOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#E8EAED] hover:bg-[#2A2D31] transition-colors"
              >
                <Calendar size={14} className="text-[#9C27B0]" />
                Schedule...
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-[#2A2D31] mx-1" />

      {/* Undo / Redo */}
      <ToolbarButton
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        icon={<Undo2 size={15} />}
      />
      <ToolbarButton
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        icon={<Redo2 size={15} />}
      />

      {/* Divider */}
      <div className="w-px h-6 bg-[#2A2D31] mx-1" />

      {/* Delete */}
      <ToolbarButton
        onClick={onDeleteSelected}
        disabled={!hasSelection}
        title="Delete selected (Del)"
        icon={<Trash2 size={15} />}
        danger
      />

      {/* Divider */}
      <div className="w-px h-6 bg-[#2A2D31] mx-1" />

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5 bg-[#1A1D21] rounded-lg border border-[#2A2D31] overflow-hidden">
        <ToolbarButton
          onClick={onZoomOut}
          title="Zoom out"
          icon={<ZoomOut size={14} />}
          compact
        />
        <button
          onClick={onZoomReset}
          title="Reset zoom"
          className="h-7 px-2 text-[11px] font-medium text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#2A2D31] transition-colors tabular-nums"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolbarButton
          onClick={onZoomIn}
          title="Zoom in"
          icon={<ZoomIn size={14} />}
          compact
        />
        <div className="w-px h-4 bg-[#2A2D31]" />
        <ToolbarButton
          onClick={onZoomFit}
          title="Fit to screen"
          icon={<Maximize size={14} />}
          compact
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Template gallery */}
      <ToolbarButton
        onClick={onOpenTemplates}
        title="Template gallery"
        icon={<Zap size={14} />}
        label="Templates"
      />

      {/* Divider */}
      <div className="w-px h-6 bg-[#2A2D31] mx-1" />

      {/* Toggles */}
      <ToggleButton
        active={snapToGrid}
        onClick={onToggleSnap}
        title="Snap to grid"
        icon={<Grid3X3 size={14} />}
      />
      <ToggleButton
        active={showMinimap}
        onClick={onToggleMinimap}
        title="Show minimap"
        icon={<Map size={14} />}
      />

      {/* Divider */}
      <div className="w-px h-6 bg-[#2A2D31] mx-1" />

      {/* Status */}
      <div className="flex items-center gap-2 text-[11px] text-[#5F6368]">
        <Clock size={12} />
        {lastExecuted ? (
          <span>
            Last run:{" "}
            {new Date(lastExecuted).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : (
          <span>Never executed</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */
function ToolbarButton({
  onClick,
  disabled,
  title,
  icon,
  label,
  compact,
  danger,
  accent,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: React.ReactNode;
  label?: string;
  compact?: boolean;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.93 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        flex items-center justify-center gap-1.5 shrink-0 transition-colors
        ${compact ? "w-7 h-7" : "h-8 px-2.5"}
        rounded-lg text-[12px] font-medium
        ${disabled
          ? "text-[#3C4043] cursor-not-allowed"
          : danger
            ? "text-[#F44336] hover:bg-[#F4433618]"
            : accent
              ? "text-[#FFC34D] hover:bg-[#FFC34D18]"
              : "text-[#9AA0A6] hover:text-[#E8EAED] hover:bg-[#2A2D31]"
        }
      `}
    >
      {icon}
      {label && <span>{label}</span>}
    </motion.button>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`
        flex items-center justify-center w-7 h-7 rounded-lg transition-colors
        ${active
          ? "bg-[#4EA8FF22] text-[#4EA8FF]"
          : "text-[#5F6368] hover:text-[#9AA0A6] hover:bg-[#2A2D31]"
        }
      `}
    >
      {icon}
    </button>
  );
}
