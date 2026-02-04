import { cn } from "../lib/utils";

export interface FlowGraphPlaceholderProps {
  className?: string;
}

export function FlowGraphPlaceholder({ className }: FlowGraphPlaceholderProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] p-6",
        className,
      )}
    >
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-sm uppercase tracking-widest text-[hsl(var(--kf-muted-foreground))]">Live Business Graph</div>
          <div 
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{
              background: "hsl(var(--kf-accent1) / 0.15)",
              color: "hsl(var(--kf-accent1))",
              border: "1px solid hsl(var(--kf-accent1) / 0.3)"
            }}
          >
            Coming Alive
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center text-sm">
          {["Leads", "Quotes", "Invoices", "Bookings", "Projects", "Automations"].map((node, idx) => (
            <div
              key={node}
              className="relative overflow-hidden rounded-xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-muted))] px-3 py-4 transition-all duration-200 hover:-translate-y-0.5"
              style={{
                borderColor: idx % 2 === 0 ? "hsl(var(--kf-accent1) / 0.2)" : "hsl(var(--kf-accent2) / 0.2)"
              }}
            >
              <div className="text-[12px] uppercase tracking-widest text-[hsl(var(--kf-muted-foreground))]">{node}</div>
              <div 
                className="mt-1 text-lg font-semibold"
                style={{ color: idx % 2 === 0 ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-accent2))" }}
              >
                •••
              </div>
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
