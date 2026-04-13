"use client";

import { useEffect, useState, useMemo } from "react";
import { LayoutGrid, Clock, Workflow } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { useNavigationContext } from "@/lib/navigation-context";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { AiBadge } from "@/components/ui/ai-badge";

import { AUTOMATIONS_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { usePlan } from "@/hooks/use-plan";
import { UpgradePrompt } from "@/components/ui/upgrade-prompt";
import { FlowList } from "./components/flow-list";
import { TemplateGallery } from "./components/template-gallery";
import { ExecutionLog } from "./components/execution-log";
import { FlowHealthStrip } from "./components/flow-health-strip";
import { CoverageMap } from "./components/coverage-map";
import { RecommendedFlows } from "./components/recommended-flows";
import type { AutomationTemplate } from "./components/automation-constants";
import { ResumePrompt } from "@/components/ui/resume-task-system";
import { useReturnNavigation } from "@/lib/use-return-navigation";
import { Playbook, CrossModuleWorkflow, fetchPlaybooks, fetchCrossModuleWorkflows } from "@/lib/client";

const TABS = [
  { key: "flows", label: "My Flows", icon: Workflow, tooltip: "Active flows and playbooks running in your business." },
  { key: "templates", label: "Templates", icon: LayoutGrid, tooltip: "Pre-built flow recipes you can activate with one click." },
  { key: "log", label: "Activity Log", icon: Clock, tooltip: "History of all flow executions, triggers, and outcomes." },
];

export default function FlowsPage() {
  useReturnNavigation({ restoreScrollOnMount: true });
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("flows");
  const { isFreePlan } = usePlan();
  const { setCurrentMeta } = useNavigationContext();
  const [selectedTemplate, setSelectedTemplate] = useState<AutomationTemplate | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [workflows, setWorkflows] = useState<CrossModuleWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(true);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  useEffect(() => {
    setCurrentMeta({ selectedEntityLabel: "Flows" });
  }, [setCurrentMeta]);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      const [pbRes, wfRes] = await Promise.all([
        fetchPlaybooks(businessId),
        fetchCrossModuleWorkflows(businessId),
      ]);
      setPlaybooks(pbRes.data ?? []);
      setWorkflows(wfRes.data ?? []);
      setLoading(false);
    };
    void load();
  }, [businessId]);

  function handleTemplateSelect(template: AutomationTemplate) {
    setSelectedTemplate(template);
    setActiveTab("flows");
  }

  function handleRecommendedSelect(template: AutomationTemplate) {
    setSelectedTemplate(template);
    setActiveTab("flows");
  }

  const healthStats = useMemo(() => {
    const active = playbooks.filter((p) => p.enabled).length + workflows.filter((w) => w.enabled).length;
    const paused = playbooks.filter((p) => !p.enabled).length + workflows.filter((w) => !w.enabled).length;
    const total = playbooks.length + workflows.length;
    const weekAgoTs = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
    const recentlyTriggered = playbooks.filter(
      (p) => p.lastRunAt && new Date(p.lastRunAt).getTime() > weekAgoTs
    ).length + workflows.filter(
      (w) => w.lastRunAt && new Date(w.lastRunAt).getTime() > weekAgoTs
    ).length;

    let mostTriggered: string | null = null;
    let maxRuns = 0;
    for (const p of playbooks) {
      if ((p.runCount ?? 0) > maxRuns) {
        maxRuns = p.runCount ?? 0;
        mostTriggered = p.name;
      }
    }
    for (const w of workflows) {
      if (w.runCount > maxRuns) {
        maxRuns = w.runCount;
        mostTriggered = w.name;
      }
    }

    const neverRun = playbooks.filter((p) => p.enabled && !(p.runCount ?? 0) && !p.lastRunAt).length
      + workflows.filter((w) => w.enabled && !w.runCount && !w.lastRunAt).length;

    return { active, paused, total, recentlyTriggered, mostTriggered, maxRuns, neverRun };
  }, [playbooks, workflows]);

  const activeTriggers = useMemo(() => {
    const triggers = new Set<string>();
    for (const p of playbooks) {
      if (p.enabled) triggers.add(p.triggerEvent);
    }
    for (const w of workflows) {
      if (w.enabled) triggers.add(w.triggerEvent);
    }
    return triggers;
  }, [playbooks, workflows]);

  return (
    <div className="space-y-4">
      <ResumePrompt module="automations" />
      <PageHeader
        icon={Workflow}
        title="Flows"
        subtitle={<span className="inline-flex items-center gap-1.5">Automate and orchestrate how your business reacts across every module <AiBadge label="AI-Powered" compact /></span>}
      />

      <div className="flex items-center gap-2">
        <PageGuideTrigger moduleKey="automations" />
      </div>

      {isFreePlan && showUpgradeBanner && (
        <div className="relative">
          <UpgradePrompt
            feature="Flow Automations"
            description="Automate your business with event-driven workflows. Available on Flow and above."
            requiredPlan="FLOW"
            variant="inline"
          />
          <button
            onClick={() => setShowUpgradeBanner(false)}
            className="absolute top-2 right-2 text-xs text-muted-foreground/60 hover:text-foreground transition-colors px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {!loading && activeTab === "flows" && (
        <>
          <FlowHealthStrip stats={healthStats} />
          <CoverageMap activeTriggers={activeTriggers} />
          <RecommendedFlows activeTriggers={activeTriggers} onSelect={handleRecommendedSelect} />
        </>
      )}

      <div data-walkthrough="automations-list">
        <TabNav
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          layoutId="flows-tab"
        />
      </div>

      {activeTab === "flows" && (
        <FlowList
          businessId={businessId}
          templateToUse={selectedTemplate}
          onTemplateClear={() => setSelectedTemplate(null)}
          playbooks={playbooks}
          workflows={workflows}
          loading={loading}
          onPlaybooksChange={setPlaybooks}
          onWorkflowsChange={setWorkflows}
        />
      )}

      {activeTab === "templates" && (
        <div data-walkthrough="automations-templates">
          <TemplateGallery onSelect={handleTemplateSelect} businessId={businessId} />
        </div>
      )}

      {activeTab === "log" && (
        <ExecutionLog businessId={businessId} />
      )}

      <PageGuide
        moduleKey="automations"
        walkthroughSteps={AUTOMATIONS_WALKTHROUGH}
      />
    </div>
  );
}
