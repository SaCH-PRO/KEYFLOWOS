import { cn } from "../lib/utils";

export interface FeedItem {
  id: string;
  icon?: string;
  text: string;
  timestamp?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

const toneColors: Record<NonNullable<FeedItem["tone"]>, string> = {
  default: "border-[rgba(78,168,255,0.18)]",
  success: "border-[rgba(76,255,206,0.3)]",
  warning: "border-[rgba(255,195,77,0.3)]",
  danger: "border-[rgba(255,78,78,0.3)]",
  info: "border-[rgba(163,116,255,0.25)]",
};

export interface FlowFeedProps {
  items: FeedItem[];
  className?: string;
}

export function FlowFeed({ items, className }: FlowFeedProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 rounded-xl border border-[var(--kf-border)] bg-[rgba(31,34,37,0.9)] p-4 shadow-glass",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-[var(--kf-text-muted)]">
        <span className="h-2 w-2 rounded-full bg-[var(--kf-electric)] shadow-[0_0_10px_rgba(78,168,255,0.7)]" />
        Flow Feed
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "relative flex items-start gap-3 rounded-lg border bg-[rgba(0,0,0,0.25)] px-3 py-2 text-sm text-[var(--kf-text)]",
              "transition-all duration-200 ease-flow hover:-translate-y-0.5 hover:border-[rgba(78,168,255,0.3)] hover:shadow-[0_8px_18px_rgba(0,0,0,0.45)]",
              toneColors[item.tone ?? "default"],
            )}
          >
            <div className="mt-0.5 text-[var(--kf-electric)]">{item.icon ?? "•"}</div>
            <div className="flex-1">
              <p className="leading-tight">{item.text}</p>
              {item.timestamp && (
                <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-[var(--kf-text-muted)]">
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
