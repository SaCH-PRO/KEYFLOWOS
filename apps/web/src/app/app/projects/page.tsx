"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { registerInterruptedTask, markTaskCompleted } from "@/lib/resume-task-registry";
import { FolderKanban, Send, LayoutGrid, List, FileStack, Zap, Sparkles } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { useSearchParams, useRouter } from "next/navigation";
import { NotesTrigger } from "@/components/keyflow/notes-trigger";
import { RichTooltip } from "@/components/ui/rich-tooltip";
import { AiBadge } from "@/components/ui/ai-badge";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { KeyflowUnifiedShell } from "@/components/guide/keyflow-unified-shell";
import { ContactPickerDrawer } from "@/components/contacts";
import { fetchProjects, Project } from "@/lib/client";
import { ProjectBoard } from "./components/project-board";
import { ProjectListView } from "./components/project-list-view";
import { TemplateManager } from "./components/template-manager";
import { PlaybookPanel } from "./components/playbook-panel";
import { ProjectExecutionStrip } from "./components/project-execution-strip";
import { ProjectDetail } from "./components/project-detail";
import { useProjectsAiHub } from "./hooks/use-projects-ai-hub";
import { PlanGenerator } from "./components/plan-generator";
import { ProjectIntelligencePanel } from "./components/project-intelligence-panel";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { GraphInsightsPanel } from "@/components/ai/graph-insights-panel";
import { AutomationCoverageIndicator } from "@/components/ai/automation-coverage-indicator";
import { useGraphIntelligence } from "@/hooks/use-graph-intelligence";
import { KanbanSkeleton } from "@/components/ui/skeleton";

const TABS = [
  { key: "board", label: "Board", icon: LayoutGrid, tooltip: "Kanban board view grouped by delivery stage." },
  { key: "list", label: "List", icon: List, tooltip: "Table view of all projects with sortable columns." },
  { key: "intelligence", label: "Intelligence", icon: Sparkles, tooltip: "AI-powered project insights and team analytics." },
  { key: "plans", label: "Plans", icon: Sparkles, tooltip: "AI-generated strategic plans from your ideas." },
  { key: "templates", label: "Templates", icon: FileStack, tooltip: "Reusable project blueprints with pre-defined tasks." },
  { key: "playbooks", label: "Playbooks", icon: Zap, tooltip: "Trigger-based event playbooks for automation." },
];

export default function ProjectsPage() {
  const { getReturnLabel, navigateBack, getOriginWorkspace } = useReturnNavigation({ skipScrollListener: true });
  const searchParams = useSearchParams();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab && TABS.some((t) => t.key === tab)) return tab;
    }
    return "board";
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [prefillContactId, setPrefillContactId] = useState<string | undefined>(undefined);
  const projectTaskIdRef = useRef<string | null>(null);
  const { aiHook: projectsAi, updateProjectsContext } = useProjectsAiHub();
  const router = useRouter();
  const intelligence = useGraphIntelligence({ businessId, module: "projects" });

  const handleProjectsAiAction = useCallback((actionKey: string) => {
    if (actionKey.startsWith("switch_tab:")) {
      const tab = actionKey.replace("switch_tab:", "");
      if (["board", "list", "intelligence", "plans", "templates", "playbooks"].includes(tab)) setActiveTab(tab);
    } else if (actionKey === "new_project") {
      setActiveTab("board");
    }
  }, []);

  useEffect(() => {
    const bid = getStoredBusinessId();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    if (bid) setBusinessId(bid);
  }, []);

  useEffect(() => {
    const contactIdParam = searchParams?.get("contactId");
    if (contactIdParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
      setPrefillContactId(contactIdParam);
      window.history.replaceState({}, "", "/app/projects");
    }
  }, [searchParams]);

  useEffect(() => {
    if (selectedProjectId) {
      const project = projects.find((p) => p.id === selectedProjectId);
      const label = project?.name ? `Project · ${project.name}` : "Project";
      const taskId = registerInterruptedTask({
        id: `projects-detail-${selectedProjectId}`,
        module: "projects",
        label,
        description: project?.name ? `Resume working on ${project.name}` : "Resume project",
        route: "/app/projects",
        draftId: selectedProjectId,
        originRoute: "/app/projects",
        originLabel: "Projects",
        taskIntent: "edit-project",
        formData: {
          projectId: selectedProjectId,
          projectName: project?.name ?? null,
          status: project?.status ?? null,
        },
      });
      projectTaskIdRef.current = taskId;
    } else {
      if (projectTaskIdRef.current) {
        markTaskCompleted(projectTaskIdRef.current);
        projectTaskIdRef.current = null;
      }
    }
  }, [selectedProjectId, projects]);

  const loadProjects = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchProjects(businessId);
      if (res.data) setProjects(res.data);
    } catch {}
    setLoading(false);
  }, [businessId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
  useEffect(() => { void loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (businessId) {
      updateProjectsContext({
        businessId,
        activeView: activeTab,
        selectedItemId: selectedProjectId ?? undefined,
        projects,
      });
    }
  }, [businessId, activeTab, selectedProjectId, projects, updateProjectsContext]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const handleResumeProjectTask = useCallback((task: import("@/lib/resume-task-registry").InterruptedTask) => {
    const fd = task.formData;
    if (fd?.projectId) {
      const match = projects.find((p) => p.id === fd.projectId);
      if (match) { setSelectedProjectId(match.id); return; }
    }
  }, [projects]);

  if (loading && projects.length === 0) {
    return (
      <WorkspaceShell
        icon={FolderKanban}
        title="Projects"
        subtitle="Plan, deliver, track, and complete client work across your business"
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabLayoutId="projects-tab"
      >
        <KanbanSkeleton />
      </WorkspaceShell>
    );
  }

  if (selectedProject) {
    return (
      <ProjectDetail
        project={selectedProject}
        businessId={businessId}
        onBack={() => setSelectedProjectId(null)}
        onProjectUpdate={(updated) => {
          setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        }}
        onProjectDelete={(id) => {
          setProjects((prev) => prev.filter((p) => p.id !== id));
          setSelectedProjectId(null);
        }}
      />
    );
  }

  const originWorkspace = getOriginWorkspace();
  const showCrossModuleBanner = !!prefillContactId && originWorkspace && originWorkspace !== "Projects";

  return (
    <KeyflowUnifiedShell
      module="projects"
      pageTitle="Projects"
      availableActions={["Create project", "Add task", "Apply template", "Generate plan"]}
    >
    <WorkspaceShell
      icon={FolderKanban}
      title="Projects"
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          Plan, deliver, track, and complete client work across your business
          <AiBadge label="AI-Powered" compact />
        </span>
      }
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      tabLayoutId="projects-tab"
      ai={{ hook: projectsAi, moduleName: "Projects", onAction: handleProjectsAiAction }}
      headerRight={
        <RichTooltip title="Broadcast Update" description="Send a project update to selected contacts via the CRM.">
          <button
            onClick={() => setShowContactPicker(true)}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Send className="w-4 h-4" />
            Broadcast
          </button>
        </RichTooltip>
      }
      banners={
        <>
          <ResumePrompt module="projects" onResume={handleResumeProjectTask} />
          {showCrossModuleBanner && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm">
              <button
                onClick={() => navigateBack()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 group"
                title={getReturnLabel()}
              >
                <span className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform inline-flex items-center">&#8592;</span>
                <span className="max-w-[180px] truncate hidden sm:inline">{getReturnLabel()}</span>
              </button>
              <div className="w-px h-4 bg-border/60 shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">
                Creating project for contact from {originWorkspace}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <NotesTrigger pageKey="projects" variant="header" />
          </div>
        </>
      }
      metricStrip={!loading ? <ProjectExecutionStrip projects={projects} /> : undefined}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        {intelligence.moduleCoverage && (
          <AutomationCoverageIndicator
            coveragePct={intelligence.moduleCoverage.coveragePct}
            automatedCount={intelligence.moduleCoverage.automatedCount}
            totalProcesses={intelligence.moduleCoverage.totalProcesses}
          />
        )}
      </div>

      <GraphInsightsPanel
        recommendations={intelligence.recommendations}
        loading={intelligence.loading}
        onDismiss={intelligence.dismiss}
        onNavigate={(route) => router.push(route)}
        className="mb-4"
      />

      <div data-walkthrough="projects-board">
        <AnimatePresence mode="wait">
          {activeTab === "board" && (
            <motion.div key="board" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <ProjectBoard
                businessId={businessId}
                projects={projects}
                loading={loading}
                onProjectsChange={setProjects}
                onOpenProject={setSelectedProjectId}
                onReload={loadProjects}
              />
            </motion.div>
          )}

          {activeTab === "list" && (
            <motion.div key="list" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <ProjectListView
                projects={projects}
                loading={loading}
                onOpenProject={setSelectedProjectId}
              />
            </motion.div>
          )}

          {activeTab === "templates" && (
            <motion.div key="templates" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <TemplateManager businessId={businessId} onProjectCreated={loadProjects} />
            </motion.div>
          )}

          {activeTab === "plans" && (
            <motion.div key="plans" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <PlanGenerator businessId={businessId || ""} goals={[]} />
            </motion.div>
          )}

          {activeTab === "intelligence" && (
            <motion.div key="intelligence" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <ProjectIntelligencePanel />
            </motion.div>
          )}

          {activeTab === "playbooks" && (
            <motion.div key="playbooks" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              <PlaybookPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />

    </WorkspaceShell>
    </KeyflowUnifiedShell>
  );
}
