"use client";

import React from "react";

function SkeletonAccordionRow({ width = "w-28" }: { width?: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3.5 flex items-center gap-3"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.4)",
      }}
    >
      <div className="w-9 h-9 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
      <div className="flex-1 space-y-1.5">
        <div className={`h-4 ${width} rounded`} style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
        <div className="h-3 w-40 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
      </div>
      <div className="w-4 h-4 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
    </div>
  );
}

export const StoreSkeleton = React.memo(function StoreSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.1) 0%, hsl(var(--kf-accent2) / 0.05) 50%, hsl(var(--kf-card)) 100%)",
          border: "1px solid hsl(var(--kf-accent1) / 0.12)",
        }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full" style={{ background: "radial-gradient(circle, hsl(var(--kf-accent1) / 0.06), transparent 60%)" }} />
        </div>

        <div className="relative px-6 pt-6 pb-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-4">
              <div className="h-[52px] w-[52px] rounded-2xl" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.2), hsl(var(--kf-accent2) / 0.1))" }} />
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="h-6 w-36 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
                  <div className="h-5 w-12 rounded-full" style={{ background: "hsl(var(--kf-muted) / 0.12)" }} />
                </div>
                <div className="h-3 w-48 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-[140px] rounded-full" style={{ background: "hsl(var(--kf-muted) / 0.12)" }} />
              <div className="h-9 w-24 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.12)" }} />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl px-3 py-3"
                style={{ background: "hsl(var(--kf-accent1) / 0.04)", border: "1px solid hsl(var(--kf-border) / 0.08)" }}
              >
                <div className="h-5 w-8 rounded mb-1" style={{ background: "hsl(var(--kf-muted) / 0.18)" }} />
                <div className="h-3 w-14 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="h-3 w-20 rounded mb-2" style={{ background: "hsl(var(--kf-muted) / 0.08)" }} />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex-shrink-0 w-[100px] rounded-xl overflow-hidden" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.2)" }}>
                  <div className="h-[64px]" style={{ background: "hsl(var(--kf-muted) / 0.08)" }} />
                  <div className="px-2 py-1.5 space-y-1">
                    <div className="h-3 w-14 rounded" style={{ background: "hsl(var(--kf-muted) / 0.12)" }} />
                    <div className="h-2.5 w-10 rounded" style={{ background: "hsl(var(--kf-muted) / 0.08)" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.06)", border: "1px solid hsl(var(--kf-border) / 0.08)" }}>
        {["My Store", "Orders"].map((tab) => (
          <div key={tab} className="flex-1 h-10 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.08)" }} />
        ))}
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-5 h-px" style={{ background: "hsl(var(--kf-accent1) / 0.12)" }} />
            <div className="h-3 w-12 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
          </div>
          <div className="space-y-1.5">
            <SkeletonAccordionRow width="w-32" />
            <SkeletonAccordionRow width="w-20" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-5 h-px" style={{ background: "hsl(var(--kf-accent1) / 0.12)" }} />
            <div className="h-3 w-14 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
          </div>
          <div className="space-y-1.5">
            <SkeletonAccordionRow width="w-24" />
            <SkeletonAccordionRow width="w-28" />
            <SkeletonAccordionRow width="w-32" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-5 h-px" style={{ background: "hsl(var(--kf-accent1) / 0.12)" }} />
            <div className="h-3 w-16 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
          </div>
          <div className="space-y-1.5">
            <SkeletonAccordionRow width="w-28" />
            <SkeletonAccordionRow width="w-24" />
            <SkeletonAccordionRow width="w-20" />
            <SkeletonAccordionRow width="w-20" />
          </div>
        </div>
      </div>
    </div>
  );
});
