"use client";

import { ArrowRight, BarChart3 } from "lucide-react";
import Link from "next/link";

interface ActionItem {
  label: string;
  value: string | number;
  color?: string;
  urgent?: boolean;
}

interface ReportLinkStripProps {
  moduleName: string;
  reportTab: string;
  actions: ActionItem[];
  children?: React.ReactNode;
}

export function ReportLinkStrip({ moduleName, reportTab, actions, children }: ReportLinkStripProps) {
  return (
    <div className="space-y-4">
      {actions.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((a, i) => (
            <div
              key={i}
              className="kf-card p-4 flex items-center gap-3"
              style={a.urgent ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold"
                style={{
                  background: `hsl(var(${a.color || "--kf-accent1"}) / 0.12)`,
                  color: `hsl(var(${a.color || "--kf-accent1"}))`,
                }}
              >
                {a.value}
              </div>
              <span className="text-sm text-muted-foreground">{a.label}</span>
            </div>
          ))}
        </div>
      )}

      {children}

      <Link
        href={`/app/reports?tab=${reportTab}`}
        className="kf-card p-4 flex items-center justify-between gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
          >
            <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <span className="text-sm font-medium">View Full {moduleName} Report</span>
            <p className="text-xs text-muted-foreground">Deep analytics, trends, and AI insights</p>
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground" />
      </Link>
    </div>
  );
}
