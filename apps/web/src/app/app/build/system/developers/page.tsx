"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { User, Building, Link, Bot, ShieldCheck, Code } from "lucide-react";


const systemTabs = [
  { label: "Account", href: "/app/build/system/account", icon: User },
  { label: "Workspace", href: "/app/build/system/workspace", icon: Building },
  { label: "Connections", href: "/app/key-connect", icon: Link },
  { label: "AI", href: "/app/build/system/ai", icon: Bot },
  { label: "Compliance", href: "/app/build/system/compliance", icon: ShieldCheck },
  { label: "Developers", href: "/app/build/system/developers", icon: Code },
];

export default function SystemDevelopersPage() {
  return (
    <ModuleShell
      icon={Code}
      title="Developers"
      subtitle="API keys, webhooks & conversion tracking"
      tabs={systemTabs}
    />
  );
}
