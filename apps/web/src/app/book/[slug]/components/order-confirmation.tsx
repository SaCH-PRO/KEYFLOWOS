"use client";

import {
  CheckCircle2,
  CalendarPlus,
  Clock,
  MapPin,
  Star,
  Mail,
  ArrowRight,
  ShoppingBag,
  Bell,
  FileText,
  AlertTriangle,
  RefreshCw,
  Package,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { ShareButtons } from "./share-buttons";
import type { CartItem, PaymentMethod } from "./types";

type Props = {
  isOrder: boolean;
  businessName: string;
  businessAddress?: string | null;
  businessWhatsapp?: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  confirmedDetails: {
    serviceNames: string[];
    dates: string[];
    times: string[];
    businessName: string;
  } | null;
  bookingResults: { bookingId: string; invoiceId?: string }[];
  calendarUrl: string | null;
  apiBase: string;
  orderItems?: CartItem[];
  orderTotal?: number;
  orderCurrency?: string;
  paymentMethod?: PaymentMethod;
  orderNumber?: string | null;
  orderId?: string | null;
  estimatedDelivery?: string | null;
  paymentFailed?: boolean;
  paymentPending?: boolean;
  customerEmail?: string | null;
  onContinueShopping: () => void;
  onRetryPayment?: () => void;
  formatDate: (d: string) => string;
  formatTime: (t: string) => string;
};

const timelineSteps = [
  {
    icon: Mail,
    title: "Confirmation Email",
    desc: "A confirmation will be sent to your email shortly",
    delay: "500ms",
  },
  {
    icon: Bell,
    title: "Reminder",
    desc: "We'll send you a reminder before your appointment",
    delay: "600ms",
  },
  {
    icon: Star,
    title: "Arrive & Enjoy",
    desc: "Show up at your scheduled time and enjoy the experience",
    delay: "700ms",
  },
];

const orderTimelineSteps = [
  {
    icon: Mail,
    title: "Confirmation Email",
    desc: "Order details will be sent to your email",
    delay: "500ms",
  },
  {
    icon: FileText,
    title: "Order Processing",
    desc: "The business will prepare and process your order",
    delay: "600ms",
  },
  {
    icon: CheckCircle2,
    title: "Ready for You",
    desc: "You'll be notified when your order is ready",
    delay: "700ms",
  },
];

const paymentMethodLabels: Record<string, string> = {
  wipay: "WiPay (Card)",
  paypal: "PayPal",
  cash: "Cash / Manual",
};

export function OrderConfirmation({
  isOrder,
  businessName,
  businessAddress,
  businessWhatsapp,
  primaryColor,
  secondaryColor,
  accentColor,
  confirmedDetails,
  bookingResults,
  calendarUrl,
  apiBase,
  orderItems,
  orderTotal,
  orderCurrency,
  paymentMethod,
  orderNumber,
  orderId,
  estimatedDelivery,
  paymentFailed,
  paymentPending,
  customerEmail,
  onContinueShopping,
  onRetryPayment,
  formatDate,
  formatTime,
}: Props) {
  const steps = isOrder ? orderTimelineSteps : timelineSteps;

  if (paymentPending) {
    return (
      <div
        className="relative max-w-lg w-full rounded-3xl border border-yellow-500/20 backdrop-blur-xl p-8 sm:p-10 text-center space-y-6"
        style={{
          background: "linear-gradient(135deg, rgba(234,179,8,0.06) 0%, rgba(234,179,8,0.02) 100%)",
          animation: "successPop 600ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div className="w-20 h-20 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto relative">
          <Clock className="w-10 h-10 text-yellow-400 relative" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-yellow-400 mb-2">Payment Processing</h1>
          <p className="text-sm text-white/50 leading-relaxed">
            Your payment is still being processed. This may take a moment.
            Please check back shortly or contact the business if the issue persists.
          </p>
        </div>

        {orderNumber && (
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
            <p className="text-xs text-white/40 mb-1">Order Reference</p>
            <p className="text-sm font-mono font-semibold text-white/80">{orderNumber}</p>
          </div>
        )}

        <div className="flex flex-col gap-3 pt-2">
          {onRetryPayment && (
            <button
              onClick={onRetryPayment}
              className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white transition-all duration-300 hover:scale-[1.015] active:scale-[0.98] inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
            >
              <RefreshCw className="w-4 h-4" />
              Retry Payment
            </button>
          )}
          <button
            onClick={onContinueShopping}
            className="w-full py-3 rounded-2xl border border-white/[0.06] text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.03] transition-all duration-200 flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            Back to Shop
          </button>
        </div>
      </div>
    );
  }

  if (paymentFailed) {
    return (
      <div
        className="relative max-w-lg w-full rounded-3xl border border-red-500/20 backdrop-blur-xl p-8 sm:p-10 text-center space-y-6"
        style={{
          background: "linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(239,68,68,0.02) 100%)",
          animation: "successPop 600ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div className="w-20 h-20 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto relative">
          <AlertTriangle className="w-10 h-10 text-red-400 relative" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-red-400 mb-2">Payment Failed</h1>
          <p className="text-sm text-white/50 leading-relaxed">
            Something went wrong with your payment. Please try again or choose a different payment method.
          </p>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          {onRetryPayment && (
            <button
              onClick={onRetryPayment}
              className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white transition-all duration-300 hover:scale-[1.015] active:scale-[0.98] inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          )}
          <button
            onClick={onContinueShopping}
            className="w-full py-3 rounded-2xl border border-white/[0.06] text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.03] transition-all duration-200 flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            Back to Shop
          </button>
        </div>
      </div>
    );
  }

  const displayOrderNumber = orderNumber || bookingResults[0]?.bookingId?.slice(-8)?.toUpperCase() || "";

  return (
    <div
      className="relative max-w-lg w-full rounded-3xl border border-emerald-500/20 backdrop-blur-xl p-8 sm:p-10 text-center space-y-6"
      style={{
        background: "linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(16,185,129,0.02) 100%)",
        animation: "successPop 600ms cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      <div
        className="w-20 h-20 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto relative"
        style={{ animation: "checkBounce 800ms cubic-bezier(0.16,1,0.3,1) 200ms both" }}
      >
        <div
          className="absolute inset-0 rounded-2xl opacity-30 blur-xl"
          style={{ backgroundColor: "#10b981" }}
        />
        <CheckCircle2 className="w-10 h-10 text-emerald-400 relative" />
      </div>

      <div style={{ animation: "fadeUp 500ms ease-out 300ms both" }}>
        <h1 className="text-2xl font-bold text-emerald-400 mb-2">
          {isOrder ? "Order Placed!" : "Booking Confirmed!"}
        </h1>
        <p className="text-sm text-white/50 leading-relaxed">
          Your {isOrder ? "order" : "appointment"} with{" "}
          <span className="font-semibold text-white/80">{businessName}</span> has been confirmed.
        </p>
      </div>

      <div className="space-y-3" style={{ animation: "fadeUp 500ms ease-out 350ms both" }}>
        {orderNumber && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 inline-flex items-center gap-2 mx-auto">
            <span className="text-[11px] text-white/40">Order #</span>
            <code className="font-mono text-sm font-bold tracking-wider" style={{ color: primaryColor }}>
              {orderNumber}
            </code>
          </div>
        )}
        {bookingResults.filter((br) => !br.bookingId.startsWith("ORD-")).map((br, idx) => (
          <div
            key={idx}
            className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 inline-flex items-center gap-2 mx-auto"
          >
            <span className="text-[11px] text-white/40">Booking Ref:</span>
            <code className="font-mono text-sm font-bold tracking-wider" style={{ color: primaryColor }}>
              {br.bookingId.slice(-8).toUpperCase()}
            </code>
          </div>
        ))}
      </div>

      {orderItems && orderItems.length > 0 && (
        <div
          className="rounded-2xl border border-white/[0.06] overflow-hidden text-left"
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
            animation: "fadeUp 500ms ease-out 380ms both",
          }}
        >
          <div className="px-4 py-3 border-b border-white/[0.04]">
            <p className="text-[10px] uppercase tracking-widest text-white/30 font-medium">Items Ordered</p>
          </div>
          <div className="p-4 space-y-2">
            {orderItems.map((item) => (
              <div key={`${item.id}_${item.itemType}`} className="flex justify-between text-sm items-center">
                <div className="flex items-center gap-2">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-8 h-8 rounded-lg object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center">
                      <Package className="w-4 h-4 text-white/20" />
                    </div>
                  )}
                  <span className="text-white/60">{item.name}</span>
                  <span className="text-[10px] text-white/30 bg-white/[0.04] px-1.5 py-0.5 rounded">x{item.quantity}</span>
                </div>
                <span className="text-white/70 font-medium tabular-nums">
                  {formatPrice(item.price * item.quantity, item.currency)}
                </span>
              </div>
            ))}
            {orderTotal !== undefined && orderCurrency && (
              <div className="border-t border-white/[0.04] pt-2 flex justify-between items-center">
                <span className="text-sm font-medium text-white/50">Total</span>
                <span className="text-base font-bold tabular-nums" style={{ color: primaryColor }}>
                  {formatPrice(orderTotal, orderCurrency)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmedDetails && confirmedDetails.serviceNames.length > 0 && !isOrder && (
        <div className="space-y-2" style={{ animation: "fadeUp 500ms ease-out 400ms both" }}>
          {confirmedDetails.serviceNames.map((name, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-left space-y-1.5"
            >
              <p className="text-sm font-medium text-white/80">{name}</p>
              <div className="flex items-center gap-4 text-[12px] text-white/45">
                {confirmedDetails.dates[idx] && (
                  <span className="flex items-center gap-1">
                    <CalendarPlus className="w-3 h-3" />
                    {formatDate(confirmedDetails.dates[idx])}
                  </span>
                )}
                {confirmedDetails.times[idx] && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTime(confirmedDetails.times[idx])}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(paymentMethod || estimatedDelivery) && (
        <div
          className="rounded-2xl border border-white/[0.06] overflow-hidden text-left"
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
            animation: "fadeUp 500ms ease-out 420ms both",
          }}
        >
          <div className="p-4 space-y-2">
            {paymentMethod && (
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Payment</span>
                <span className="text-white/60">{paymentMethodLabels[paymentMethod] || paymentMethod}</span>
              </div>
            )}
            {estimatedDelivery && (
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Est. Delivery</span>
                <span className="text-white/60">{estimatedDelivery}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className="rounded-2xl border border-white/[0.06] overflow-hidden text-left"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
          animation: "fadeUp 500ms ease-out 480ms both",
        }}
      >
        <div className="px-4 py-3 border-b border-white/[0.04]">
          <p className="text-[10px] uppercase tracking-widest text-white/30 font-medium">
            What Happens Next
          </p>
        </div>
        <div className="p-4 space-y-0">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            const isLast = idx === steps.length - 1;
            return (
              <div
                key={step.title}
                className="flex gap-3 relative"
                style={{ animation: `fadeUp 400ms ease-out ${step.delay} both` }}
              >
                <div className="flex flex-col items-center">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${primaryColor}12` }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                  </div>
                  {!isLast && (
                    <div
                      className="w-px flex-1 my-1"
                      style={{ background: `${primaryColor}15` }}
                    />
                  )}
                </div>
                <div className={`pb-4 ${isLast ? "pb-0" : ""}`}>
                  <p className="text-xs font-medium text-white/70">{step.title}</p>
                  <p className="text-[11px] text-white/35 mt-0.5">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2" style={{ animation: "fadeUp 500ms ease-out 600ms both" }}>
        {calendarUrl && (
          <a
            href={calendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white transition-all duration-300 hover:scale-[1.015] active:scale-[0.98] inline-flex items-center justify-center gap-2 min-h-[44px]"
            style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
          >
            <CalendarPlus className="w-4 h-4" />
            Add to Calendar
          </a>
        )}
        {(bookingResults.some((br) => br.invoiceId) || orderId) && (
          <button
            onClick={() => {
              if (orderId) {
                const emailParam = customerEmail ? `?email=${encodeURIComponent(customerEmail)}` : "";
                window.open(`${apiBase}/site/storefront/public/order/${orderId}${emailParam}`, "_blank");
              } else {
                const inv = bookingResults.find((br) => br.invoiceId);
                if (inv?.invoiceId) window.open(`${apiBase}/commerce/invoices/${inv.invoiceId}/receipt`, "_blank");
              }
            }}
            aria-label="Download receipt"
            className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all duration-300 hover:scale-[1.015] active:scale-[0.98] min-h-[44px]"
            style={{
              backgroundColor: calendarUrl ? "transparent" : primaryColor,
              color: "white",
              border: calendarUrl ? "1px solid rgba(255,255,255,0.1)" : "none",
              boxShadow: calendarUrl ? "none" : `0 8px 32px ${primaryColor}30`,
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <FileText className="w-4 h-4" />
              {orderId ? "View Order Details" : "Download Receipt"}
            </span>
          </button>
        )}

        <div className="space-y-2">
          <p className="text-xs text-white/40">Share with friends</p>
          <div className="flex justify-center">
            <ShareButtons
              url={typeof window !== "undefined" ? window.location.href : ""}
              title={isOrder ? `Just ordered from ${businessName}!` : `Just booked with ${businessName}!`}
              description={`Check out ${businessName}`}
              primaryColor={primaryColor}
            />
          </div>
        </div>

        <button
          onClick={onContinueShopping}
          className="w-full py-3 rounded-2xl border border-white/[0.06] text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.03] transition-all duration-200 flex items-center justify-center gap-2 min-h-[44px]"
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          Continue Shopping
        </button>
      </div>

      {businessAddress && (
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-white/25" style={{ animation: "fadeUp 500ms ease-out 700ms both" }}>
          <MapPin className="w-3 h-3" />
          <span>{businessAddress}</span>
        </div>
      )}

      {isOrder && !customerEmail && (
        <div
          className="rounded-2xl border border-white/[0.06] overflow-hidden text-left"
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
            animation: "fadeUp 500ms ease-out 750ms both",
          }}
        >
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${secondaryColor}15` }}
              >
                <Bell className="w-4 h-4" style={{ color: secondaryColor }} />
              </div>
              <div>
                <p className="text-xs font-medium text-white/70">Get Order Updates</p>
                <p className="text-[10px] text-white/35">Receive status notifications via email</p>
              </div>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const emailInput = form.elements.namedItem("notifyEmail") as HTMLInputElement;
                if (emailInput?.value && orderId) {
                  const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
                  if (btn) {
                    btn.textContent = "Saving...";
                    btn.disabled = true;
                  }
                  try {
                    await fetch(`${apiBase}/site/storefront/public/order/${orderId}/notify`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ email: emailInput.value }),
                    });
                  } catch {}
                  if (btn) {
                    btn.textContent = "Subscribed!";
                    btn.style.opacity = "0.6";
                  }
                }
              }}
              className="flex gap-2"
            >
              <input
                name="notifyEmail"
                type="email"
                required
                placeholder="your@email.com"
                className="flex-1 rounded-xl px-3 py-2.5 text-sm min-h-[44px]"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.8)",
                }}
              />
              <button
                type="submit"
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all hover:scale-[1.02] active:scale-[0.98] min-h-[44px]"
                style={{ backgroundColor: secondaryColor }}
              >
                Notify Me
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/20">
        <Star className="w-3 h-3" />
        <span>Thank you for your business</span>
      </div>
    </div>
  );
}
