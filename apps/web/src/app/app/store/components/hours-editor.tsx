"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, Copy, Check, Zap } from "lucide-react";

export type DayHours = { open: string; close: string; closed: boolean };
export type BusinessHoursMap = Record<string, DayHours>;

const DAYS = [
  { key: "mon", label: "Monday", short: "Mon" },
  { key: "tue", label: "Tuesday", short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday", short: "Thu" },
  { key: "fri", label: "Friday", short: "Fri" },
  { key: "sat", label: "Saturday", short: "Sat" },
  { key: "sun", label: "Sunday", short: "Sun" },
] as const;

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri"];

export const DEFAULT_HOURS: BusinessHoursMap = {
  mon: { open: "09:00", close: "17:00", closed: false },
  tue: { open: "09:00", close: "17:00", closed: false },
  wed: { open: "09:00", close: "17:00", closed: false },
  thu: { open: "09:00", close: "17:00", closed: false },
  fri: { open: "09:00", close: "17:00", closed: false },
  sat: { open: "10:00", close: "14:00", closed: false },
  sun: { open: "10:00", close: "14:00", closed: true },
};

type Preset = "weekdays" | "247" | "custom";

const PRESETS: { key: Preset; label: string; desc: string }[] = [
  { key: "weekdays", label: "9–5 Weekdays", desc: "Mon–Fri 9am–5pm" },
  { key: "247", label: "24/7", desc: "Always open" },
  { key: "custom", label: "Custom", desc: "Set your own" },
];

type Props = {
  hours: BusinessHoursMap;
  onChange: (hours: BusinessHoursMap) => void;
  onSave: () => Promise<void>;
  saving: boolean;
};

export function HoursEditor({ hours, onChange, onSave, saving }: Props) {
  const [copySource, setCopySource] = useState<string | null>(null);
  const [copiedTo, setCopiedTo] = useState<string | null>(null);

  function toggleDay(day: string) {
    onChange({ ...hours, [day]: { ...hours[day], closed: !hours[day].closed } });
  }

  function updateTime(day: string, field: "open" | "close", value: string) {
    onChange({ ...hours, [day]: { ...hours[day], [field]: value } });
  }

  function applyPreset(preset: Preset) {
    if (preset === "weekdays") {
      const updated = { ...hours };
      for (const key of WEEKDAY_KEYS) {
        updated[key] = { open: "09:00", close: "17:00", closed: false };
      }
      updated["sat"] = { open: "10:00", close: "14:00", closed: true };
      updated["sun"] = { open: "10:00", close: "14:00", closed: true };
      onChange(updated);
    } else if (preset === "247") {
      const updated: BusinessHoursMap = {};
      for (const d of DAYS) {
        updated[d.key] = { open: "00:00", close: "23:59", closed: false };
      }
      onChange(updated);
    }
  }

  function toggleAllWeekdays() {
    const allWeekdaysClosed = WEEKDAY_KEYS.every((k) => hours[k]?.closed);
    const updated = { ...hours };
    for (const key of WEEKDAY_KEYS) {
      updated[key] = { ...updated[key], closed: !allWeekdaysClosed };
    }
    onChange(updated);
  }

  function copyHoursFrom(sourceDay: string, targetDay: string) {
    const src = hours[sourceDay];
    if (!src) return;
    onChange({ ...hours, [targetDay]: { ...src } });
    setCopiedTo(targetDay);
    setTimeout(() => setCopiedTo(null), 1500);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent2) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent2) / 0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent2) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.06), transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent2) / 0.15)" }}
          >
            <Clock className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Business Hours</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Set when customers can book</p>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="kf-btn-primary text-xs"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : "Save Hours"}
        </button>
      </div>

      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground mr-1">Quick presets:</span>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all kf-btn-secondary"
              title={p.desc}
            >
              {p.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={toggleAllWeekdays}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "hsl(var(--kf-accent2))" }}
          >
            Toggle Weekdays
          </button>
        </div>
      </div>

      <div className="p-3 space-y-1.5">
        {DAYS.map(({ key, label, short }, idx) => {
          const h = hours[key];
          const isWeekday = WEEKDAY_KEYS.includes(key);
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.03 }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all"
              style={{
                background: h.closed
                  ? "hsl(var(--kf-muted) / 0.2)"
                  : "hsl(var(--kf-accent2) / 0.04)",
                border: copiedTo === key
                  ? "1px solid hsl(var(--kf-accent2) / 0.4)"
                  : "1px solid transparent",
              }}
            >
              <span className="text-sm font-medium w-24">
                {label}
                {isWeekday && (
                  <span className="text-[9px] text-muted-foreground/50 ml-1 hidden sm:inline">WD</span>
                )}
              </span>

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

              <div className="ml-auto flex items-center gap-1">
                {copySource === key ? (
                  <span className="text-[10px] text-muted-foreground">Click a day to paste</span>
                ) : copySource ? (
                  <button
                    onClick={() => {
                      copyHoursFrom(copySource, key);
                      setCopySource(null);
                    }}
                    className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors"
                    title={`Paste hours from ${copySource}`}
                  >
                    <Check className="w-3 h-3 text-emerald-400" />
                  </button>
                ) : (
                  <button
                    onClick={() => setCopySource(key)}
                    className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.5)] transition-colors opacity-0 group-hover:opacity-100"
                    style={{ opacity: 0.4 }}
                    title="Copy hours to another day"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {copySource && (
        <div
          className="mx-5 mb-4 px-3 py-2 rounded-lg text-xs flex items-center justify-between"
          style={{
            background: "hsl(var(--kf-accent2) / 0.1)",
            border: "1px solid hsl(var(--kf-accent2) / 0.2)",
            color: "hsl(var(--kf-accent2))",
          }}
        >
          <span>Copying hours from <strong>{copySource.toUpperCase()}</strong> — click another day to paste</span>
          <button onClick={() => setCopySource(null)} className="text-xs hover:opacity-80">Cancel</button>
        </div>
      )}
    </motion.div>
  );
}
