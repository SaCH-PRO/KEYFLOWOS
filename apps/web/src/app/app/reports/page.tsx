"use client";

import { useEffect, useState } from "react";
import { Card } from "@keyflow/ui";
import { ReportSummary, fetchReportSummary } from "@/lib/client";

export default function ReportsPage() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);

  useEffect(() => {
    fetchReportSummary().then((res) => setSummary(res.data ?? null));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Live KPI snapshots across CRM, bookings, and commerce.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card title="Contacts" badge="CRM">
          <div className="text-2xl font-semibold">{summary?.totalContacts ?? 0}</div>
          <div className="text-xs text-muted-foreground">Total tracked contacts.</div>
        </Card>
        <Card title="Bookings" badge="Scheduling">
          <div className="text-2xl font-semibold">{summary?.totalBookings ?? 0}</div>
          <div className="text-xs text-muted-foreground">Total bookings created.</div>
        </Card>
        <Card title="Invoices" badge="Billing">
          <div className="text-2xl font-semibold">{summary?.totalInvoices ?? 0}</div>
          <div className="text-xs text-muted-foreground">All invoices generated.</div>
        </Card>
        <Card title="Revenue" badge="Paid">
          <div className="text-2xl font-semibold">{summary?.totalRevenue ?? 0}</div>
          <div className="text-xs text-muted-foreground">Collected from paid invoices.</div>
        </Card>
        <Card title="Outstanding" badge="Due">
          <div className="text-2xl font-semibold">{summary?.outstandingBalance ?? 0}</div>
          <div className="text-xs text-muted-foreground">Pending balances across accounts.</div>
        </Card>
        <Card title="Overdue tasks" badge="CRM">
          <div className="text-2xl font-semibold">{summary?.overdueTasks ?? 0}</div>
          <div className="text-xs text-muted-foreground">Tasks past due date.</div>
        </Card>
        <Card title="Upcoming bookings" badge="Scheduling">
          <div className="text-2xl font-semibold">{summary?.upcomingBookings ?? 0}</div>
          <div className="text-xs text-muted-foreground">Next appointments queued.</div>
        </Card>
      </div>

      {!summary && (
        <div className="rounded-2xl border border-border/60 bg-muted p-4 text-sm text-muted-foreground">
          Loading report summary...
        </div>
      )}
    </div>
  );
}
