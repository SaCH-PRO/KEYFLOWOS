"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, MoreHorizontal, Trash2, Archive, Edit3, Save, X,
  LayoutDashboard, ListTodo, Flag, Clock, MessageSquare,
  User, DollarSign, Calendar, Zap, FileText,
  HeartPulse,
} from "lucide-react";
import {
  Project, ProjectTask,
  updateProject, deleteProject,
  createProjectTask, updateProjectTask, deleteProjectTask,
} from "@/lib/client";
import { toast } from "sonner";
import { TabNav } from "@/components/ui/tab-nav";
import { TaskContinuityHeader } from "@/components/ui/task-continuity-header";
import { useNavigationContext } from "@/lib/navigation-context";
import {
  PROJECT_STAGES, normalizeStatus, getStageInfo, PROJECT_COLORS,
  getProjectProgress, getProjectRisk, RISK_STYLES,
} from "./project-constants";
import { OverviewTab } from "./project-detail-tabs/overview-tab";
import { TasksTab } from "./project-detail-tabs/tasks-tab";
import { MilestonesTab, Milestone } from "./project-detail-tabs/milestones-tab";
import { TimelineTab } from "./project-detail-tabs/timeline-tab";
import { NotesTab } from "./project-detail-tabs/notes-tab";
import { ClientTab } from "./project-detail-tabs/client-tab";
import { RevenueTab } from "./project-detail-tabs/revenue-tab";
import { CalendarTab } from "./project-detail-tabs/calendar-tab";
import { FlowsTab } from "./project-detail-tabs/flows-tab";
import { DeliverablesTab, Deliverable } from "./project-detail-tabs/deliverables-tab";

const DETAIL_TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "milestones", label: "Milestones", icon: Flag },
  { key: "timeline", label: "Timeline", icon: Clock },
  { key: "notes", label: "Notes", icon: MessageSquare },
  { key: "client", label: "Client", icon: User },
  { key: "revenue", label: "Revenue", icon: DollarSign },
  { key: "calendar", label: "Calendar", icon: Calendar },
  { key: "flows", label: "Flows", icon: Zap },
  { key: "deliverables", label: "Deliverables", icon: FileText },
];

interface ProjectDetailProps {
  project: Project;
  businessId: string | null;
  onBack: () => void;
  onProjectUpdate: (project: Project) => void;
  onProjectDelete: (id: string) => void;
}

export function ProjectDetail({
  project, businessId, onBack, onProjectUpdate, onProjectDelete,
}: ProjectDetailProps) {
  const router = useRouter();
  const { getOriginContext } = useNavigationContext();
  const originContext = getOriginContext();
  const crossModuleOrigin = originContext && originContext.workspace && originContext.workspace !== "Projects"
    ? { label: originContext.workspace, route: originContext.route }
    : null;

  const handleBack = useCallback(() => {
    if (crossModuleOrigin?.route) {
      router.push(crossModuleOrigin.route);
    } else {
      onBack();
    }
  }, [crossModuleOrigin, router, onBack]);

  const [activeTab, setActiveTab] = useState("overview");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDescription, setEditDescription] = useState(project.description || "");
  const [editDueDate, setEditDueDate] = useState(project.dueDate || "");
  const [editColor, setEditColor] = useState(project.color || PROJECT_COLORS[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);

  const stageInfo = getStageInfo(project.status);
  const progress = getProjectProgress(project.tasks ?? []);
  const risk = getProjectRisk(project);
  const riskStyle = RISK_STYLES[risk];

  const handleSaveEdit = async () => {
    if (!businessId) return;
    const res = await updateProject(businessId, project.id, {
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      dueDate: editDueDate || null,
      color: editColor,
    });
    if (res.data) {
      onProjectUpdate(res.data);
      toast.success("Project updated");
    }
    setEditing(false);
  };

  const handleStageChange = async (stage: string) => {
    if (!businessId) return;
    const res = await updateProject(businessId, project.id, { status: stage });
    if (res.data) {
      onProjectUpdate(res.data);
      toast.success(`Moved to ${getStageInfo(stage).label}`);
    }
  };

  const handleDelete = async () => {
    if (!businessId) return;
    await deleteProject(businessId, project.id);
    onProjectDelete(project.id);
    toast.success("Project deleted");
  };

  const handleArchive = async () => {
    if (!businessId) return;
    const newStatus = normalizeStatus(project.status) === "ARCHIVED" ? "NOT_STARTED" : "ARCHIVED";
    const res = await updateProject(businessId, project.id, { status: newStatus });
    if (res.data) {
      onProjectUpdate(res.data);
      toast.success(newStatus === "ARCHIVED" ? "Project archived" : "Project unarchived");
    }
    setMenuOpen(false);
  };

  const handleAddTask = useCallback(async (projectId: string, title: string, dueDate?: string) => {
    if (!businessId || !title) return;
    try {
      const res = await createProjectTask(businessId, projectId, { title, dueDate });
      if (res.data) {
        onProjectUpdate({ ...project, tasks: [...(project.tasks || []), res.data] });
      }
    } catch { toast.error("Failed to add task"); }
  }, [businessId, project, onProjectUpdate]);

  const handleToggleTask = useCallback(async (projectId: string, task: ProjectTask) => {
    if (!businessId) return;
    const updated = !task.isCompleted;
    try {
      const res = await updateProjectTask(businessId, task.id, { isCompleted: updated });
      if (res.data) {
        onProjectUpdate({
          ...project,
          tasks: project.tasks.map((t) => (t.id === task.id ? { ...t, isCompleted: updated } : t)),
        });
      }
    } catch { toast.error("Failed to update task"); }
  }, [businessId, project, onProjectUpdate]);

  const handleDeleteTask = useCallback(async (projectId: string, taskId: string) => {
    if (!businessId) return;
    try {
      await deleteProjectTask(businessId, taskId);
      onProjectUpdate({ ...project, tasks: project.tasks.filter((t) => t.id !== taskId) });
    } catch { toast.error("Failed to delete task"); }
  }, [businessId, project, onProjectUpdate]);

  const handleUpdateTask = useCallback(async (projectId: string, taskId: string, data: { dueDate?: string | null }) => {
    if (!businessId) return;
    try {
      const res = await updateProjectTask(businessId, taskId, data);
      if (res.data) {
        const mapped = { dueDate: data.dueDate ?? undefined };
        onProjectUpdate({
          ...project,
          tasks: project.tasks.map((t) => (t.id === taskId ? { ...t, ...mapped } : t)),
        });
      }
    } catch { toast.error("Failed to update task"); }
  }, [businessId, project, onProjectUpdate]);

  return (
    <div className="space-y-4">
      <TaskContinuityHeader
        taskLabel={project.name || "Project"}
        returnLabel={crossModuleOrigin ? `Back to ${crossModuleOrigin.label}` : "Back to Projects"}
        onBack={handleBack}
      />
      <div className="flex items-center gap-3">
        <button
          onClick={handleBack}
          className="p-2 rounded-xl hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {editing ? (
          <div className="flex-1 space-y-2">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="text-xl font-bold bg-transparent border-b border-primary/40 focus:outline-none w-full"
            />
            <input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description (optional)"
              className="text-sm text-muted-foreground bg-transparent border-b border-border/30 focus:outline-none w-full"
            />
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => setEditDueDate(e.target.value)}
                className="bg-transparent text-xs text-muted-foreground border border-border/40 rounded-lg px-2 py-1 focus:outline-none"
              />
              <div className="flex items-center gap-1">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setEditColor(c)}
                    className="w-4 h-4 rounded-full transition-transform"
                    style={{
                      background: c,
                      transform: editColor === c ? "scale(1.3)" : "scale(1)",
                      boxShadow: editColor === c ? `0 0 0 2px ${c}40` : "none",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveEdit} className="kf-btn-primary px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1">
                <Save className="w-3 h-3" />
                Save
              </button>
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <X className="w-3 h-3" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: project.color || stageInfo.color }} />
              <h1 className="text-xl font-bold truncate">{project.name}</h1>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold shrink-0"
                style={{ background: riskStyle.bg, color: riskStyle.color }}
              >
                {riskStyle.label}
              </span>
              {(project.priority || "").toUpperCase() === "HIGH" && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold shrink-0" style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
                  High Priority
                </span>
              )}
              {(project.priority || "").toUpperCase() === "URGENT" && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md font-semibold shrink-0" style={{ background: "hsl(var(--kf-error) / 0.15)", color: "hsl(var(--kf-error))" }}>
                  Urgent
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              {project.description && (
                <p className="text-sm text-muted-foreground truncate">{project.description}</p>
              )}
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="w-20 h-1.5 rounded-full overflow-hidden bg-muted/30">
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: stageInfo.color }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{progress}%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {!editing && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {PROJECT_STAGES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => handleStageChange(s.key)}
                  className={`text-[10px] px-2 py-1 rounded-lg font-medium transition-colors ${normalizeStatus(project.status) === s.key ? "ring-1" : "opacity-60 hover:opacity-100"}`}
                  style={{
                    background: s.bg,
                    color: s.color,
                    ...(normalizeStatus(project.status) === s.key ? { boxShadow: `0 0 0 1px ${s.color}` } : {}),
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setEditing(true)}
              className="p-2 rounded-xl hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Edit3 className="w-4 h-4" />
            </button>

            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 rounded-xl hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 z-50 w-44 rounded-lg border border-border/60 bg-card p-1 shadow-xl">
                  <button
                    onClick={handleArchive}
                    className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-muted/30 flex items-center gap-2 text-muted-foreground"
                  >
                    <Archive className="w-3 h-3" />
                    {normalizeStatus(project.status) === "ARCHIVED" ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-red-500/20 flex items-center gap-2"
                    style={{ color: "hsl(var(--kf-error))" }}
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete Project
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <TabNav
        tabs={DETAIL_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        layoutId="project-detail-tab"
      />

      <div className="min-h-[300px]">
        {activeTab === "overview" && (
          <OverviewTab project={project} onStageChange={handleStageChange} />
        )}
        {activeTab === "tasks" && (
          <TasksTab
            tasks={project.tasks ?? []}
            projectId={project.id}
            onAddTask={handleAddTask}
            onToggleTask={handleToggleTask}
            onDeleteTask={handleDeleteTask}
            onUpdateTask={handleUpdateTask}
          />
        )}
        {activeTab === "milestones" && (
          <MilestonesTab
            milestones={milestones}
            onMilestonesChange={setMilestones}
          />
        )}
        {activeTab === "timeline" && (
          <TimelineTab project={project} notes={notes} />
        )}
        {activeTab === "notes" && (
          <NotesTab notes={notes} onNotesChange={setNotes} />
        )}
        {activeTab === "client" && (
          <ClientTab contactId={project.contactId} />
        )}
        {activeTab === "revenue" && (
          <RevenueTab invoiceId={project.invoiceId} businessId={businessId ?? undefined} projectId={project.id} />
        )}
        {activeTab === "calendar" && (
          <CalendarTab project={project} />
        )}
        {activeTab === "flows" && (
          <FlowsTab />
        )}
        {activeTab === "deliverables" && (
          <DeliverablesTab
            deliverables={deliverables}
            onDeliverablesChange={setDeliverables}
          />
        )}
      </div>
    </div>
  );
}
