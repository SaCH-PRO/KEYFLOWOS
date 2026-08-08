"use client";

import type React from "react";
import type { LucideIcon } from "lucide-react";
import { Surface } from "@/components/ui-v2/surface";

interface CommandSectionProps {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function CommandSection({ icon: Icon, title, children, action }: CommandSectionProps) {
  return (
    <Surface>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-3.5 w-3.5 text-primary" />
          </div>
          <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </Surface>
  );
}
