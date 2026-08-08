"use client";

import { useState } from "react";
import { LayoutGrid } from "lucide-react";
import {
  ModuleLauncherSheet,
  type ModuleLauncherSection,
} from "@/components/ui/module-launcher-sheet";

interface FlowQuickLauncherProps {
  title?: string;
  subtitle?: string;
  sections: ModuleLauncherSection[];
}

export function FlowQuickLauncher({
  title = "Flow Modules",
  subtitle = "Jump to related tools",
  sections,
}: FlowQuickLauncherProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open module launcher"
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/60 bg-card/60 hover:bg-card hover:border-primary/20 transition-all active:scale-95 focus-ring"
      >
        <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">Modules</span>
      </button>
      <ModuleLauncherSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        subtitle={subtitle}
        sections={sections}
      />
    </>
  );
}
