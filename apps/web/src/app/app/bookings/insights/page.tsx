"use client";

import { useEffect, useState } from "react";
import {
  fetchBookings,
  fetchServices,
  fetchBookingStats,
  fetchScheduleHealth,
  type Booking,
  type Service,
  type BookingStats,
  type ScheduleHealth,
} from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { BarChart3 } from "lucide-react";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import BookingsInsightsTab from "./bookings-insights-tab";

export default function BookingsInsightsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [stats, setStats] = useState<BookingStats | null>(null);
  const [scheduleHealth, setScheduleHealth] = useState<ScheduleHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) setBusinessId(bid);
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [b, s, st, sh] = await Promise.all([
          fetchBookings(businessId),
          fetchServices(businessId),
          fetchBookingStats(businessId).catch(() => ({ data: null })),
          fetchScheduleHealth(businessId).catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        if (b.data) setBookings(b.data);
        if (s.data) setServices(s.data);
        if (st.data) setStats(st.data);
        if (sh.data) setScheduleHealth(sh.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  if (loading) return <ListPageSkeleton />;

  return (
    <WorkspaceShell
      icon={BarChart3}
      title="Bookings Insights"
      subtitle="Performance trends, utilization, and AI insights from your bookings."
    >
      <BookingsInsightsTab
        bookings={bookings}
        services={services}
        stats={stats}
        scheduleHealth={scheduleHealth}
      />
    </WorkspaceShell>
  );
}
