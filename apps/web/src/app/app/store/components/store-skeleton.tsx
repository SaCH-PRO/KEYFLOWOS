"use client";

import React from "react";

export const StoreSkeleton = React.memo(function StoreSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-36 rounded-lg bg-white/[0.06]" />
          <div className="h-4 w-56 rounded-lg bg-white/[0.04]" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-24 rounded-xl bg-white/[0.06]" />
          <div className="h-10 w-32 rounded-xl bg-white/[0.06]" />
        </div>
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
        {["Overview", "Customize", "Products", "Hours", "Settings"].map((tab, i) => (
          <div
            key={tab}
            className="h-10 rounded-t-xl bg-white/[0.04] border-x border-t border-transparent"
            style={{
              width: i === 0 ? "110px" : i === 1 ? "120px" : i === 2 ? "100px" : i === 3 ? "90px" : "105px",
              animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>
      <div className="h-px bg-border/40" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="kf-card border border-border/20 rounded-xl p-4 space-y-3"
            style={{ animation: `pulse 1.5s ease-in-out ${i * 0.12}s infinite` }}
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-white/[0.06]" />
              <div className="space-y-1.5 flex-1">
                <div className="h-4 w-32 rounded bg-white/[0.07]" />
                <div className="h-3 w-48 rounded bg-white/[0.04]" />
              </div>
            </div>
            <div className="h-3 w-full rounded bg-white/[0.03]" />
            <div className="h-3 w-3/4 rounded bg-white/[0.03]" />
          </div>
        ))}
      </div>
    </div>
  );
});
