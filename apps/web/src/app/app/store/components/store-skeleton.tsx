"use client";

import React from "react";
import { Surface } from "@/components/ui-v2/surface";

function SkeletonAccordionRow({ width = "w-28" }: { width?: string }) {
  return (
    <Surface variant="default" className="rounded-xl px-4 py-3.5 flex items-center gap-3 border-border/40">
      <div className="w-9 h-9 rounded-lg bg-muted/15" />
      <div className="flex-1 space-y-1.5">
        <div className={`h-4 ${width} rounded bg-muted/15`} />
        <div className="h-3 w-40 rounded bg-muted/10" />
      </div>
      <div className="w-4 h-4 rounded bg-muted/10" />
    </Surface>
  );
}

export const StoreSkeleton = React.memo(function StoreSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <Surface
        variant="accent"
        className="relative overflow-hidden"
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-primary/5" />
        </div>

        <div className="relative px-6 pt-6 pb-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-4">
              <div className="h-[52px] w-[52px] rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/10" />
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <div className="h-6 w-36 rounded-lg bg-muted/15" />
                  <div className="h-5 w-12 rounded-full bg-muted/10" />
                </div>
                <div className="h-3 w-48 rounded bg-muted/10" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-[140px] rounded-full bg-muted/10" />
              <div className="h-9 w-24 rounded-xl bg-muted/10" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Surface
                key={i}
                variant="default"
                className="rounded-xl px-3 py-3 border-border/10"
              >
                <div className="h-5 w-8 rounded mb-1 bg-muted/15" />
                <div className="h-3 w-14 rounded bg-muted/10" />
              </Surface>
            ))}
          </div>

          <div className="mt-4">
            <div className="h-3 w-20 rounded mb-2 bg-muted/10" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Surface
                  key={i}
                  variant="default"
                  className="flex-shrink-0 w-[100px] rounded-xl overflow-hidden border-border/20"
                >
                  <div className="h-[64px] bg-muted/10" />
                  <div className="px-2 py-1.5 space-y-1">
                    <div className="h-3 w-14 rounded bg-muted/10" />
                    <div className="h-2.5 w-10 rounded bg-muted/10" />
                  </div>
                </Surface>
              ))}
            </div>
          </div>
        </div>
      </Surface>

      <Surface variant="default" className="p-1 border-border/10 flex items-center gap-1">
        {["My Store", "Orders"].map((tab) => (
          <div key={tab} className="flex-1 h-10 rounded-lg bg-muted/10" />
        ))}
      </Surface>

      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-5 h-px bg-primary/10" />
            <div className="h-3 w-12 rounded bg-muted/10" />
          </div>
          <div className="space-y-1.5">
            <SkeletonAccordionRow width="w-32" />
            <SkeletonAccordionRow width="w-20" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-5 h-px bg-primary/10" />
            <div className="h-3 w-14 rounded bg-muted/10" />
          </div>
          <div className="space-y-1.5">
            <SkeletonAccordionRow width="w-24" />
            <SkeletonAccordionRow width="w-28" />
            <SkeletonAccordionRow width="w-32" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-5 h-px bg-primary/10" />
            <div className="h-3 w-16 rounded bg-muted/10" />
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
