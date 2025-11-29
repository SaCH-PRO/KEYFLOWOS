import { cn } from "../lib/utils";

export interface FlowGraphPlaceholderProps {
  className?: string;
}

export function FlowGraphPlaceholder({ className }: FlowGraphPlaceholderProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[var(--kf-border)] bg-[rgba(0,0,0,0.3)] p-6 shadow-glass backdrop-blur-md",
        "before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_20%_20%,rgba(78,168,255,0.08),transparent_35%),radial-gradient(circle_at_80%_60%,rgba(163,116,255,0.08),transparent_35%)]",
        className,
      )}
    >
      <div className="relative z-10 flex flex-col gap-3 text-[var(--kf-text)]">
        <div className="flex items-center justify-between">
          <div className="text-sm uppercase tracking-[0.08em] text-[var(--kf-text-muted)]">Live Business Graph</div>
          <div className="rounded-full border border-[var(--kf-electric)] bg-[rgba(78,168,255,0.08)] px-3 py-1 text-xs text-[var(--kf-electric)]">
            Coming Alive
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center text-sm">
          {["Leads", "Quotes", "Invoices", "Bookings", "Projects", "Automations"].map((node) => (
            <div
              key={node}
              className="relative overflow-hidden rounded-xl border border-[rgba(78,168,255,0.18)] bg-[rgba(31,34,37,0.8)] px-3 py-4 shadow-[0_0_14px_rgba(78,168,255,0.18)] transition-all duration-200 ease-flow hover:-translate-y-0.5 hover:border-[rgba(163,116,255,0.3)]"
            >
              <div className="text-[12px] uppercase tracking-[0.08em] text-[var(--kf-text-muted)]">{node}</div>
              <div className="mt-1 text-lg font-semibold text-[var(--kf-electric)]">•••</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--kf-text-muted)]">
          This placeholder represents the kinetic Flow Graph. Nodes glow/pulse on events; edges animate energy when data
          moves.
        </p>
      </div>
    </div>
  );
}
