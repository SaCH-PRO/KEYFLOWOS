"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { GripVertical, Clock, AlertCircle } from "lucide-react";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  position: number;
  priority: string;
  dueDate: string | null;
  assigneeId: string | null;
  estimatedHours: number | null;
  trackedHours: number;
}

const COLUMNS = [
  { id: "TODO", label: "To Do", color: "bg-slate-500" },
  { id: "IN_PROGRESS", label: "In Progress", color: "bg-blue-500" },
  { id: "REVIEW", label: "Review", color: "bg-amber-500" },
  { id: "DONE", label: "Done", color: "bg-emerald-500" },
  { id: "BLOCKED", label: "Blocked", color: "bg-red-500" },
];

function SortableTaskCard({ task }: { task: Task }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group bg-card border border-border rounded-lg p-3 mb-2 cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow"
    >
      <div className="flex items-start gap-2">
        <div {...attributes} {...listeners} className="mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{task.title}</div>
          <div className="flex items-center gap-2 mt-1">
            {task.priority === "HIGH" && <AlertCircle className="w-3 h-3 text-red-400" />}
            {task.priority === "URGENT" && <AlertCircle className="w-3 h-3 text-red-500" />}
            {task.estimatedHours && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {task.trackedHours?.toFixed(1)}/{task.estimatedHours}h
              </span>
            )}
            {task.dueDate && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(task.dueDate).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface TaskKanbanProps {
  tasks: Task[];
  onUpdate: (taskId: string, status: string, position: number) => void;
}

export function TaskKanban({ tasks, onUpdate }: TaskKanbanProps) {
  const [items, setItems] = useState<Task[]>(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeTask = items.find(t => t.id === active.id);
    if (!activeTask) return;

    const overId = over.id as string;
    const overColumn = COLUMNS.find(c => c.id === overId);

    if (overColumn) {
      // Dropped on a column
      if (activeTask.status !== overColumn.id) {
        const columnTasks = items.filter(t => t.status === overColumn.id);
        const newPosition = columnTasks.length;
        const updated = items.map(t =>
          t.id === activeTask.id ? { ...t, status: overColumn.id, position: newPosition } : t
        );
        setItems(updated);
        onUpdate(activeTask.id, overColumn.id, newPosition);
      }
    } else {
      // Dropped on another task - reorder within column
      const overTask = items.find(t => t.id === overId);
      if (!overTask || overTask.status !== activeTask.status) return;

      const oldIndex = items.filter(t => t.status === activeTask.status).findIndex(t => t.id === active.id);
      const newIndex = items.filter(t => t.status === activeTask.status).findIndex(t => t.id === over.id);

      if (oldIndex !== newIndex) {
        const columnTaskIds = items.filter(t => t.status === activeTask.status).map(t => t.id);
        const reorderedIds = arrayMove(columnTaskIds, oldIndex, newIndex);
        const updated = items.map(t => {
          if (t.status === activeTask.status) {
            const pos = reorderedIds.indexOf(t.id);
            return { ...t, position: pos };
          }
          return t;
        });
        setItems(updated);
        const task = updated.find(t => t.id === activeTask.id);
        if (task) onUpdate(task.id, task.status, task.position);
      }
    }
  }, [items, onUpdate]);

  const activeTask = activeId ? items.find(t => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map(col => {
          const colTasks = items
            .filter(t => t.status === col.id)
            .sort((a, b) => a.position - b.position);

          return (
            <div key={col.id} className="flex-shrink-0 w-64">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2 h-2 rounded-full ${col.color}`} />
                <span className="text-sm font-semibold">{col.label}</span>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {colTasks.length}
                </span>
              </div>
              <SortableContext
                items={colTasks.map(t => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  className="min-h-[200px] bg-muted/30 rounded-lg p-2"
                  data-column={col.id}
                >
                  {colTasks.map(task => (
                    <SortableTaskCard key={task.id} task={task} />
                  ))}
                </div>
              </SortableContext>
            </div>
          );
        })}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="bg-card border border-border rounded-lg p-3 shadow-lg opacity-90">
            <div className="text-sm font-medium">{activeTask.title}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
