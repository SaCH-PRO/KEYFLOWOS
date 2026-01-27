import { ReactNode } from "react";
import { cn } from "../lib/utils";

interface ShellProps {
  sidebar: ReactNode;
  topbar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Shell({ sidebar, topbar, children, className }: ShellProps) {
  return (
    <div className={cn("min-h-screen bg-[hsl(var(--kf-background))] text-[hsl(var(--kf-foreground))]", className)}>
      <div className="mx-auto flex max-w-7xl gap-4 px-6 py-4">
        <aside className="w-64 shrink-0 rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] shadow-[var(--kf-shadow)]">
          {sidebar}
        </aside>
        <div className="flex w-full flex-col gap-4">
          {topbar}
          <main className="rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] shadow-[var(--kf-shadow)] p-4">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
