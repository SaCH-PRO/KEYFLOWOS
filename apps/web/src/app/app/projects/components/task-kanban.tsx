"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
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
import { GripVertical, Clock, AlertCircle } from "lucide-react";

export interface KanbanTask {
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
  /** The task's completion, when known. It can disagree with status: see boardStatus. */
  isCompleted?: boolean;
}

export interface KanbanMove {
  taskId: string;
  status: string;
  position: number;
}

/** A write the board waits on: false or a rejection means it was refused and the board rolls back. */
type BoardWrite = boolean | void | Promise<boolean | void>;

const COLUMNS = [
  { id: "TODO", label: "To Do", color: "bg-slate-500" },
  { id: "IN_PROGRESS", label: "In Progress", color: "bg-blue-500" },
  { id: "REVIEW", label: "Review", color: "bg-amber-500" },
  { id: "DONE", label: "Done", color: "bg-emerald-500" },
  { id: "BLOCKED", label: "Blocked", color: "bg-red-500" },
];
const COLUMN_IDS = new Set(COLUMNS.map((c) => c.id));

function SortableTaskCard({ task }: { task: KanbanTask }) {
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
            {task.estimatedHours ? (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                {task.trackedHours?.toFixed(1)}/{task.estimatedHours}h
              </span>
            ) : null}
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

/**
 * PR196-PROJECTS-WEB (WPD-05): a column is a drop target in its own right
 * (useDroppable under its status), so a drop on a column, empty or not, names it.
 */
function KanbanColumn({ column, tasks }: { column: (typeof COLUMNS)[number]; tasks: KanbanTask[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div className="flex-shrink-0 w-64">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${column.color}`} />
        <span className="text-sm font-semibold">{column.label}</span>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`min-h-[200px] rounded-lg p-2 transition-colors ${isOver ? "bg-muted/50" : "bg-muted/30"}`}
          data-column={column.id}
        >
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

/**
 * Review SEC-W196-1 / CR-W1: the column a card shows in. A task's status and completion can
 * disagree: the Projects page checkbox (PATCH {isCompleted}) and KEY's projects_complete_task
 * complete a task and leave its status as it was, and reopening the same way leaves DONE. Such a
 * card shows where its completion puts it (completed: Done; reopened: To Do), as the list does.
 */
function boardStatus(t: KanbanTask): string {
  if (t.isCompleted === undefined || (t.status === "DONE") === t.isCompleted) return t.status;
  return t.isCompleted ? "DONE" : "TODO";
}

/** A column's tasks in board order: by position, ties in the order given. */
function columnOf(items: KanbanTask[], status: string): KanbanTask[] {
  return items.filter((t) => boardStatus(t) === status).sort((a, b) => a.position - b.position);
}

/**
 * The writes a column's new order needs: only the tasks whose position changed (CR-W1), in the
 * new order, each under the column it shows in. A task whose position is unchanged is not sent, so
 * nothing is written for it.
 */
function repositioned(ordered: KanbanTask[], status: string): KanbanMove[] {
  return ordered.flatMap((t, i) => (t.position === i ? [] : [{ taskId: t.id, status, position: i }]));
}

async function accepted(write: () => BoardWrite): Promise<boolean> {
  try {
    return (await write()) !== false;
  } catch {
    return false;
  }
}

interface TaskKanbanProps {
  tasks: KanbanTask[];
  /**
   * A move to another column: the server's status door (PATCH .../tasks/:taskId/status).
   * Resolve false, or reject, when it was refused: the board puts the task back.
   */
  onUpdate: (taskId: string, status: string, position: number) => BoardWrite;
  /**
   * The positions of a column's tasks after a reorder (POST .../tasks/reorder). Every task whose
   * position changed is sent with its new position and the column it shows in, so the order
   * survives a reload (WPD-06); a task whose position did not change is not sent (CR-W1). The
   * writer saves the position alone for a task whose stored status is not that column, since
   * the server reads any status it is sent for that task as a status change (SEC-W196-1).
   */
  onReorder: (updates: KanbanMove[]) => BoardWrite;
}

export function TaskKanban({ tasks, onUpdate, onReorder }: TaskKanbanProps) {
  // WPD-07: the board shows the parent's tasks as they change (a task added from the add bar, a
  // saved move coming back), and its own optimistic move only until the parent's next list.
  const [items, setItems] = useState<KanbanTask[]>(tasks);
  const [shownTasks, setShownTasks] = useState<KanbanTask[]>(tasks);
  if (shownTasks !== tasks) {
    setShownTasks(tasks);
    setItems(tasks);
  }
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const before = items;
    const activeTask = before.find((t) => t.id === active.id);
    if (!activeTask) return;

    // WPD-05: `over` is a column (its own drop target) or a card; a card in another column
    // means that column, at that card's place.
    const overId = String(over.id);
    const overTask = COLUMN_IDS.has(overId) ? undefined : before.find((t) => t.id === overId);
    const targetStatus = COLUMN_IDS.has(overId) ? overId : overTask && boardStatus(overTask);
    if (!targetStatus) return;

    if (targetStatus !== boardStatus(activeTask)) {
      const target = columnOf(before, targetStatus);
      const index = overTask ? target.findIndex((t) => t.id === overTask.id) : target.length;
      // The moved card takes the column's status (and the completion the server gives it for that
      // status); the cards it lands above only move down.
      const moved: KanbanTask = {
        ...activeTask,
        status: targetStatus,
        position: index,
        ...(activeTask.isCompleted !== undefined && { isCompleted: targetStatus === "DONE" }),
      };
      const ordered = [...target.slice(0, index), moved, ...target.slice(index)];
      const positions = new Map(ordered.map((t, i) => [t.id, i]));
      setItems(before.map((t) => (t.id === moved.id ? moved : positions.has(t.id) ? { ...t, position: positions.get(t.id)! } : t)));

      // The status change goes through the server's status door; a refusal puts the board back.
      if (!(await accepted(() => onUpdate(activeTask.id, targetStatus, index)))) {
        setItems(before);
        return;
      }
      // The cards the moved one landed above keep their order: positions only (CR-W1).
      const shifted = repositioned(ordered, targetStatus).filter((u) => u.taskId !== moved.id);
      if (shifted.length > 0) await accepted(() => onReorder(shifted));
      return;
    }

    // WPD-06: a reorder inside the column sends every task whose position changed.
    if (!overTask) return;
    const column = columnOf(before, targetStatus);
    const from = column.findIndex((t) => t.id === activeTask.id);
    const to = column.findIndex((t) => t.id === overTask.id);
    if (from === to) return;
    const reordered = arrayMove(column, from, to);
    const updates = repositioned(reordered, targetStatus);
    if (updates.length === 0) return;
    const positions = new Map(reordered.map((t, i) => [t.id, i]));
    setItems(before.map((t) => (positions.has(t.id) ? { ...t, position: positions.get(t.id)! } : t)));
    if (!(await accepted(() => onReorder(updates)))) setItems(before);
  }, [items, onUpdate, onReorder]);

  const activeTask = activeId ? items.find((t) => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <KanbanColumn key={col.id} column={col} tasks={columnOf(items, col.id)} />
        ))}
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
