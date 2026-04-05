"use client";

import { Phone, Mail, MapPin, MessageCircle, Send } from "lucide-react";
import type { Business } from "./types";

type Props = {
  business: Business;
  heading?: string;
  customMessage?: string;
  showWhatsApp?: boolean;
  showEmail?: boolean;
  showPhone?: boolean;
  showAddress?: boolean;
  primaryColor: string;
  secondaryColor: string;
};

export function ContactSection({
  business,
  heading,
  customMessage,
  showWhatsApp = true,
  showEmail = true,
  showPhone = true,
  showAddress = true,
  primaryColor,
  secondaryColor,
}: Props) {
  const hasContact = (showPhone && business.phone) || (showEmail && business.email) || (showAddress && business.address) || (showWhatsApp && business.whatsapp);
  if (!hasContact) return null;

  const waPhone = business.whatsapp?.replace(/[^0-9+]/g, "").replace(/^\+/, "") || "";
  const waLink = business.whatsapp
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi ${business.name}, I'd like to get in touch.`)}`
    : null;

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${primaryColor}15` }}
        >
          <Send className="w-4 h-4" style={{ color: primaryColor }} />
        </div>
        <h3 className="text-lg font-semibold text-white/80">
          {heading || "Get in Touch"}
        </h3>
      </div>

      {customMessage && (
        <p className="text-sm text-white/50 leading-relaxed">{customMessage}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {showPhone && business.phone && (
          <a
            href={`tel:${business.phone}`}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all min-h-[44px] group"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${primaryColor}12` }}>
              <Phone className="w-4 h-4" style={{ color: primaryColor }} />
            </div>
            <div>
              <p className="text-xs text-white/40">Call Us</p>
              <p className="text-sm font-medium text-white/70 group-hover:text-white/90 transition-colors">{business.phone}</p>
            </div>
          </a>
        )}

        {showEmail && business.email && (
          <a
            href={`mailto:${business.email}`}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all min-h-[44px] group"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${secondaryColor}12` }}>
              <Mail className="w-4 h-4" style={{ color: secondaryColor }} />
            </div>
            <div>
              <p className="text-xs text-white/40">Email</p>
              <p className="text-sm font-medium text-white/70 group-hover:text-white/90 transition-colors truncate">{business.email}</p>
            </div>
          </a>
        )}

        {showAddress && business.address && (
          <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] min-h-[44px]">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${primaryColor}12` }}>
              <MapPin className="w-4 h-4" style={{ color: primaryColor }} />
            </div>
            <div>
              <p className="text-xs text-white/40">Location</p>
              <p className="text-sm font-medium text-white/70">{business.address}</p>
            </div>
          </div>
        )}

        {showWhatsApp && waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08] hover:border-emerald-500/30 transition-all min-h-[44px] group"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-emerald-500/15">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-white/40">WhatsApp</p>
              <p className="text-sm font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">Chat with us</p>
            </div>
          </a>
        )}
      </div>
    </section>
  );
}
