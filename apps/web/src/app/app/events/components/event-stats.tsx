"use client";

import { StatOrb } from "@/components/ui-v2";
import type { EventDetail, EventTicketType } from "@/lib/api/events";

interface EventStatsProps {
  event: EventDetail;
  businessCurrency: string;
}

function computeRevenue(ticketTypes: EventTicketType[]): number {
  return ticketTypes.reduce((sum, tt) => {
    const price = parseFloat(tt.price) || 0;
    return sum + price * tt.quantitySold;
  }, 0);
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function EventStats({ event, businessCurrency }: EventStatsProps) {
  const revenue = computeRevenue(event.ticketTypes);
  const currency = event.ticketTypes[0]?.currency ?? businessCurrency;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatOrb label="Ticket types" value={event.ticketTypes.length} color="orange" />
      <StatOrb label="Registered" value={event._count.attendees} color="teal" />
      <StatOrb label="Checked in" value={event._count.checkIns} color="violet" />
      <StatOrb label="Revenue" value={formatCurrency(revenue, currency)} color="gold" />
    </div>
  );
}

export { computeRevenue, formatCurrency };
