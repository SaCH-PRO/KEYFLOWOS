"use client";

import { useEffect, useState } from "react";
import { Card } from "@keyflow/ui";
import { BarChart3, TrendingUp, Users, Calendar, DollarSign, FileText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { FeatureGuide } from "@/components/ui/feature-guide";
import { fetchContacts, fetchBookings, fetchInvoices, fetchProducts, Booking, Invoice, Contact, Product } from "@/lib/client";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";

type ReportStats = {
  totalRevenue: number;
  pendingRevenue: number;
  totalContacts: number;
  totalBookings: number;
  confirmedBookings: number;
  pendingBookings: number;
  totalProducts: number;
  paidInvoices: number;
  outstandingInvoices: number;
  currency: string;
};

export default function ReportsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    const initWorkspace = async () => {
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        return;
      }
      const stored = getStoredBusinessId();
      if (stored) {
        setBusinessId(stored);
      }
    };
    void initWorkspace();
  }, []);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      const [contactsRes, bookingsRes, invoicesRes, productsRes] = await Promise.all([
        fetchContacts(businessId),
        fetchBookings(businessId),
        fetchInvoices(businessId),
        fetchProducts(businessId),
      ]);

      const contacts = contactsRes.data ?? [];
      const bookings = bookingsRes.data ?? [];
      const invoices = invoicesRes.data ?? [];
      const products = productsRes.data ?? [];

      const paidInvoices = invoices.filter((i) => i.status === "PAID");
      const totalRevenue = paidInvoices.reduce((sum, i) => sum + Number(i.total || 0), 0);
      const pendingRevenue = invoices
        .filter((i) => i.status !== "PAID" && i.status !== "VOID")
        .reduce((sum, i) => sum + Number(i.total || 0), 0);

      const confirmedBookings = bookings.filter((b) => b.status === "CONFIRMED").length;
      const pendingBookings = bookings.filter((b) => b.status === "PENDING").length;

      setStats({
        totalRevenue,
        pendingRevenue,
        totalContacts: contacts.length,
        totalBookings: bookings.length,
        confirmedBookings,
        pendingBookings,
        totalProducts: products.length,
        paidInvoices: paidInvoices.length,
        outstandingInvoices: invoices.filter((i) => i.status !== "PAID" && i.status !== "VOID").length,
        currency: "TTD",
      });

      setRecentBookings(bookings.slice(0, 5));
      setRecentInvoices(invoices.slice(0, 5));
      setLoading(false);
    };
    load();
  }, [businessId]);

  if (loading) {
    return (
      <div className="space-y-4">
          <PageHeader icon={BarChart3} title="Reports" subtitle="Loading analytics..." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={BarChart3} title="Reports" subtitle="Business analytics and insights" />

      <FeatureGuide
        featureKey="reports"
        title="Understanding Your Reports"
        description="Get a clear picture of your business performance with real-time analytics and KPIs."
        steps={[
          { title: "Revenue Overview", description: "See total revenue from paid invoices and average transaction values." },
          { title: "Customer Insights", description: "Track total contacts, active clients, and new leads over time." },
          { title: "Booking Analytics", description: "Monitor booking volume, completion rates, and popular services." },
          { title: "Product Performance", description: "Review your product catalog size, top sellers, and pricing trends." },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Total Revenue</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {stats?.currency} {stats?.totalRevenue.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground">
            From {stats?.paidInvoices} paid invoices
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Pending Revenue</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400">
            {stats?.currency} {stats?.pendingRevenue.toLocaleString()}
          </div>
          <div className="text-xs text-muted-foreground">
            {stats?.outstandingInvoices} outstanding invoices
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Total Contacts</span>
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{stats?.totalContacts}</div>
          <div className="text-xs text-muted-foreground">Active leads and clients</div>
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Bookings</span>
            <Calendar className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold">{stats?.totalBookings}</div>
          <div className="text-xs text-muted-foreground">
            {stats?.confirmedBookings} confirmed, {stats?.pendingBookings} pending
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Recent Bookings</span>
          </div>
          {recentBookings.length === 0 ? (
            <div className="text-sm text-muted-foreground">No bookings yet.</div>
          ) : (
            <div className="space-y-2">
              {recentBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-900/60 px-3 py-2"
                >
                  <div>
                    <div className="text-sm">{new Date(booking.startTime).toLocaleDateString()}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(booking.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    booking.status === "CONFIRMED" ? "bg-emerald-500/20 text-emerald-300" :
                    booking.status === "PENDING" ? "bg-amber-500/20 text-amber-300" :
                    "bg-slate-500/20 text-slate-300"
                  }`}>
                    {booking.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Recent Invoices</span>
          </div>
          {recentInvoices.length === 0 ? (
            <div className="text-sm text-muted-foreground">No invoices yet.</div>
          ) : (
            <div className="space-y-2">
              {recentInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-slate-900/60 px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-mono">{invoice.invoiceNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {invoice.currency} {invoice.total.toLocaleString()}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    invoice.status === "PAID" ? "bg-emerald-500/20 text-emerald-300" :
                    invoice.status === "OVERDUE" ? "bg-red-500/20 text-red-300" :
                    "bg-amber-500/20 text-amber-300"
                  }`}>
                    {invoice.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-border/60 bg-slate-950/60 backdrop-blur p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Business Health</span>
          </div>
          <span className="text-xs text-muted-foreground">Last 30 days</span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="rounded-xl border border-border/60 bg-slate-900/60 p-3">
            <div className="text-2xl font-bold text-emerald-400">{stats?.paidInvoices}</div>
            <div className="text-xs text-muted-foreground">Paid Invoices</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-slate-900/60 p-3">
            <div className="text-2xl font-bold text-blue-400">{stats?.confirmedBookings}</div>
            <div className="text-xs text-muted-foreground">Confirmed Bookings</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-slate-900/60 p-3">
            <div className="text-2xl font-bold text-primary">{stats?.totalProducts}</div>
            <div className="text-xs text-muted-foreground">Products/Services</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground text-center">
        Coming soon: Interactive charts, date range filters, and exportable PDF reports.
      </div>
    </div>
  );
}
