"use client";

import Link from "next/link";
import { AlertCircle, Loader2, MessageCircle, Mail, Phone, ArrowLeft } from "lucide-react";
import { buildWhatsAppLink } from "@/lib/whatsapp";

type Variant = "loading" | "error" | "empty";

type ContactBusiness = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  slug?: string | null;
};

type Props = {
  variant: Variant;
  title?: string;
  message?: string;
  business?: ContactBusiness | null;
  retry?: () => void;
  homeHref?: string;
  homeLabel?: string;
  primaryColor?: string;
};

export function PublicPageState({
  variant,
  title,
  message,
  business,
  retry,
  homeHref,
  homeLabel = "Back to home",
  primaryColor = "#F97316",
}: Props) {
  if (variant === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white px-4">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 mx-auto animate-spin" style={{ color: primaryColor }} />
          <p className="text-sm text-slate-400">{message ?? "Loading..."}</p>
        </div>
      </div>
    );
  }

  const waLink =
    business?.whatsapp
      ? buildWhatsAppLink(business.whatsapp, `Hi${business?.name ? ` ${business.name}` : ""}, I need help with my order/booking.`)
      : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white px-4 py-10">
      <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-8 text-center space-y-5">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7 text-red-400" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold">{title ?? "Something went wrong"}</h1>
          {message && <p className="text-sm text-slate-400 leading-relaxed">{message}</p>}
        </div>

        <div className="flex flex-col gap-2.5">
          {retry && (
            <button
              onClick={retry}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
              style={{ background: primaryColor }}
            >
              Try again
            </button>
          )}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              Message {business?.name ?? "us"} on WhatsApp
            </a>
          )}
          {!waLink && business?.email && (
            <a
              href={`mailto:${business.email}`}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 transition-colors"
            >
              <Mail className="w-4 h-4" />
              Email {business.name ?? "us"}
            </a>
          )}
          {!waLink && !business?.email && business?.phone && (
            <a
              href={`tel:${business.phone}`}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 transition-colors"
            >
              <Phone className="w-4 h-4" />
              Call {business.name ?? "us"}
            </a>
          )}
          {(homeHref || business?.slug) && (
            <Link
              href={homeHref ?? `/book/${business?.slug}`}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 text-slate-300 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {homeLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
