"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, MoreHorizontal, Calendar, Trash2, FolderKanban,
  ChevronDown, ChevronRight, Archive, Eye, EyeOff, Search,
  AlertTriangle, User, ExternalLink, DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { KanbanSkeleton } from "@/components/ui/skeleton";
import {
  createProject, updateProject, deleteProject,
  createProjectTask, updateProjectTask, deleteProjectTask,
  fetchContacts,
  Project, ProjectTask, type Contact,
} from "@/lib/client";
import {
  PROJECT_STAGES, ALL_PROJECT_STAGES, PROJECT_COLORS,
  normalizeStatus, getStageInfo, getProjectProgress, getProjectRisk,
  RISK_STYLES, isOverdue, formatDate,
} from "./project-constants";
import { TaskList } from "./task-list";

interface ProjectBoardProps {
  businessId: string | null;
  projects: Project[];
  loading: boolean;
  onProjectsChange: (fn: ((prev: Project[]) => Project[]) | Project[]) => void;
  onOpenProject: (id: string) => void;
  onReload: () => void;
}

export function ProjectBoard({
  businessId, projects, loading, onProjectsChange, onOpenProject, onReload,
}: ProjectBoardProps) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);
  const [newProjectDueDate, setNewProjectDueDate] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [contactMap, setContactMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!businessId) return;
    const contactIds = [...new Set(projects.filter((p) => p.contactId).map((p) => p.contactId!))];
    if (contactIds.length === 0) return;
    fetchContacts(businessId).then((res) => {
      if (res.data) {
        const contacts = (res.data as { contacts?: Contact[] }).contacts ?? (Array.isArray(res.data) ? res.data as Contact[] : []);
        const map: Record<string, string> = {};
        contacts.forEach((c: Contact) => {
          const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Client";
          map[c.id] = name;
        });
        setContactMap(map);
      }
    });
  }, [businessId, projects]);

  const handleCreateProject = async () => {
    if (!businessId || !newProjectName.trim()) return;
    const res = await createProject(businessId, {
      name: newProjectName.trim(),
      color: newProjectColor,
      dueDate: newProjectDueDate || undefined,
      status: "NOT_STARTED",
    });
    if (res.data) {
      onProjectsChange((prev: Project[]) => [res.data!, ...prev]);
      setExpandedProjects((prev) => new Set(prev).add(res.data!.id));
    }
    setNewProjectName("");
    setNewProjectDueDate("");
    setShowNewProject(false);
  };

  const handleUpdateProjectStatus = async (projectId: string, status: string) => {
    if (!businessId) return;
    try {
      const res = await updateProject(businessId, projectId, { status });
      if (res.data) {
        onProjectsChange((prev: Project[]) => prev.map((p) => (p.id === projectId ? { ...p, status } : p)));
      }
    } catch { toast.error("Failed to update project status"); }
    setMenuOpen(null);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!businessId) return;
    try {
      await deleteProject(businessId, projectId);
      onProjectsChange((prev: Project[]) => prev.filter((p) => p.id !== projectId));
    } catch { toast.error("Failed to delete project"); }
    setMenuOpen(null);
  };

  const handleAddTask = async (projectId: string, title: string, dueDate?: string) => {
    if (!businessId || !title) return;
    try {
      const res = await createProjectTask(businessId, projectId, { title, dueDate });
      if (res.data) {
        onProjectsChange((prev: Project[]) =>
          prev.map((p) =>
            p.id === projectId ? { ...p, tasks: [...(p.tasks || []), res.data!] } : p,
          ),
        );
      }
    } catch { toast.error("Failed to add task"); }
  };

  const handleToggleTask = async (projectId: string, task: ProjectTask) => {
    if (!businessId) return;
    const updated = !task.isCompleted;
    try {
      const res = await updateProjectTask(businessId, task.id, { isCompleted: updated });
      if (res.data) {
        onProjectsChange((prev: Project[]) =>
          prev.map((p) =>
            p.id === projectId
              ? { ...p, tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, isCompleted: updated } : t)) }
              : p,
          ),
        );
      }
    } catch { toast.error("Failed to update task"); }
  };

  const handleDeleteTask = async (projectId: string, taskId: string) => {
    if (!businessId) return;
    try {
      await deleteProjectTask(businessId, taskId);
      onProjectsChange((prev: Project[]) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) } : p,
        ),
      );
    } catch { toast.error("Failed to delete task"); }
  };

  const handleUpdateTask = async (projectId: string, taskId: string, data: { dueDate?: string | null }) => {
    if (!businessId) return;
    try {
      const res = await updateProjectTask(businessId, taskId, data);
      if (res.data) {
        const mapped = { dueDate: data.dueDate ?? undefined };
        onProjectsChange((prev: Project[]) =>
          prev.map((p) =>
            p.id === projectId
              ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, ...mapped } : t)) }
              : p,
          ),
        );
      }
    } catch { toast.error("Failed to update task"); }
  };

  const toggleExpand = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const filteredProjects = useMemo(() => {
    let result = showArchived
      ? projects
      : projects.filter((p) => normalizeStatus(p.status) !== "ARCHIVED");

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(q));
    }
    return result;
  }, [projects, showArchived, searchQuery]);

  const displayColumns = showArchived ? ALL_PROJECT_STAGES : PROJECT_STAGES;
  const projectsByStage = displayColumns.map((col) => ({
    ...col,
    projects: filteredProjects.filter((p) => normalizeStatus(p.status) === col.key),
  }));
  const archivedCount = projects.filter((p) => normalizeStatus(p.status) === "ARCHIVED").length;

  if (loading) return <KanbanSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-border/60 bg-input pl-9 pr-3 py-2.5 text-sm placeholder:text-muted-foreground/60"
            />
          </div>
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              {showArchived ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showArchived ? "Hide" : "Show"} Archived ({archivedCount})
            </button>
          )}
        </div>
        <button
          onClick={() => setShowNewProject(true)}
          className="kf-btn-primary px-4 min-h-[44px] rounded-xl text-sm font-medium inline-flex items-center gap-2"
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
            <div className="rounded-2xl border border-primary/40 bg-card p-4 space-y-3">
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
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Due date:</span>
                <input
                  type="date"
                  value={newProjectDueDate}
                  onChange={(e) => setNewProjectDueDate(e.target.value)}
                  className="bg-transparent border border-border/60 rounded-lg px-3 py-1.5 text-xs text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim()}
                  className="kf-btn-primary px-4 min-h-[44px] rounded-lg text-sm font-medium disabled:opacity-40"
                >
                  Create
                </button>
                <button
                  onClick={() => { setShowNewProject(false); setNewProjectDueDate(""); }}
                  className="px-4 min-h-[44px] rounded-lg text-sm text-muted-foreground hover:bg-muted/30"
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
          description="Create your first project to organize delivery, track milestones, and stay on top of client work."
          tip="Projects connect to your clients, revenue, calendar, and flows — making them the delivery hub of your business."
          actionLabel="New Project"
          onAction={() => setShowNewProject(true)}
        />
      ) : (
        <div className={`grid gap-4 grid-cols-1 md:grid-cols-2 ${showArchived ? "xl:grid-cols-7" : "xl:grid-cols-6"}`}>
          {projectsByStage.map((column) => (
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
                    const progress = getProjectProgress(project.tasks ?? []);
                    const risk = getProjectRisk(project);
                    const riskStyle = RISK_STYLES[risk];
                    const overdue = isOverdue(project.dueDate) && normalizeStatus(project.status) !== "COMPLETED";
                    const overdueTasks = (project.tasks ?? []).filter((t) => !t.isCompleted && isOverdue(t.dueDate)).length;
                    const stageInfo = getStageInfo(project.status);
                    const clientName = project.contactId ? contactMap[project.contactId] : null;
                    const priorityUpper = (project.priority || "").toUpperCase();

                    return (
                      <motion.div
                        key={project.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="rounded-xl border overflow-hidden transition-colors"
                        style={{
                          borderColor: risk === "critical" || risk === "blocked"
                            ? "hsl(var(--kf-error) / 0.3)"
                            : risk === "at-risk"
                              ? "hsl(var(--kf-warning) / 0.3)"
                              : "hsl(var(--border) / 0.6)",
                          background: "hsl(var(--card))",
                        }}
                      >
                        <div className="p-3">
                          <div className="flex items-start gap-2">
                            <button onClick={() => toggleExpand(project.id)} className="mt-0.5 text-muted-foreground hover:text-foreground">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                  style={{ background: project.color || stageInfo.color }}
                                />
                                <button
                                  onClick={() => onOpenProject(project.id)}
                                  className="text-sm font-semibold truncate hover:text-primary transition-colors text-left"
                                >
                                  {project.name}
                                </button>
                                {priorityUpper === "HIGH" || priorityUpper === "URGENT" ? (
                                  <span className="text-[8px] px-1 py-0.5 rounded font-bold shrink-0" style={{ background: "hsl(var(--kf-error) / 0.15)", color: "hsl(var(--kf-error))" }}>
                                    {priorityUpper === "URGENT" ? "!!!" : "!!"}
                                  </span>
                                ) : null}
                              </div>
                              {clientName && (
                                <div className="flex items-center gap-1 mt-0.5 ml-[18px]">
                                  <User className="w-2.5 h-2.5 text-muted-foreground/60" />
                                  <span className="text-[10px] text-muted-foreground/80 truncate">{clientName}</span>
                                </div>
                              )}
                            </div>
                            <div className="relative">
                              <button
                                onClick={() => setMenuOpen(menuOpen === project.id ? null : project.id)}
                                className="p-1 text-muted-foreground hover:text-foreground rounded"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                              {menuOpen === project.id && (
                                <div className="absolute right-0 top-7 z-50 w-48 rounded-lg border border-border/60 bg-card p-1 shadow-xl">
                                  <button
                                    onClick={() => { onOpenProject(project.id); setMenuOpen(null); }}
                                    className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-muted/30 flex items-center gap-2"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    Open Project
                                  </button>
                                  <div className="border-t border-border/40 my-1" />
                                  {PROJECT_STAGES.filter((s) => s.key !== normalizeStatus(project.status)).map((s) => (
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
                                  {normalizeStatus(project.status) !== "ARCHIVED" && (
                                    <button
                                      onClick={() => handleUpdateProjectStatus(project.id, "ARCHIVED")}
                                      className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-muted/30 flex items-center gap-2 text-muted-foreground"
                                    >
                                      <Archive className="w-3 h-3" />
                                      Archive
                                    </button>
                                  )}
                                  {normalizeStatus(project.status) === "ARCHIVED" && (
                                    <button
                                      onClick={() => handleUpdateProjectStatus(project.id, "NOT_STARTED")}
                                      className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-muted/30 flex items-center gap-2 text-muted-foreground"
                                    >
                                      <Archive className="w-3 h-3" />
                                      Unarchive
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleDeleteProject(project.id)}
                                    className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-red-500/20 flex items-center gap-2"
                                    style={{ color: "hsl(var(--kf-error))" }}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-2 ml-6 space-y-1.5">
                            {totalTasks > 0 && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                      width: `${progress}%`,
                                      background: project.color || stageInfo.color,
                                    }}
                                  />
                                </div>
                                <span className="text-[10px] tabular-nums font-medium" style={{ color: progress === 100 ? "hsl(var(--kf-success))" : undefined }}>
                                  {progress}% · {completedTasks}/{totalTasks}
                                </span>
                              </div>
                            )}

                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
                                style={{ background: riskStyle.bg, color: riskStyle.color }}
                              >
                                {riskStyle.label}
                              </span>

                              {project.contactId && !clientName && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-0.5"
                                  style={{ background: "hsl(var(--kf-info) / 0.1)", color: "hsl(var(--kf-info))" }}>
                                  <User className="w-2.5 h-2.5" />
                                  Client
                                </span>
                              )}

                              {project.invoiceId && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-0.5"
                                  style={{ background: "hsl(var(--kf-success) / 0.1)", color: "hsl(var(--kf-success))" }}>
                                  <DollarSign className="w-2.5 h-2.5" />
                                  Revenue
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                              {project.dueDate && (
                                <span
                                  className="flex items-center gap-0.5"
                                  style={{ color: overdue ? "hsl(var(--kf-error))" : undefined }}
                                >
                                  <Calendar className="w-3 h-3" />
                                  {overdue ? "Overdue: " : ""}{formatDate(project.dueDate)}
                                </span>
                              )}
                              {overdueTasks > 0 && (
                                <span className="flex items-center gap-0.5" style={{ color: "hsl(var(--kf-warning))" }}>
                                  <AlertTriangle className="w-3 h-3" />
                                  {overdueTasks} overdue task{overdueTasks > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </div>

                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div data-walkthrough="projects-tasks">
                                  <TaskList
                                    tasks={project.tasks ?? []}
                                    projectId={project.id}
                                    onToggleTask={handleToggleTask}
                                    onDeleteTask={handleDeleteTask}
                                    onAddTask={handleAddTask}
                                    onUpdateTask={handleUpdateTask}
                                  />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
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
