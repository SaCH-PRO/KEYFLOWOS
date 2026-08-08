"use client";

import {
  Dna,
  Grid3X3,
  MessageSquare,
  FileText,
  ScrollText,
  Briefcase,
  Sparkles,
  Radio,
  Lightbulb,
  Shield,
  Brain,
} from "lucide-react";
import { FlowQuickLauncher } from "@/components/layout/flow-quick-launcher";
import type { ModuleLauncherSection } from "@/components/ui/module-launcher-sheet";

const SECTIONS: ModuleLauncherSection[] = [
  {
    id: "genome-core",
    label: "Genome",
    items: [
      { id: "overview", label: "Overview", href: "/app/genome", icon: Dna, tone: "primary" },
      { id: "dna", label: "DNA Sections", href: "/app/genome?tab=dna", icon: Grid3X3, tone: "violet" },
      { id: "chat", label: "Genome Chat", href: "/app/genome?tab=chat", icon: MessageSquare, tone: "sky" },
      { id: "reports", label: "Reports", href: "/app/profile?tab=business-genome&section=reports", icon: FileText, tone: "mint" },
    ],
  },
  {
    id: "genome-advanced",
    label: "Advanced",
    items: [
      { id: "constitution", label: "Constitution", href: "/app/profile?tab=business-genome&section=constitution", icon: ScrollText, tone: "gold" },
      { id: "assets", label: "Asset Registry", href: "/app/profile?tab=business-genome&section=assets", icon: Briefcase, tone: "orange" },
      { id: "evolution", label: "Evolution Proposals", href: "/app/profile?tab=business-genome&section=evolution-proposals", icon: Sparkles, tone: "rose" },
      { id: "signals", label: "Signals", href: "/app/profile?tab=business-genome&section=signals", icon: Radio, tone: "teal" },
      { id: "recommendations", label: "Recommendations", href: "/app/profile?tab=business-genome&section=recommendations", icon: Lightbulb, tone: "gold" },
      { id: "governance", label: "Governance", href: "/app/profile?tab=business-genome&section=governance", icon: Shield, tone: "violet" },
      { id: "memory", label: "Memory", href: "/app/profile?tab=business-genome&section=memory", icon: Brain, tone: "sky" },
    ],
  },
];

export function GenomeQuickLauncher() {
  return (
    <FlowQuickLauncher
      title="Genome Modules"
      subtitle="Jump to genome tools and advanced panels"
      sections={SECTIONS}
    />
  );
}
