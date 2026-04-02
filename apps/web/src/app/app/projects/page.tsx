"use client";

import { useEffect, useState } from "react";
import { FolderKanban, Send } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { ModuleWalkthrough } from "@/components/ui/module-walkthrough";
import { PROJECTS_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { ContactPickerDrawer } from "@/components/contacts";
import { ProjectBoard } from "./components/project-board";
import { useProjectsAiHub } from "./hooks/use-projects-ai-hub";

export default function ProjectsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);
  useProjectsAiHub(businessId);

  useEffect(() => { const bid = getStoredBusinessId(); if (bid) setBusinessId(bid); }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FolderKanban}
        title="Projects"
        subtitle="Organize and track your work"
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
        description="Organize work with kanban boards and task tracking"
        steps={[
          { title: "Create Projects", description: "Click '+ New Project' to set up a project with a name and color for organizing work." },
          { title: "Add Tasks", description: "Expand a project and add tasks — check them off as you complete each action item." },
          { title: "Use Kanban Board", description: "Projects are displayed in columns by status: Active, In Progress, Completed, and On Hold." },
          { title: "Track Progress", description: "Monitor task completion with progress bars and move projects between statuses." },
        ]}
      />

      <ProjectBoard businessId={businessId} />

      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />

      <ModuleWalkthrough moduleKey="projects" steps={PROJECTS_WALKTHROUGH} />
    </div>
  );
}
