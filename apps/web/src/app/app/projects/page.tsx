"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@keyflow/ui";
import {
  Project,
  ProjectTemplate,
  createProject,
  createProjectFromTemplate,
  createProjectTask,
  createProjectTemplate,
  fetchProjects,
  fetchProjectTemplates,
  updateProjectTask,
} from "@/lib/client";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [projectName, setProjectName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateTasks, setTemplateTasks] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");

  useEffect(() => {
    const load = async () => {
      const [projRes, templateRes] = await Promise.all([fetchProjects(), fetchProjectTemplates()]);
      setProjects(projRes.data ?? []);
      setTemplates(templateRes.data ?? []);
    };
    void load();
  }, []);

  const refreshProjects = async () => {
    const res = await fetchProjects();
    setProjects(res.data ?? []);
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;
    await createProject({ name: projectName.trim() });
    setProjectName("");
    await refreshProjects();
  };

  const handleCreateTask = async () => {
    if (!selectedProjectId || !taskTitle.trim()) return;
    await createProjectTask({ projectId: selectedProjectId, title: taskTitle.trim() });
    setTaskTitle("");
    await refreshProjects();
  };

  const handleToggleTask = async (taskId: string, isCompleted?: boolean) => {
    await updateProjectTask({ taskId, isCompleted: !isCompleted });
    await refreshProjects();
  };

  const handleCreateTemplate = async () => {
    if (!templateName.trim()) return;
    const taskTitles = templateTasks
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await createProjectTemplate({ name: templateName.trim(), taskTitles });
    setTemplateName("");
    setTemplateTasks("");
    const refreshed = await fetchProjectTemplates();
    setTemplates(refreshed.data ?? []);
  };

  const handleInstantiateTemplate = async (templateId: string) => {
    await createProjectFromTemplate({ templateId });
    await refreshProjects();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Track delivery projects and playbook templates.</p>
        </div>
        <Badge tone="info">{projects.length} projects</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="New project" badge="Active">
          <div className="flex flex-wrap gap-2">
            <Input label="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            <Button onClick={handleCreateProject}>Create</Button>
          </div>
        </Card>

        <Card title="Project templates" badge={`${templates.length}`}>
          <div className="space-y-2">
            <Input label="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            <Input
              label="Task titles (comma separated)"
              value={templateTasks}
              onChange={(e) => setTemplateTasks(e.target.value)}
            />
            <Button variant="outline" onClick={handleCreateTemplate}>
              Save template
            </Button>
            <div className="space-y-2">
              {templates.map((template) => (
                <div key={template.id} className="rounded-xl border border-border/60 bg-slate-900/60 p-3 text-sm">
                  <div className="font-semibold">{template.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(template.taskTitles ?? []).length} tasks
                  </div>
                  <Button size="xs" variant="outline" className="mt-2" onClick={() => handleInstantiateTemplate(template.id)}>
                    Create project
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card title="Projects list" badge="Live">
          <div className="space-y-2">
            {projects.length === 0 && <div className="text-xs text-muted-foreground">No projects yet.</div>}
            {projects.map((project) => (
              <div
                key={project.id}
                className="rounded-2xl border border-border/60 bg-slate-900/60 p-3 text-sm cursor-pointer"
                onClick={() => setSelectedProjectId(project.id)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{project.name}</span>
                  <Badge tone={project.status === "COMPLETED" ? "success" : "info"}>{project.status}</Badge>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {(project.tasks ?? []).length} tasks
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Tasks" badge={selectedProjectId ? "Selected" : "Choose project"}>
          <div className="space-y-3">
            {!selectedProjectId && <div className="text-xs text-muted-foreground">Select a project to manage tasks.</div>}
            {selectedProjectId && (
              <>
                <div className="flex gap-2">
                  <Input label="Task title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                  <Button variant="outline" onClick={handleCreateTask}>
                    Add task
                  </Button>
                </div>
                <div className="space-y-2 text-sm">
                  {(projects.find((p) => p.id === selectedProjectId)?.tasks ?? []).map((task) => (
                    <div key={task.id} className="rounded-xl border border-border/60 bg-slate-900/60 p-2">
                      <div className="flex items-center justify-between">
                        <span className={task.isCompleted ? "line-through text-muted-foreground" : ""}>{task.title}</span>
                        <Button size="xs" variant="outline" onClick={() => handleToggleTask(task.id, task.isCompleted)}>
                          {task.isCompleted ? "Reopen" : "Complete"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
