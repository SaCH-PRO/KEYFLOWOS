"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Calendar, User, Briefcase, CheckCircle2, XCircle, Bell, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchWaitlist, cancelWaitlistEntry, convertWaitlistEntry } from "@/lib/client";
import type { BookingWaitlistEntry, Service, StaffMember } from "@/lib/client";
import { toast } from "sonner";

interface WaitlistPanelProps {
  businessId: string;
  services: Service[];
  staff: StaffMember[];
}

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  WAITING: { label: "Waiting", color: "hsl(var(--kf-warning))", icon: Clock },
  OFFERED: { label: "Offered", color: "hsl(var(--kf-accent1))", icon: Bell },
  CONVERTED: { label: "Converted", color: "hsl(var(--kf-success))", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "hsl(var(--kf-error))", icon: XCircle },
  EXPIRED: { label: "Expired", color: "hsl(var(--muted-foreground))", icon: Clock },
};

function formatDateRange(from?: string | null, to?: string | null) {
  if (!from && !to) return "Any date";
  const f = from ? new Date(from).toLocaleDateString() : "…";
  const t = to ? new Date(to).toLocaleDateString() : "…";
  return `${f} – ${t}`;
}

function formatTimeOfDay(value?: string | null) {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function WaitlistPanel({ businessId, services, staff }: WaitlistPanelProps) {
  const [entries, setEntries] = useState<BookingWaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("WAITING");
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchWaitlist(businessId, { status: statusFilter });
    if (res.data?.items) {
      setEntries(res.data.items);
    } else {
      toast.error(res.error ?? "Failed to load waitlist");
    }
    setLoading(false);
  }, [businessId, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConvert(entryId: string) {
    setActionId(entryId);
    const res = await convertWaitlistEntry(entryId, businessId);
    if (res.data) {
      toast.success("Slot accepted and booking confirmed");
      await load();
    } else {
      toast.error(res.error ?? "Failed to accept slot");
    }
    setActionId(null);
  }

  async function handleCancel(entryId: string) {
    setActionId(entryId);
    const res = await cancelWaitlistEntry(entryId, businessId);
    if (res.data) {
      toast.success("Waitlist entry cancelled");
      await load();
    } else {
      toast.error(res.error ?? "Failed to cancel entry");
    }
    setActionId(null);
  }

  const statusKeys = Object.keys(STATUS_LABELS);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {statusKeys.map((s) => {
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                active ? "text-white border-transparent" : "text-muted-foreground border-border/50 hover:text-foreground"
              }`}
              style={active ? { background: STATUS_LABELS[s].color } : undefined}
            >
              {STATUS_LABELS[s].label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No waitlist entries"
          description={`No ${STATUS_LABELS[statusFilter]?.label.toLowerCase() ?? statusFilter.toLowerCase()} entries right now.`}
          tip="When a booking slot is full, add the contact to the waitlist and they'll be offered the first freed slot that matches."
        />
      ) : (
        <div className="grid gap-3">
          <AnimatePresence>
            {entries.map((entry) => {
              const status = STATUS_LABELS[entry.status] ?? STATUS_LABELS.WAITING;
              const StatusIcon = status.icon;
              const serviceName = entry.service?.name ?? services.find((s) => s.id === entry.serviceId)?.name ?? "Unknown service";
              const staffName = entry.preferredStaff?.name ?? staff.find((s) => s.id === entry.preferredStaffId)?.name;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="kf-card p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: `${status.color}15`, color: status.color, border: `1px solid ${status.color}30` }}
                      >
                        <StatusIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold truncate">
                          {entry.contact?.displayName ?? `${entry.contact?.firstName ?? ""} ${entry.contact?.lastName ?? ""}`.trim() ?? "Unknown contact"}
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          Added {new Date(entry.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: `${status.color}15`, color: status.color }}
                    >
                      {status.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Briefcase className="w-3 h-3" />
                      <span className="truncate">{serviceName}</span>
                    </div>
                    {staffName && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <User className="w-3 h-3" />
                        <span className="truncate">Preferred: {staffName}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      <span>{formatDateRange(entry.preferredDateFrom, entry.preferredDateTo)}</span>
                    </div>
                    {entry.preferredTimeOfDay && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{formatTimeOfDay(entry.preferredTimeOfDay)}</span>
                      </div>
                    )}
                  </div>

                  {entry.notes && (
                    <p className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg p-2">
                      {entry.notes}
                    </p>
                  )}

                  {entry.offeredBooking && (
                    <div className="text-[11px] bg-[hsl(var(--kf-accent1)/0.08)] text-[hsl(var(--kf-accent1))] rounded-lg p-2">
                      Offered slot: {new Date(entry.offeredBooking.startTime).toLocaleString()} –{" "}
                      {new Date(entry.offeredBooking.endTime).toLocaleTimeString()}
                    </div>
                  )}

                  {entry.status === "OFFERED" && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleConvert(entry.id)}
                        disabled={actionId === entry.id}
                        className="kf-btn-primary text-[11px] px-3 py-1.5 inline-flex items-center gap-1.5"
                      >
                        {actionId === entry.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                        Accept slot
                      </button>
                      <button
                        onClick={() => handleCancel(entry.id)}
                        disabled={actionId === entry.id}
                        className="text-[11px] px-3 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors inline-flex items-center gap-1.5"
                      >
                        <XCircle className="w-3 h-3" />
                        Decline
                      </button>
                    </div>
                  )}

                  {entry.status === "WAITING" && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => handleCancel(entry.id)}
                        disabled={actionId === entry.id}
                        className="text-[11px] px-3 py-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors inline-flex items-center gap-1.5"
                      >
                        {actionId === entry.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                        Remove
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
