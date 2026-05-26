"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { RefreshCw, Layers } from "lucide-react";


const automateTabs = [
  { label: "Flows", href: "/app/build/automate/flows", icon: RefreshCw },
  { label: "Workflows", href: "/app/build/automate/workflows", icon: Layers },
];

export default function AutomateFlowsPage() {
  return (
    <ModuleShell
      icon={RefreshCw}
      title="Flows"
      subtitle="Automation builder, triggers & actions"
      tabs={automateTabs}
    />
  );
}
