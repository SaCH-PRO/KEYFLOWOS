"use client";

import { useEffect, useState } from "react";
import { Clock, CalendarDays, Bell, Sparkles, List, Plus, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TemporalFlowEvent,
  TemporalFlowListParams,
  getTemporalFlowEvents,
  getTemporalFlowReminders,
  createTemporalFlowEvent,
} from "@/lib/api/temporal-flow";
import { getStoredBusinessId } from "@/lib/workspace";
import { TemporalFlowFilters } from "./temporal-flow-filters";
import { TemporalFlowTimeline } from "./temporal-flow-timeline";
import { TemporalFlowCalendar } from "./temporal-flow-calendar";
import { TemporalFlowReminders } from "./temporal-flow-reminders";
import { TemporalFlowKeyAnalysis } from "./temporal-flow-key-analysis";
import { TemporalFlowMemoryTab } from "./temporal-flow-memory-tab";

type TabId = "timeline" | "calendar" | "reminders" | "analysis" | "memory";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "timeline", label: "Timeline", icon: List },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "reminders", label: "Reminders", icon: Bell },
  { id: "analysis", label: "KEY Analysis", icon: Sparkles },
  { id: "memory", label: "Memory", icon: Brain },
];

export function TemporalFlowShell() {
  const businessId = getStoredBusinessId() ?? "";
  const [activeTab, setActiveTab] = useState<TabId>("timeline");
  const [events, setEvents] = useState<TemporalFlowEvent[]>([]);
  const [reminders, setReminders] = useState<TemporalFlowEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<TemporalFlowListParams>({ limit: 100 });
  const [showCreate, setShowCreate] = useState(false);

  const fetchEvents = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data } = await getTemporalFlowEvents(businessId, filters);
    setEvents(data ?? []);
    setLoading(false);
  };

  const fetchReminders = async () => {
    if (!businessId) return;
    const { data } = await getTemporalFlowReminders(businessId);
    setReminders(data ?? []);
  };

  useEffect(() => {
    if (activeTab === "timeline" || activeTab === "analysis") {
      fetchEvents();
    }
    if (activeTab === "reminders") {
      fetchReminders();
    }
  }, [activeTab, filters, businessId]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!businessId) return;
    const form = new FormData(e.currentTarget);
    await createTemporalFlowEvent(businessId, {
      source: "MANUAL",
      type: (form.get("type") as string) || "manual.event",
      title: (form.get("title") as string) || "Manual event",
      summary: (form.get("summary") as string) || undefined,
      importance: (form.get("importance") as string) || "NORMAL",
      startsAt: (form.get("startsAt") as string) || undefined,
      reminderAt: (form.get("reminderAt") as string) || undefined,
    });
    setShowCreate(false);
    fetchEvents();
    fetchReminders();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/50 w-fit">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  isActive ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground w-fit"
        >
          <Plus className="w-3.5 h-3.5" />
          Add event
        </button>
      </div>

      {activeTab === "timeline" && (
        <>
          <TemporalFlowFilters filters={filters} onChange={setFilters} />
          <TemporalFlowTimeline events={events} loading={loading} onRefresh={fetchEvents} />
        </>
      )}

      {activeTab === "calendar" && <TemporalFlowCalendar />}

      {activeTab === "reminders" && (
        <TemporalFlowReminders reminders={reminders} loading={loading} onRefresh={fetchReminders} />
      )}

      {activeTab === "analysis" && (
        <>
          <TemporalFlowTimeline events={events.slice(0, 20)} loading={loading} onRefresh={fetchEvents} />
          <TemporalFlowKeyAnalysis />
        </>
      )}

      {activeTab === "memory" && <TemporalFlowMemoryTab />}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-5 space-y-4 shadow-lg">
            <h3 className="font-semibold">Add Temporal Event</h3>
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                name="title"
                required
                placeholder="Title"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <input
                name="type"
                placeholder="Type (e.g. manual.follow_up)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <textarea
                name="summary"
                placeholder="Summary"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                rows={3}
              />
              <select
                name="importance"
                defaultValue="NORMAL"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Starts at</label>
                  <input
                    name="startsAt"
                    type="datetime-local"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Reminder at</label>
                  <input
                    name="reminderAt"
                    type="datetime-local"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground"
                >
                  Save event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
