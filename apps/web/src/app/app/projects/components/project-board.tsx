"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, MoreHorizontal, Calendar,
  Trash2, FolderKanban, ChevronDown, ChevronRight,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  fetchProjects, createProject, updateProject, deleteProject,
  createProjectTask, updateProjectTask, deleteProjectTask,
  Project, ProjectTask,
} from "@/lib/client";
import { ExplainerButton } from "./explainer-button";
import { TaskList } from "./task-list";

const STATUS_COLUMNS = [
  { key: "ACTIVE", label: "Active", color: "hsl(var(--kf-accent2))" },
  { key: "IN_PROGRESS", label: "In Progress", color: "hsl(var(--kf-accent1))" },
  { key: "COMPLETED", label: "Completed", color: "hsl(var(--kf-success))" },
  { key: "ON_HOLD", label: "On Hold", color: "hsl(var(--kf-neutral))" },
];

const PROJECT_COLORS = [
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e", "#eab308", "#ec4899", "#6366f1",
];

export function ProjectBoard({ businessId }: { businessId: string | null }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchProjects(businessId);
      if (res.data) setProjects(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const handleCreateProject = async () => {
    if (!businessId || !newProjectName.trim()) return;
    const res = await createProject(businessId, { name: newProjectName.trim(), color: newProjectColor });
    if (res.data) {
      setProjects((prev) => [res.data!, ...prev]);
      setExpandedProjects((prev) => new Set(prev).add(res.data!.id));
    }
    setNewProjectName("");
    setShowNewProject(false);
  };

  const handleUpdateProjectStatus = async (projectId: string, status: string) => {
    if (!businessId) return;
    await updateProject(businessId, projectId, { status });
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status } : p)));
    setMenuOpen(null);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!businessId) return;
    await deleteProject(businessId, projectId);
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setMenuOpen(null);
  };

  const handleAddTask = async (projectId: string, title: string) => {
    if (!businessId || !title) return;
    const res = await createProjectTask(businessId, projectId, { title });
    if (res.data) {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, tasks: [...(p.tasks || []), res.data!] } : p,
        ),
      );
    }
  };

  const handleToggleTask = async (projectId: string, task: ProjectTask) => {
    if (!businessId) return;
    const updated = !task.isCompleted;
    await updateProjectTask(businessId, task.id, { isCompleted: updated });
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, isCompleted: updated } : t)) }
          : p,
      ),
    );
  };

  const handleDeleteTask = async (projectId: string, taskId: string) => {
    if (!businessId) return;
    await deleteProjectTask(businessId, taskId);
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) } : p,
      ),
    );
  };

  const toggleExpand = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const projectsByStatus = STATUS_COLUMNS.map((col) => ({
    ...col,
    projects: projects.filter((p) => p.status === col.key),
  }));

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {STATUS_COLUMNS.map((col) => (
          <div key={col.key} className="rounded-2xl border border-border/40 p-4 space-y-3" style={{ background: "hsl(var(--kf-muted) / 0.05)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="h-4 w-24 rounded animate-pulse" style={{ background: "hsl(var(--kf-muted) / 0.2)" }} />
              <div className="h-5 w-6 rounded-full animate-pulse" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
            </div>
            {Array.from({ length: col.key === "ACTIVE" ? 3 : col.key === "IN_PROGRESS" ? 2 : 1 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/20 p-3 space-y-2" style={{ background: "hsl(var(--kf-muted) / 0.08)" }}>
                <div className="h-4 w-3/4 rounded animate-pulse" style={{ background: "hsl(var(--kf-muted) / 0.2)" }} />
                <div className="h-3 w-1/2 rounded animate-pulse" style={{ background: "hsl(var(--kf-muted) / 0.12)" }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ExplainerButton
          items={[
            { title: "Create a Project", text: "Click '+ New Project' to set up a project with a name and color. Each project is a container for related tasks — like a client job, campaign, or event." },
            { title: "Add Tasks", text: "Expand a project and add tasks — each is a specific action item (e.g. \"Design flyer\", \"Confirm venue\"). Check them off as you complete them." },
            { title: "Kanban Board View", text: "Projects are displayed in columns by status: Active, In Progress, Completed, and On Hold. Move projects between statuses using the menu." },
            { title: "Track Progress", text: "Each project shows a progress bar based on completed tasks. Open it to see all tasks and their status at a glance." },
          ]}
        />
        <button
          onClick={() => setShowNewProject(true)}
          className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      <AnimatePresence>
        {showNewProject && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="kf-card p-4 space-y-3">
              <input
                autoFocus
                placeholder="Project name..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
                className="w-full bg-transparent border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Color:</span>
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewProjectColor(c)}
                    className="w-5 h-5 rounded-full transition-transform"
                    style={{
                      background: c,
                      transform: newProjectColor === c ? "scale(1.3)" : "scale(1)",
                      boxShadow: newProjectColor === c ? `0 0 0 2px ${c}40` : "none",
                    }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim()}
                  className="kf-btn-primary px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowNewProject(false)}
                  className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted/30"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to organize tasks, track progress, and stay on top of your work."
          actionLabel="New Project"
          onAction={() => setShowNewProject(true)}
          tip="Projects move across Active, In Progress, Completed, and On Hold columns as you work."
        />
      ) : (
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {projectsByStatus.map((column) => (
          <div key={column.key} className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <div className="w-2 h-2 rounded-full" style={{ background: column.color }} />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {column.label}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">{column.projects.length}</span>
            </div>

            <div className="space-y-2 min-h-[100px]">
              <AnimatePresence>
                {column.projects.map((project) => {
                  const isExpanded = expandedProjects.has(project.id);
                  const completedTasks = project.tasks?.filter((t) => t.isCompleted).length ?? 0;
                  const totalTasks = project.tasks?.length ?? 0;
                  const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

                  return (
                    <motion.div
                      key={project.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="kf-card rounded-xl overflow-hidden"
                    >
                      <div className="p-3">
                        <div className="flex items-start gap-2">
                          <button onClick={() => toggleExpand(project.id)} className="mt-0.5 text-muted-foreground hover:text-white">
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                style={{ background: project.color || column.color }}
                              />
                              <span className="text-sm font-semibold truncate">{project.name}</span>
                            </div>
                            {project.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 ml-4.5">{project.description}</p>
                            )}
                          </div>
                          <div className="relative">
                            <button
                              onClick={() => setMenuOpen(menuOpen === project.id ? null : project.id)}
                              className="p-1 text-muted-foreground hover:text-white rounded"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {menuOpen === project.id && (
                              <div className="absolute right-0 top-7 z-50 w-44 rounded-lg border border-border/60 bg-slate-900 p-1 shadow-xl">
                                {STATUS_COLUMNS.filter((s) => s.key !== project.status).map((s) => (
                                  <button
                                    key={s.key}
                                    onClick={() => handleUpdateProjectStatus(project.id, s.key)}
                                    className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-muted/30 flex items-center gap-2"
                                  >
                                    <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                                    Move to {s.label}
                                  </button>
                                ))}
                                <div className="border-t border-border/40 my-1" />
                                <button
                                  onClick={() => handleDeleteProject(project.id)}
                                  className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-red-500/20 text-red-400 flex items-center gap-2"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {totalTasks > 0 && (
                          <div className="mt-2 ml-6">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${progress}%`,
                                    background: project.color || column.color,
                                  }}
                                />
                              </div>
                              <span>{completedTasks}/{totalTasks}</span>
                            </div>
                          </div>
                        )}

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <TaskList
                                tasks={project.tasks ?? []}
                                projectId={project.id}
                                onToggleTask={handleToggleTask}
                                onDeleteTask={handleDeleteTask}
                                onAddTask={handleAddTask}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {project.dueDate && (
                          <div className="mt-2 ml-6 flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            {new Date(project.dueDate).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {column.projects.length === 0 && (
                <div className="rounded-xl p-6 text-center" style={{ background: "hsl(var(--kf-muted) / 0.3)" }}>
                  <div className="w-8 h-8 rounded-lg mx-auto mb-2 flex items-center justify-center" style={{ background: "hsl(var(--kf-muted) / 0.5)" }}>
                    <FolderKanban className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">No projects</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
