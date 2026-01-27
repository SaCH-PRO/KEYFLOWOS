import { cn } from "../lib/utils";

export interface FlowGraphPlaceholderProps {
  className?: string;
}

export function FlowGraphPlaceholder({ className }: FlowGraphPlaceholderProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] p-6 shadow-[var(--kf-shadow)]",
        "before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_20%_20%,hsl(var(--kf-primary)/0.1),transparent_35%),radial-gradient(circle_at_80%_60%,hsl(var(--kf-accent)/0.1),transparent_35%)]",
        className,
      )}
    >
      <div className="relative z-10 flex flex-col gap-3 text-[hsl(var(--kf-foreground))]">
        <div className="flex items-center justify-between">
          <div className="text-sm uppercase tracking-[0.16em] text-[hsl(var(--kf-muted-foreground))]">Live Business Graph</div>
          <div className="rounded-full border border-[hsl(var(--kf-primary))] bg-[hsl(var(--kf-primary)/0.08)] px-3 py-1 text-xs text-[hsl(var(--kf-primary))]">
            Coming Alive
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center text-sm">
          {["Leads", "Quotes", "Invoices", "Bookings", "Projects", "Automations"].map((node) => (
            <div
              key={node}
              className="relative overflow-hidden rounded-xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-background))] px-3 py-4 shadow-[0_12px_22px_rgba(15,23,42,0.08)] transition-all duration-200 ease-flow hover:-translate-y-0.5 hover:border-[hsl(var(--kf-primary)/0.4)]"
            >
              <div className="text-[12px] uppercase tracking-[0.16em] text-[hsl(var(--kf-muted-foreground))]">{node}</div>
              <div className="mt-1 text-lg font-semibold text-[hsl(var(--kf-primary))]">•••</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[hsl(var(--kf-muted-foreground))]">
          This placeholder represents the kinetic Flow Graph. Nodes glow/pulse on events; edges animate energy when data
          moves.
        </p>
      </div>
    </div>
  );
}
