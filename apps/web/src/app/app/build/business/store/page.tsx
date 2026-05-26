"use client";

import { ModuleShell } from "@/components/ui/module-shell";
import { BrainCircuit, Store, Globe, GraduationCap } from "lucide-react";


const businessTabs = [
  { label: "Blueprint", href: "/app/build/business/blueprint", icon: BrainCircuit },
  { label: "Storefront", href: "/app/build/business/store", icon: Store },
  { label: "Presence", href: "/app/build/business/presence", icon: Globe },
  { label: "Templates", href: "/app/build/business/templates", icon: GraduationCap },
];

export default function BusinessStorePage() {
  return (
    <ModuleShell
      icon={Store}
      title="Storefront"
      subtitle="E-commerce store, products & catalog"
      tabs={businessTabs}
    />
  );
}
