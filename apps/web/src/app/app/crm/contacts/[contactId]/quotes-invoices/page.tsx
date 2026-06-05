"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { Card, Button } from "@keyflow/ui";
import { FileText, Receipt } from "lucide-react";

interface Invoice {
  id: string;
  invoiceNumber?: string | null;
  status: string;
  total: number;
  currency: string;
  issueDate?: string | null;
  dueDate?: string | null;
  paidAt?: string | null;
  items?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
}

interface Quote {
  id: string;
  quoteNumber?: string | null;
  status: string;
  total: number;
  currency: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  items?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
}

function fmtCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ContactQuotesInvoicesPage() {
  const { contactId } = useParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [activeTab, setActiveTab] = useState<"invoices" | "quotes">("invoices");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [invRes, quoRes] = await Promise.all([
        apiGet<{ data: Invoice[] }>(`/commerce/businesses/default/invoices?contactId=${contactId}`),
        apiGet<{ data: Quote[] }>(`/commerce/businesses/default/quotes?contactId=${contactId}`),
      ]);
      setInvoices(invRes.data?.data ?? []);
      setQuotes(quoRes.data?.data ?? []);
      setLoading(false);
    };
    load();
  }, [contactId]);

  if (loading) return <div className="p-4">Loading documents...</div>;

  const statusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === "paid" || s === "accepted") return "bg-green-100 text-green-800";
    if (s === "sent" || s === "pending" || s === "draft") return "bg-amber-100 text-amber-800";
    if (s === "overdue" || s === "rejected" || s === "cancelled") return "bg-red-100 text-red-800";
    return "bg-gray-100 text-gray-800";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Quotes & Invoices</h3>
      </div>

      <div className="flex gap-1 border-b pb-1">
        <Button
          variant={activeTab === "invoices" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("invoices")}
          className="flex items-center gap-1"
        >
          <Receipt className="h-4 w-4" />
          Invoices ({invoices.length})
        </Button>
        <Button
          variant={activeTab === "quotes" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("quotes")}
          className="flex items-center gap-1"
        >
          <FileText className="h-4 w-4" />
          Quotes ({quotes.length})
        </Button>
      </div>

      {activeTab === "invoices" && (
        <div className="space-y-2">
          {invoices.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              No invoices found for this contact.
            </div>
          ) : (
            invoices.map((inv) => (
              <Card key={inv.id}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{inv.invoiceNumber || inv.id.slice(0, 8)}</span>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor(inv.status)}`}>{inv.status}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {inv.issueDate && <span>Issued {fmtDate(inv.issueDate)}</span>}
                        {inv.dueDate && <span>Due {fmtDate(inv.dueDate)}</span>}
                        {inv.paidAt && <span className="text-green-600">Paid {fmtDate(inv.paidAt)}</span>}
                      </div>
                      {inv.items && inv.items.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {inv.items.slice(0, 3).map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{item.description} × {item.quantity}</span>
                              <span>{fmtCurrency(item.total, inv.currency)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{fmtCurrency(inv.total, inv.currency)}</p>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === "quotes" && (
        <div className="space-y-2">
          {quotes.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              No quotes found for this contact.
            </div>
          ) : (
            quotes.map((q) => (
              <Card key={q.id}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{q.quoteNumber || q.id.slice(0, 8)}</span>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColor(q.status)}`}>{q.status}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {q.issueDate && <span>Issued {fmtDate(q.issueDate)}</span>}
                        {q.expiryDate && <span>Expires {fmtDate(q.expiryDate)}</span>}
                      </div>
                      {q.items && q.items.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {q.items.slice(0, 3).map((item, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-muted-foreground">{item.description} × {item.quantity}</span>
                              <span>{fmtCurrency(item.total, q.currency)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{fmtCurrency(q.total, q.currency)}</p>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
