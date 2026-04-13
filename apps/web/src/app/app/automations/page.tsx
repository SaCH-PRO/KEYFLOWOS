"use client";

import { useEffect, useState } from "react";
import { Zap, List, LayoutGrid, Clock } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { PageGuide, PageGuideTrigger } from "@/components/ui/page-guide";
import { AiBadge } from "@/components/ui/ai-badge";

import { AUTOMATIONS_WALKTHROUGH } from "@/lib/walkthrough-definitions";
import { usePlan } from "@/hooks/use-plan";
import { UpgradePrompt } from "@/components/ui/upgrade-prompt";
import { AutomationList } from "./components/automation-list";
import { TemplateGallery } from "./components/template-gallery";
import { ExecutionLog } from "./components/execution-log";
import type { AutomationTemplate } from "./components/automation-constants";

const TABS = [
  { key: "automations", label: "My Automations", icon: List, tooltip: "Active automations and playbooks running in your business." },
  { key: "templates", label: "Templates", icon: LayoutGrid, tooltip: "Pre-built automation recipes you can activate with one click." },
  { key: "log", label: "Activity Log", icon: Clock, tooltip: "History of all automation executions, triggers, and outcomes." },
];

export default function AutomationsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("automations");
  const { isFreePlan } = usePlan();
  const [selectedTemplate, setSelectedTemplate] = useState<AutomationTemplate | null>(null);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  function handleTemplateSelect(template: AutomationTemplate) {
    setSelectedTemplate(template);
    setActiveTab("automations");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Zap}
        title="Automations"
        subtitle={<span className="inline-flex items-center gap-1.5">Build workflows that run your business on autopilot <AiBadge label="AI-Powered" compact /></span>}
      />

      <div className="flex items-center gap-2">
        <PageGuideTrigger moduleKey="automations" />
      </div>

      {isFreePlan && (
        <UpgradePrompt
          feature="Playbook Automations"
          description="Automate your business with event-driven workflows. Available on Flow and above."
          requiredPlan="FLOW"
          variant="inline"
        />
      )}

      <div data-walkthrough="automations-list">
        <TabNav
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          layoutId="automations-tab"
        />
      </div>

      {activeTab === "automations" && (
        <AutomationList
          businessId={businessId}
          templateToUse={selectedTemplate}
          onTemplateClear={() => setSelectedTemplate(null)}
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
