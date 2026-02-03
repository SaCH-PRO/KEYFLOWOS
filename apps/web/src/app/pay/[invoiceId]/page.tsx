"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card } from "@keyflow/ui";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import { CheckCircle2, Loader2, CreditCard, FileText, AlertCircle } from "lucide-react";

type Invoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  paidAt: string | null;
  contact?: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
  items?: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
};

export default function PublicPaymentPage() {
  const params = useParams();
  const invoiceId = params.invoiceId as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    const loadInvoice = async () => {
      setLoading(true);
      const res = await apiGet<Invoice>(`/commerce/invoices/${encodeURIComponent(invoiceId)}`);
      if (res.error || !res.data) {
        setError("Invoice not found");
        setLoading(false);
        return;
      }
      setInvoice(res.data);
      if (res.data.status === "PAID") {
        setPaid(true);
      }
      setLoading(false);
    };
    loadInvoice();
  }, [invoiceId]);

  const handlePay = async () => {
    setPaying(true);
    const { data, error } = await apiPost<Invoice>({
      path: `/commerce/invoices/${encodeURIComponent(invoiceId)}/paid`,
      body: {},
    });
    setPaying(false);
    if (error) {
      setError(error);
    } else if (data) {
      setInvoice(data);
      setPaid(true);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </main>
    );
  }

  if (error && !invoice) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
        <Card className="max-w-md bg-slate-900/80 border-red-500/40">
          <div className="text-center p-6">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-red-400">Invoice Not Found</h1>
            <p className="text-sm text-slate-400 mt-2">The invoice "{invoiceId}" could not be found.</p>
          </div>
        </Card>
      </main>
    );
  }

  if (paid && invoice) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <Card className="max-w-md w-full bg-slate-900/80 border-emerald-500/40">
          <div className="text-center p-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold text-emerald-400">Payment Complete!</h1>
            <p className="text-sm text-slate-300">
              Invoice #{invoice.invoiceNumber} has been paid.
            </p>
            <div className="text-2xl font-bold text-white">
              {invoice.currency} {invoice.total.toLocaleString()}
            </div>
            <Button
              onClick={() => window.open(`${API_BASE}/commerce/invoices/${invoice.id}/receipt`, "_blank")}
            >
              <FileText className="w-4 h-4 mr-2" />
              Download Receipt
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">Pay Invoice</h1>
          <p className="text-sm text-slate-400">Secure payment powered by KeyFlowOS</p>
        </div>

        <Card className="bg-slate-900/80 border-border/60">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div>
                <div className="text-xs text-muted-foreground">Invoice</div>
                <div className="font-semibold">#{invoice?.invoiceNumber}</div>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs ${
                invoice?.status === "PAID" ? "bg-emerald-500/20 text-emerald-300" :
                invoice?.status === "OVERDUE" ? "bg-red-500/20 text-red-300" :
                "bg-amber-500/20 text-amber-300"
              }`}>
                {invoice?.status}
              </div>
            </div>

            {invoice?.contact && (
              <div className="text-sm">
                <div className="text-xs text-muted-foreground">Bill To</div>
                <div>{invoice.contact.firstName} {invoice.contact.lastName}</div>
                {invoice.contact.email && <div className="text-xs text-muted-foreground">{invoice.contact.email}</div>}
              </div>
            )}

            {invoice?.items && invoice.items.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Items</div>
                {invoice.items.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <div>
                      <span>{item.description}</span>
                      <span className="text-muted-foreground"> x{item.quantity}</span>
                    </div>
                    <div>{invoice.currency} {item.total.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-border/60 pt-3">
              <div className="flex justify-between items-center">
                <div className="text-lg font-semibold">Total</div>
                <div className="text-2xl font-bold text-primary">
                  {invoice?.currency} {invoice?.total.toLocaleString()}
                </div>
              </div>
              {invoice?.dueDate && (
                <div className="text-xs text-muted-foreground mt-1">
                  Due: {new Date(invoice.dueDate).toLocaleDateString()}
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <Button
              onClick={handlePay}
              className="w-full"
              disabled={paying || invoice?.status === "PAID"}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              {paying ? "Processing..." : `Pay ${invoice?.currency} ${invoice?.total.toLocaleString()}`}
            </Button>

            <div className="text-center text-[11px] text-muted-foreground">
              This is a demo payment. In production, this integrates with Stripe/WiPay.
            </div>
          </div>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          Powered by <span className="text-primary font-semibold">KeyFlowOS</span>
        </div>
      </div>
    </main>
  );
}
