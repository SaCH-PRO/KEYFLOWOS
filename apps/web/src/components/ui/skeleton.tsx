export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse kf-radius-md ${className}`}
      style={{ background: "hsl(var(--kf-muted) / 0.3)", ...style }}
    />
  );
}

export function StatCardSkeleton() {
  return (
    <div className="kf-card-metric space-y-3">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{ borderBottom: "1px solid hsl(var(--kf-border) / 0.5)" }}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === 0 ? "w-32" : i === cols - 1 ? "w-16" : "w-24"}`} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="kf-card kf-radius-lg overflow-hidden">
      <div
        className="flex items-center gap-4 px-4 py-3"
        style={{
          borderBottom: "1px solid hsl(var(--kf-border) / 0.6)",
          background: "hsl(var(--kf-muted) / 0.15)",
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-20" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRowSkeleton key={i} cols={cols} />
      ))}
    </div>
  );
}

const CHART_HEIGHTS = ["75%", "45%", "90%", "60%", "35%", "80%", "55%", "70%"];

export function ChartSkeleton() {
  return (
    <div className="kf-card kf-radius-lg p-6 space-y-4">
      <Skeleton className="h-4 w-32" />
      <div className="flex items-end gap-2 h-40">
        {CHART_HEIGHTS.map((h, i) => (
          <Skeleton key={i} className="flex-1 kf-radius-sm" style={{ height: h }} />
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-32 kf-radius-md" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSkeleton />
        <TableSkeleton rows={4} cols={3} />
      </div>
    </div>
  );
}

export function ListPageSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-32 kf-radius-md" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 w-28 kf-radius-md" />
        <Skeleton className="h-9 flex-1 max-w-xs kf-radius-md" />
        <Skeleton className="h-9 w-28 kf-radius-md" />
      </div>
      <TableSkeleton rows={6} cols={5} />
    </div>
  );
}

export function SkeletonList({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 kf-radius-md"
          style={{ background: "hsl(var(--kf-muted) / 0.1)" }}
        >
          <Skeleton className="w-8 h-8 kf-radius-md flex-shrink-0" />
          <div className="flex-1 flex items-center gap-4">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton
                key={j}
                className={`h-3.5 ${j === 0 ? "w-1/3" : j === cols - 1 ? "w-16" : "w-20"}`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="kf-card kf-radius-lg p-4 flex items-center gap-3">
          <Skeleton className="w-10 h-10 kf-radius-lg flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-7 w-16 kf-radius-md flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function KanbanSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32 kf-radius-md" />
          <Skeleton className="h-9 w-28 kf-radius-md" />
        </div>
      </div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="w-72 shrink-0 space-y-3">
            <div
              className="flex items-center justify-between p-3 kf-radius-md"
              style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
            {Array.from({ length: [3, 4, 2, 3, 2][col] }).map((_, card) => (
              <div key={card} className="kf-card kf-radius-md p-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
