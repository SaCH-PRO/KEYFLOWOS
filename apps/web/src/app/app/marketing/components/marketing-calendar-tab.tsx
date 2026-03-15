"use client";

import { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  CalendarDays,
  Clock,
  Mail,
  PenSquare,
  Send,
} from "lucide-react";
import type { EmailCampaign, SocialPost } from "@/lib/client";

type CalendarEntry = {
  id: string;
  type: "campaign" | "post";
  title: string;
  date: Date;
  status: string;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getEntryStyle(type: "campaign" | "post", status: string) {
  if (type === "campaign") {
    switch (status) {
      case "SENT":
        return { bg: "bg-emerald-500/20", border: "border-emerald-500/40", text: "text-emerald-400", dot: "bg-emerald-400" };
      case "SCHEDULED":
        return { bg: "bg-blue-500/20", border: "border-blue-500/40", text: "text-blue-400", dot: "bg-blue-400" };
      default:
        return { bg: "bg-slate-500/20", border: "border-slate-500/40", text: "text-slate-400", dot: "bg-slate-400" };
    }
  }
  switch (status) {
    case "POSTED":
      return { bg: "bg-emerald-500/20", border: "border-emerald-500/40", text: "text-emerald-400", dot: "bg-emerald-400" };
    case "SCHEDULED":
      return { bg: "bg-[hsl(var(--kf-accent2))]/20", border: "border-[hsl(var(--kf-accent2))]/40", text: "text-[hsl(var(--kf-accent2))]", dot: "bg-[hsl(var(--kf-accent2))]" };
    case "DRAFT":
      return { bg: "bg-slate-500/20", border: "border-slate-500/40", text: "text-slate-400", dot: "bg-slate-400" };
    default:
      return { bg: "bg-amber-500/20", border: "border-amber-500/40", text: "text-amber-400", dot: "bg-amber-400" };
  }
}

interface MarketingCalendarTabProps {
  campaigns: EmailCampaign[];
  socialPosts: SocialPost[];
  onTabChange: (tab: string) => void;
}

export function MarketingCalendarTab({ campaigns, socialPosts, onTabChange }: MarketingCalendarTabProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const [filter, setFilter] = useState<"all" | "campaigns" | "posts">("all");

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();
  const todayStr = toLocalDateStr(today);

  const entries = useMemo<CalendarEntry[]>(() => {
    const items: CalendarEntry[] = [];
    if (filter !== "posts") {
      campaigns.forEach((c) => {
        const d = c.sentAt || c.scheduledAt || c.createdAt;
        if (!d) return;
        items.push({
          id: `campaign-${c.id}`,
          type: "campaign",
          title: c.name || "Untitled Campaign",
          date: new Date(d),
          status: c.status,
        });
      });
    }
    if (filter !== "campaigns") {
      socialPosts.forEach((p) => {
        const d = p.postedAt || p.publishedAt || p.scheduledAt || p.scheduledFor || p.createdAt;
        if (!d) return;
        items.push({
          id: `post-${p.id}`,
          type: "post",
          title: p.content?.slice(0, 40) || "Untitled Post",
          date: new Date(d),
          status: p.status,
        });
      });
    }
    return items;
  }, [campaigns, socialPosts, filter]);

  const entriesByDate = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    entries.forEach((e) => {
      const key = toLocalDateStr(e.date);
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.date.getTime() - b.date.getTime()));
    return map;
  }, [entries]);

  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prev = useCallback(() => {
    if (view === "month") setCurrentDate(new Date(year, month - 1, 1));
    else setCurrentDate(new Date(currentDate.getTime() - 7 * 86400000));
  }, [view, year, month, currentDate]);

  const next = useCallback(() => {
    if (view === "month") setCurrentDate(new Date(year, month + 1, 1));
    else setCurrentDate(new Date(currentDate.getTime() + 7 * 86400000));
  }, [view, year, month, currentDate]);

  const titleText = view === "month"
    ? `${MONTHS[month]} ${year}`
    : `Week of ${weekDays[0].toLocaleDateString("en-TT", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-TT", { month: "short", day: "numeric", year: "numeric" })}`;

  const scheduledCount = entries.filter((e) => e.status === "SCHEDULED").length;
  const sentCount = entries.filter((e) => e.status === "SENT" || e.status === "POSTED").length;

  const VIEWS: { key: "month" | "week"; label: string; icon: React.ElementType }[] = [
    { key: "month", label: "Month", icon: Calendar },
    { key: "week", label: "Week", icon: CalendarDays },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs text-muted-foreground">{scheduledCount} scheduled</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/20 border border-border/30">
          <Send className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs text-muted-foreground">{sentCount} sent/posted</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{titleText}</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
            {VIEWS.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`p-1.5 text-[10px] px-2 transition-colors flex items-center gap-1 ${view === v.key ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
                  style={view === v.key ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
                >
                  <Icon className="w-3 h-3" /> {v.label}
                </button>
              );
            })}
          </div>
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
            {(["all", "campaigns", "posts"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`p-1.5 text-[10px] px-2 transition-colors capitalize ${filter === f ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
                style={filter === f ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={prev} className="kf-btn-secondary w-7 h-7 flex items-center justify-center !p-0">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="kf-btn-secondary text-[10px] !px-2 !py-1">
              Today
            </button>
            <button onClick={next} className="kf-btn-secondary w-7 h-7 flex items-center justify-center !p-0">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {view === "month" && (
        <div className="overflow-x-auto -mx-4 px-4 pb-1">
          <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden min-w-[500px]" style={{ border: "1px solid hsl(var(--kf-border))", background: "hsl(var(--kf-border))" }}>
            {DAYS.map((d) => (
              <div key={d} className="px-1 py-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground font-medium" style={{ background: "hsl(var(--kf-muted))" }}>
                {d}
              </div>
            ))}
            {cells.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} className="min-h-[80px]" style={{ background: "hsl(var(--kf-background))" }} />;
              }
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEntries = entriesByDate[dateStr] || [];
              const isToday = dateStr === todayStr;
              const campaignCount = dayEntries.filter((e) => e.type === "campaign").length;
              const postCount = dayEntries.filter((e) => e.type === "post").length;

              return (
                <div
                  key={dateStr}
                  className="min-h-[80px] p-1.5 relative group transition-colors"
                  style={{
                    background: isToday ? "hsl(var(--kf-accent1) / 0.05)" : "hsl(var(--kf-card))",
                    ...(isToday ? { boxShadow: "inset 0 0 0 1px hsl(var(--kf-accent1) / 0.5)" } : {}),
                  }}
                >
                  <span className={`text-[11px] font-medium ${isToday ? "text-[hsl(var(--kf-accent1))] font-bold" : "text-muted-foreground"}`}>
                    {day}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayEntries.slice(0, 3).map((entry) => {
                      const sc = getEntryStyle(entry.type, entry.status);
                      return (
                        <div
                          key={entry.id}
                          className={`w-full flex items-center gap-1 rounded-md px-1 py-0.5 text-[9px] ${sc.bg} border ${sc.border} ${sc.text} truncate`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                          {entry.type === "campaign" ? <Mail className="w-2.5 h-2.5 flex-shrink-0" /> : <PenSquare className="w-2.5 h-2.5 flex-shrink-0" />}
                          <span className="truncate">{entry.title.slice(0, 16)}</span>
                        </div>
                      );
                    })}
                    {dayEntries.length > 3 && (
                      <span className="text-[9px] text-muted-foreground pl-1">+{dayEntries.length - 3} more</span>
                    )}
                  </div>
                  {(campaignCount > 0 || postCount > 0) && (
                    <div className="absolute bottom-1 right-1 flex gap-0.5">
                      {campaignCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent1))]/60" title={`${campaignCount} campaign(s)`} />}
                      {postCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent2))]/60" title={`${postCount} post(s)`} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="overflow-x-auto -mx-4 px-4 pb-1">
          <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden min-w-[600px]" style={{ border: "1px solid hsl(var(--kf-border))", background: "hsl(var(--kf-border))" }}>
            {weekDays.map((wd) => {
              const dateStr = toLocalDateStr(wd);
              const dayEntries = entriesByDate[dateStr] || [];
              const isToday = dateStr === todayStr;

              return (
                <div
                  key={dateStr}
                  className="min-h-[200px] transition-colors"
                  style={{
                    background: isToday ? "hsl(var(--kf-accent1) / 0.05)" : "hsl(var(--kf-card))",
                    ...(isToday ? { boxShadow: "inset 0 0 0 1px hsl(var(--kf-accent1) / 0.5)" } : {}),
                  }}
                >
                  <div className="px-2 py-2 text-center border-b" style={{ borderColor: "hsl(var(--kf-border))" }}>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {DAYS[wd.getDay()]}
                    </span>
                    <span className={`block text-sm font-semibold ${isToday ? "text-[hsl(var(--kf-accent1))]" : ""}`}>
                      {wd.getDate()}
                    </span>
                  </div>
                  <div className="p-1.5 space-y-1">
                    {dayEntries.map((entry) => {
                      const sc = getEntryStyle(entry.type, entry.status);
                      return (
                        <div
                          key={entry.id}
                          className={`flex items-start gap-1 rounded-md px-1.5 py-1 text-[10px] ${sc.bg} border ${sc.border} ${sc.text}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${sc.dot}`} />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{entry.title.slice(0, 20)}</p>
                            <p className="text-[9px] opacity-70">
                              {entry.date.toLocaleTimeString("en-TT", { hour: "numeric", minute: "2-digit", hour12: true })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {dayEntries.length === 0 && (
                      <p className="text-[9px] text-muted-foreground/40 text-center py-4">No items</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {entries.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="kf-card p-8 text-center"
        >
          <Calendar className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-sm font-semibold mb-1">No scheduled content</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Create campaigns or social posts to see them on the calendar.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => onTabChange("create")}
              className="kf-btn-primary text-xs !px-3 !py-1.5 flex items-center gap-1.5"
            >
              <Mail className="w-3.5 h-3.5" /> Create Campaign
            </button>
            <button
              onClick={() => onTabChange("create")}
              className="kf-btn-secondary text-xs !px-3 !py-1.5 flex items-center gap-1.5"
            >
              <PenSquare className="w-3.5 h-3.5" /> New Post
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
