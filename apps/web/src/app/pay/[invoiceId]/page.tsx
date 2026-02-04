"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card } from "@keyflow/ui";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import {
  CheckCircle2,
  Loader2,
  CreditCard,
  FileText,
  AlertCircle,
  Phone,
  Mail,
  Globe,
  MapPin,
  Building2,
} from "lucide-react";

type Business = {
  id: string;
  name: string;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  whatsapp: string | null;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  subtotal: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number | null;
  notes: string | null;
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
  business?: Business;
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

  const business = invoice?.business;
  const primaryColor = business?.primaryColor || "#F97316";
  const logoUrl = business?.logoUrl ? `${API_BASE}${business.logoUrl}` : null;

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

  const subtotal = invoice?.subtotal ?? invoice?.total ?? 0;
  const taxRate = invoice?.taxRate ?? 0;
  const taxAmount = invoice?.taxAmount ?? 0;
  const discountAmount = invoice?.discountAmount ?? 0;
  const total = invoice?.total ?? 0;

  if (paid && invoice) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <Card className="max-w-md w-full bg-slate-900/80 border-emerald-500/40">
          <div className="text-center p-6 space-y-4">
            {business && (
              <div className="mb-4">
                {logoUrl ? (
                  <img src={logoUrl} alt={business.name} className="h-16 w-16 object-contain mx-auto rounded-xl" />
                ) : (
                  <div
                    className="h-16 w-16 rounded-xl flex items-center justify-center mx-auto text-white font-bold text-2xl"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {business.name?.charAt(0) || "K"}
                  </div>
                )}
                <p className="text-lg font-semibold mt-2" style={{ color: primaryColor }}>
                  {business.name}
                </p>
              </div>
            )}
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold text-emerald-400">Payment Complete!</h1>
            <p className="text-sm text-slate-300">
              Invoice #{invoice.invoiceNumber} has been paid.
            </p>
            <div className="text-2xl font-bold text-white">
              {invoice.currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
      <div className="mx-auto max-w-2xl space-y-6">
        <Card className="bg-slate-900/80 border-border/60 overflow-hidden">
          <div
            className="h-2 w-full"
            style={{ backgroundColor: primaryColor }}
          />
          <div className="p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img src={logoUrl} alt={business?.name} className="h-16 w-16 object-contain rounded-xl" />
                ) : business ? (
                  <div
                    className="h-16 w-16 rounded-xl flex items-center justify-center text-white font-bold text-2xl"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {business.name?.charAt(0) || "K"}
                  </div>
                ) : (
                  <div className="h-16 w-16 rounded-xl bg-primary/20 flex items-center justify-center">
                    <Building2 className="w-8 h-8 text-primary" />
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-semibold" style={{ color: primaryColor }}>
                    {business?.name || "Invoice"}
                  </h2>
                  {business?.address && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {business.address}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Invoice</div>
                <div className="font-semibold text-lg">#{invoice?.invoiceNumber}</div>
                <div className={`rounded-full px-3 py-1 text-xs inline-block mt-1 ${
                  invoice?.status === "PAID" ? "bg-emerald-500/20 text-emerald-300" :
                  invoice?.status === "OVERDUE" ? "bg-red-500/20 text-red-300" :
                  "bg-amber-500/20 text-amber-300"
                }`}>
                  {invoice?.status}
                </div>
              </div>
            </div>

            {business && (business.phone || business.email || business.website) && (
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border-t border-border/40 pt-4">
                {business.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {business.phone}
                  </span>
                )}
                {business.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {business.email}
                  </span>
                )}
                {business.website && (
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3" />
                    {business.website}
                  </span>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm border-t border-border/40 pt-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Bill To</div>
                {invoice?.contact ? (
                  <>
                    <div className="font-medium">{invoice.contact.firstName} {invoice.contact.lastName}</div>
                    {invoice.contact.email && <div className="text-xs text-muted-foreground">{invoice.contact.email}</div>}
                  </>
                ) : (
                  <div className="text-muted-foreground">-</div>
                )}
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground mb-1">Invoice Date</div>
                <div>{invoice?.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : "-"}</div>
                {invoice?.dueDate && (
                  <>
                    <div className="text-xs text-muted-foreground mt-2 mb-1">Due Date</div>
                    <div>{new Date(invoice.dueDate).toLocaleDateString()}</div>
                  </>
                )}
              </div>
            </div>

            {invoice?.items && invoice.items.length > 0 && (
              <div className="border-t border-border/40 pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border/40">
                      <th className="text-left pb-2">Description</th>
                      <th className="text-center pb-2">Qty</th>
                      <th className="text-right pb-2">Price</th>
                      <th className="text-right pb-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item) => (
                      <tr key={item.id} className="border-b border-border/20">
                        <td className="py-2">{item.description}</td>
                        <td className="text-center py-2">{item.quantity}</td>
                        <td className="text-right py-2">{invoice.currency} {item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="text-right py-2">{invoice.currency} {item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-border/40 pt-4">
              <div className="flex justify-end">
                <div className="w-64 space-y-2 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{invoice?.currency} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  {taxRate > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax ({taxRate}%)</span>
                      <span>{invoice?.currency} {taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>Discount</span>
                      <span>-{invoice?.currency} {discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-lg border-t border-border/40 pt-2" style={{ color: primaryColor }}>
                    <span>Total</span>
                    <span>{invoice?.currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            </div>

            {invoice?.notes && (
              <div className="border-t border-border/40 pt-4">
                <div className="text-xs text-muted-foreground mb-1">Notes</div>
                <p className="text-sm">{invoice.notes}</p>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <Button
              onClick={handlePay}
              className="w-full text-lg py-6"
              disabled={paying || invoice?.status === "PAID"}
              style={{ backgroundColor: primaryColor }}
            >
              <CreditCard className="w-5 h-5 mr-2" />
              {paying ? "Processing..." : `Pay ${invoice?.currency} ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            </Button>

            <div className="text-center text-[11px] text-muted-foreground">
              This is a demo payment. In production, this integrates with Stripe/WiPay.
            </div>
          </div>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          Powered by <span className="font-semibold" style={{ color: primaryColor }}>KeyFlowOS</span>
        </div>
      </div>
    </main>
  );
}
