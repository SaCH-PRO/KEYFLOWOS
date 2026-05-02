"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Plus, Trash2, FileStack, X, ListChecks, Search, Sparkles, Tag, Zap, Flag } from "lucide-react";
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

const SERVICE_TYPE_PRESETS: Record<string, { label: string; colorVar: string }> = {
  consultation: { label: "Consultation", colorVar: "--kf-info" },
  design: { label: "Design", colorVar: "--kf-accent1" },
  development: { label: "Development", colorVar: "--kf-accent2" },
  marketing: { label: "Marketing", colorVar: "--kf-warning" },
  photography: { label: "Photography", colorVar: "--kf-success" },
  event: { label: "Event", colorVar: "--kf-error" },
  general: { label: "General", colorVar: "--muted-foreground" },
};

const INTELLIGENT_DEFAULTS: Record<string, { tasks: string[]; milestones: string[] }> = {
  consultation: {
    tasks: ["Discovery call", "Needs assessment document", "Strategy proposal", "Final presentation", "Follow-up action items"],
    milestones: ["Discovery complete", "Proposal delivered", "Engagement closed"],
  },
  design: {
    tasks: ["Creative brief", "Mood board / references", "Initial concepts", "Revisions round 1", "Revisions round 2", "Final assets delivery", "Brand guidelines update"],
    milestones: ["Brief approved", "Concepts presented", "Final design approved", "Assets delivered"],
  },
  development: {
    tasks: ["Requirements gathering", "Technical specification", "Environment setup", "Core development", "Testing & QA", "Bug fixes", "Deployment", "Documentation"],
    milestones: ["Spec approved", "MVP complete", "QA passed", "Go live"],
  },
  marketing: {
    tasks: ["Campaign brief", "Audience research", "Content creation", "Creative assets", "Campaign setup", "Launch & monitor", "Performance report"],
    milestones: ["Brief signed off", "Content approved", "Campaign launched", "Report delivered"],
  },
  photography: {
    tasks: ["Pre-shoot planning", "Location scouting", "Equipment prep", "Photo shoot", "Photo selection & editing", "Client review", "Final delivery"],
    milestones: ["Shoot planned", "Shoot complete", "Edits delivered"],
  },
  event: {
    tasks: ["Event brief & objectives", "Venue research", "Vendor coordination", "Marketing & invitations", "Day-of logistics plan", "Event execution", "Post-event debrief"],
    milestones: ["Venue booked", "Vendors confirmed", "Event day", "Debrief complete"],
  },
  general: {
    tasks: ["Project kickoff", "Planning & scope", "Execution", "Review & feedback", "Final delivery"],
    milestones: ["Kickoff complete", "Delivery complete"],
  },
};

function inferServiceType(template: ProjectTemplate): string {
  const name = template.name.toLowerCase();
  const tasks = (Array.isArray(template.taskTitles) ? template.taskTitles : []).join(" ").toLowerCase();
  const text = `${name} ${tasks}`;
  if (text.includes("consult") || text.includes("advisory") || text.includes("strategy")) return "consultation";
  if (text.includes("design") || text.includes("brand") || text.includes("logo") || text.includes("creative")) return "design";
  if (text.includes("develop") || text.includes("code") || text.includes("build") || text.includes("deploy") || text.includes("app")) return "development";
  if (text.includes("market") || text.includes("campaign") || text.includes("social") || text.includes("ads")) return "marketing";
  if (text.includes("photo") || text.includes("shoot") || text.includes("video") || text.includes("film")) return "photography";
  if (text.includes("event") || text.includes("conference") || text.includes("workshop") || text.includes("party")) return "event";
  return "general";
}

export function TemplateManager({ businessId, onProjectCreated }: Props) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [tasks, setTasks] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedServiceType, setSelectedServiceType] = useState<string | null>(null);
  const [newTemplateServiceType, setNewTemplateServiceType] = useState("general");

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await fetchProjectTemplates(businessId);
      if (res.data) setTemplates(res.data);
    } catch {
      toast.error("Failed to load templates");
    }
  }, [businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    if (!businessId || !name.trim() || tasks.length === 0) return;
    setCreating(true);
    try {
      const res = await createProjectTemplate(businessId, { name: name.trim(), taskTitles: tasks });
      if (res.data) {
        setTemplates((prev) => [...prev, res.data!]);
        setName("");
        setTasks([]);
        setTaskInput("");
        setShowCreate(false);
        setNewTemplateServiceType("general");
        toast.success("Template created");
      }
    } catch {
      toast.error("Failed to create template");
    }
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    try {
      await deleteProjectTemplate(businessId, id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success("Template deleted");
    } catch {
      toast.error("Failed to delete template");
    }
  };

  const handleUseTemplate = async (template: ProjectTemplate) => {
    if (!businessId) return;
    try {
      const res = await createProjectFromTemplate(businessId, template.id);
      if (res.data) {
        toast.success(`Project "${res.data.name}" created from template`);
        onProjectCreated?.();
      }
    } catch {
      toast.error("Failed to create project from template");
    }
  };

  const addTask = () => {
    if (taskInput.trim()) {
      setTasks((prev) => [...prev, taskInput.trim()]);
      setTaskInput("");
    }
  };

  const applyDefaults = (type: string) => {
    const defaults = INTELLIGENT_DEFAULTS[type];
    if (defaults) {
      setTasks(defaults.tasks);
      setNewTemplateServiceType(type);
      if (!name.trim()) {
        const preset = SERVICE_TYPE_PRESETS[type];
        setName(`${preset?.label || "General"} Project Template`);
      }
    }
  };

  const serviceTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    templates.forEach((t) => {
      const st = inferServiceType(t);
      counts[st] = (counts[st] || 0) + 1;
    });
    return counts;
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!t.name.toLowerCase().includes(q)) return false;
      }
      if (selectedServiceType) {
        if (inferServiceType(t) !== selectedServiceType) return false;
      }
      return true;
    });
  }, [templates, searchQuery, selectedServiceType]);

  const usedServiceTypes = Object.keys(serviceTypeCounts).sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileStack className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Project Templates</h3>
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/30">{templates.length}</span>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          New Template
        </button>
      </div>

      {(templates.length > 2 || usedServiceTypes.length > 1) && (
        <div className="flex items-center gap-3 flex-wrap">
          {templates.length > 3 && (
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-border/60 bg-input pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground/60"
              />
            </div>
          )}
          {usedServiceTypes.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setSelectedServiceType(null)}
                className="text-[10px] px-2 py-1 rounded-md transition-colors"
                style={{
                  background: !selectedServiceType ? "hsl(var(--kf-accent1) / 0.15)" : "hsl(var(--muted) / 0.2)",
                  color: !selectedServiceType ? "hsl(var(--kf-accent1))" : "hsl(var(--muted-foreground))",
                }}
              >
                All
              </button>
              {usedServiceTypes.map((st) => {
                const preset = SERVICE_TYPE_PRESETS[st];
                const isActive = selectedServiceType === st;
                return (
                  <button
                    key={st}
                    onClick={() => setSelectedServiceType(isActive ? null : st)}
                    className="text-[10px] px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1"
                    style={{
                      background: isActive ? `hsl(var(${preset?.colorVar || "--muted-foreground"}) / 0.15)` : "hsl(var(--muted) / 0.2)",
                      color: isActive ? `hsl(var(${preset?.colorVar || "--muted-foreground"}))` : "hsl(var(--muted-foreground))",
                    }}
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {preset?.label || st}
                    <span className="opacity-60">{serviceTypeCounts[st]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <div className="kf-card rounded-xl p-4 space-y-3 border border-border/40">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="space-y-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Quick Start — load defaults by service type</span>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(SERVICE_TYPE_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyDefaults(key)}
                  className="text-[10px] px-2.5 py-1 rounded-md transition-colors inline-flex items-center gap-1"
                  style={{
                    background: newTemplateServiceType === key ? `hsl(var(${preset.colorVar}) / 0.15)` : "hsl(var(--muted) / 0.2)",
                    color: newTemplateServiceType === key ? `hsl(var(${preset.colorVar}))` : "hsl(var(--muted-foreground))",
                    borderWidth: "1px",
                    borderColor: newTemplateServiceType === key ? `hsl(var(${preset.colorVar}) / 0.3)` : "transparent",
                  }}
                >
                  <Zap className="w-2.5 h-2.5" />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {INTELLIGENT_DEFAULTS[newTemplateServiceType]?.milestones.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: "hsl(var(--muted) / 0.1)" }}>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Flag className="w-2.5 h-2.5" style={{ color: "hsl(var(--kf-accent2))" }} />
                Suggested Milestones — add to project after creation
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {INTELLIGENT_DEFAULTS[newTemplateServiceType].milestones.map((ms, i) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-md" style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}>
                    {ms}
                  </span>
                ))}
              </div>
            </div>
          )}

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
              onClick={() => { setShowCreate(false); setName(""); setTasks([]); setTaskInput(""); setNewTemplateServiceType("general"); }}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {filteredTemplates.length === 0 && !showCreate && (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/40">
          <Sparkles className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">{selectedServiceType ? "No templates in this category" : "No templates yet"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {selectedServiceType
              ? "Try a different category or create a new template."
              : "Create reusable project blueprints with pre-defined tasks to spin up projects quickly."}
          </p>
        </div>
      )}

      {filteredTemplates.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((t) => {
            const taskList = Array.isArray(t.taskTitles) ? t.taskTitles : [];
            const serviceType = inferServiceType(t);
            const preset = SERVICE_TYPE_PRESETS[serviceType];
            return (
              <div key={t.id} className="kf-card rounded-xl p-3 flex flex-col gap-2 border border-border/30">
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `hsl(var(${preset?.colorVar || "--kf-accent1"}) / 0.1)` }}
                  >
                    <ListChecks className="w-4 h-4" style={{ color: `hsl(var(${preset?.colorVar || "--kf-accent1"}))` }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.name}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">
                        {taskList.length} task{taskList.length !== 1 ? "s" : ""}
                        {t.product ? ` · ${t.product.name}` : ""}
                      </span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5"
                        style={{
                          background: `hsl(var(${preset?.colorVar || "--muted-foreground"}) / 0.1)`,
                          color: `hsl(var(${preset?.colorVar || "--muted-foreground"}))`,
                        }}
                      >
                        <Tag className="w-2 h-2" />
                        {preset?.label || serviceType}
                      </span>
                    </div>
                  </div>
                </div>
                {taskList.length > 0 && (
                  <div className="space-y-0.5 pl-12">
                    {taskList.slice(0, 3).map((task, i) => (
                      <div key={i} className="text-[10px] text-muted-foreground/70 truncate flex items-center gap-1">
                        <div className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
                        {typeof task === "string" ? task : String(task)}
                      </div>
                    ))}
                    {taskList.length > 3 && (
                      <div className="text-[10px] text-muted-foreground/50">+{taskList.length - 3} more</div>
                    )}
                  </div>
                )}
                {INTELLIGENT_DEFAULTS[serviceType]?.milestones.length > 0 && (
                  <div className="flex items-center gap-1 pl-12 mt-1">
                    <Flag className="w-2.5 h-2.5 shrink-0" style={{ color: "hsl(var(--kf-accent2))" }} />
                    <span className="text-[9px] text-muted-foreground">
                      {INTELLIGENT_DEFAULTS[serviceType].milestones.length} milestone{INTELLIGENT_DEFAULTS[serviceType].milestones.length !== 1 ? "s" : ""} suggested
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-auto pt-1">
                  <button
                    onClick={() => handleUseTemplate(t)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex-1"
                    style={{
                      background: "hsl(var(--kf-accent2) / 0.1)",
                      color: "hsl(var(--kf-accent2))",
                    }}
                  >
                    Use Template
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
