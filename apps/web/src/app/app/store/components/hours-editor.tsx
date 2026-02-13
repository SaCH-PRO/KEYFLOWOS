"use client";

import { motion } from "framer-motion";
import { Clock } from "lucide-react";

export type DayHours = { open: string; close: string; closed: boolean };
export type BusinessHoursMap = Record<string, DayHours>;

const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

export const DEFAULT_HOURS: BusinessHoursMap = {
  mon: { open: "09:00", close: "17:00", closed: false },
  tue: { open: "09:00", close: "17:00", closed: false },
  wed: { open: "09:00", close: "17:00", closed: false },
  thu: { open: "09:00", close: "17:00", closed: false },
  fri: { open: "09:00", close: "17:00", closed: false },
  sat: { open: "10:00", close: "14:00", closed: false },
  sun: { open: "10:00", close: "14:00", closed: true },
};

type Props = {
  hours: BusinessHoursMap;
  onChange: (hours: BusinessHoursMap) => void;
  onSave: () => Promise<void>;
  saving: boolean;
};

export function HoursEditor({ hours, onChange, onSave, saving }: Props) {
  function toggleDay(day: string) {
    onChange({ ...hours, [day]: { ...hours[day], closed: !hours[day].closed } });
  }

  function updateTime(day: string, field: "open" | "close", value: string) {
    onChange({ ...hours, [day]: { ...hours[day], [field]: value } });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="kf-card overflow-hidden"
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: "1px solid hsl(var(--kf-accent2) / 0.15)", background: "hsl(var(--kf-accent2) / 0.05)" }}
      >
        <div className="flex items-center gap-2.5">
          <Clock className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
          <div>
            <h3 className="text-sm font-semibold">Business Hours</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Set when customers can book</p>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="kf-btn-secondary text-xs"
          style={{ borderColor: "hsl(var(--kf-accent2) / 0.3)", color: "hsl(var(--kf-accent2))" }}
        >
          {saving ? "Saving..." : "Save Hours"}
        </button>
      </div>
      <div className="p-3 space-y-1">
        {DAYS.map(({ key, label }) => {
          const h = hours[key];
          return (
            <div
              key={key}
              className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors"
            >
              <span className="text-sm font-medium w-24">{label}</span>
              <button
                type="button"
                onClick={() => toggleDay(key)}
                className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                  h.closed ? "bg-[hsl(var(--kf-muted-foreground)/0.3)]" : ""
                }`}
                style={!h.closed ? { background: "hsl(var(--kf-accent2))" } : {}}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    h.closed ? "left-0.5" : "left-[22px]"
                  }`}
                />
              </button>
              {h.closed ? (
                <span className="text-xs text-muted-foreground">Closed</span>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={h.open}
                    onChange={(e) => updateTime(key, "open", e.target.value)}
                    className="kf-input !px-2 !py-1 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={h.close}
                    onChange={(e) => updateTime(key, "close", e.target.value)}
                    className="kf-input !px-2 !py-1 text-xs"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
