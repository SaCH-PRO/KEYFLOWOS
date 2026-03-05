"use client";

export function BookingsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-36 rounded-lg bg-white/[0.06]" />
          <div className="h-4 w-56 rounded-lg bg-white/[0.04]" />
        </div>
        <div className="h-10 w-32 rounded-xl bg-white/[0.06]" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="kf-card border border-border/30 rounded-xl p-4 space-y-2"
            style={{ animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite` }}
          >
            <div className="h-3 w-20 rounded bg-white/[0.06]" />
            <div className="h-6 w-12 rounded bg-white/[0.08]" />
          </div>
        ))}
      </div>

      <div className="flex gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-t-xl bg-white/[0.04] border-x border-t border-transparent"
            style={{
              width: i === 0 ? "120px" : i === 1 ? "110px" : "100px",
              animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>
      <div className="h-px bg-border/40" />

      <div className="kf-card border border-border/30 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 w-20 rounded-lg bg-white/[0.05]" />
            ))}
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-24 rounded-lg bg-white/[0.05]" />
            <div className="h-8 w-8 rounded-lg bg-white/[0.05]" />
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-border/20 rounded-xl overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="bg-card p-2 min-h-[80px] space-y-1">
              <div className="h-3 w-8 rounded bg-white/[0.06] mx-auto" />
              <div className="h-5 w-5 rounded-full bg-white/[0.04] mx-auto" />
              {i % 3 === 0 && (
                <div
                  className="h-5 w-full rounded bg-white/[0.04] mt-2"
                  style={{ animation: `pulse 1.5s ease-in-out ${i * 0.15}s infinite` }}
                />
              )}
              {i % 2 === 0 && (
                <div
                  className="h-5 w-full rounded bg-white/[0.03] mt-1"
                  style={{ animation: `pulse 1.5s ease-in-out ${(i + 1) * 0.15}s infinite` }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="kf-card border border-border/20 rounded-xl p-3 flex items-center gap-3"
            style={{ animation: `pulse 1.5s ease-in-out ${i * 0.12}s infinite` }}
          >
            <div className="w-10 h-10 rounded-full bg-white/[0.06]" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-32 rounded bg-white/[0.07]" />
              <div className="h-3 w-48 rounded bg-white/[0.04]" />
            </div>
            <div className="h-6 w-20 rounded-full bg-white/[0.05]" />
          </div>
        ))}
      </div>
    </div>
  );
}
