"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Bell, Sparkles, List, Plus, Brain, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useSwipeTabs } from "@/hooks/use-swipe-tabs";
import {
  TemporalFlowEvent,
  TemporalFlowListParams,
  getTemporalFlowEvents,
  getTemporalFlowReminders,
  createTemporalFlowEvent,
} from "@/lib/api/temporal-flow";
import { getStoredBusinessId } from "@/lib/workspace";
import { Surface, Button, Input, Select, Textarea } from "@/components/ui-v2";
import { TemporalFlowFilters } from "./temporal-flow-filters";
import { TemporalFlowTimeline } from "./temporal-flow-timeline";
import { TemporalFlowCalendar } from "./temporal-flow-calendar";
import { TemporalFlowReminders } from "./temporal-flow-reminders";
import { TemporalFlowKeyAnalysis } from "./temporal-flow-key-analysis";
import { TemporalFlowMemoryTab } from "./temporal-flow-memory-tab";
import { TemporalFlowHero } from "./temporal-flow-hero";
import { TemporalFlowBriefing } from "./temporal-flow-briefing";

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
  const [loading, setLoading] = useState(() => !!businessId);
  const [filters, setFilters] = useState<TemporalFlowListParams>({ limit: 100 });
  const [showCreate, setShowCreate] = useState(false);
  const [pullOffset, setPullOffset] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const pullStart = useRef<{ y: number; scrollTop: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const fetchEvents = useCallback(async () => {
    if (!businessId) return;
    const { data } = await getTemporalFlowEvents(businessId, filters);
    setEvents(data ?? []);
    setLoading(false);
  }, [businessId, filters]);

  const fetchReminders = useCallback(async () => {
    if (!businessId) return;
    const { data } = await getTemporalFlowReminders(businessId);
    setReminders(data ?? []);
  }, [businessId]);

  useEffect(() => {
    if (activeTab === "timeline" || activeTab === "analysis") {
      Promise.resolve().then(() => fetchEvents());
    }
    if (activeTab === "reminders") {
      Promise.resolve().then(() => fetchReminders());
    }
  }, [activeTab, fetchEvents, fetchReminders]);

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

  const tabIds = TABS.map((t) => t.id);
  const { swipeHandlers } = useSwipeTabs({
    tabs: tabIds,
    activeTab,
    onTabChange: (id) => setActiveTab(id as TabId),
  });

  const applyTimeRange = (range: "today" | "week" | "month" | "all") => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (range === "today") {
      setFilters({ ...filters, from: startOfDay.toISOString(), to: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000).toISOString() });
    } else if (range === "week") {
      setFilters({ ...filters, from: startOfDay.toISOString(), to: new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() });
    } else if (range === "month") {
      setFilters({ ...filters, from: startOfDay.toISOString(), to: new Date(startOfDay.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() });
    } else {
      const { from: _from, to: _to, ...rest } = filters;
      setFilters(rest);
    }
  };

  const PULL_THRESHOLD = 80;

  const onPullStart = (e: React.TouchEvent) => {
    swipeHandlers.onTouchStart(e);
    const container = contentRef.current;
    if (!container) return;
    const touch = e.touches[0];
    pullStart.current = { y: touch.clientY, scrollTop: container.scrollTop };
  };

  const onPullMove = (e: React.TouchEvent) => {
    if (!pullStart.current) return;
    const container = contentRef.current;
    if (!container) return;
    if (pullStart.current.scrollTop > 0 || pullStart.current.y > 120) return;
    const dy = e.touches[0].clientY - pullStart.current.y;
    if (dy > 0) {
      setIsPulling(true);
      setPullOffset(Math.min(dy * 0.5, PULL_THRESHOLD + 20));
    }
  };

  const onPullEnd = async (e: React.TouchEvent) => {
    swipeHandlers.onTouchEnd(e);
    if (!pullStart.current) return;
    pullStart.current = null;
    if (pullOffset > PULL_THRESHOLD) {
      setPullOffset(PULL_THRESHOLD);
      await Promise.all([fetchEvents(), fetchReminders()]);
    }
    setIsPulling(false);
    setPullOffset(0);
  };

  return (
    <div className="space-y-4">
      {(activeTab === "timeline" || activeTab === "analysis") && <TemporalFlowHero events={events} />}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <Surface
          variant="default"
          className="flex items-center gap-1 p-1 w-fit"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[40px]",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {isActive && (
                  <span
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background: "hsl(var(--kf-accent1) / 0.08)",
                      border: "1px solid hsl(var(--kf-accent1) / 0.15)",
                    }}
                  />
                )}
                <Icon className="w-3.5 h-3.5 relative z-10" aria-hidden="true" />
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </Surface>
        <Button variant="primary" onClick={() => setShowCreate(true)} leftIcon={<Plus className="w-4 h-4" />}>
          Add event
        </Button>
      </div>

      <div
        ref={contentRef}
        {...swipeHandlers}
        onTouchStart={onPullStart}
        onTouchMove={onPullMove}
        onTouchEnd={onPullEnd}
        className="relative min-h-[200px]"
      >
        <div
          className={cn(
            "absolute left-0 right-0 z-10 flex items-center justify-center transition-opacity duration-200 pointer-events-none",
            isPulling ? "opacity-100" : "opacity-0"
          )}
          style={{ top: pullOffset - 48 }}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/90 border border-border/60 shadow-sm text-xs text-muted-foreground">
            <Loader2 className={cn("w-3.5 h-3.5", pullOffset > PULL_THRESHOLD && "animate-spin")} />
            {pullOffset > PULL_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {activeTab === "timeline" && (
            <motion.div
              key="timeline"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              <TemporalFlowBriefing events={events} />
              <TemporalFlowFilters filters={filters} onChange={setFilters} onTimeRange={applyTimeRange} />
              <TemporalFlowTimeline events={events} loading={loading} onRefresh={fetchEvents} />
            </motion.div>
          )}

          {activeTab === "calendar" && (
            <motion.div
              key="calendar"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18 }}
            >
              <TemporalFlowCalendar />
            </motion.div>
          )}

          {activeTab === "reminders" && (
            <motion.div
              key="reminders"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18 }}
            >
              <TemporalFlowReminders reminders={reminders} loading={loading} onRefresh={fetchReminders} />
            </motion.div>
          )}

          {activeTab === "analysis" && (
            <motion.div
              key="analysis"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18 }}
              className="space-y-4"
            >
              <TemporalFlowTimeline events={events.slice(0, 20)} loading={loading} onRefresh={fetchEvents} />
              <TemporalFlowKeyAnalysis />
            </motion.div>
          )}

          {activeTab === "memory" && (
            <motion.div
              key="memory"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18 }}
            >
              <TemporalFlowMemoryTab />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Surface className="w-full max-w-md p-5 space-y-4 shadow-2xl">
            <h3 className="font-display text-title font-semibold text-foreground">Add Temporal Event</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <Input name="title" required placeholder="Title" />
              <Input name="type" placeholder="Type (e.g. manual.follow_up)" />
              <Textarea name="summary" placeholder="Summary" rows={3} />
              <Select
                name="importance"
                defaultValue="NORMAL"
                options={[
                  { value: "LOW", label: "Low" },
                  { value: "NORMAL", label: "Normal" },
                  { value: "HIGH", label: "High" },
                  { value: "CRITICAL", label: "Critical" },
                ]}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input name="startsAt" type="datetime-local" label="Starts at" />
                <Input name="reminderAt" type="datetime-local" label="Reminder at" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="soft" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save event
                </Button>
              </div>
            </form>
          </Surface>
        </div>
      )}
    </div>
  );
}
