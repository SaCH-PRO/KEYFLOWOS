"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  fetchContactTasks,
  addContactTask,
  deleteContactTask,
  completeContactTask,
  reopenContactTask,
  updateContactTask,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { Button, Card, Input } from "@keyflow/ui";
import { CheckSquare, Plus, Trash2, Calendar, Flag, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";

interface Task {
  id: string;
  title: string;
  status?: string | null;
  completedAt?: string | null;
  dueDate?: string | null;
  priority?: string | null;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ContactTasksPage() {
  const { contactId } = useParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const load = async () => {
    setLoading(true);
    const res = await fetchContactTasks({ contactId: contactId as string });
    setTasks(res.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchContactTasks({ contactId: contactId as string });
      if (!cancelled) {
        setTasks(res.data ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contactId]);

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    const res = await addContactTask(contactId as string, newTitle.trim());
    setSaving(false);
    if (res.data) {
      setNewTitle("");
      toast.success("Task added");
      load();
    } else {
      toast.error(res.error ?? "Failed to add task");
    }
  };

  const handleToggle = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || togglingId) return;

    const completed = task.status === "completed" || task.completedAt != null;
    setTogglingId(taskId);
    try {
      const businessId = getStoredBusinessId() ?? undefined;
      const res = completed
        ? await reopenContactTask(taskId, businessId)
        : await completeContactTask(taskId, businessId);
      if (res.data) {
        toast.success(completed ? "Task reopened" : "Task completed");
        load();
      } else {
        toast.error(res.error ?? "Failed to update task");
      }
    } catch {
      toast.error("Failed to update task");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (taskId: string) => {
    const res = await deleteContactTask(taskId);
    if (res.data) {
      toast.success("Task deleted");
      load();
    } else {
      toast.error(res.error ?? "Failed to delete task");
    }
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
  };

  const saveEdit = async (taskId: string) => {
    if (!editTitle.trim()) return;
    const businessId = getStoredBusinessId() ?? undefined;
    const res = await updateContactTask(taskId, { title: editTitle.trim() }, businessId);
    if (res.data) {
      toast.success("Task updated");
      setEditingId(null);
      load();
    } else {
      toast.error(res.error ?? "Failed to update task");
    }
  };

  const isCompleted = (t: Task) => t.status === "completed" || t.completedAt != null;
  const pending = tasks.filter((t) => !isCompleted(t));
  const done = tasks.filter((t) => isCompleted(t));

  if (loading) return <div className="p-4">Loading tasks...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckSquare className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Tasks</h3>
        <span className="ml-auto text-sm text-muted-foreground">
          {pending.length} pending · {done.length} done
        </span>
      </div>

      <div className="flex gap-2">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a new task..."
          className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <Button onClick={handleAdd} disabled={saving || !newTitle.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </div>

      {[...pending, ...done].length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No tasks yet. Add your first task above.
        </div>
      ) : (
        <div className="space-y-2">
          {[...pending, ...done].map((task) => (
            <Card key={task.id} className={isCompleted(task) ? "opacity-60" : ""}>
              <div className="flex items-center gap-3 p-3">
                <button
                  onClick={() => handleToggle(task.id)}
                  disabled={togglingId === task.id}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${isCompleted(task) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}
                >
                  {togglingId === task.id ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary-foreground" />
                  ) : isCompleted(task) ? (
                    <CheckSquare className="h-3.5 w-3.5 text-primary-foreground" />
                  ) : null}
                </button>
                <div className="min-w-0 flex-1">
                  {editingId === task.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(task.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <button onClick={() => saveEdit(task.id)} className="text-primary hover:text-primary/80">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={cancelEdit} className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEdit(task)}
                      className={`text-left text-sm w-full ${isCompleted(task) ? "line-through text-muted-foreground" : ""}`}
                    >
                      {task.title}
                    </button>
                  )}
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {task.dueDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {fmtDate(task.dueDate)}
                      </span>
                    )}
                    {task.priority && (
                      <span className="flex items-center gap-1">
                        <Flag className="h-3 w-3" />
                        {task.priority}
                      </span>
                    )}
                  </div>
                </div>
                {editingId !== task.id && (
                  <button
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(task.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
