"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { FolderKanban, Clock, FileSignature, CheckSquare } from "lucide-react";


const workTabs = [
  { label: "Projects", href: "/app/work/projects", icon: FolderKanban },
  { label: "Time", href: "/app/work/time", icon: Clock },
  { label: "Agreements", href: "/app/work/agreements", icon: FileSignature },
  { label: "Tasks", href: "/app/work/tasks", icon: CheckSquare },
];

export default function WorkProjectsPage() {
  return (
    <ModuleShell
      icon={FolderKanban}
      title="Projects"
      subtitle="Active projects, plans & deliverables"
      tabs={workTabs}
    />
  );
}
