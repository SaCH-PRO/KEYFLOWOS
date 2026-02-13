"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Calendar, CalendarDays } from "lucide-react";
import type { SocialPost } from "@/lib/client";

type Props = {
  posts: SocialPost[];
  onSelectPost: (post: SocialPost) => void;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const HOURS = [8, 10, 12, 14, 16, 18, 20];

function getStatusColor(status: string) {
  switch (status) {
    case "POSTED": return { bg: "bg-emerald-500/20", border: "border-emerald-500/40", text: "text-emerald-400", dot: "bg-emerald-400" };
    case "SCHEDULED": return { bg: "bg-blue-500/20", border: "border-blue-500/40", text: "text-blue-400", dot: "bg-blue-400" };
    case "DRAFT": return { bg: "bg-slate-500/20", border: "border-slate-500/40", text: "text-slate-400", dot: "bg-slate-400" };
    default: return { bg: "bg-red-500/20", border: "border-red-500/40", text: "text-red-400", dot: "bg-red-400" };
  }
}

function formatHour(h: number) {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function ContentCalendar({ posts, onSelectPost }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const postsByDate = useMemo(() => {
    const map: Record<string, SocialPost[]> = {};
    posts.forEach((p) => {
      const d = p.postedAt || p.publishedAt || p.scheduledAt || p.scheduledFor || p.createdAt;
      const key = new Date(d).toISOString().split("T")[0];
      if (!map[key]) map[key] = [];
      map[key].push(p);
    });
    return map;
  }, [posts]);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

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

  function prev() {
    if (view === "month") setCurrentDate(new Date(year, month - 1, 1));
    else setCurrentDate(new Date(currentDate.getTime() - 7 * 86400000));
  }
  function next() {
    if (view === "month") setCurrentDate(new Date(year, month + 1, 1));
    else setCurrentDate(new Date(currentDate.getTime() + 7 * 86400000));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {view === "month"
            ? `${MONTHS[month]} ${year}`
            : `Week of ${weekDays[0].toLocaleDateString("en-TT", { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString("en-TT", { month: "short", day: "numeric", year: "numeric" })}`}
        </h3>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
            <button
              onClick={() => setView("month")}
              className={`p-1.5 text-[10px] px-2 transition-colors flex items-center gap-1 ${view === "month" ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
              style={view === "month" ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
            >
              <Calendar className="w-3 h-3" /> Month
            </button>
            <button
              onClick={() => setView("week")}
              className={`p-1.5 text-[10px] px-2 transition-colors flex items-center gap-1 ${view === "week" ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
              style={view === "week" ? { background: "hsl(var(--kf-accent1) / 0.1)" } : {}}
            >
              <CalendarDays className="w-3 h-3" /> Week
            </button>
          </div>
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

      {view === "month" ? (
        <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--kf-border))", background: "hsl(var(--kf-border))" }}>
          {DAYS.map((d) => (
            <div key={d} className="px-1 py-2 text-center text-[10px] uppercase tracking-wider text-muted-foreground font-medium" style={{ background: "hsl(var(--kf-muted))" }}>
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`empty-${i}`} className="min-h-[72px]" style={{ background: "hsl(var(--kf-background))" }} />;
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayPosts = postsByDate[dateStr] || [];
            const isToday = dateStr === todayStr;

            return (
              <div
                key={dateStr}
                className="min-h-[72px] p-1.5 relative"
                style={{
                  background: isToday ? "hsl(var(--kf-accent1) / 0.05)" : "hsl(var(--kf-card))",
                  ...(isToday ? { boxShadow: "inset 0 0 0 1px hsl(var(--kf-accent1) / 0.5)" } : {}),
                }}
              >
                <span className={`text-[11px] font-medium ${isToday ? "text-[hsl(var(--kf-accent1))] font-bold" : "text-muted-foreground"}`}>
                  {day}
                </span>
                <div className="mt-1 space-y-0.5">
                  {dayPosts.slice(0, 2).map((p) => {
                    const sc = getStatusColor(p.status);
                    return (
                      <button
                        key={p.id}
                        onClick={() => onSelectPost(p)}
                        className={`w-full flex items-center gap-1 rounded-md px-1 py-0.5 text-[9px] ${sc.bg} border ${sc.border} ${sc.text} hover:brightness-125 transition-all truncate text-left`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                        <span className="truncate">{p.content.slice(0, 20)}</span>
                      </button>
                    );
                  })}
                  {dayPosts.length > 2 && (
                    <span className="text-[9px] text-muted-foreground pl-1">+{dayPosts.length - 2} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--kf-border))" }}>
          <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px" style={{ background: "hsl(var(--kf-border))" }}>
            <div className="p-2" style={{ background: "hsl(var(--kf-muted))" }} />
            {weekDays.map((d) => {
              const ds = d.toISOString().split("T")[0];
              const isToday = ds === todayStr;
              return (
                <div
                  key={ds}
                  className="p-2 text-center"
                  style={{ background: isToday ? "hsl(var(--kf-accent1) / 0.1)" : "hsl(var(--kf-muted))" }}
                >
                  <div className={`text-[10px] uppercase tracking-wider font-medium ${isToday ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"}`}>
                    {DAYS[d.getDay()]}
                  </div>
                  <div className={`text-sm font-semibold ${isToday ? "text-[hsl(var(--kf-accent1))]" : ""}`}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}

            {HOURS.map((hour) => (
              <>
                <div key={`label-${hour}`} className="p-1.5 text-[10px] text-muted-foreground text-right pr-2 flex items-start justify-end" style={{ background: "hsl(var(--kf-card))" }}>
                  {formatHour(hour)}
                </div>
                {weekDays.map((d) => {
                  const ds = d.toISOString().split("T")[0];
                  const isToday = ds === todayStr;
                  const dayPosts = (postsByDate[ds] || []).filter((p) => {
                    const pd = p.postedAt || p.publishedAt || p.scheduledAt || p.scheduledFor || p.createdAt;
                    const h = new Date(pd).getHours();
                    return h >= hour && h < hour + 2;
                  });

                  return (
                    <div
                      key={`${ds}-${hour}`}
                      className="min-h-[48px] p-1 relative"
                      style={{ background: isToday ? "hsl(var(--kf-accent1) / 0.03)" : "hsl(var(--kf-card))" }}
                    >
                      {dayPosts.map((p) => {
                        const sc = getStatusColor(p.status);
                        return (
                          <button
                            key={p.id}
                            onClick={() => onSelectPost(p)}
                            className={`w-full flex items-center gap-1 rounded-md px-1 py-0.5 text-[9px] mb-0.5 ${sc.bg} border ${sc.border} ${sc.text} hover:brightness-125 transition-all truncate text-left`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                            <span className="truncate">{p.content.slice(0, 15)}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
