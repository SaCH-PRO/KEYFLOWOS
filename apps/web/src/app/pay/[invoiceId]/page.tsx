"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
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
  Wallet,
  ArrowRight,
  Shield,
  ChevronLeft,
} from "lucide-react";
import { InvoiceTemplateRenderer } from "@/app/app/commerce/components/invoice-templates";
import type { TemplateId, InvoiceTemplateData } from "@/app/app/commerce/components/invoice-templates";

type Business = {
  id: string;
  name: string;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  invoiceTemplate: string | null;
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

type Gateway = {
  id: string;
  name: string;
  currencies: string[];
};

export default function PublicPaymentPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const invoiceId = params.invoiceId as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [selectedGateway, setSelectedGateway] = useState<string | null>(null);
  const [step, setStep] = useState<"review" | "gateway" | "processing">("review");

  const wipayStatus = searchParams.get("status");
  const wipayOrderId = searchParams.get("order_id");
  const paypalToken = searchParams.get("token");
  const paypalPayerId = searchParams.get("PayerID");

  useEffect(() => {
    if (wipayStatus && wipayOrderId) {
      const processWipayReturn = async () => {
        const callbackParams = new URLSearchParams(window.location.search);
        const res = await apiGet<{ success: boolean; invoiceId?: string; message: string }>(
          `/payments/wipay/callback?${callbackParams.toString()}`
        );
        if (res.data?.success) {
          setPaid(true);
          const invoiceRes = await apiGet<Invoice>(`/commerce/invoices/${encodeURIComponent(invoiceId)}`);
          if (invoiceRes.data) setInvoice(invoiceRes.data);
        } else {
          setError(res.data?.message || res.error || "Payment was not successful");
        }
        setStep("review");
      };
      processWipayReturn();
    }
  }, [wipayStatus, wipayOrderId, invoiceId]);

  useEffect(() => {
    if (paypalToken) {
      const capturePaypal = async () => {
        setStep("processing");
        const res = await apiPost<{ id: string; status: string }>({
          path: `/payments/paypal/capture/${paypalToken}`,
          body: { invoiceId },
        });
        if (res.data?.status === "COMPLETED") {
          setPaid(true);
          const invoiceRes = await apiGet<Invoice>(`/commerce/invoices/${encodeURIComponent(invoiceId)}`);
          if (invoiceRes.data) setInvoice(invoiceRes.data);
        } else {
          setError(res.error || "PayPal payment could not be completed");
        }
        setStep("review");
      };
      capturePaypal();
    }
  }, [paypalToken, invoiceId]);

  useEffect(() => {
    const loadInvoice = async () => {
      setLoading(true);
      const [invoiceRes, gatewayRes] = await Promise.all([
        apiGet<Invoice>(`/commerce/invoices/${encodeURIComponent(invoiceId)}`),
        apiGet<{ gateways: Gateway[] }>(`/payments/invoice/${encodeURIComponent(invoiceId)}/gateways`),
      ]);

      if (invoiceRes.error || !invoiceRes.data) {
        setError("Invoice not found");
        setLoading(false);
        return;
      }
      setInvoice(invoiceRes.data);
      if (invoiceRes.data.status === "PAID") {
        setPaid(true);
      }

      if (gatewayRes.data) {
        const gwList = Array.isArray(gatewayRes.data) ? gatewayRes.data : (gatewayRes.data as any).gateways || [];
        setGateways(gwList);
        if (gwList.length === 1) {
          setSelectedGateway(gwList[0].id);
        }
      }

      setLoading(false);
    };
    loadInvoice();
  }, [invoiceId]);

  const handleWipayPay = useCallback(async () => {
    if (!invoice) return;
    setPaying(true);
    setStep("processing");

    const currentUrl = window.location.origin + window.location.pathname;

    const res = await apiPost<{ redirectUrl: string }>({
      path: `/payments/invoice/${encodeURIComponent(invoiceId)}/wipay`,
      body: { returnUrl: currentUrl },
    });

    if (res.error || !res.data?.redirectUrl) {
      setError(res.error || "Failed to initiate payment");
      setPaying(false);
      setStep("gateway");
      return;
    }

    window.location.href = res.data.redirectUrl;
  }, [invoice, invoiceId]);

  const handlePaypalPay = useCallback(async () => {
    if (!invoice) return;
    setPaying(true);
    setStep("processing");

    const orderRes = await apiPost<{ orderId: string }>({
      path: `/payments/invoice/${encodeURIComponent(invoiceId)}/paypal/create-order`,
      body: {},
    });

    if (orderRes.error || !orderRes.data?.orderId) {
      setError(orderRes.error || "Failed to create PayPal order");
      setPaying(false);
      setStep("gateway");
      return;
    }

    const returnUrl = encodeURIComponent(window.location.origin + window.location.pathname);
    const approvalUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${orderRes.data.orderId}&return=${returnUrl}`;
    window.location.href = approvalUrl;
  }, [invoice, invoiceId]);

  const handlePay = useCallback(async () => {
    if (!selectedGateway) {
      setError("Please select a payment method");
      return;
    }

    if (selectedGateway === "wipay") {
      await handleWipayPay();
    } else if (selectedGateway === "paypal") {
      await handlePaypalPay();
    } else {
      setPaying(true);
      const { data, error: payError } = await apiPost<Invoice>({
        path: `/commerce/invoices/${encodeURIComponent(invoiceId)}/paid`,
        body: {},
      });
      setPaying(false);
      if (payError) {
        setError(payError);
      } else if (data) {
        setInvoice(data);
        setPaid(true);
      }
    }
  }, [selectedGateway, handleWipayPay, handlePaypalPay, invoiceId]);

  const business = invoice?.business;
  const primaryColor = business?.primaryColor || "#F97316";
  const logoUrl = business?.logoUrl ? `${API_BASE}${business.logoUrl}` : null;

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin mx-auto" style={{ color: primaryColor }} />
          <p className="text-sm text-slate-400">Loading invoice...</p>
        </div>
      </main>
    );
  }

  if (error && !invoice) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <Card className="max-w-md w-full bg-slate-900/80 border-red-500/40">
          <div className="text-center p-6 space-y-3">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <h1 className="text-xl font-semibold text-red-400">Invoice Not Found</h1>
            <p className="text-sm text-slate-400">This invoice link may be invalid or expired.</p>
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
          </div>
        </Card>
      </main>
    );
  }

  const templateId = (business?.invoiceTemplate || "classic") as TemplateId;
  const templateData: InvoiceTemplateData = {
    type: "invoice",
    number: invoice?.invoiceNumber ?? "",
    status: invoice?.status ?? "DRAFT",
    issueDate: invoice?.issueDate ?? null,
    dueDate: invoice?.dueDate ?? null,
    contact: invoice?.contact ?? null,
    items: invoice?.items ?? [],
    subtotal,
    taxRate,
    taxAmount,
    discountType: invoice?.discountType,
    discountValue: invoice?.discountValue,
    discountAmount,
    total,
    currency: invoice?.currency ?? "TTD",
    notes: invoice?.notes,
    business: {
      name: business?.name ?? "Invoice",
      logoUrl,
      address: business?.address,
      city: business?.city,
      country: business?.country,
      phone: business?.phone,
      email: business?.email,
      website: business?.website,
      primaryColor,
      secondaryColor: business?.secondaryColor || "#14B8A6",
    },
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <InvoiceTemplateRenderer templateId={templateId} data={templateData} />

        {!paid && invoice?.status !== "PAID" && (
          <Card className="bg-slate-900/80 border-border/60 overflow-hidden">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5" style={{ color: primaryColor }} />
                <h3 className="font-semibold text-lg">Payment Method</h3>
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              {step === "processing" ? (
                <div className="text-center py-8 space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: primaryColor }} />
                  <p className="text-sm text-slate-400">Redirecting to payment gateway...</p>
                  <p className="text-xs text-slate-500">Please do not close this window</p>
                </div>
              ) : (
                <>
                  {gateways.length > 0 ? (
                    <div className="space-y-2">
                      {gateways.map((gw) => (
                        <button
                          key={gw.id}
                          onClick={() => { setSelectedGateway(gw.id); setError(null); }}
                          className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${
                            selectedGateway === gw.id
                              ? "border-2 bg-white/5"
                              : "border-border/40 hover:border-border/60 hover:bg-white/[0.02]"
                          }`}
                          style={selectedGateway === gw.id ? { borderColor: primaryColor } : {}}
                        >
                          <div
                            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `${primaryColor}20` }}
                          >
                            {gw.id === "wipay" ? (
                              <CreditCard className="w-5 h-5" style={{ color: primaryColor }} />
                            ) : (
                              <Wallet className="w-5 h-5" style={{ color: primaryColor }} />
                            )}
                          </div>
                          <div className="flex-1 text-left">
                            <div className="font-medium text-sm">
                              {gw.id === "wipay" ? "Pay with Card (WiPay)" : `Pay with ${gw.name}`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {gw.id === "wipay"
                                ? "Credit/Debit Card via WiPay"
                                : "PayPal account or card"}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {gw.currencies.join(", ")}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 space-y-2">
                      <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
                      <p className="text-sm text-slate-400">No payment methods available yet</p>
                      <p className="text-xs text-slate-500">Contact {business?.name || "the business"} for payment options</p>
                    </div>
                  )}

                  {gateways.length > 0 && (
                    <Button
                      onClick={handlePay}
                      className="w-full text-base py-5 font-semibold"
                      disabled={paying || !selectedGateway}
                      style={{ backgroundColor: selectedGateway ? primaryColor : undefined }}
                    >
                      {paying ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4 mr-2" />
                          Pay {invoice?.currency} {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  )}

                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                    <Shield className="w-3 h-3" />
                    <span>Secure payment processing</span>
                  </div>
                </>
              )}
            </div>
          </Card>
        )}

        <div className="text-center text-xs text-muted-foreground pb-4">
          Powered by <span className="font-semibold" style={{ color: primaryColor }}>KeyFlowOS</span>
        </div>
      </div>
    </main>
  );
}
