import { ReactNode } from "react";
import { cn } from "../lib/utils";

export function ContentContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("max-w-screen-2xl mx-auto px-6 py-8", className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
        {actions}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 mb-4", className)}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}>{children}</div>;
}
