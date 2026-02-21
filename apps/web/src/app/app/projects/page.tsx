"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  MoreHorizontal,
  CheckCircle2,
  Circle,
  Calendar,
  Flag,
  Trash2,
  GripVertical,
  FolderKanban,
  ChevronDown,
  ChevronRight,
  Pencil,
} from "lucide-react";
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  Project,
  ProjectTask,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { ContactPickerDrawer } from "@/components/contacts";
import { Send } from "lucide-react";
import { FeatureGuide } from "@/components/ui/feature-guide";

const STATUS_COLUMNS = [
  { key: "ACTIVE", label: "Active", color: "hsl(var(--kf-accent2))" },
  { key: "IN_PROGRESS", label: "In Progress", color: "hsl(var(--kf-accent1))" },
  { key: "COMPLETED", label: "Completed", color: "#22c55e" },
  { key: "ON_HOLD", label: "On Hold", color: "#94a3b8" },
];

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "#ef4444",
  HIGH: "#f97316",
  NORMAL: "#3b82f6",
  LOW: "#94a3b8",
};

const PROJECT_COLORS = [
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e", "#eab308", "#ec4899", "#6366f1",
];

export default function ProjectsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [newTaskInputs, setNewTaskInputs] = useState<Record<string, string>>({});
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const loadProjects = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchProjects(businessId);
      if (res.data) setProjects(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleCreateProject = async () => {
    if (!businessId || !newProjectName.trim()) return;
    const res = await createProject(businessId, {
      name: newProjectName.trim(),
      color: newProjectColor,
    });
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

  const handleAddTask = async (projectId: string) => {
    if (!businessId) return;
    const title = newTaskInputs[projectId]?.trim();
    if (!title) return;
    const res = await createProjectTask(businessId, projectId, { title });
    if (res.data) {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, tasks: [...(p.tasks || []), res.data!] } : p,
        ),
      );
    }
    setNewTaskInputs((prev) => ({ ...prev, [projectId]: "" }));
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

  const getStatusColumn = (status: string) => STATUS_COLUMNS.find((c) => c.key === status) || STATUS_COLUMNS[0];

  const projectsByStatus = STATUS_COLUMNS.map((col) => ({
    ...col,
    projects: projects.filter((p) => p.status === col.key),
  }));

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader icon={FolderKanban} title="Projects" subtitle="Loading your projects..." />
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-48 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        subtitle="Manage your projects and tasks"
        actionLabel="New Project"
        onAction={() => setShowNewProject(true)}
        rightSlot={
          <button
            onClick={() => setShowContactPicker(true)}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Send className="w-4 h-4" />
            Broadcast
          </button>
        }
      />

      <FeatureGuide
        featureKey="projects"
        title="Getting Started with Projects"
        description="Organize work into projects with tasks, deadlines, and a visual Kanban board."
        steps={[
          { title: "Create a Project", description: "Set up a project with a name, description, status, and priority level." },
          { title: "Add Tasks", description: "Break projects into tasks with titles, deadlines, and assignees." },
          { title: "Use Kanban Board", description: "Drag and drop tasks across columns (To Do, In Progress, Done) to track progress." },
          { title: "Track Status", description: "Monitor project health with status indicators and completion tracking." },
        ]}
      />

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
                              <div className="mt-3 ml-6 space-y-1">
                                {project.tasks?.map((task) => (
                                  <div
                                    key={task.id}
                                    className="flex items-center gap-2 group py-1"
                                  >
                                    <button
                                      onClick={() => handleToggleTask(project.id, task)}
                                      className="flex-shrink-0 transition-colors"
                                      style={{ color: task.isCompleted ? "#22c55e" : "hsl(var(--muted-foreground))" }}
                                    >
                                      {task.isCompleted ? (
                                        <CheckCircle2 className="w-4 h-4" />
                                      ) : (
                                        <Circle className="w-4 h-4" />
                                      )}
                                    </button>
                                    <span
                                      className={`text-xs flex-1 ${task.isCompleted ? "line-through text-muted-foreground" : ""}`}
                                    >
                                      {task.title}
                                    </span>
                                    <button
                                      onClick={() => handleDeleteTask(project.id, task.id)}
                                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}

                                <div className="flex items-center gap-2 mt-2">
                                  <input
                                    placeholder="Add task..."
                                    value={newTaskInputs[project.id] || ""}
                                    onChange={(e) =>
                                      setNewTaskInputs((prev) => ({ ...prev, [project.id]: e.target.value }))
                                    }
                                    onKeyDown={(e) => e.key === "Enter" && handleAddTask(project.id)}
                                    className="flex-1 bg-transparent border-b border-border/40 text-xs py-1 focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                                  />
                                  <button
                                    onClick={() => handleAddTask(project.id)}
                                    className="text-muted-foreground hover:text-white"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
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
                <div className="border border-dashed border-border/40 rounded-xl p-4 text-center text-xs text-muted-foreground">
                  No projects
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
