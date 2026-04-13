"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { FolderKanban, Send, LayoutGrid, List, FileStack } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { RichTooltip } from "@/components/ui/rich-tooltip";
import { AiBadge } from "@/components/ui/ai-badge";
import { TabNav } from "@/components/ui/tab-nav";
import { PROJECTS_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { ContactPickerDrawer } from "@/components/contacts";
import { fetchProjects, Project } from "@/lib/client";
import { ProjectBoard } from "./components/project-board";
import { ProjectListView } from "./components/project-list-view";
import { TemplateManager } from "./components/template-manager";
import { ProjectExecutionStrip } from "./components/project-execution-strip";
import { ProjectDetail } from "./components/project-detail";
import { useProjectsAiHub } from "./hooks/use-projects-ai-hub";

const TABS = [
  { key: "board", label: "Board", icon: LayoutGrid, tooltip: "Kanban board view grouped by delivery stage." },
  { key: "list", label: "List", icon: List, tooltip: "Table view of all projects with sortable columns." },
  { key: "templates", label: "Templates", icon: FileStack, tooltip: "Reusable project blueprints with pre-defined tasks." },
];

export default function ProjectsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("board");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  useProjectsAiHub(businessId);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

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

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

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

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            Plan, deliver, track, and complete client work across your business
            <AiBadge label="AI-Powered" compact />
          </span>
        }
        rightSlot={
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
      />

      <div className="flex items-center gap-2">
        <PageGuideTrigger moduleKey="projects" />
      </div>

      {!loading && <ProjectExecutionStrip projects={projects} />}

      <div data-walkthrough="projects-board">
        <TabNav
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          layoutId="projects-tab"
        />
      </div>

      {activeTab === "board" && (
        <ProjectBoard
          businessId={businessId}
          projects={projects}
          loading={loading}
          onProjectsChange={setProjects}
          onOpenProject={setSelectedProjectId}
          onReload={loadProjects}
        />
      )}

      {activeTab === "list" && (
        <ProjectListView
          projects={projects}
          loading={loading}
          onOpenProject={setSelectedProjectId}
        />
      )}

      {activeTab === "templates" && (
        <TemplateManager businessId={businessId} onProjectCreated={loadProjects} />
      )}

      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />

      <PageGuide
        moduleKey="projects"
        walkthroughSteps={PROJECTS_WALKTHROUGH}
      />
    </div>
  );
}
