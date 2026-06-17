"use client";

import { Card } from "@keyflow/ui";

const METRIC_LABELS: Record<string, string> = {
  messagesReceived: "Messages received",
  urgentCount: "Urgent",
  salesOpportunities: "Sales opportunities",
  complaints: "Complaints",
  bookingRequests: "Booking requests",
  invoiceRequests: "Invoice requests",
  avgResponseTimeHours: "Avg response time (hrs)",
};

function formatMetricValue(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

interface BriefMetricsProps {
  metrics: Record<string, number>;
}

export function BriefMetrics({ metrics }: BriefMetricsProps) {
  const entries = Object.entries(metrics);

  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {entries.map(([key, value]) => (
        <Card key={key} variant="glass" padding="md" className="flex flex-col justify-between">
          <span className="text-xs text-muted-foreground">{METRIC_LABELS[key] ?? key}</span>
          <span className="text-2xl font-semibold mt-1">{formatMetricValue(value)}</span>
        </Card>
      ))}
    </div>
  );
}
