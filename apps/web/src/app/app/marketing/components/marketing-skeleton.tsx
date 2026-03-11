"use client";

import React from "react";

function SkeletonBlock({
  className = "",
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={`rounded-lg ${className}`}
      style={{
        background: "hsl(var(--kf-muted) / 0.5)",
        animation: `pulse 1.5s ease-in-out ${delay}s infinite`,
      }}
    />
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <SkeletonBlock className="h-7 w-36" />
        <SkeletonBlock className="h-4 w-56" delay={0.05} />
      </div>
      <SkeletonBlock className="h-10 w-32 rounded-xl" delay={0.1} />
    </div>
  );
}

function KpiStripSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="kf-card rounded-xl p-4 space-y-2"
          style={{
            borderColor: "hsl(var(--kf-border) / 0.3)",
            animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
          }}
        >
          <SkeletonBlock className="h-3 w-20" delay={i * 0.1} />
          <SkeletonBlock className="h-6 w-12" delay={i * 0.1 + 0.05} />
        </div>
      ))}
    </div>
  );
}

function TabsSkeleton() {
  const tabWidths = [120, 100, 110, 100];
  return (
    <>
      <div className="flex gap-1">
        {tabWidths.map((w, i) => (
          <div
            key={i}
            className="h-10 rounded-t-xl"
            style={{
              width: `${w}px`,
              background: "hsl(var(--kf-muted) / 0.3)",
              animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
      </div>
      <div style={{ height: 1, background: "hsl(var(--kf-border) / 0.4)" }} />
    </>
  );
}

function CampaignsTabSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="kf-card rounded-xl p-4 space-y-3"
          style={{
            borderColor: "hsl(var(--kf-border) / 0.2)",
            animation: `pulse 1.5s ease-in-out ${i * 0.12}s infinite`,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SkeletonBlock className="h-4 w-32" delay={i * 0.12} />
              <SkeletonBlock className="h-5 w-16 rounded-full" delay={i * 0.12 + 0.05} />
            </div>
            <SkeletonBlock className="h-6 w-20 rounded-full" delay={i * 0.12 + 0.08} />
          </div>
          <SkeletonBlock className="h-3 w-48" delay={i * 0.12 + 0.03} />
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-3 w-3 rounded-full" delay={i * 0.12} />
              <SkeletonBlock className="h-3 w-20" delay={i * 0.12 + 0.02} />
            </div>
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-3 w-3 rounded-full" delay={i * 0.12 + 0.04} />
              <SkeletonBlock className="h-3 w-16" delay={i * 0.12 + 0.06} />
            </div>
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-3 w-3 rounded-full" delay={i * 0.12 + 0.08} />
              <SkeletonBlock className="h-3 w-14" delay={i * 0.12 + 0.1} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SocialTabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-9 w-28 rounded-xl" />
        <SkeletonBlock className="h-9 flex-1 max-w-xs rounded-xl" delay={0.05} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="kf-card rounded-xl p-4 space-y-3"
            style={{
              borderColor: "hsl(var(--kf-border) / 0.2)",
              animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
            }}
          >
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-8 w-8 rounded-full" delay={i * 0.1} />
              <div className="flex-1 space-y-1">
                <SkeletonBlock className="h-3 w-24" delay={i * 0.1 + 0.03} />
                <SkeletonBlock className="h-2.5 w-16" delay={i * 0.1 + 0.06} />
              </div>
              <SkeletonBlock className="h-5 w-14 rounded-full" delay={i * 0.1 + 0.04} />
            </div>
            <SkeletonBlock className="h-20 w-full rounded-lg" delay={i * 0.1 + 0.05} />
            <div className="flex gap-4">
              <SkeletonBlock className="h-3 w-12" delay={i * 0.1 + 0.07} />
              <SkeletonBlock className="h-3 w-12" delay={i * 0.1 + 0.09} />
              <SkeletonBlock className="h-3 w-12" delay={i * 0.1 + 0.11} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormsTabSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="kf-card rounded-xl p-4 flex items-center gap-4"
          style={{
            borderColor: "hsl(var(--kf-border) / 0.2)",
            animation: `pulse 1.5s ease-in-out ${i * 0.12}s infinite`,
          }}
        >
          <div
            className="w-10 h-10 rounded-lg flex-shrink-0"
            style={{ background: "hsl(var(--kf-muted) / 0.5)" }}
          />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-36" delay={i * 0.12} />
            <SkeletonBlock className="h-3 w-52" delay={i * 0.12 + 0.04} />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right space-y-1">
              <SkeletonBlock className="h-5 w-10" delay={i * 0.12 + 0.06} />
              <SkeletonBlock className="h-2.5 w-16" delay={i * 0.12 + 0.08} />
            </div>
            <SkeletonBlock className="h-6 w-16 rounded-full" delay={i * 0.12 + 0.1} />
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightsTabSkeleton() {
  const barHeights = ["75%", "45%", "90%", "60%", "35%", "80%", "55%", "70%"];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="kf-card rounded-xl p-6 space-y-4"
          style={{ borderColor: "hsl(var(--kf-border) / 0.2)" }}
        >
          <SkeletonBlock className="h-4 w-32" />
          <div className="flex items-end gap-2 h-40">
            {barHeights.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-lg"
                style={{
                  height: h,
                  background: "hsl(var(--kf-muted) / 0.5)",
                  animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
                }}
              />
            ))}
          </div>
        </div>

        <div
          className="kf-card rounded-xl p-6 space-y-4"
          style={{ borderColor: "hsl(var(--kf-border) / 0.2)" }}
        >
          <SkeletonBlock className="h-4 w-28" delay={0.1} />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <SkeletonBlock className="h-3 w-20" delay={i * 0.08} />
                <div
                  className="flex-1 h-4 rounded-full overflow-hidden"
                  style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${[70, 55, 40, 25][i]}%`,
                      background: "hsl(var(--kf-muted) / 0.6)",
                      animation: `pulse 1.5s ease-in-out ${i * 0.12}s infinite`,
                    }}
                  />
                </div>
                <SkeletonBlock className="h-3 w-8" delay={i * 0.08 + 0.04} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="kf-card rounded-xl p-6 space-y-4"
        style={{ borderColor: "hsl(var(--kf-border) / 0.2)" }}
      >
        <SkeletonBlock className="h-4 w-36" delay={0.15} />
        <div className="h-48 flex items-end gap-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-lg"
              style={{
                height: `${30 + Math.sin(i * 0.8) * 40 + 20}%`,
                background: "hsl(var(--kf-muted) / 0.5)",
                animation: `pulse 1.5s ease-in-out ${i * 0.08}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export const MarketingSkeleton = React.memo(function MarketingSkeleton({
  activeTab = "campaigns",
}: {
  activeTab?: "campaigns" | "social" | "forms" | "insights";
}) {
  const tabContent = {
    campaigns: <CampaignsTabSkeleton />,
    social: <SocialTabSkeleton />,
    forms: <FormsTabSkeleton />,
    insights: <InsightsTabSkeleton />,
  };

  return (
    <div className="space-y-6 animate-pulse">
      <HeaderSkeleton />
      <KpiStripSkeleton />
      <TabsSkeleton />
      {tabContent[activeTab]}
    </div>
  );
});
