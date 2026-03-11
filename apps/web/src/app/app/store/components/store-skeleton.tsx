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
          <div className="h-9 w-[140px] rounded-full bg-white/[0.06]" />
          <div className="h-9 w-24 rounded-xl bg-white/[0.06]" />
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="lg:col-span-2 rounded-2xl p-5 space-y-4"
          style={{ background: "hsl(var(--kf-accent1)/0.04)", border: "1px solid hsl(var(--kf-accent1)/0.1)", animation: "pulse 1.5s ease-in-out infinite" }}
        >
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded bg-white/[0.08]" />
            <div className="h-4 w-32 rounded bg-white/[0.06]" />
          </div>
          <div className="h-12 rounded-xl bg-white/[0.04]" />
          <div className="flex gap-2">
            <div className="h-9 w-24 rounded-lg bg-white/[0.06]" />
            <div className="h-9 w-24 rounded-lg bg-white/[0.04]" />
            <div className="h-9 w-28 rounded-lg bg-white/[0.04]" />
          </div>
        </div>
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: "hsl(var(--kf-accent2)/0.04)", border: "1px solid hsl(var(--kf-accent2)/0.1)", animation: "pulse 1.5s ease-in-out 0.1s infinite" }}
        >
          <div className="flex items-center justify-between">
            <div className="h-4 w-36 rounded bg-white/[0.06]" />
            <div className="h-4 w-10 rounded bg-white/[0.08]" />
          </div>
          <div className="h-2 rounded-full bg-white/[0.06]" />
          <div className="grid grid-cols-2 gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-3.5 rounded bg-white/[0.04]" style={{ animation: `pulse 1.5s ease-in-out ${i * 0.05}s infinite` }} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl p-4 space-y-2"
            style={{
              background: "hsl(var(--kf-accent1)/0.04)",
              border: "1px solid hsl(var(--kf-border)/0.2)",
              animation: `pulse 1.5s ease-in-out ${i * 0.08}s infinite`,
            }}
          >
            <div className="h-4 w-4 rounded bg-white/[0.08]" />
            <div className="h-6 w-12 rounded bg-white/[0.06]" />
            <div className="h-3 w-20 rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>

      <div
        className="rounded-2xl p-6 space-y-4"
        style={{
          background: "hsl(var(--kf-accent1)/0.04)",
          border: "1px solid hsl(var(--kf-accent1)/0.1)",
          animation: "pulse 1.5s ease-in-out 0.2s infinite",
        }}
      >
        <div className="h-5 w-32 rounded bg-white/[0.06]" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-white/[0.04]" style={{ animation: `pulse 1.5s ease-in-out ${0.25 + i * 0.05}s infinite` }} />
        ))}
      </div>
    </div>
  );
});
