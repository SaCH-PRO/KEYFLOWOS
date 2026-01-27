import { cn } from "../lib/utils";

export interface FeedItem {
  id: string;
  icon?: string;
  text: string;
  timestamp?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

const toneColors: Record<NonNullable<FeedItem["tone"]>, string> = {
  default: "border-[hsl(var(--kf-primary)/0.2)]",
  success: "border-[color-mix(in srgb, var(--kf-mint) 30%, transparent)]",
  warning: "border-[color-mix(in srgb, var(--kf-amber) 30%, transparent)]",
  danger: "border-[color-mix(in srgb, var(--kf-red) 30%, transparent)]",
  info: "border-[hsl(var(--kf-accent)/0.25)]",
};

export interface FlowFeedProps {
  items: FeedItem[];
  className?: string;
}

export function FlowFeed({ items, className }: FlowFeedProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 rounded-2xl border border-[hsl(var(--kf-border))] bg-[hsl(var(--kf-card))] p-4 shadow-[var(--kf-shadow)]",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[hsl(var(--kf-muted-foreground))]">
        <span className="h-2 w-2 rounded-full bg-[hsl(var(--kf-primary))]" />
        Flow Feed
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "relative flex items-start gap-3 rounded-xl border bg-[hsl(var(--kf-background))] px-3 py-2 text-sm text-[hsl(var(--kf-foreground))]",
              "transition-all duration-200 ease-flow hover:-translate-y-0.5 hover:border-[hsl(var(--kf-primary)/0.35)] hover:shadow-[0_12px_20px_rgba(15,23,42,0.08)]",
              toneColors[item.tone ?? "default"],
            )}
          >
            <div className="mt-0.5 text-[hsl(var(--kf-primary))]">{item.icon ?? "•"}</div>
            <div className="flex-1">
              <p className="leading-tight">{item.text}</p>
              {item.timestamp && (
                <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[hsl(var(--kf-muted-foreground))]">
                  {item.timestamp}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
