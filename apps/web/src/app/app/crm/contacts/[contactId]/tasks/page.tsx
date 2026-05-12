"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchContactTasks, addContactTask, deleteContactTask } from "@/lib/client";
import { Button, Card, Input } from "@keyflow/ui";
import { CheckSquare, Plus, Trash2, Calendar, Flag } from "lucide-react";
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

  const load = async () => {
    setLoading(true);
    const res = await fetchContactTasks({ contactId: contactId as string });
    setTasks(res.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
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

  const handleToggle = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        const completed = t.status === "completed" || t.completedAt != null;
        return { ...t, status: completed ? "pending" : "completed", completedAt: completed ? null : new Date().toISOString() };
      })
    );
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
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${isCompleted(task) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}
                >
                  {isCompleted(task) && <CheckSquare className="h-3.5 w-3.5 text-primary-foreground" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${isCompleted(task) ? "line-through text-muted-foreground" : ""}`}>
                    {task.title}
                  </p>
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
                <button
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(task.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
