"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, FileStack, X, ListChecks } from "lucide-react";
import {
  fetchProjectTemplates,
  createProjectTemplate,
  deleteProjectTemplate,
  createProjectFromTemplate,
  ProjectTemplate,
} from "@/lib/client";
import { toast } from "sonner";

interface Props {
  businessId: string | null;
  onProjectCreated?: () => void;
}

export function TemplateManager({ businessId, onProjectCreated }: Props) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [tasks, setTasks] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await fetchProjectTemplates(businessId);
    if (res.data) setTemplates(res.data);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    if (!businessId || !name.trim() || tasks.length === 0) return;
    setCreating(true);
    const res = await createProjectTemplate(businessId, { name: name.trim(), taskTitles: tasks });
    if (res.data) {
      setTemplates((prev) => [...prev, res.data!]);
      setName("");
      setTasks([]);
      setTaskInput("");
      setShowCreate(false);
      toast.success("Template created");
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    await deleteProjectTemplate(businessId, id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    toast.success("Template deleted");
  };

  const handleUseTemplate = async (template: ProjectTemplate) => {
    if (!businessId) return;
    const res = await createProjectFromTemplate(businessId, template.id);
    if (res.data) {
      toast.success(`Project "${res.data.name}" created from template`);
      onProjectCreated?.();
    }
  };

  const addTask = () => {
    if (taskInput.trim()) {
      setTasks((prev) => [...prev, taskInput.trim()]);
      setTaskInput("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileStack className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Project Templates</h3>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          New Template
        </button>
      </div>

      {showCreate && (
        <div className="kf-card rounded-xl p-4 space-y-3 border border-border/40">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-2">
            <input
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTask())}
              placeholder="Add a task and press Enter"
              className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button onClick={addTask} className="px-3 py-2 rounded-lg bg-muted text-sm hover:bg-muted/80">
              Add
            </button>
          </div>
          {tasks.length > 0 && (
            <div className="space-y-1">
              {tasks.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg text-sm"
                  style={{ background: "hsl(var(--kf-accent2) / 0.06)" }}
                >
                  <span className="text-muted-foreground">{i + 1}. {t}</span>
                  <button onClick={() => setTasks((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim() || tasks.length === 0}
              className="kf-btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Save Template
            </button>
            <button
              onClick={() => { setShowCreate(false); setName(""); setTasks([]); setTaskInput(""); }}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {templates.length === 0 && !showCreate && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No templates yet. Create one to quickly spin up projects with pre-defined tasks.
        </p>
      )}

      {templates.length > 0 && (
        <div className="grid gap-2">
          {templates.map((t) => {
            const taskList = Array.isArray(t.taskTitles) ? t.taskTitles : [];
            return (
              <div key={t.id} className="kf-card rounded-xl p-3 flex items-center gap-3 border border-border/30">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
                >
                  <ListChecks className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <p className="kf-text-caption text-muted-foreground">
                    {taskList.length} task{taskList.length !== 1 ? "s" : ""}
                    {t.product ? ` · Linked to ${t.product.name}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleUseTemplate(t)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  style={{
                    background: "hsl(var(--kf-accent2) / 0.1)",
                    color: "hsl(var(--kf-accent2))",
                  }}
                >
                  Use
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="text-muted-foreground hover:text-foreground p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
