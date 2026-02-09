"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, FileText, Clock, CheckCircle2 } from "lucide-react";
import type { SocialPost } from "@/lib/client";

type Props = {
  posts: SocialPost[];
  onSelectPost: (post: SocialPost) => void;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function getStatusDot(status: string) {
  switch (status) {
    case "POSTED": return "bg-emerald-400";
    case "SCHEDULED": return "bg-blue-400";
    case "DRAFT": return "bg-[hsl(var(--kf-muted-foreground))]";
    default: return "bg-red-400";
  }
}

export function ContentCalendar({ posts, onSelectPost }: Props) {
  const [currentDate, setCurrentDate] = useState(new Date());
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

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function prev() { setCurrentDate(new Date(year, month - 1, 1)); }
  function next() { setCurrentDate(new Date(year, month + 1, 1)); }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {MONTHS[month]} {year}
        </h3>
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
          const isToday = dateStr === today;

          return (
            <div
              key={dateStr}
              className="min-h-[72px] p-1.5 relative"
              style={{
                background: "hsl(var(--kf-card))",
                ...(isToday ? { boxShadow: "inset 0 0 0 1px hsl(var(--kf-accent1) / 0.5)" } : {}),
              }}
            >
              <span className={`text-[11px] font-medium ${isToday ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"}`}>
                {day}
              </span>
              <div className="mt-1 space-y-0.5">
                {dayPosts.slice(0, 2).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onSelectPost(p)}
                    className="w-full flex items-center gap-1 rounded px-1 py-0.5 text-[9px] hover:bg-[hsl(var(--kf-muted))] transition-colors truncate text-left"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDot(p.status)}`} />
                    <span className="truncate">{p.content.slice(0, 20)}</span>
                  </button>
                ))}
                {dayPosts.length > 2 && (
                  <span className="text-[9px] text-muted-foreground pl-1">+{dayPosts.length - 2} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
