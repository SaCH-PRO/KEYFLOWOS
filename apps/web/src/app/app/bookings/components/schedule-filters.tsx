"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Filter, X } from "lucide-react";
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

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "COMPLETED", label: "Completed" },
  { key: "CANCELLED", label: "Cancelled" },
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

  function clearAll() {
    onStaffChange("");
    onServiceChange("");
    onStatusChange("ALL");
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(!open)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
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
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeCount > 0 && (
            <span
              className="w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
              style={{ background: "hsl(var(--kf-accent1))" }}
            >
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          >
            <X className="w-3 h-3" /> Clear
          </button>
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
            <div className="flex flex-wrap gap-3 pt-2.5">
              <div className="min-w-[140px]">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1 block">
                  Staff
                </label>
                <select
                  value={staffFilter}
                  onChange={(e) => onStaffChange(e.target.value)}
                  className="kf-input w-full text-xs py-1.5"
                >
                  <option value="">All staff</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[140px]">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1 block">
                  Service
                </label>
                <select
                  value={serviceFilter}
                  onChange={(e) => onServiceChange(e.target.value)}
                  className="kf-input w-full text-xs py-1.5"
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
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1 block">
                  Status
                </label>
                <div className="flex gap-1">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => onStatusChange(opt.key)}
                      className={`px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
                        statusFilter === opt.key
                          ? "border-[hsl(var(--kf-accent1)/0.5)] text-foreground"
                          : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border/70"
                      }`}
                      style={
                        statusFilter === opt.key
                          ? { background: "hsl(var(--kf-accent1)/0.1)" }
                          : undefined
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
