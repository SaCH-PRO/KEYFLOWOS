"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  MoreHorizontal,
  CheckCircle2,
  Circle,
  Calendar,
  Trash2,
  FolderKanban,
  ChevronDown,
  ChevronRight,
  Zap,
  Power,
  PowerOff,
  Send,
  HelpCircle,
  Lightbulb,
  X,
  Brain,
  Clock,
  Settings2,
} from "lucide-react";
import { Button, Input } from "@keyflow/ui";
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
  Playbook,
  fetchPlaybooks,
  createPlaybook,
  updatePlaybook,
  CrossModuleWorkflow,
  fetchCrossModuleWorkflows,
  updateCrossModuleWorkflow,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { ContactPickerDrawer } from "@/components/contacts";

const STATUS_COLUMNS = [
  { key: "ACTIVE", label: "Active", color: "hsl(var(--kf-accent2))" },
  { key: "IN_PROGRESS", label: "In Progress", color: "hsl(var(--kf-accent1))" },
  { key: "COMPLETED", label: "Completed", color: "#22c55e" },
  { key: "ON_HOLD", label: "On Hold", color: "#94a3b8" },
];

const PROJECT_COLORS = [
  "#f97316", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e", "#eab308", "#ec4899", "#6366f1",
];

const TRIGGER_OPTIONS = [
  { value: "invoice.paid", label: "Invoice Paid" },
  { value: "invoice.sent", label: "Invoice Sent" },
  { value: "invoice.overdue", label: "Invoice Overdue" },
  { value: "booking.created", label: "Booking Created" },
  { value: "booking.confirmed", label: "Booking Confirmed" },
  { value: "booking.cancelled", label: "Booking Cancelled" },
  { value: "contact.created", label: "Contact Created" },
  { value: "contact.updated", label: "Contact Updated" },
];

const ACTION_OPTIONS = [
  { value: "send_email", label: "Send Email" },
  { value: "send_whatsapp", label: "Send WhatsApp" },
  { value: "create_task", label: "Create Task" },
  { value: "add_tag", label: "Add Tag" },
  { value: "update_status", label: "Update Status" },
];

const TABS = [
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "automations", label: "Automations", icon: Zap },
];

function ExplainerButton({ items }: { items: { title: string; text: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
        style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
      >
        <HelpCircle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        How this works
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              className="absolute right-0 top-full mt-2 z-50 w-80 sm:w-96 rounded-xl border shadow-2xl p-4 space-y-3"
              style={{
                background: "hsl(var(--kf-bg))",
                borderColor: "hsl(var(--kf-accent1) / 0.2)",
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Lightbulb className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Quick Guide
                </div>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground text-xs">
                  Close
                </button>
              </div>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div
                    key={i}
                    className="rounded-lg px-3 py-2.5 flex gap-2.5 items-start"
                    style={{
                      background: "hsl(var(--kf-muted) / 0.25)",
                      border: "1px solid hsl(var(--kf-border) / 0.2)",
                    }}
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.15)",
                        color: "hsl(var(--kf-accent1))",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight">{item.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProjectsTab({ businessId }: { businessId: string | null }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [newTaskInputs, setNewTaskInputs] = useState<Record<string, string>>({});
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

  const projectsByStatus = STATUS_COLUMNS.map((col) => ({
    ...col,
    projects: projects.filter((p) => p.status === col.key),
  }));

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-2xl border border-border/60 bg-slate-950/70 p-4 h-48 animate-pulse" />
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
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  Commerce: "hsl(var(--kf-accent1))",
  Marketing: "#8b5cf6",
  Bookings: "#06b6d4",
};

function CrossModuleIntelligenceTab({ businessId }: { businessId: string | null }) {
  const [workflows, setWorkflows] = useState<CrossModuleWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await fetchCrossModuleWorkflows(businessId ?? undefined);
      setWorkflows(data ?? []);
      if (error) setError(error);
      setLoading(false);
    };
    void load();
  }, [businessId]);

  async function handleToggle(wf: CrossModuleWorkflow) {
    setUpdating(wf.key);
    const { error } = await updateCrossModuleWorkflow({
      businessId: businessId ?? undefined,
      workflowKey: wf.key,
      enabled: !wf.enabled,
    });
    if (error) {
      setError(error);
    } else {
      setWorkflows((prev) =>
        prev.map((w) => (w.key === wf.key ? { ...w, enabled: !w.enabled } : w))
      );
    }
    setUpdating(null);
  }

  async function handleConfigUpdate(wf: CrossModuleWorkflow, newConfig: Record<string, any>) {
    setUpdating(wf.key);
    const { error } = await updateCrossModuleWorkflow({
      businessId: businessId ?? undefined,
      workflowKey: wf.key,
      config: newConfig,
    });
    if (error) {
      setError(error);
    } else {
      setWorkflows((prev) =>
        prev.map((w) => (w.key === wf.key ? { ...w, config: newConfig } : w))
      );
    }
    setUpdating(null);
  }

  const categories = Array.from(new Set(workflows.map((w) => w.category)));

  return (
    <div className="space-y-4">
      <ExplainerButton
        items={[
          { title: "What is Cross-Module Intelligence?", text: "These are smart workflows that connect your CRM, Commerce, Bookings, and Marketing modules. They listen for events and automatically take actions across modules." },
          { title: "How does it work?", text: "When an event happens (like a quote being sent or a booking being cancelled), the intelligence agent automatically creates follow-up tasks, updates contacts, sends notifications, and more." },
          { title: "Toggle On/Off", text: "Each workflow can be enabled or disabled independently. Disabling a workflow stops it from running but preserves your configuration." },
          { title: "Configuration", text: "Click the settings icon on any workflow to adjust parameters like follow-up delays, auto-enrollment options, and more." },
        ]}
      />

      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading intelligence workflows...</div>
      ) : (
        <>
          <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  Cross-Module Intelligence
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Smart workflows that connect your modules and automate cross-cutting actions.
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                {workflows.filter((w) => w.enabled).length} active / {workflows.length} total
              </div>
            </div>
          </div>

          {categories.map((category) => (
            <div key={category} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: CATEGORY_COLORS[category] ?? "hsl(var(--kf-accent1))" }}
                />
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{category}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {workflows
                  .filter((w) => w.category === category)
                  .map((wf) => (
                    <motion.div
                      key={wf.key}
                      layout
                      className={`rounded-2xl border p-3 flex flex-col gap-2 text-sm transition-colors ${
                        wf.enabled
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-border/60 bg-slate-900/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-semibold flex items-center gap-2">
                          <Brain className="w-4 h-4" style={{ color: CATEGORY_COLORS[wf.category] ?? "hsl(var(--kf-accent1))" }} />
                          {wf.name}
                        </div>
                        <div className="flex items-center gap-1">
                          {wf.configSchema.length > 0 && (
                            <button
                              onClick={() => setExpandedKey(expandedKey === wf.key ? null : wf.key)}
                              className="rounded-full p-1.5 transition-colors bg-slate-500/10 text-slate-400 hover:bg-slate-500/20"
                            >
                              <Settings2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleToggle(wf)}
                            disabled={updating === wf.key}
                            className={`rounded-full p-1.5 transition-colors ${
                              wf.enabled
                                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                : "bg-slate-500/20 text-slate-400 hover:bg-slate-500/30"
                            } ${updating === wf.key ? "opacity-50" : ""}`}
                          >
                            {wf.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <p className="text-[12px] text-muted-foreground leading-relaxed">{wf.description}</p>

                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
                        <span className="inline-flex items-center gap-1">
                          <Zap className="w-3 h-3" /> {wf.triggerEvent}
                        </span>
                        {wf.runCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {wf.runCount} runs
                          </span>
                        )}
                        {wf.lastRunAt && (
                          <span>Last: {new Date(wf.lastRunAt).toLocaleDateString()}</span>
                        )}
                      </div>

                      <AnimatePresence>
                        {expandedKey === wf.key && wf.configSchema.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-border/40 pt-2 mt-1 space-y-2">
                              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Configuration</div>
                              {wf.configSchema.map((field) => (
                                <div key={field.key} className="flex items-center gap-2">
                                  <label className="text-xs text-muted-foreground flex-1">{field.label}</label>
                                  {field.type === "boolean" ? (
                                    <button
                                      onClick={() =>
                                        handleConfigUpdate(wf, {
                                          ...wf.config,
                                          [field.key]: !(wf.config[field.key] ?? field.default),
                                        })
                                      }
                                      className={`w-8 h-5 rounded-full transition-colors relative ${
                                        (wf.config[field.key] ?? field.default)
                                          ? "bg-emerald-500"
                                          : "bg-slate-600"
                                      }`}
                                    >
                                      <div
                                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                          (wf.config[field.key] ?? field.default)
                                            ? "translate-x-3.5"
                                            : "translate-x-0.5"
                                        }`}
                                      />
                                    </button>
                                  ) : field.type === "number" ? (
                                    <input
                                      type="number"
                                      className="w-20 rounded-lg border border-border/60 bg-slate-900 px-2 py-1 text-xs text-right"
                                      value={wf.config[field.key] ?? field.default}
                                      onChange={(e) =>
                                        handleConfigUpdate(wf, {
                                          ...wf.config,
                                          [field.key]: parseInt(e.target.value, 10) || field.default,
                                        })
                                      }
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      className="w-32 rounded-lg border border-border/60 bg-slate-900 px-2 py-1 text-xs"
                                      value={wf.config[field.key] ?? field.default}
                                      onChange={(e) =>
                                        handleConfigUpdate(wf, {
                                          ...wf.config,
                                          [field.key]: e.target.value,
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function PlaybooksTab() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [form, setForm] = useState({ name: "", triggerEvent: "", actionType: "" });
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await fetchPlaybooks();
      setPlaybooks(data ?? []);
      if (error) setError(error);
      setLoading(false);
    };
    void load();
  }, []);

  async function handleCreate() {
    setFormError(null);
    if (!form.name.trim() || !form.triggerEvent || !form.actionType) {
      setFormError("All fields are required");
      return;
    }
    const { data, error } = await createPlaybook({
      name: form.name,
      triggerEvent: form.triggerEvent,
      actions: [{ type: form.actionType }],
    });
    if (error) setFormError(error);
    if (data) {
      setPlaybooks((prev) => [data, ...prev]);
      setForm({ name: "", triggerEvent: "", actionType: "" });
      setShowBuilder(false);
    }
  }

  async function handleToggle(playbook: Playbook) {
    const { data, error } = await updatePlaybook({
      playbookId: playbook.id,
      enabled: !playbook.enabled,
    });
    if (error) {
      setError(error);
    } else if (data) {
      setPlaybooks((prev) => prev.map((p) => (p.id === playbook.id ? data : p)));
    }
  }

  function getTriggerLabel(trigger: string) {
    return TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label ?? trigger;
  }

  function getActionLabel(actions: unknown) {
    if (!Array.isArray(actions) || actions.length === 0) return "No actions";
    const action = actions[0] as { type?: string };
    return ACTION_OPTIONS.find((a) => a.value === action.type)?.label ?? action.type ?? "Custom action";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ExplainerButton
          items={[
            { title: "What is a Playbook?", text: "A Playbook is a simple rule: WHEN something happens (the trigger) → THEN do something automatically (the action). For example: WHEN a booking is confirmed → THEN send a WhatsApp reminder." },
            { title: "Create a Playbook", text: "Click '+ New Playbook', give it a name, pick what triggers it (e.g. invoice paid, new booking), and choose the action (e.g. send email, update status)." },
            { title: "Toggle On/Off", text: "Each playbook has a power button. Toggle it ON to activate, OFF to pause. Pausing doesn't delete your setup — you can re-enable it anytime." },
            { title: "Starter Ideas", text: "Try these: 1) Auto-send receipt when invoice is paid, 2) Welcome email for new contacts, 3) Follow-up after a booking, 4) Thank-you after a purchase." },
          ]}
        />
        <button
          onClick={() => setShowBuilder(!showBuilder)}
          className="kf-btn-primary px-4 py-2 rounded-xl text-sm font-medium inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Playbook
        </button>
      </div>

      {formError && <div className="text-xs text-amber-400">{formError}</div>}
      {error && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {error}
        </div>
      )}

      <AnimatePresence>
        {showBuilder && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-2xl border border-primary/40 bg-slate-950/80 p-4 space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Zap className="w-4 h-4" /> Create Playbook
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  label="Playbook Name"
                  placeholder="Send receipt on payment"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">When this happens...</label>
                  <select
                    className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm"
                    value={form.triggerEvent}
                    onChange={(e) => setForm((f) => ({ ...f, triggerEvent: e.target.value }))}
                  >
                    <option value="">Select trigger...</option>
                    {TRIGGER_OPTIONS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Do this...</label>
                  <select
                    className="w-full rounded-lg border border-border/60 bg-slate-900 px-3 py-2 text-sm"
                    value={form.actionType}
                    onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value }))}
                  >
                    <option value="">Select action...</option>
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowBuilder(false)}>Cancel</Button>
                <Button onClick={handleCreate}>Create Playbook</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Live Playbooks</div>
            <p className="text-sm text-muted-foreground">These respond to emitted events in your business.</p>
          </div>
          <div className="text-xs text-muted-foreground">
            {playbooks.filter((p) => p.enabled).length} active / {playbooks.length} total
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Loading playbooks...</div>
        ) : playbooks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            No playbooks yet. Create one to start automating your business flows.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {playbooks.map((pb) => (
              <div
                key={pb.id}
                className={`rounded-2xl border p-3 flex flex-col gap-2 text-sm transition-colors ${
                  pb.enabled
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-border/60 bg-slate-900/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{pb.name}</div>
                  <button
                    onClick={() => handleToggle(pb)}
                    className={`rounded-full p-1.5 transition-colors ${
                      pb.enabled
                        ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                        : "bg-slate-500/20 text-slate-400 hover:bg-slate-500/30"
                    }`}
                  >
                    {pb.enabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                  </button>
                </div>
                <div className="text-[12px] text-muted-foreground">
                  <span className="text-primary">Trigger:</span> {getTriggerLabel(pb.triggerEvent)}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  <span className="text-primary">Action:</span> {getActionLabel(pb.actions)}
                </div>
                <div className="text-[11px] text-muted-foreground/60">
                  Created: {new Date(pb.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
          Coming soon: Visual flow builder with conditions, delays, and multi-step actions.
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const tabParam = searchParams.get("tab");
  const activeTab = tabParam === "automations" || tabParam === "intelligence" ? "automations" : "projects";

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  const handleTabChange = (tab: string) => {
    router.push(`/app/projects${tab !== "projects" ? `?tab=${tab}` : ""}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FolderKanban}
        title="Projects & Playbooks"
        subtitle="Manage work and automate your business flows"
        titleExtra={
          <div className="relative">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                showGuide
                  ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
                  : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
              }`}
              aria-label="Getting started guide"
              title="Getting started guide"
            >
              <Lightbulb className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showGuide && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowGuide(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 rounded-lg bg-amber-400/10">
                        <Lightbulb className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold">Getting Started</h4>
                        <p className="text-[11px] text-muted-foreground">Your quick-start guide</p>
                      </div>
                      <button onClick={() => setShowGuide(false)} className="ml-auto p-1 rounded hover:bg-muted/50">
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        { step: "1", title: "Create Projects", desc: "Click '+ New Project' to set up a project with a name and color for organizing work." },
                        { step: "2", title: "Add Tasks", desc: "Expand a project and add tasks — check them off as you complete each action item." },
                        { step: "3", title: "Use Kanban Board", desc: "Projects are displayed in columns by status: Active, In Progress, Completed, and On Hold." },
                        { step: "4", title: "Set Up Playbooks", desc: "Create automation playbooks that trigger actions based on business events." },
                        { step: "5", title: "Automate Workflows", desc: "Connect triggers like invoice paid or booking created to automatic actions." },
                        { step: "6", title: "Track Progress", desc: "Monitor task completion with progress bars and move projects between statuses." },
                      ].map((item) => (
                        <div key={item.step} className="flex gap-2.5 p-2 rounded-xl hover:bg-muted/30 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                            {item.step}
                          </div>
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        }
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

      <TabNav
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        layoutId="projects-tab"
      />

      {activeTab === "projects" ? (
        <ProjectsTab businessId={businessId} />
      ) : (
        <div className="space-y-6">
          <CrossModuleIntelligenceTab businessId={businessId} />
          <PlaybooksTab />
        </div>
      )}

      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
