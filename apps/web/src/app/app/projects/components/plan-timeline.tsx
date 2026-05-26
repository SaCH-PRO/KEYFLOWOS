"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Bot,
  Hand,
  Flag,
  PauseCircle,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Users,
  DollarSign,
  ArrowUpDown,
} from "lucide-react";
import { Badge, Button, Card } from "@keyflow/ui";
import type { ProjectPlanEvent } from "@/lib/project-plans-api";

interface PlanTimelineProps {
  events: ProjectPlanEvent[];
  planStatus: string;
  onReorder: (updates: { eventId: string; sortOrder: number }[]) => void;
  onAnalyzeImpact?: (eventId: string, newSortOrder: number) => Promise<{
    canProceed: boolean;
    dependencyViolations: string[];
    timeDeltaDays: number;
    budgetDelta: number;
    peopleImpact: Array<{ role: string; impact: string; details: string }>;
    riskDelta: string;
    newRisks: Array<{ description: string; severity: string }>;
    pros: string[];
    cons: string[];
    recommendation: string;
  } | null>;
  onExecute?: (eventId: string) => void;
  onComplete?: (eventId: string) => void;
}

function EventTypeIcon({ eventType, executionContext }: { eventType: string; executionContext: string }) {
  if (eventType === "milestone") return <Flag className="w-4 h-4 text-emerald-400" />;
  if (eventType === "decision_gate") return <PauseCircle className="w-4 h-4 text-purple-400" />;
  if (eventType === "review") return <CheckCircle2 className="w-4 h-4 text-blue-400" />;
  if (executionContext === "IN_APP") return <Bot className="w-4 h-4 text-sky-400" />;
  return <Hand className="w-4 h-4 text-amber-400" />;
}

function EventCard({
  event,
  isOverlay,
  isDragged,
  planStatus,
  onExecute,
  onComplete,
}: {
  event: ProjectPlanEvent;
  isOverlay?: boolean;
  isDragged?: boolean;
  planStatus: string;
  onExecute?: (eventId: string) => void;
  onComplete?: (eventId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: event.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isOverlay || isDragged ? 50 : undefined,
  };

  const isMaterialized = planStatus === "materialized";
  const canExecute = isMaterialized && event.executionContext === "IN_APP" && event.status !== "completed";
  const canComplete = isMaterialized && event.executionContext === "OUT_APP" && event.status !== "completed";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-start gap-3 p-3 rounded-lg border transition-shadow ${
        isOverlay
          ? "bg-card border-primary shadow-lg ring-1 ring-primary/20"
          : "bg-card border-border hover:shadow-sm"
      }`}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="mt-0.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </div>

      {/* Icon */}
      <div className="mt-0.5 shrink-0">
        <EventTypeIcon eventType={event.eventType} executionContext={event.executionContext} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{event.title}</span>
          <Badge tone={event.executionContext === "IN_APP" ? "info" : "default"}>
            {event.executionContext === "IN_APP" ? "Auto" : "Manual"}
          </Badge>
          {event.autoExecute && (
            <Badge tone="info">Auto-Run</Badge>
          )}
          {event.status === "completed" && (
            <Badge tone="success">Done</Badge>
          )}
        </div>
        {event.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{event.description}</p>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          {event.estimatedHours && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock className="w-3 h-3" /> {event.estimatedHours}h
            </span>
          )}
          {event.estimatedCost && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <DollarSign className="w-3 h-3" /> {event.estimatedCost}
            </span>
          )}
          {event.requiredRoles.length > 0 && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Users className="w-3 h-3" /> {event.requiredRoles.join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {canExecute && (
          <Button
            size="xs"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onExecute?.(event.id)}
            title="Execute now"
          >
            <Play className="w-3.5 h-3.5 text-sky-400" />
          </Button>
        )}
        {canComplete && (
          <Button
            size="xs"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onComplete?.(event.id)}
            title="Mark complete"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function PlanTimeline({
  events,
  planStatus,
  onReorder,
  onAnalyzeImpact,
  onExecute,
  onComplete,
}: PlanTimelineProps) {
  const [items, setItems] = useState<ProjectPlanEvent[]>(events);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [impactAnalysis, setImpactAnalysis] = useState<{
    eventId: string;
    result: NonNullable<Awaited<ReturnType<NonNullable<typeof onAnalyzeImpact>>>>;
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setImpactAnalysis(null);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);

    if (oldIndex === newIndex) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    const updates = reordered.map((item, idx) => ({ eventId: item.id, sortOrder: idx + 1 }));
    setItems(reordered);
    onReorder(updates);

    // Trigger impact analysis
    if (onAnalyzeImpact) {
      setAnalyzing(true);
      const result = await onAnalyzeImpact(active.id as string, newIndex + 1);
      setAnalyzing(false);
      if (result) {
        setImpactAnalysis({ eventId: active.id as string, result });
      }
    }
  }, [items, onReorder, onAnalyzeImpact]);

  const activeEvent = activeId ? items.find((i) => i.id === activeId) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Drag to rearrange events. Key will analyze the impact of each change.
        </span>
      </div>

      {impactAnalysis && (
        <Card className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-2 flex-1">
              <p className="text-sm font-medium">Impact Analysis</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="text-xs">
                  <span className="text-muted-foreground">Time:</span>{" "}
                  <span className={impactAnalysis.result.timeDeltaDays > 0 ? "text-red-400" : impactAnalysis.result.timeDeltaDays < 0 ? "text-emerald-400" : "text-muted-foreground"}>
                    {impactAnalysis.result.timeDeltaDays > 0 ? "+" : ""}{impactAnalysis.result.timeDeltaDays}d
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Budget:</span>{" "}
                  <span className={impactAnalysis.result.budgetDelta > 0 ? "text-red-400" : impactAnalysis.result.budgetDelta < 0 ? "text-emerald-400" : "text-muted-foreground"}>
                    {impactAnalysis.result.budgetDelta > 0 ? "+" : ""}{impactAnalysis.result.budgetDelta}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Risk:</span>{" "}
                  <span className={impactAnalysis.result.riskDelta === "increased" ? "text-red-400" : impactAnalysis.result.riskDelta === "decreased" ? "text-emerald-400" : "text-muted-foreground"}>
                    {impactAnalysis.result.riskDelta}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Proceed:</span>{" "}
                  <span className={impactAnalysis.result.canProceed ? "text-emerald-400" : "text-red-400"}>
                    {impactAnalysis.result.canProceed ? "Yes" : "No"}
                  </span>
                </div>
              </div>
              {impactAnalysis.result.dependencyViolations.length > 0 && (
                <div className="text-xs text-red-400">
                  <span className="font-medium">Dependency violations:</span>{" "}
                  {impactAnalysis.result.dependencyViolations.join("; ")}
                </div>
              )}
              {impactAnalysis.result.pros.length > 0 && (
                <div className="text-xs">
                  <span className="font-medium text-emerald-400">Pros:</span>{" "}
                  {impactAnalysis.result.pros.join("; ")}
                </div>
              )}
              {impactAnalysis.result.cons.length > 0 && (
                <div className="text-xs">
                  <span className="font-medium text-red-400">Cons:</span>{" "}
                  {impactAnalysis.result.cons.join("; ")}
                </div>
              )}
              {impactAnalysis.result.recommendation && (
                <p className="text-xs text-muted-foreground italic">
                  {impactAnalysis.result.recommendation}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {analyzing && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Key is analyzing the impact...
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                planStatus={planStatus}
                onExecute={onExecute}
                onComplete={onComplete}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeEvent ? (
            <EventCard event={activeEvent} isOverlay planStatus={planStatus} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
