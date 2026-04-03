"use client";

import {
  CheckCircle2,
  CalendarPlus,
  Clock,
  MapPin,
  Star,
  Mail,
  Share2,
  ArrowRight,
  ShoppingBag,
  Bell,
  FileText,
} from "lucide-react";
import { formatPrice } from "@/lib/format";

type Props = {
  isOrder: boolean;
  businessName: string;
  businessAddress?: string | null;
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
  onContinueShopping: () => void;
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

export function OrderConfirmation({
  isOrder,
  businessName,
  businessAddress,
  primaryColor,
  secondaryColor,
  accentColor,
  confirmedDetails,
  bookingResults,
  calendarUrl,
  apiBase,
  onContinueShopping,
  formatDate,
  formatTime,
}: Props) {
  const steps = isOrder ? orderTimelineSteps : timelineSteps;

  const handleShare = async () => {
    const text = isOrder
      ? `Just placed an order with ${businessName}!`
      : `Just booked an appointment with ${businessName}!`;
    if (navigator.share) {
      try {
        await navigator.share({ title: businessName, text, url: window.location.href });
      } catch {}
    } else {
      navigator.clipboard.writeText(`${text} ${window.location.href}`);
    }
  };

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

      <div className="space-y-3" style={{ animation: "fadeUp 500ms ease-out 450ms both" }}>
        {bookingResults.map((br, idx) => (
          <div
            key={idx}
            className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 inline-flex items-center gap-2 mx-auto"
          >
            <span className="text-[11px] text-white/40">
              {br.bookingId.startsWith("order-") ? "Order:" : "Reference:"}
            </span>
            <code
              className="font-mono text-sm font-bold tracking-wider"
              style={{ color: primaryColor }}
            >
              {br.bookingId.slice(-8).toUpperCase()}
            </code>
          </div>
        ))}
      </div>

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
            className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white transition-all duration-300 hover:scale-[1.015] active:scale-[0.98] inline-flex items-center justify-center gap-2"
            style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
          >
            <CalendarPlus className="w-4 h-4" />
            Add to Calendar
          </a>
        )}
        {bookingResults.some((br) => br.invoiceId) && (
          <button
            onClick={() => {
              const inv = bookingResults.find((br) => br.invoiceId);
              if (inv?.invoiceId) window.open(`${apiBase}/commerce/invoices/${inv.invoiceId}/receipt`, "_blank");
            }}
            aria-label="View invoice"
            className="w-full py-3.5 rounded-2xl font-semibold text-sm transition-all duration-300 hover:scale-[1.015] active:scale-[0.98]"
            style={{
              backgroundColor: calendarUrl ? "transparent" : primaryColor,
              color: "white",
              border: calendarUrl ? "1px solid rgba(255,255,255,0.1)" : "none",
              boxShadow: calendarUrl ? "none" : `0 8px 32px ${primaryColor}30`,
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <FileText className="w-4 h-4" />
              View Invoice
            </span>
          </button>
        )}

        <button
          onClick={handleShare}
          className="w-full py-3 rounded-2xl border border-white/[0.06] text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.03] transition-all duration-200 flex items-center justify-center gap-2"
        >
          <Share2 className="w-3.5 h-3.5" />
          Share with Friends
        </button>

        <button
          onClick={onContinueShopping}
          className="w-full py-3 rounded-2xl border border-white/[0.06] text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.03] transition-all duration-200 flex items-center justify-center gap-2"
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

      <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/20">
        <Star className="w-3 h-3" />
        <span>Thank you for your business</span>
      </div>
    </div>
  );
}
