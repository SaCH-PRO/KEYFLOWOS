"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { Contact, Filter, Send, Brain, Headset } from "lucide-react";


const peopleTabs = [
  { label: "Directory", href: "/app/people", icon: Contact },
  { label: "Pipeline", href: "/app/people/pipeline", icon: Filter },
  { label: "Sequences", href: "/app/people/sequences", icon: Send },
  { label: "Intelligence", href: "/app/people/intelligence", icon: Brain },
  { label: "Service", href: "/app/people/service", icon: Headset },
];

export default function PeopleServicePage() {
  return (
    <ModuleShell
      icon={Headset}
      title="Service"
      subtitle="Helpdesk, portal & WhatsApp"
      tabs={peopleTabs}
    />
  );
}
