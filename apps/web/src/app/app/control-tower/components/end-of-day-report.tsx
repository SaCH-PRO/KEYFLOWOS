"use client";

import { useState, useEffect } from "react";
import {
  Moon,
  X,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Calendar,
  Users,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { fetchEodReport } from "@/lib/client";
import { toast } from "sonner";

function formatTTD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

interface EndOfDayReportProps {
  businessId: string;
}

export function EndOfDayReport({ businessId }: EndOfDayReportProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    date: string;
    events: number;
    revenueCollected: number;
    bookingsCompleted: number;
    contactsUpdated: number;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchEodReport(businessId);
      if (res.data) setData(res.data);
      setOpen(true);
    } catch {
      toast.error("Failed to load end-of-day report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={load}
        disabled={loading}
        className="flex items-center gap-1.5 h-9 px-3 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all min-h-[36px]"
        aria-label="Generate end-of-day report"
        title="End of Day Report"
      >
        <Moon className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">End of Day</span>
      </button>

      {open && data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold">End of Day Report</h3>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(data.date).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border/40 bg-background/50 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="p-1 rounded-md bg-emerald-500/10">
                      <DollarSign className="w-3 h-3 text-emerald-500" />
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Revenue</span>
                  </div>
                  <p className="text-lg font-bold">{formatTTD(data.revenueCollected)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {data.revenueCollected > 0 ? (
                      <span className="text-emerald-500 flex items-center gap-0.5">
                        <TrendingUp className="w-3 h-3" /> Collected today
                      </span>
                    ) : (
                      <span className="text-muted-foreground flex items-center gap-0.5">
                        <Minus className="w-3 h-3" /> No payments today
                      </span>
                    )}
                  </p>
                </div>

                <div className="rounded-lg border border-border/40 bg-background/50 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="p-1 rounded-md bg-blue-500/10">
                      <Calendar className="w-3 h-3 text-blue-500" />
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Bookings</span>
                  </div>
                  <p className="text-lg font-bold">{data.bookingsCompleted}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {data.bookingsCompleted > 0 ? "New today" : "No new bookings"}
                  </p>
                </div>

                <div className="rounded-lg border border-border/40 bg-background/50 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="p-1 rounded-md bg-violet-500/10">
                      <Users className="w-3 h-3 text-violet-500" />
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Contacts</span>
                  </div>
                  <p className="text-lg font-bold">{data.contactsUpdated}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {data.contactsUpdated > 0 ? "Updated today" : "No changes"}
                  </p>
                </div>

                <div className="rounded-lg border border-border/40 bg-background/50 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="p-1 rounded-md bg-amber-500/10">
                      <Activity className="w-3 h-3 text-amber-500" />
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Activity</span>
                  </div>
                  <p className="text-lg font-bold">{data.events}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {data.events > 0 ? "Events recorded" : "Quiet day"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
                <h4 className="text-xs font-medium mb-2">Daily Snapshot</h4>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Activity level</span>
                    <span className="font-medium text-foreground">
                      {data.events > 20 ? "High" : data.events > 5 ? "Normal" : "Low"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Revenue performance</span>
                    <span className="font-medium text-foreground">
                      {data.revenueCollected > 0 ? "Positive" : "No revenue"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Contact engagement</span>
                    <span className="font-medium text-foreground">
                      {data.contactsUpdated > 0 ? "Active" : "Quiet"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
