"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FolderKanban, Send, Zap } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { ContactPickerDrawer } from "@/components/contacts";
import { ProjectBoard } from "./components/project-board";
import { WorkflowConfig } from "./components/workflow-config";
import { PlaybookPanel } from "./components/playbook-panel";

const TABS = [
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "automations", label: "Automations", icon: Zap },
];

export default function ProjectsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [showContactPicker, setShowContactPicker] = useState(false);

  const tabParam = searchParams.get("tab");
  const activeTab = tabParam === "automations" || tabParam === "intelligence" ? "automations" : "projects";

  useEffect(() => { const bid = getStoredBusinessId(); if (bid) setBusinessId(bid); }, []);

  const handleTabChange = (tab: string) => {
    router.push(`/app/projects${tab !== "projects" ? `?tab=${tab}` : ""}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon={FolderKanban}
        title="Projects & Playbooks"
        subtitle="Manage work and automate your business flows"
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
        description="Organize work and automate business flows"
        steps={[
          { title: "Create Projects", description: "Click '+ New Project' to set up a project with a name and color for organizing work." },
          { title: "Add Tasks", description: "Expand a project and add tasks — check them off as you complete each action item." },
          { title: "Use Kanban Board", description: "Projects are displayed in columns by status: Active, In Progress, Completed, and On Hold." },
          { title: "Set Up Playbooks", description: "Create automation playbooks that trigger actions based on business events." },
          { title: "Automate Workflows", description: "Connect triggers like invoice paid or booking created to automatic actions." },
          { title: "Track Progress", description: "Monitor task completion with progress bars and move projects between statuses." },
        ]}
      />

      <TabNav
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        layoutId="projects-tab"
      />

      {activeTab === "projects" ? (
        <ProjectBoard businessId={businessId} />
      ) : (
        <div className="space-y-6">
          <WorkflowConfig businessId={businessId} />
          <PlaybookPanel />
        </div>
      )}

      <ContactPickerDrawer isOpen={showContactPicker} onClose={() => setShowContactPicker(false)} />
    </div>
  );
}
