"use client";

export function SkeletonProfile() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Loading profile..." aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-muted/40" />
        <div className="space-y-2 flex-1">
          <div className="h-6 w-36 bg-muted/40 rounded-lg" />
          <div className="h-3 w-56 bg-muted/30 rounded-lg" />
        </div>
      </div>

      <div className="rounded-xl p-4" style={{ border: "1px solid hsl(var(--kf-border) / 0.2)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 rounded-full bg-muted/30" />
            <div className="space-y-1">
              <div className="h-4 w-40 bg-muted/40 rounded" />
              <div className="h-3 w-28 bg-muted/20 rounded" />
            </div>
          </div>
          <div className="h-4 w-4 bg-muted/20 rounded" />
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl" style={{ border: "1px solid hsl(var(--kf-border) / 0.2)" }}>
        {["Profile", "Brand & Identity", "Documents"].map((tab) => (
          <div key={tab} className="flex-1 flex items-center justify-center py-2.5 rounded-lg">
            <div className="h-4 w-20 bg-muted/30 rounded" />
          </div>
        ))}
      </div>

      <div className="rounded-xl p-4" style={{ background: "hsl(var(--kf-accent1) / 0.04)", border: "1px solid hsl(var(--kf-accent1) / 0.08)" }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="h-3.5 w-3.5 rounded bg-muted/30" />
          <div className="h-3 w-32 bg-muted/30 rounded" />
        </div>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-7 w-24 bg-muted/15 rounded-lg" />
          ))}
        </div>
      </div>

      <div className="kf-card p-6 space-y-4">
        <div className="h-5 w-44 bg-muted/40 rounded" />
        <div className="h-3 w-64 bg-muted/20 rounded" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 bg-muted/30 rounded" />
              <div className="h-10 bg-muted/20 rounded-xl" />
            </div>
          ))}
        </div>
      </div>

      <div className="kf-card p-6 space-y-4">
        <div className="h-5 w-36 bg-muted/40 rounded" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 bg-muted/30 rounded" />
              <div className="h-10 bg-muted/20 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
