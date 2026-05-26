"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { FolderKanban, Clock, FileSignature, CheckSquare } from "lucide-react";


const workTabs = [
  { label: "Projects", href: "/app/work/projects", icon: FolderKanban },
  { label: "Time", href: "/app/work/time", icon: Clock },
  { label: "Agreements", href: "/app/work/agreements", icon: FileSignature },
  { label: "Tasks", href: "/app/work/tasks", icon: CheckSquare },
];

export default function WorkAgreementsPage() {
  return (
    <ModuleShell
      icon={FileSignature}
      title="Agreements"
      subtitle="Retainers, change orders & SOWs"
      tabs={workTabs}
    />
  );
}
