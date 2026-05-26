"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { BarChart3, Target, Activity, ShieldCheck } from "lucide-react";


const intelligenceTabs = [
  { label: "Reports", href: "/app/intelligence/reports", icon: BarChart3 },
  { label: "Goals", href: "/app/intelligence/goals", icon: Target },
  { label: "Operations", href: "/app/intelligence/ops", icon: Activity },
  { label: "Compliance", href: "/app/intelligence/compliance", icon: ShieldCheck },
];

export default function IntelligenceReportsPage() {
  return (
    <ModuleShell
      icon={BarChart3}
      title="Reports"
      subtitle="Cross-module analytics & insights"
      tabs={intelligenceTabs}
    />
  );
}
