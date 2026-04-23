"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Filter, X, ChevronDown } from "lucide-react";
import type { Service, StaffMember, StatusFilter } from "./bookings-types";

interface ScheduleFiltersProps {
  services: Service[];
  staff: StaffMember[];
  staffFilter: string;
  serviceFilter: string;
  statusFilter: StatusFilter;
  onStaffChange: (id: string) => void;
  onServiceChange: (id: string) => void;
  onStatusChange: (status: StatusFilter) => void;
}

const STATUS_OPTIONS: { key: StatusFilter; label: string; color: string }[] = [
  { key: "ALL", label: "All", color: "var(--muted-foreground)" },
  { key: "PENDING", label: "Pending", color: "var(--kf-warning)" },
  { key: "CONFIRMED", label: "Confirmed", color: "var(--kf-success)" },
  { key: "COMPLETED", label: "Done", color: "var(--secondary)" },
  { key: "CANCELLED", label: "Cancelled", color: "var(--kf-error)" },
];

export default function ScheduleFilters({
  services,
  staff,
  staffFilter,
  serviceFilter,
  statusFilter,
  onStaffChange,
  onServiceChange,
  onStatusChange,
}: ScheduleFiltersProps) {
  const [open, setOpen] = useState(false);

  const activeCount =
    (staffFilter ? 1 : 0) +
    (serviceFilter ? 1 : 0) +
    (statusFilter !== "ALL" ? 1 : 0);

  const activeStaffName = staffFilter ? staff.find((s) => s.id === staffFilter)?.name : null;
  const activeServiceName = serviceFilter ? services.find((s) => s.id === serviceFilter)?.name : null;

  function clearAll() {
    onStaffChange("");
    onServiceChange("");
    onStatusChange("ALL");
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="schedule-filters-panel"
          className={`inline-flex items-center gap-1.5 px-2 min-h-[32px] rounded-lg text-[11px] font-medium transition-colors border ${
            open || activeCount > 0
              ? "border-[hsl(var(--kf-accent1)/0.4)] text-foreground"
              : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border/70"
          }`}
          style={
            open || activeCount > 0
              ? { background: "hsl(var(--kf-accent1)/0.08)" }
              : undefined
          }
        >
          <Filter className="w-3 h-3" />
          Filters
          {activeCount > 0 && (
            <span
              className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              {activeCount}
            </span>
          )}
          <ChevronDown className={`w-2.5 h-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {activeCount > 0 && !open && (
          <>
            {activeStaffName && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium"
                style={{
                  background: "hsl(var(--kf-accent2) / 0.08)",
                  color: "hsl(var(--kf-accent2))",
                  borderWidth: 1,
                  borderColor: "hsl(var(--kf-accent2) / 0.2)",
                }}
              >
                {activeStaffName}
                <button onClick={() => onStaffChange("")} className="hover:opacity-70" aria-label={`Remove ${activeStaffName} filter`}>
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )}
            {activeServiceName && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium"
                style={{
                  background: "hsl(var(--kf-accent1) / 0.08)",
                  color: "hsl(var(--kf-accent1))",
                  borderWidth: 1,
                  borderColor: "hsl(var(--kf-accent1) / 0.2)",
                }}
              >
                {activeServiceName}
                <button onClick={() => onServiceChange("")} className="hover:opacity-70" aria-label={`Remove ${activeServiceName} filter`}>
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )}
            {statusFilter !== "ALL" && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium"
                style={{
                  background: `hsl(${STATUS_OPTIONS.find((o) => o.key === statusFilter)?.color ?? "var(--muted)"} / 0.08)`,
                  color: `hsl(${STATUS_OPTIONS.find((o) => o.key === statusFilter)?.color ?? "var(--muted-foreground)"})`,
                  borderWidth: 1,
                  borderColor: `hsl(${STATUS_OPTIONS.find((o) => o.key === statusFilter)?.color ?? "var(--border)"} / 0.2)`,
                }}
              >
                {STATUS_OPTIONS.find((o) => o.key === statusFilter)?.label ?? statusFilter}
                <button onClick={() => onStatusChange("ALL")} className="hover:opacity-70" aria-label="Remove status filter">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )}
            <button
              onClick={clearAll}
              className="text-[10px] text-muted-foreground/60 hover:text-foreground flex items-center gap-0.5 transition-colors"
            >
              Clear all
            </button>
          </>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div id="schedule-filters-panel" className="flex flex-wrap gap-2.5 pt-1.5 pb-1">
              <div className="min-w-[130px]">
                <label className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium mb-1 block">
                  Staff
                </label>
                <select
                  value={staffFilter}
                  onChange={(e) => onStaffChange(e.target.value)}
                  className="kf-input w-full text-xs py-1 min-h-[32px]"
                >
                  <option value="">All staff</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[130px]">
                <label className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium mb-1 block">
                  Service
                </label>
                <select
                  value={serviceFilter}
                  onChange={(e) => onServiceChange(e.target.value)}
                  className="kf-input w-full text-xs py-1 min-h-[32px]"
                >
                  <option value="">All services</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium mb-1 block">
                  Status
                </label>
                <div className="flex gap-0.5">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => onStatusChange(opt.key)}
                      className={`px-2 py-1 text-[10px] font-medium rounded-lg border transition-colors min-h-[32px] ${
                        statusFilter === opt.key
                          ? "text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20"
                      }`}
                      style={
                        statusFilter === opt.key
                          ? {
                              background: `hsl(${opt.color} / 0.1)`,
                              borderColor: `hsl(${opt.color} / 0.3)`,
                              color: `hsl(${opt.color})`,
                            }
                          : undefined
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeCount > 0 && (
                <div className="flex items-end">
                  <button
                    onClick={clearAll}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 min-h-[32px] transition-colors"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
