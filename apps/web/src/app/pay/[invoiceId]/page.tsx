"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button } from "@keyflow/ui";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import { initPresence, trackPageView, pickBusinessId } from "@/app/_lib/presence-sdk";
import { formatPrice } from "@/lib/format";
import { PublicPageState } from "@/components/ui/public-page-state";
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
  Wallet,
  ArrowRight,
  Shield,
  Landmark,
  Banknote,
  Copy,
  Check,
  Calendar,
  Hash,
  User,
  Receipt,
} from "lucide-react";

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

  metaData?: Record<string, unknown> | null;
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

type PaymentMethod = "wipay" | "paypal" | "stripe" | "google_pay" | "bank_transfer" | "cash";

function ConfettiParticles() {
  const [particles] = useState(() => {
    const colors = ["#F97316", "#14B8A6", "#8B5CF6", "#EC4899", "#EAB308", "#3B82F6"];
    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 2}s`,
      duration: `${2 + Math.random() * 3}s`,
      color: colors[i % colors.length],
      size: 4 + Math.random() * 6,
      rotation: Math.random() * 360,
    }));
  });

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute animate-confetti-fall"
          style={{
            left: p.left,
            top: "-10px",
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.size > 7 ? "50%" : "1px",
            animationDelay: p.delay,
            animationDuration: p.duration,
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .animate-confetti-fall {
          animation-name: confetti-fall;
          animation-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
          animation-fill-mode: forwards;
        }
      `}</style>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-2 p-1 rounded hover:bg-white/10 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
    </button>
  );
}

function PublicPaymentPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const invoiceId = params.invoiceId as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initPresence({ apiBase: API_BASE });
    const bizId = pickBusinessId(invoice);
    if (bizId) trackPageView(bizId);
  }, [invoice]);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [step, setStep] = useState<"review" | "gateway" | "processing">("review");
  const [showConfetti, setShowConfetti] = useState(false);
  const [offlineConfirmed, setOfflineConfirmed] = useState(false);

  const [googlePayAvailable, setGooglePayAvailable] = useState(false);

  const wipayStatus = searchParams.get("status");
  const wipayOrderId = searchParams.get("order_id");
  const paypalToken = searchParams.get("token");
  const _paypalPayerId = searchParams.get("PayerID");
  const stripeReturn = searchParams.get("stripe");

  useEffect(() => {
    if (stripeReturn === "success") {
      let cancelled = false;
      const poll = async (attempt = 0) => {
        const res = await apiGet<Invoice>(`/commerce/invoices/${encodeURIComponent(invoiceId)}`);
        if (cancelled) return;
        if (res.data?.status === "PAID") {
          setInvoice(res.data);
          setPaid(true);
          setShowConfetti(true);
          return;
        }
        if (attempt < 8) setTimeout(() => poll(attempt + 1), 1500);
      };
      poll();
      return () => { cancelled = true; };
    }
    if (stripeReturn === "cancel") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- transient toast feedback: surface the Stripe-cancel return-URL state into the page error banner once on mount
      setError("Stripe payment was cancelled.");
    }
  }, [stripeReturn, invoiceId]);

  useEffect(() => {
    if (wipayStatus && wipayOrderId) {
      const processWipayReturn = async () => {
        const callbackParams = new URLSearchParams(window.location.search);
        const res = await apiGet<{ success: boolean; invoiceId?: string; message: string }>(
          `/payments/wipay/callback?${callbackParams.toString()}`
        );
        if (res.data?.success) {
          setPaid(true);
          setShowConfetti(true);
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
          setShowConfetti(true);
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
        const gwList = Array.isArray(gatewayRes.data) ? gatewayRes.data : (gatewayRes.data as { gateways?: typeof gateways }).gateways || [];
        setGateways(gwList);
      }

      setLoading(false);
    };
    loadInvoice();
  }, [invoiceId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.PaymentRequest) return;
    const methods = [{
      supportedMethods: "https://google.com/pay",
      data: {
        environment: process.env.NEXT_PUBLIC_GOOGLE_PAY_ENV === "PRODUCTION" ? "PRODUCTION" : "TEST",
        apiVersion: 2,
        apiVersionMinor: 0,
        allowedPaymentMethods: [{
          type: "CARD",
          parameters: {
            allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
            allowedCardNetworks: ["VISA", "MASTERCARD", "AMEX"],
          },
          tokenizationSpecification: {
            type: "PAYMENT_GATEWAY",
            parameters: {
              gateway: process.env.NEXT_PUBLIC_GOOGLE_PAY_GATEWAY || "example",
              gatewayMerchantId: process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID || "exampleMerchantId",
            },
          },
        }],
      },
    }];
    const details = { total: { label: "Check", amount: { currency: "USD", value: "0.01" } } };
    try {
      const req = new PaymentRequest(methods, details);
      req.canMakePayment().then((can) => { if (can) setGooglePayAvailable(true); }).catch(() => {});
    } catch { /* PaymentRequest not supported for Google Pay */ }
  }, []);

  const handleGooglePay = useCallback(async () => {
    if (!invoice || !window.PaymentRequest) return;
    setPaying(true);
    setStep("processing");

    const invTotal = String(invoice.total ?? 0);
    const invCurrency = invoice.currency ?? "TTD";

    try {
      const methods = [{
        supportedMethods: "https://google.com/pay",
        data: {
          environment: process.env.NEXT_PUBLIC_GOOGLE_PAY_ENV === "PRODUCTION" ? "PRODUCTION" : "TEST",
          apiVersion: 2,
          apiVersionMinor: 0,
          merchantInfo: { merchantName: invoice.business?.name || "KeyFlowOS" },
          allowedPaymentMethods: [{
            type: "CARD",
            parameters: {
              allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
              allowedCardNetworks: ["VISA", "MASTERCARD", "AMEX"],
            },
            tokenizationSpecification: {
              type: "PAYMENT_GATEWAY",
              parameters: {
                gateway: process.env.NEXT_PUBLIC_GOOGLE_PAY_GATEWAY || "example",
                gatewayMerchantId: process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID || "exampleMerchantId",
              },
            },
          }],
          transactionInfo: {
            totalPriceStatus: "FINAL",
            totalPrice: invTotal,
            currencyCode: invCurrency,
            countryCode: "TT",
          },
        },
      }];

      const details = {
        total: { label: invoice.business?.name || "Payment", amount: { currency: invCurrency, value: invTotal } },
        displayItems: (invoice.items || []).map((item) => ({
          label: item.description,
          amount: { currency: invCurrency, value: String(item.total) },
        })),
      };

      const request = new PaymentRequest(methods, details);
      const response = await request.show();
      await response.complete("success");

      const res = await apiPost<{ success: boolean }>({
        path: `/commerce/invoices/${encodeURIComponent(invoiceId)}/payment-intent`,
        body: { method: "google_pay" },
      });

      if (res.data?.success) {
        setOfflineConfirmed(true);
      } else {
        setError(res.error || "Payment could not be processed");
      }
    } catch (err: unknown) {
      if (!(err instanceof Error) || err.name !== "AbortError") {
        setError("Google Pay payment was cancelled or failed");
      }
    }

    setPaying(false);
    setStep("review");
  }, [invoice, invoiceId]);

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
      setStep("review");
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
      setStep("review");
      return;
    }

    const returnUrl = encodeURIComponent(window.location.origin + window.location.pathname);
    const paypalClientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "";
    const isLive = paypalClientId.startsWith("A");
    const paypalBase = isLive ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";
    const approvalUrl = `${paypalBase}/checkoutnow?token=${orderRes.data.orderId}&return=${returnUrl}`;
    window.location.href = approvalUrl;
  }, [invoice, invoiceId]);

  const handleStripePay = useCallback(async () => {
    if (!invoice) return;
    setPaying(true);
    setStep("processing");

    const baseUrl = window.location.origin + window.location.pathname;
    const successUrl = `${baseUrl}?stripe=success`;
    const cancelUrl = `${baseUrl}?stripe=cancel`;

    const res = await apiPost<{ redirectUrl: string }>({
      path: `/payments/invoice/${encodeURIComponent(invoiceId)}/stripe`,
      body: { successUrl, cancelUrl },
    });

    if (res.error || !res.data?.redirectUrl) {
      setError(res.error || "Failed to initiate Stripe payment");
      setPaying(false);
      setStep("review");
      return;
    }

    window.location.href = res.data.redirectUrl;
  }, [invoice, invoiceId]);

  const handleOfflinePayment = useCallback(async (method: "bank_transfer" | "cash") => {
    if (!invoice) return;
    setPaying(true);

    const res = await apiPost<{ success: boolean }>({
      path: `/commerce/invoices/${encodeURIComponent(invoiceId)}/payment-intent`,
      body: { method },
    });

    setPaying(false);

    if (res.error) {
      setError(res.error);
      return;
    }

    setOfflineConfirmed(true);
  }, [invoice, invoiceId]);

  const handlePay = useCallback(async () => {
    if (!selectedMethod) {
      setError("Please select a payment method");
      return;
    }

    setError(null);

    if (selectedMethod === "google_pay") {
      await handleGooglePay();
    } else if (selectedMethod === "wipay") {
      await handleWipayPay();
    } else if (selectedMethod === "paypal") {
      await handlePaypalPay();
    } else if (selectedMethod === "stripe") {
      await handleStripePay();
    } else if (selectedMethod === "bank_transfer" || selectedMethod === "cash") {
      await handleOfflinePayment(selectedMethod);
    }
  }, [selectedMethod, handleGooglePay, handleWipayPay, handlePaypalPay, handleStripePay, handleOfflinePayment]);

  const business = invoice?.business;
  const primaryColor = business?.primaryColor || "#F97316";
  const secondaryColor = business?.secondaryColor || "#14B8A6";
  const logoUrl = business?.logoUrl ? `${API_BASE}${business.logoUrl}` : null;


  const meta = (business?.metaData || {}) as Record<string, unknown>;
  const bankName = (meta.bankName as string) || "";
  const bankAccountNumber = (meta.bankAccountNumber as string) || "";
  const bankRoutingNumber = (meta.bankRoutingNumber as string) || "";
  const bankBranch = (meta.bankBranch as string) || "";
  const hasBankDetails = !!(bankName || bankAccountNumber);

  const subtotal = invoice?.subtotal ?? invoice?.total ?? 0;
  const taxRate = invoice?.taxRate ?? 0;
  const taxAmount = invoice?.taxAmount ?? 0;
  const discountAmount = invoice?.discountAmount ?? 0;
  const total = invoice?.total ?? 0;
  const currency = invoice?.currency ?? "TTD";

  const hasWipay = gateways.some((g) => g.id === "wipay");
  const hasPaypal = gateways.some((g) => g.id === "paypal");
  const hasStripe = gateways.some((g) => g.id === "stripe");
  const wipayGateway = gateways.find((g) => g.id === "wipay");
  const paypalGateway = gateways.find((g) => g.id === "paypal");
  const stripeGateway = gateways.find((g) => g.id === "stripe");

  const glassCard = "backdrop-blur-xl bg-white/[0.04] border border-white/[0.08] rounded-2xl shadow-2xl";
  const glassCardInner = "backdrop-blur-xl bg-white/[0.06] border border-white/[0.06] rounded-xl";

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative">
            <div
              className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
              style={{ backgroundColor: `${primaryColor}15` }}
            >
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: primaryColor }} />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-300">Loading invoice...</p>
            <p className="text-xs text-slate-500">Please wait a moment</p>
          </div>
        </div>
      </main>
    );
  }

  if (error && !invoice) {
    return (
      <PublicPageState
        variant="error"
        title="Invoice Not Found"
        message="This invoice link may be invalid or expired. If you were sent this by a business, please contact them for a new link."
        retry={() => window.location.reload()}
        primaryColor={primaryColor}
      />
    );
  }

  if (paid && invoice) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        {showConfetti && <ConfettiParticles />}
        <div className={`max-w-md w-full ${glassCard} overflow-hidden`}>
          <div
            className="h-1.5 w-full"
            style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
          />
          <div className="p-8 space-y-6">
            {business && (
              <div className="text-center">
                {logoUrl ? (
                  <Image src={logoUrl} alt={business.name} className="h-14 w-14 object-contain mx-auto rounded-xl"  width={56} height={56} unoptimized />
                ) : (
                  <div
                    className="h-14 w-14 rounded-xl flex items-center justify-center mx-auto text-white font-bold text-xl"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {business.name?.charAt(0) || "K"}
                  </div>
                )}
                <p className="text-sm font-medium mt-2 text-slate-300">{business.name}</p>
              </div>
            )}

            <div className="text-center space-y-3">
              <div className="relative w-20 h-20 mx-auto">
                <div
                  className="absolute inset-0 rounded-full animate-ping opacity-20"
                  style={{ backgroundColor: "#10B981" }}
                />
                <div className="relative w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-emerald-400">Payment Complete!</h1>
            </div>

            <div className={`${glassCardInner} p-4 space-y-3`}>
              <div className="flex items-center gap-2 mb-3">
                <Receipt className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Receipt</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Invoice</span>
                <span className="font-medium">#{invoice.invoiceNumber}</span>
              </div>
              {invoice.contact && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Client</span>
                  <span className="font-medium">
                    {[invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(" ")}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Date</span>
                <span className="font-medium">
                  {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
              <div className="border-t border-white/[0.08] pt-3 mt-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 text-sm">Total Paid</span>
                  <span className="text-xl font-bold" style={{ color: primaryColor }}>
                    {formatPrice(total, currency)}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-center text-xs text-slate-500">
              A confirmation has been sent to your email
            </p>
          </div>
        </div>
        <footer className="fixed bottom-4 left-0 right-0 text-center text-xs text-slate-600">
          Powered by <span className="font-semibold" style={{ color: primaryColor }}>KeyFlowOS</span>
        </footer>
      </main>
    );
  }

  if (offlineConfirmed && invoice) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <div className={`max-w-md w-full ${glassCard} overflow-hidden`}>
          <div
            className="h-1.5 w-full"
            style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
          />
          <div className="p-8 space-y-6">
            {business && (
              <div className="text-center">
                {logoUrl ? (
                  <Image src={logoUrl} alt={business.name} className="h-14 w-14 object-contain mx-auto rounded-xl"  width={56} height={56} unoptimized />
                ) : (
                  <div
                    className="h-14 w-14 rounded-xl flex items-center justify-center mx-auto text-white font-bold text-xl"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {business.name?.charAt(0) || "K"}
                  </div>
                )}
                <p className="text-sm font-medium mt-2 text-slate-300">{business.name}</p>
              </div>
            )}
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-blue-400" />
              </div>
              <h1 className="text-xl font-bold text-blue-400">
                {selectedMethod === "bank_transfer" ? "Bank Transfer Noted" : "Cash Payment Noted"}
              </h1>
              <p className="text-sm text-slate-400">
                {selectedMethod === "bank_transfer"
                  ? "Please complete the bank transfer using the details provided. The business has been notified of your intent to pay."
                  : `Please arrange payment in person with ${business?.name || "the business"}. They have been notified.`}
              </p>
            </div>
            <div className={`${glassCardInner} p-4`}>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Invoice</span>
                <span className="font-medium">#{invoice.invoiceNumber}</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span className="text-slate-400">Amount Due</span>
                <span className="font-bold" style={{ color: primaryColor }}>
                  {formatPrice(total, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
        <footer className="fixed bottom-4 left-0 right-0 text-center text-xs text-slate-600">
          Powered by <span className="font-semibold" style={{ color: primaryColor }}>KeyFlowOS</span>
        </footer>
      </main>
    );
  }

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">

        {business && (
          <div className="text-center space-y-3 pt-4">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={business.name}
                className="h-16 w-16 object-contain mx-auto rounded-2xl shadow-lg"
                style={{ boxShadow: `0 0 30px ${primaryColor}30` }}
               width={64} height={64} unoptimized />
            ) : (
              <div
                className="h-16 w-16 rounded-2xl flex items-center justify-center mx-auto text-white font-bold text-2xl shadow-lg"
                style={{ backgroundColor: primaryColor, boxShadow: `0 0 30px ${primaryColor}30` }}
              >
                {business.name?.charAt(0) || "K"}
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold" style={{ color: primaryColor }}>{business.name}</h1>
              {(business.city || business.country) && (
                <p className="text-xs text-slate-500 mt-0.5 flex items-center justify-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {[business.city, business.country].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          </div>
        )}

        <div className={`${glassCard} overflow-hidden`}>
          <div
            className="h-1 w-full"
            style={{ background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor})` }}
          />
          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5" style={{ color: primaryColor }} />
                <h2 className="font-semibold text-lg">Invoice Summary</h2>
              </div>
              <span
                className="text-xs font-medium px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: invoice?.status === "PAID" ? "#10B98120" : `${primaryColor}20`,
                  color: invoice?.status === "PAID" ? "#10B981" : primaryColor,
                }}
              >
                {invoice?.status || "PENDING"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={`${glassCardInner} p-3`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Hash className="w-3 h-3 text-slate-500" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Invoice #</span>
                </div>
                <p className="text-sm font-semibold">{invoice?.invoiceNumber}</p>
              </div>
              <div className={`${glassCardInner} p-3`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <User className="w-3 h-3 text-slate-500" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Client</span>
                </div>
                <p className="text-sm font-semibold truncate">
                  {invoice?.contact
                    ? [invoice.contact.firstName, invoice.contact.lastName].filter(Boolean).join(" ") || "—"
                    : "—"}
                </p>
              </div>
              <div className={`${glassCardInner} p-3`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className="w-3 h-3 text-slate-500" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Issued</span>
                </div>
                <p className="text-sm font-semibold">{formatDate(invoice?.issueDate ?? null)}</p>
              </div>
              <div className={`${glassCardInner} p-3`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className="w-3 h-3 text-slate-500" />
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Due Date</span>
                </div>
                <p className="text-sm font-semibold">{formatDate(invoice?.dueDate ?? null)}</p>
              </div>
            </div>

            {invoice?.items && invoice.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th className="text-left py-2 text-xs text-slate-500 font-medium">Item</th>
                      <th className="text-center py-2 text-xs text-slate-500 font-medium w-16">Qty</th>
                      <th className="text-right py-2 text-xs text-slate-500 font-medium w-24">Price</th>
                      <th className="text-right py-2 text-xs text-slate-500 font-medium w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item) => (
                      <tr key={item.id} className="border-b border-white/[0.04]">
                        <td className="py-2.5 text-slate-200">{item.description}</td>
                        <td className="py-2.5 text-center text-slate-400">{item.quantity}</td>
                        <td className="py-2.5 text-right text-slate-400">{formatPrice(item.unitPrice, currency)}</td>
                        <td className="py-2.5 text-right font-medium">{formatPrice(item.total, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-white/[0.08]">
              <div className="flex justify-between text-sm text-slate-400">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal, currency)}</span>
              </div>
              {taxAmount > 0 && (
                <div className="flex justify-between text-sm text-slate-400">
                  <span>Tax{taxRate ? ` (${taxRate}%)` : ""}</span>
                  <span>{formatPrice(taxAmount, currency)}</span>
                </div>
              )}
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-emerald-400">
                  <span>Discount</span>
                  <span>-{formatPrice(discountAmount, currency)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-white/[0.08]">
                <span className="font-semibold text-base">Total</span>
                <span className="text-2xl font-bold" style={{ color: primaryColor }}>
                  {formatPrice(total, currency)}
                </span>
              </div>
            </div>

            {invoice?.notes && (
              <div className={`${glassCardInner} p-3`}>
                <p className="text-xs text-slate-500 mb-1 font-medium">Notes</p>
                <p className="text-sm text-slate-300">{invoice.notes}</p>
              </div>
            )}
          </div>
        </div>

        {!paid && invoice?.status !== "PAID" && (
          <div className={`${glassCard} overflow-hidden`}>
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5" style={{ color: primaryColor }} />
                <h3 className="font-semibold text-lg">Choose Payment Method</h3>
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm text-red-300">{error}</p>
                    <button
                      onClick={() => setError(null)}
                      className="text-xs text-red-400/70 hover:text-red-300 mt-1 underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {step === "processing" ? (
                <div className="text-center py-10 space-y-4">
                  <div className="relative w-16 h-16 mx-auto">
                    <div
                      className="absolute inset-0 rounded-full animate-ping opacity-30"
                      style={{ backgroundColor: primaryColor }}
                    />
                    <div
                      className="relative w-16 h-16 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: `${primaryColor}15` }}
                    >
                      <Loader2 className="w-8 h-8 animate-spin" style={{ color: primaryColor }} />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">Redirecting to payment gateway...</p>
                    <p className="text-xs text-slate-500 mt-1">Please do not close this window</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {hasWipay && (
                      <button
                        onClick={() => { setSelectedMethod("wipay"); setError(null); }}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          selectedMethod === "wipay"
                            ? "bg-white/[0.06] scale-[1.02]"
                            : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]"
                        }`}
                        style={selectedMethod === "wipay" ? { borderColor: primaryColor } : {}}
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                          style={{ backgroundColor: `${primaryColor}15` }}
                        >
                          <CreditCard className="w-5 h-5" style={{ color: primaryColor }} />
                        </div>
                        <div className="font-medium text-sm mb-1">Pay with Card</div>
                        <div className="text-xs text-slate-500">Credit/Debit via WiPay</div>
                        <div className="text-[10px] text-slate-600 mt-2 font-medium">
                          {wipayGateway?.currencies.join(" · ") || "TTD · JMD · BBD"}
                        </div>
                      </button>
                    )}

                    {hasPaypal && (
                      <button
                        onClick={() => { setSelectedMethod("paypal"); setError(null); }}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          selectedMethod === "paypal"
                            ? "bg-white/[0.06] scale-[1.02]"
                            : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]"
                        }`}
                        style={selectedMethod === "paypal" ? { borderColor: primaryColor } : {}}
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                          style={{ backgroundColor: "#0070BA15" }}
                        >
                          <Wallet className="w-5 h-5" style={{ color: "#0070BA" }} />
                        </div>
                        <div className="font-medium text-sm mb-1">Pay with PayPal</div>
                        <div className="text-xs text-slate-500">PayPal account or card</div>
                        <div className="text-[10px] text-slate-600 mt-2 font-medium">
                          {paypalGateway?.currencies.join(" · ") || "USD"}
                        </div>
                      </button>
                    )}

                    {hasStripe && (
                      <button
                        onClick={() => { setSelectedMethod("stripe"); setError(null); }}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          selectedMethod === "stripe"
                            ? "bg-white/[0.06] scale-[1.02]"
                            : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]"
                        }`}
                        style={selectedMethod === "stripe" ? { borderColor: primaryColor } : {}}
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                          style={{ backgroundColor: "#635BFF15" }}
                        >
                          <CreditCard className="w-5 h-5" style={{ color: "#635BFF" }} />
                        </div>
                        <div className="font-medium text-sm mb-1">Pay with Stripe</div>
                        <div className="text-xs text-slate-500">Card via Stripe Checkout</div>
                        <div className="text-[10px] text-slate-600 mt-2 font-medium">
                          {stripeGateway?.currencies.join(" · ") || "USD"}
                        </div>
                      </button>
                    )}

                    {googlePayAvailable && (
                      <button
                        onClick={() => { setSelectedMethod("google_pay"); setError(null); }}
                        className={`text-left p-4 rounded-xl border-2 transition-all ${
                          selectedMethod === "google_pay"
                            ? "bg-white/[0.06] scale-[1.02]"
                            : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]"
                        }`}
                        style={selectedMethod === "google_pay" ? { borderColor: primaryColor } : {}}
                      >
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 bg-white/[0.08]">
                          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                            <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" fill="white"/>
                          </svg>
                        </div>
                        <div className="font-medium text-sm mb-1">Google Pay</div>
                        <div className="text-xs text-slate-500">Fast & secure checkout</div>
                        <div className="text-[10px] text-slate-600 mt-2 font-medium">{currency}</div>
                      </button>
                    )}

                    <button
                      onClick={() => { setSelectedMethod("bank_transfer"); setError(null); }}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        selectedMethod === "bank_transfer"
                          ? "bg-white/[0.06] scale-[1.02]"
                          : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]"
                      }`}
                      style={selectedMethod === "bank_transfer" ? { borderColor: primaryColor } : {}}
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                        style={{ backgroundColor: "#8B5CF615" }}
                      >
                        <Landmark className="w-5 h-5" style={{ color: "#8B5CF6" }} />
                      </div>
                      <div className="font-medium text-sm mb-1">Bank Transfer</div>
                      <div className="text-xs text-slate-500">Direct bank deposit</div>
                      <div className="text-[10px] text-slate-600 mt-2 font-medium">{currency}</div>
                    </button>

                    <button
                      onClick={() => { setSelectedMethod("cash"); setError(null); }}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        selectedMethod === "cash"
                          ? "bg-white/[0.06] scale-[1.02]"
                          : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.02]"
                      }`}
                      style={selectedMethod === "cash" ? { borderColor: primaryColor } : {}}
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                        style={{ backgroundColor: "#10B98115" }}
                      >
                        <Banknote className="w-5 h-5" style={{ color: "#10B981" }} />
                      </div>
                      <div className="font-medium text-sm mb-1">Cash / In-Person</div>
                      <div className="text-xs text-slate-500">Pay in person</div>
                      <div className="text-[10px] text-slate-600 mt-2 font-medium">Any currency</div>
                    </button>
                  </div>

                  {selectedMethod === "bank_transfer" && (
                    <div className={`${glassCardInner} p-4 space-y-3`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Landmark className="w-4 h-4" style={{ color: "#8B5CF6" }} />
                        <span className="text-sm font-medium">Bank Transfer Details</span>
                      </div>
                      {hasBankDetails ? (
                        <>
                          {bankName && (
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Bank</p>
                                <p className="text-sm font-medium">{bankName}</p>
                              </div>
                              <CopyButton text={bankName} />
                            </div>
                          )}
                          {bankAccountNumber && (
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Account Number</p>
                                <p className="text-sm font-medium font-mono">{bankAccountNumber}</p>
                              </div>
                              <CopyButton text={bankAccountNumber} />
                            </div>
                          )}
                          {bankRoutingNumber && (
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Routing Number</p>
                                <p className="text-sm font-medium font-mono">{bankRoutingNumber}</p>
                              </div>
                              <CopyButton text={bankRoutingNumber} />
                            </div>
                          )}
                          {bankBranch && (
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Branch</p>
                                <p className="text-sm font-medium">{bankBranch}</p>
                              </div>
                            </div>
                          )}
                          <div className="border-t border-white/[0.06] pt-3 mt-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Reference</p>
                                <p className="text-sm font-medium font-mono" style={{ color: primaryColor }}>
                                  {invoice?.invoiceNumber}
                                </p>
                              </div>
                              <CopyButton text={invoice?.invoiceNumber || ""} />
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 mt-2">
                            Please use the reference above when making your transfer, and send proof of payment to{" "}
                            <span className="text-slate-300">{business?.email || "the business"}</span>.
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-slate-400">
                          Contact {business?.name || "the business"} at{" "}
                          <span className="text-slate-300">{business?.email || business?.phone || "their office"}</span>{" "}
                          for bank transfer details.
                        </p>
                      )}
                    </div>
                  )}

                  {selectedMethod === "cash" && (
                    <div className={`${glassCardInner} p-4 space-y-3`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Banknote className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-medium">Cash / In-Person Payment</span>
                      </div>
                      <p className="text-sm text-slate-400">
                        Cash will be collected in person. The business will be notified of your intent to pay.
                      </p>
                      {(business?.address || business?.city) && (
                        <div className="flex items-start gap-2 mt-2">
                          <MapPin className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-slate-300">
                            {[business.address, business.city, business.country].filter(Boolean).join(", ")}
                          </p>
                        </div>
                      )}
                      {business?.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4 text-slate-500 flex-shrink-0" />
                          <a href={`tel:${business.phone}`} className="text-sm text-slate-300 hover:underline">
                            {business.phone}
                          </a>
                        </div>
                      )}
                      {business?.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-slate-500 flex-shrink-0" />
                          <a href={`mailto:${business.email}`} className="text-sm text-slate-300 hover:underline">
                            {business.email}
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedMethod && (
                    <Button
                      onClick={handlePay}
                      className="w-full text-base py-5 font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
                      disabled={paying}
                      style={{ backgroundColor: primaryColor }}
                    >
                      {paying ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : selectedMethod === "google_pay" ? (
                        <>
                          <svg viewBox="0 0 24 24" className="w-4 h-4 mr-2" fill="none">
                            <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" fill="white"/>
                          </svg>
                          Pay {formatPrice(total, currency)} with Google Pay
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      ) : selectedMethod === "wipay" || selectedMethod === "paypal" || selectedMethod === "stripe" ? (
                        <>
                          <CreditCard className="w-4 h-4 mr-2" />
                          Pay {formatPrice(total, currency)}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 mr-2" />
                          Confirm {selectedMethod === "bank_transfer" ? "Bank Transfer" : "Cash Payment"}
                        </>
                      )}
                    </Button>
                  )}

                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-600">
                    <Shield className="w-3 h-3" />
                    <span>Secure payment processing</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {business && (business.facebook || business.instagram || business.twitter || business.whatsapp || business.website) && (
          <div className="flex items-center justify-center gap-2 flex-wrap pt-2">
            {business.facebook && (
              <a
                href={business.facebook.startsWith("http") ? business.facebook : `https://facebook.com/${business.facebook}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                aria-label="Facebook"
              >
                <Globe className="w-3.5 h-3.5 text-slate-500" />
              </a>
            )}
            {business.instagram && (
              <a
                href={business.instagram.startsWith("http") ? business.instagram : `https://instagram.com/${business.instagram}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                aria-label="Instagram"
              >
                <Globe className="w-3.5 h-3.5 text-slate-500" />
              </a>
            )}
            {business.twitter && (
              <a
                href={business.twitter.startsWith("http") ? business.twitter : `https://x.com/${business.twitter.replace(/^@/, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                aria-label="Twitter / X"
              >
                <Globe className="w-3.5 h-3.5 text-slate-500" />
              </a>
            )}
            {business.whatsapp && (
              <a
                href={`https://wa.me/${business.whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                aria-label="WhatsApp"
              >
                <Phone className="w-3.5 h-3.5 text-slate-500" />
              </a>
            )}
            {business.website && /^https?:\/\//i.test(business.website) && (
              <a
                href={business.website}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
                aria-label="Website"
              >
                <Globe className="w-3.5 h-3.5 text-slate-500" />
              </a>
            )}
          </div>
        )}

        <div className="text-center text-xs text-slate-600 pb-6">
          Powered by <span className="font-semibold" style={{ color: primaryColor }}>KeyFlowOS</span>
        </div>
      </div>
    </main>
  );
}

export default function PublicPaymentPage() {
  return (
    <Suspense fallback={null}>
      <PublicPaymentPageInner />
    </Suspense>
  );
}

