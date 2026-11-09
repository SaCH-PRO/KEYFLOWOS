"use client";

/**
 * The customer pay page, keyed by the pay-link token.
 *
 * V1-46-PUB-PAY-LINK-TOKEN-GATE (M34; D-07, ruled 2026-10-31: token links
 * only, the bare-id pay page is retired). This page used to resolve the token
 * and router.replace() to /pay/:invoiceId, whose every API call was keyed by
 * the bare invoice id, so deactivating or expiring a link did nothing once
 * the customer was past the first visit. It is now the pay page itself:
 *
 *   - the invoice is read through GET /commerce/public/invoice-link/:token/pay
 *     (the same redacted projection the bare-id read serves; 404 once the
 *     link is deactivated or expired);
 *   - the bank-transfer, cash and Google Pay intents go through POST
 *     /commerce/public/invoice-link/:token/payment-intent;
 *   - provider returns (WiPay, PayPal, Stripe) come back to this URL and
 *     re-read through the token. When the link has closed by then (paying a
 *     pre-V1-48 link rotates its token), the page says the payment was
 *     received or submitted, not that the link is invalid (review CR-02).
 *
 * V1-46b-TOKEN-PAY-COMPLETE (review ST-1): the status poll, the gateway
 * list, the Stripe / WiPay / PayPal checkouts and the PayPal capture are the
 * token routes of payments.controller.ts (/payments/public/invoice-link/
 * :token/..., through lib/client.ts), so every call this page makes is keyed
 * by the token and stops when the link is revoked or expires. The token read
 * no longer returns the invoice id, and the page never uses one. The one
 * place the id still travels is WiPay (review SEC-V46B-4): WiPay keys its
 * hosted page and its callback by order_id, which is the invoice id, so a
 * WiPay return brings it back in this URL and the page forwards the query
 * to /payments/wipay/callback as it is. Once the link is revoked or expires
 * that id opens no bare-id route (the server answers 404) and no reminder
 * mints a new link.
 */

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button } from "@keyflow/ui";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import { pickBusinessId } from "@/app/_lib/presence-sdk";
import { PresenceTracker } from "@/app/_lib/PresenceTracker";
import { formatPrice } from "@/lib/format";
import {
  capturePayLinkPaypalOrder,
  createPayLinkCheckout,
  getPayLinkGateways,
  getPayLinkStatus,
  type PayLinkCheckoutBody,
  type PayLinkStatus,
} from "@/lib/client";
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

// V1-46b (TG-16): the token read carries no invoice id; the page needs none.
type Invoice = {
  /** The tenant key the projection carries for the presence tracker. */
  businessId?: string;
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
  /** From the public projection (computeBalance): what is still owed. */
  remaining?: number;
  /** From the public projection: the money received, net of refunds. */
  paid?: number;
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

/**
 * W5-CREDIT-AWARE-PAY (W4-CREDIT-AWARE-READERS review CR-AR-2; D-78): whether nothing is owed. PAID, or
 * a PARTIALLY_CREDITED invoice whose remainder (the server's figure, net of its APPLIED credit notes) is
 * paid: paying what a credit leaves owing keeps it PARTIALLY_CREDITED, never PAID.
 */
function isSettled(inv: { status?: string; remaining?: number } | null | undefined): boolean {
  if (!inv) return false;
  if (inv.status === "PAID") return true;
  return inv.status === "PARTIALLY_CREDITED" && typeof inv.remaining === "number" && inv.remaining <= 0;
}

/** W5-CREDIT-AWARE-PAY: the token status poll's `credited` (present only for a credited invoice). */
function creditedOf(poll: PayLinkStatus | undefined | null): number | null {
  const figure = (poll as (PayLinkStatus & { credited?: unknown }) | undefined | null)?.credited;
  return typeof figure === "number" ? figure : null;
}

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

/** What the page says when the token does not open a payable invoice. */
const LINK_UNAVAILABLE = "This payment link is invalid, has expired or has been deactivated.";

/** The token routes' answer for a link that no longer opens (unknown, inactive, expired, rotated). */
function linkGone(res: { data: unknown; rawError?: Record<string, unknown> | null }): boolean {
  return !res.data && res.rawError?.statusCode === 404;
}

/**
 * V1-46 review CR-02: a provider sent the customer back here after the
 * payment, and the link no longer opens. Paying a pre-V1-48 (cuid) link
 * rotates its token (invoice.paid -> receipt listener -> findAnyPaymentLink ->
 * reissueLink, ST-V48-1), and a link can also lapse or be deactivated while
 * the customer is at the provider. The page can no longer show the invoice,
 * but it must not tell a customer who has just paid that their link is
 * invalid. "received": the WiPay callback or the PayPal capture said the
 * money was taken. "submitted": Stripe returned to the success URL, which this
 * page cannot confirm without the link.
 */
type ClosedAfterPayment = "received" | "submitted";

function PaymentClosedState({ kind }: { kind: ClosedAfterPayment }) {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full backdrop-blur-xl bg-white/[0.04] border border-white/[0.08] rounded-2xl shadow-2xl p-8 space-y-4 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        </div>
        <h1 className="text-xl font-bold text-emerald-400">
          {kind === "received" ? "Payment received" : "Payment submitted"}
        </h1>
        <p className="text-sm text-slate-400">
          {kind === "received"
            ? "Thank you. Your payment was received."
            : "Thank you. Your payment was submitted to the card processor."}{" "}
          This payment link is no longer active, so the invoice cannot be shown here. The business will email your
          receipt once the payment is confirmed.
        </p>
      </div>
    </main>
  );
}

function TokenPaymentPageInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  // Every customer read and intent goes through the token.
  const payPath = `/commerce/public/invoice-link/${encodeURIComponent(token)}/pay`;
  const intentPath = `/commerce/public/invoice-link/${encodeURIComponent(token)}/payment-intent`;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const paypalCaptured = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [step, setStep] = useState<"review" | "gateway" | "processing">("review");
  const [showConfetti, setShowConfetti] = useState(false);
  const [offlineConfirmed, setOfflineConfirmed] = useState(false);
  // W5-CREDIT-AWARE-PAY (CR-AR-2): the server's credited figure for a part-credited invoice; null otherwise.
  const [credited, setCredited] = useState<number | null>(null);

  const [googlePayAvailable, setGooglePayAvailable] = useState(false);

  const wipayStatus = searchParams.get("status");
  const wipayOrderId = searchParams.get("order_id");
  const paypalToken = searchParams.get("token");
  const _paypalPayerId = searchParams.get("PayerID");
  const stripeReturn = searchParams.get("stripe");

  // CR-02: what the provider said about the payment this return is for, and
  // whether a token read has since answered 404 (see PaymentClosedState).
  const [providerOutcome, setProviderOutcome] = useState<ClosedAfterPayment | null>(
    stripeReturn === "success" ? "submitted" : null,
  );
  const [tokenGone, setTokenGone] = useState(false);
  // A WiPay return decides the page only once its callback has answered.
  const [wipayPending, setWipayPending] = useState(Boolean(wipayStatus && wipayOrderId));

  useEffect(() => {
    if (stripeReturn === "success") {
      let cancelled = false;
      const poll = async (attempt = 0) => {
        const res = await getPayLinkStatus(token);
        if (cancelled) return;
        // W5-CREDIT-AWARE-PAY (D-78): a part-credited invoice is settled at remaining 0, never PAID.
        if (isSettled(res.data)) {
          if (creditedOf(res.data) !== null) setCredited(creditedOf(res.data));
          const fresh = await apiGet<Invoice>(payPath);
          if (cancelled) return;
          if (fresh.data) setInvoice(fresh.data);
          else if (linkGone(fresh)) setTokenGone(true);
          setPaid(true);
          setShowConfetti(true);
          return;
        }
        if (linkGone(res)) {
          setTokenGone(true);
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
  }, [stripeReturn, payPath, token]);

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
          setProviderOutcome("received");
          const invoiceRes = await apiGet<Invoice>(payPath);
          if (invoiceRes.data) setInvoice(invoiceRes.data);
          else if (linkGone(invoiceRes)) setTokenGone(true);
        } else {
          setError(res.data?.message || res.error || "Payment was not successful");
        }
        setStep("review");
        setWipayPending(false);
      };
      processWipayReturn();
    }
  }, [wipayStatus, wipayOrderId, payPath]);

  // PayPal returns here with its order token (`?token=`, distinct from the
  // pay-link token in the path). V1-46b: the capture is keyed by the pay-link
  // token (the server records it against that link's invoice), so it runs
  // once, without waiting for the invoice read.
  useEffect(() => {
    if (paypalToken && !paypalCaptured.current) {
      paypalCaptured.current = true;
      const capturePaypal = async () => {
        setStep("processing");
        const res = await capturePayLinkPaypalOrder(token, paypalToken);
        if (res.data?.status === "COMPLETED") {
          setPaid(true);
          setShowConfetti(true);
          setProviderOutcome("received");
          const invoiceRes = await apiGet<Invoice>(payPath);
          if (invoiceRes.data) setInvoice(invoiceRes.data);
          else if (linkGone(invoiceRes)) setTokenGone(true);
        } else {
          setError(res.error || "PayPal payment could not be completed");
        }
        setStep("review");
      };
      capturePaypal();
    }
  }, [paypalToken, token, payPath]);

  useEffect(() => {
    const loadInvoice = async () => {
      setLoading(true);
      // The token decides first: a deactivated, expired or unknown link stops
      // here, before any gateway is listed or any action offered.
      const invoiceRes = await apiGet<Invoice>(payPath);
      if (invoiceRes.error || !invoiceRes.data) {
        setInvoice(null);
        setError(LINK_UNAVAILABLE);
        if (linkGone(invoiceRes)) setTokenGone(true);
        setLoading(false);
        return;
      }
      const loaded = invoiceRes.data;
      const gatewayRes = await getPayLinkGateways(token);

      setInvoice(loaded);
      if (isSettled(loaded)) {
        setPaid(true);
      }
      // W5-CREDIT-AWARE-PAY (CR-AR-2): a part-credited invoice shows the server's credited figure.
      if (loaded.status === "PARTIALLY_CREDITED") {
        const poll = await getPayLinkStatus(token);
        if (creditedOf(poll.data) !== null) setCredited(creditedOf(poll.data));
      }

      if (gatewayRes.data) {
        const gwList: Gateway[] = Array.isArray(gatewayRes.data) ? gatewayRes.data : (gatewayRes.data as { gateways?: Gateway[] }).gateways || [];
        setGateways(gwList);
      }

      setLoading(false);
    };
    loadInvoice();
  }, [payPath, token]);

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

    // W5-CREDIT-AWARE-PAY: what is still owed (net of payments and credit notes), not the total.
    const invTotal = String(typeof invoice.remaining === "number" ? invoice.remaining : invoice.total ?? 0);
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
        path: intentPath,
        body: { method: "google_pay" },
      });

      if (res.data?.success) {
        setOfflineConfirmed(true);
      } else if (res.rawError?.statusCode === 404) {
        // V1-46: the link was deactivated or expired since the page loaded.
        setInvoice(null);
        setError(LINK_UNAVAILABLE);
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
  }, [invoice, intentPath]);

  /**
   * V1-46b: every provider checkout goes through the token route. A 404 means
   * the link was deactivated or expired since the page loaded.
   */
  const startCheckout = useCallback(async (body: PayLinkCheckoutBody) => {
    const res = await createPayLinkCheckout(token, body);
    if (res.rawError?.statusCode === 404) {
      setInvoice(null);
      setError(LINK_UNAVAILABLE);
      setPaying(false);
      setStep("review");
      return null;
    }
    return res;
  }, [token]);

  const handleWipayPay = useCallback(async () => {
    if (!invoice) return;
    setPaying(true);
    setStep("processing");

    const currentUrl = window.location.origin + window.location.pathname;

    const res = await startCheckout({ gateway: "wipay", returnUrl: currentUrl });
    if (!res) return;
    const redirectUrl = res.data?.type === "redirect" ? res.data.redirectUrl : null;

    if (res.error || !redirectUrl) {
      setError(res.error || "Failed to initiate payment");
      setPaying(false);
      setStep("review");
      return;
    }

    window.location.href = redirectUrl;
  }, [invoice, startCheckout]);

  const handlePaypalPay = useCallback(async () => {
    if (!invoice) return;
    setPaying(true);
    setStep("processing");

    const orderRes = await startCheckout({ gateway: "paypal" });
    if (!orderRes) return;
    const orderId = orderRes.data?.type === "paypal_order" ? orderRes.data.orderId : null;

    if (orderRes.error || !orderId) {
      setError(orderRes.error || "Failed to create PayPal order");
      setPaying(false);
      setStep("review");
      return;
    }

    const returnUrl = encodeURIComponent(window.location.origin + window.location.pathname);
    const paypalClientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "";
    const isLive = paypalClientId.startsWith("A");
    const paypalBase = isLive ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";
    const approvalUrl = `${paypalBase}/checkoutnow?token=${orderId}&return=${returnUrl}`;
    window.location.href = approvalUrl;
  }, [invoice, startCheckout]);

  const handleStripePay = useCallback(async () => {
    if (!invoice) return;
    setPaying(true);
    setStep("processing");

    const baseUrl = window.location.origin + window.location.pathname;
    const successUrl = `${baseUrl}?stripe=success`;
    const cancelUrl = `${baseUrl}?stripe=cancel`;

    const res = await startCheckout({ gateway: "stripe", successUrl, cancelUrl });
    if (!res) return;
    const redirectUrl = res.data?.type === "redirect" ? res.data.redirectUrl : null;

    if (res.error || !redirectUrl) {
      setError(res.error || "Failed to initiate Stripe payment");
      setPaying(false);
      setStep("review");
      return;
    }

    window.location.href = redirectUrl;
  }, [invoice, startCheckout]);

  const handleOfflinePayment = useCallback(async (method: "bank_transfer" | "cash") => {
    if (!invoice) return;
    setPaying(true);

    const res = await apiPost<{ success: boolean }>({
      path: intentPath,
      body: { method },
    });

    setPaying(false);

    if (res.error) {
      // R0-22: an intent on a settled invoice answers 409. Re-read the
      // invoice so the page shows its paid state instead of a bare error.
      if (res.rawError?.statusCode === 409) {
        const fresh = await apiGet<Invoice>(payPath);
        if (fresh.data) {
          setInvoice(fresh.data);
          if (isSettled(fresh.data)) {
            setPaid(true);
            return;
          }
        }
      }
      // V1-46: the link was deactivated or expired since the page loaded.
      if (res.rawError?.statusCode === 404) {
        setInvoice(null);
        setError(LINK_UNAVAILABLE);
        return;
      }
      setError(res.error);
      return;
    }

    setOfflineConfirmed(true);
  }, [invoice, intentPath, payPath]);

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
  // R0-22: what is still owed (the public projection's remaining), not the
  // total, so a partly paid invoice does not ask for money already received.
  const amountDue = typeof invoice?.remaining === "number" ? invoice.remaining : total;

  const hasWipay = gateways.some((g) => g.id === "wipay");
  const hasPaypal = gateways.some((g) => g.id === "paypal");
  const hasStripe = gateways.some((g) => g.id === "stripe");
  const wipayGateway = gateways.find((g) => g.id === "wipay");
  const paypalGateway = gateways.find((g) => g.id === "paypal");
  const stripeGateway = gateways.find((g) => g.id === "stripe");

  const glassCard = "backdrop-blur-xl bg-white/[0.04] border border-white/[0.08] rounded-2xl shadow-2xl";
  const glassCardInner = "backdrop-blur-xl bg-white/[0.06] border border-white/[0.06] rounded-xl";

  if (loading || (wipayPending && !invoice)) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center">
        <PresenceTracker businessId={pickBusinessId(invoice) ?? null} />
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

  // CR-02: the provider took (or was handed) the payment and the link has
  // since closed. A view of the invoice already on screen as paid is kept
  // (below); otherwise the customer gets the neutral state, never the
  // link-error state and never a stale unpaid view.
  if (providerOutcome && tokenGone && !(paid && invoice)) {
    return <PaymentClosedState kind={providerOutcome} />;
  }

  if (error && !invoice) {
    return (
      <>
        <PresenceTracker businessId={pickBusinessId(invoice) ?? null} />
        <PublicPageState
          variant="error"
          title="Payment Link Error"
          message={`${error ?? LINK_UNAVAILABLE} Please contact the business for a new payment link.`}
          retry={() => window.location.reload()}
          primaryColor={primaryColor}
        />
      </>
    );
  }

  if (paid && invoice) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-black to-slate-950 text-white flex items-center justify-center px-4">
        <PresenceTracker businessId={pickBusinessId(invoice) ?? null} />
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
              {/* W5-CREDIT-AWARE-PAY (CR-AR-2, D-78): a settled part-credited invoice states its credit, and
                  what was paid is the server's received figure, not the total. */}
              {credited !== null && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Credited</span>
                  <span className="font-medium text-emerald-400" data-testid="pay-link-credited">
                    {formatPrice(credited, currency)}
                  </span>
                </div>
              )}
              <div className="border-t border-white/[0.08] pt-3 mt-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 text-sm">Total Paid</span>
                  <span className="text-xl font-bold" style={{ color: primaryColor }} data-testid="pay-link-total-paid">
                    {formatPrice(
                      invoice.status === "PARTIALLY_CREDITED" && typeof invoice.paid === "number" ? invoice.paid : total,
                      currency,
                    )}
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
        <PresenceTracker businessId={pickBusinessId(invoice) ?? null} />
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
                  {formatPrice(amountDue, currency)}
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
      <PresenceTracker businessId={pickBusinessId(invoice) ?? null} />
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
                  backgroundColor: isSettled(invoice) ? "#10B98120" : `${primaryColor}20`,
                  color: isSettled(invoice) ? "#10B981" : primaryColor,
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
              {/* W5-CREDIT-AWARE-PAY (CR-AR-2): a part-credited invoice states its credit and what it still owes. */}
              {invoice?.status === "PARTIALLY_CREDITED" && (
                <>
                  {credited !== null && (
                    <div className="flex justify-between text-sm text-emerald-400">
                      <span>Credited</span>
                      <span data-testid="pay-link-credited">-{formatPrice(credited, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Amount due</span>
                    <span data-testid="pay-link-amount-due">{formatPrice(amountDue, currency)}</span>
                  </div>
                </>
              )}
            </div>

            {invoice?.notes && (
              <div className={`${glassCardInner} p-3`}>
                <p className="text-xs text-slate-500 mb-1 font-medium">Notes</p>
                <p className="text-sm text-slate-300">{invoice.notes}</p>
              </div>
            )}
          </div>
        </div>

        {!paid && !isSettled(invoice) && (
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
                          Pay {formatPrice(amountDue, currency)} with Google Pay
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      ) : selectedMethod === "wipay" || selectedMethod === "paypal" || selectedMethod === "stripe" ? (
                        <>
                          <CreditCard className="w-4 h-4 mr-2" />
                          {/* W5-CREDIT-AWARE-PAY: every provider checkout asks for the remainder, not the total. */}
                          Pay {formatPrice(amountDue, currency)}
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

export default function PaymentLinkPage() {
  return (
    <Suspense fallback={null}>
      <TokenPaymentPageInner />
    </Suspense>
  );
}

