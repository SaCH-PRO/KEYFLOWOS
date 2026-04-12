"use client";

import React from "react";

export const StoreSkeleton = React.memo(function StoreSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08) 0%, hsl(var(--kf-accent2) / 0.05) 50%, hsl(var(--kf-card) / 0.4) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.1)",
        }}
      >
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-6 w-40 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
                  <div className="h-5 w-14 rounded-full" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
                </div>
                <div className="h-3.5 w-56 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-[140px] rounded-full" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
              <div className="h-9 w-24 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl px-4 py-3 flex items-center gap-3"
                style={{
                  background: "hsl(var(--kf-accent1) / 0.04)",
                  border: "1px solid hsl(var(--kf-border) / 0.1)",
                  animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
                }}
              >
                <div className="w-9 h-9 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
                <div className="space-y-1.5">
                  <div className="h-5 w-8 rounded" style={{ background: "hsl(var(--kf-muted) / 0.2)" }} />
                  <div className="h-3 w-16 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="flex gap-1 p-1 rounded-xl"
        style={{ background: "hsl(var(--kf-muted) / 0.06)", border: "1px solid hsl(var(--kf-border) / 0.08)" }}
      >
        {["My Store", "Orders"].map((tab, i) => (
          <div
            key={tab}
            className="flex-1 h-10 rounded-lg"
            style={{
              background: "hsl(var(--kf-muted) / 0.1)",
              animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-6 h-6 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
            <div className="h-3 w-12 rounded" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
            <div className="flex-1 h-px" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl p-4 flex items-center gap-3"
                style={{
                  background: "hsl(var(--kf-card) / 0.4)",
                  border: "1px solid hsl(var(--kf-border) / 0.1)",
                  animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
                }}
              >
                <div className="w-9 h-9 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-28 rounded" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
                  <div className="h-3 w-40 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-6 h-6 rounded-lg" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
            <div className="h-3 w-14 rounded" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
            <div className="flex-1 h-px" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl p-4 flex items-center gap-3"
                style={{
                  background: "hsl(var(--kf-card) / 0.4)",
                  border: "1px solid hsl(var(--kf-border) / 0.1)",
                  animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
                }}
              >
                <div className="w-9 h-9 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-24 rounded" style={{ background: "hsl(var(--kf-muted) / 0.15)" }} />
                  <div className="h-3 w-32 rounded" style={{ background: "hsl(var(--kf-muted) / 0.1)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
