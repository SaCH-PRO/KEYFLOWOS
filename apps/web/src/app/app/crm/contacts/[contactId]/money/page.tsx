"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchContactRevenueSummary } from "@/lib/client";
import { apiGet } from "@/lib/api";
import { Card, Badge } from "@keyflow/ui";
import { DollarSign, TrendingUp, AlertCircle, Receipt, FileText, Clock } from "lucide-react";

interface RevenueAction {
  type: string;
  label: string;
  amount: number | null;
  currency: string | null;
  occurredAt: string;
  entityId: string | null;
}

interface RevenueSummary {
  contactId: string;
  currency: string;
  lifetimeRevenue: number;
  outstandingBalance: number;
  openInvoices: number;
  openQuotes: number;
  lastPaymentAt: string | null;
  lastPaymentAmount: number | null;
  paymentReliability: number | null;
  recentRevenueActions: RevenueAction[];
}

interface Invoice {
  id: string;
  invoiceNumber?: string | null;
  status: string;
  total: number;
  currency: string;
  issueDate?: string | null;
  dueDate?: string | null;
  paidAt?: string | null;
}

interface Quote {
  id: string;
  quoteNumber?: string | null;
  status: string;
  total: number;
  currency: string;
  issueDate?: string | null;
  expiryDate?: string | null;
}

function fmtCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return fmtDate(d);
}

export default function ContactMoneyPage() {
  const { contactId } = useParams();
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [sumRes, invRes, quoRes] = await Promise.all([
        fetchContactRevenueSummary(contactId as string),
        apiGet<{ data: Invoice[] }>(`/commerce/businesses/default/invoices?contactId=${contactId}`),
        apiGet<{ data: Quote[] }>(`/commerce/businesses/default/quotes?contactId=${contactId}`),
      ]);
      setSummary(sumRes.data ?? null);
      setInvoices(invRes.data?.data ?? []);
      setQuotes(quoRes.data?.data ?? []);
      setLoading(false);
    };
    load();
  }, [contactId]);

  if (loading) return <div className="p-4">Loading financial data...</div>;
  if (!summary) return <div className="p-4">No financial data available.</div>;

  const currency = summary.currency || "USD";

  const statCards = [
    { label: "Lifetime Revenue", value: fmtCurrency(summary.lifetimeRevenue, currency), icon: TrendingUp, color: "text-green-600" },
    { label: "Outstanding Balance", value: fmtCurrency(summary.outstandingBalance, currency), icon: AlertCircle, color: "text-amber-600" },
    { label: "Open Invoices", value: String(summary.openInvoices), icon: Receipt, color: "text-blue-600" },
    { label: "Open Quotes", value: String(summary.openQuotes), icon: FileText, color: "text-purple-600" },
  ];

  const statusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === "paid" || s === "accepted") return "bg-green-100 text-green-800";
    if (s === "sent" || s === "pending") return "bg-amber-100 text-amber-800";
    if (s === "overdue" || s === "rejected") return "bg-red-100 text-red-800";
    return "bg-gray-100 text-gray-800";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Money</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <div className="flex items-center gap-3 p-4">
                <Icon className={`h-8 w-8 ${c.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                  <p className="text-lg font-bold">{c.value}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {summary.lastPaymentAt && (
        <div className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm">
          <Clock className="h-4 w-4 text-green-600" />
          <span className="text-muted-foreground">Last payment:</span>
          <span className="font-medium">{fmtCurrency(summary.lastPaymentAmount ?? 0, currency)}</span>
          <span className="text-muted-foreground">{timeAgo(summary.lastPaymentAt)}</span>
        </div>
      )}

      {summary.paymentReliability !== null && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Payment reliability:</span>
          <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${summary.paymentReliability >= 80 ? "bg-green-500" : summary.paymentReliability >= 50 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${summary.paymentReliability}%` }}
            />
          </div>
          <span className="font-medium">{summary.paymentReliability}%</span>
        </div>
      )}

      {summary.recentRevenueActions.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Recent Activity</h4>
          <div className="space-y-2">
            {summary.recentRevenueActions.map((a, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone="default">{a.type}</Badge>
                  <span>{a.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  {a.amount !== null && <span className="font-medium">{fmtCurrency(a.amount, a.currency || currency)}</span>}
                  <span className="text-xs text-muted-foreground">{timeAgo(a.occurredAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {invoices.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Invoices</h4>
          <div className="space-y-2">
            {invoices.map((inv) => (
              <Card key={inv.id}>
                <div className="flex items-center justify-between p-3 text-sm">
                  <div className="flex items-center gap-3">
                    <Receipt className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{inv.invoiceNumber || inv.id.slice(0, 8)}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor(inv.status)}`}>{inv.status}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {inv.issueDate && <span className="text-xs text-muted-foreground">{fmtDate(inv.issueDate)}</span>}
                    <span className="font-semibold">{fmtCurrency(inv.total, inv.currency)}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {quotes.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Quotes</h4>
          <div className="space-y-2">
            {quotes.map((q) => (
              <Card key={q.id}>
                <div className="flex items-center justify-between p-3 text-sm">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{q.quoteNumber || q.id.slice(0, 8)}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor(q.status)}`}>{q.status}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {q.issueDate && <span className="text-xs text-muted-foreground">{fmtDate(q.issueDate)}</span>}
                    <span className="font-semibold">{fmtCurrency(q.total, q.currency)}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
