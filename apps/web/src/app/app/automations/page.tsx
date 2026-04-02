"use client";

import { useEffect, useState } from "react";
import { Zap, List, LayoutGrid, Clock } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { PageHeader } from "@/components/ui/page-header";
import { TabNav } from "@/components/ui/tab-nav";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { usePlan } from "@/hooks/use-plan";
import { UpgradePrompt } from "@/components/ui/upgrade-prompt";
import { AutomationList } from "./components/automation-list";
import { TemplateGallery } from "./components/template-gallery";
import { ExecutionLog } from "./components/execution-log";
import type { AutomationTemplate } from "./components/automation-constants";

const TABS = [
  { key: "automations", label: "My Automations", icon: List },
  { key: "templates", label: "Templates", icon: LayoutGrid },
  { key: "log", label: "Activity Log", icon: Clock },
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
        subtitle="Build workflows that run your business on autopilot"
      />

      <FeatureGuide
        featureKey="automations"
        title="Getting Started with Automations"
        description="Automate repetitive tasks and connect your business modules"
        steps={[
          { title: "Create an Automation", description: "Click 'New Automation' or use a template to set up trigger-to-action workflows." },
          { title: "Pick a Trigger", description: "Choose what starts the automation — like a paid invoice, new booking, or form submission." },
          { title: "Add Actions", description: "Define what happens next — send an email, create a task, tag a contact, or more." },
          { title: "Toggle On/Off", description: "Enable or disable automations anytime without losing your configuration." },
          { title: "Monitor Activity", description: "Check the Activity Log tab to see when automations ran and what they did." },
        ]}
      />

      {isFreePlan && (
        <UpgradePrompt
          feature="Playbook Automations"
          description="Automate your business with event-driven workflows. Available on Flow and above."
          requiredPlan="FLOW"
          variant="inline"
        />
      )}

      <TabNav
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        layoutId="automations-tab"
      />

      {activeTab === "automations" && (
        <AutomationList
          businessId={businessId}
          templateToUse={selectedTemplate}
          onTemplateClear={() => setSelectedTemplate(null)}
        />
      )}

      {activeTab === "templates" && (
        <TemplateGallery onSelect={handleTemplateSelect} businessId={businessId} />
      )}

      {activeTab === "log" && (
        <ExecutionLog businessId={businessId} />
      )}
    </div>
  );
}
