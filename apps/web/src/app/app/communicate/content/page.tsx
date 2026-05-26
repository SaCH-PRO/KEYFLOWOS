"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { Megaphone, PenTool, Share2 } from "lucide-react";


const communicateTabs = [
  { label: "Campaigns", href: "/app/communicate/campaigns", icon: Megaphone },
  { label: "Content", href: "/app/communicate/content", icon: PenTool },
  { label: "Social", href: "/app/communicate/social", icon: Share2 },
];

export default function CommunicateContentPage() {
  return (
    <ModuleShell
      icon={PenTool}
      title="Content"
      subtitle="Content ops, assets & creative production"
      tabs={communicateTabs}
    />
  );
}
