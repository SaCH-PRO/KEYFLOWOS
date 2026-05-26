"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { RefreshCw, Layers } from "lucide-react";


const automateTabs = [
  { label: "Flows", href: "/app/build/automate/flows", icon: RefreshCw },
  { label: "Workflows", href: "/app/build/automate/workflows", icon: Layers },
];

export default function AutomateWorkflowsPage() {
  return (
    <ModuleShell
      icon={Layers}
      title="Workflows"
      subtitle="Business process workflows"
      tabs={automateTabs}
    />
  );
}
