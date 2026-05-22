"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import {
  PartyPopper,
  CheckCircle2,
  CircleDollarSign,
  CalendarCheck,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
} from "lucide-react";

const CELEBRATIONS: Record<string, { message: string; icon: typeof PartyPopper; tone: "success" | "warning" }> = {
  "kf:invoice.paid": {
    message: "Payment received! Money in the bank. 💰",
    icon: CircleDollarSign,
    tone: "success",
  },
  "kf:invoice.created": {
    message: "Invoice sent! One step closer to getting paid.",
    icon: CheckCircle2,
    tone: "success",
  },
  "kf:booking.created": {
    message: "New booking locked in! 📅",
    icon: CalendarCheck,
    tone: "success",
  },
  "kf:booking.confirmed": {
    message: "Booking confirmed! Your client knows what's up.",
    icon: CalendarCheck,
    tone: "success",
  },
  "kf:contact.created": {
    message: "New contact added! Network growing. 🌱",
    icon: Sparkles,
    tone: "success",
  },
  "kf:action.executed": {
    message: "Action completed! You're on a roll. 🚀",
    icon: CheckCircle2,
    tone: "success",
  },
  "kf:approval.resolved": {
    message: "Approval handled! Moving forward. ✅",
    icon: ShieldCheck,
    tone: "success",
  },
  "kf:action.blocked": {
    message: "That action needs approval first — KEY's got your back.",
    icon: AlertTriangle,
    tone: "warning",
  },
};

function CelebrationToast({
  message,
  icon: Icon,
  tone,
}: {
  message: string;
  icon: typeof PartyPopper;
  tone: "success" | "warning";
}) {
  const bg = tone === "success" ? "bg-emerald-500/10" : "bg-amber-500/10";
  const text = tone === "success" ? "text-emerald-400" : "text-amber-400";
  const border = tone === "success" ? "border-emerald-500/20" : "border-amber-500/20";

  return (
    <div className={`flex items-center gap-2.5 px-1 py-0.5`}>
      <div className={`p-1.5 rounded-md ${bg} ${text} border ${border}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
}

export function CelebrationListener() {
  useEffect(() => {
    const handlers: Array<{ type: string; fn: (e: Event) => void }> = [];

    for (const [eventType, config] of Object.entries(CELEBRATIONS)) {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        let message = config.message;

        // Personalize with detail if available
        if (eventType === "kf:invoice.paid" && detail?.total) {
          const cur = detail.currency || "TTD";
          message = `Payment received: ${cur} ${detail.total.toLocaleString()}! 🎉`;
        }
        if (eventType === "kf:invoice.created" && detail?.invoiceNumber) {
          message = `Invoice ${detail.invoiceNumber} sent! 💼`;
        }
        if (eventType === "kf:booking.created" && detail?.contactName) {
          message = `Booking with ${detail.contactName} locked in! 📅`;
        }
        if (eventType === "kf:contact.created" && detail?.name) {
          message = `${detail.name} added to your network! 🌟`;
        }

        if (config.tone === "success") {
          toast.success(<CelebrationToast message={message} icon={config.icon} tone="success" />);
        } else {
          toast.warning(<CelebrationToast message={message} icon={config.icon} tone="warning" />);
        }
      };

      window.addEventListener(eventType, handler);
      handlers.push({ type: eventType, fn: handler });
    }

    return () => {
      for (const h of handlers) {
        window.removeEventListener(h.type, h.fn);
      }
    };
  }, []);

  return null;
}
