"use client";

import { useEffect, useRef, useState } from "react";
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
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!hasContact) return null;

  const waPhone = business.whatsapp?.replace(/[^0-9+]/g, "").replace(/^\+/, "") || "";
  const waLink = business.whatsapp
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hi ${business.name}, I'd like to get in touch.`)}`
    : null;

  return (
    <section
      ref={ref}
      className="space-y-5"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${primaryColor}15` }}
        >
          <Send className="w-4 h-4" style={{ color: primaryColor }} />
        </div>
        <h3 className="text-lg font-semibold text-gray-700">
          {heading || "Get in Touch"}
        </h3>
      </div>

      {customMessage && (
        <p className="text-sm text-gray-500 leading-relaxed">{customMessage}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {showPhone && business.phone && (
          <a
            href={`tel:${business.phone}`}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-gray-200 bg-white/[0.02] hover:bg-gray-100 hover:border-gray-300 transition-all min-h-[44px] group"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${primaryColor}12` }}>
              <Phone className="w-4 h-4" style={{ color: primaryColor }} />
            </div>
            <div>
              <p className="text-xs text-gray-400">Call Us</p>
              <p className="text-sm font-medium text-gray-600 group-hover:text-gray-800 transition-colors">{business.phone}</p>
            </div>
          </a>
        )}

        {showEmail && business.email && (
          <a
            href={`mailto:${business.email}`}
            className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-gray-200 bg-white/[0.02] hover:bg-gray-100 hover:border-gray-300 transition-all min-h-[44px] group"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${secondaryColor}12` }}>
              <Mail className="w-4 h-4" style={{ color: secondaryColor }} />
            </div>
            <div>
              <p className="text-xs text-gray-400">Email</p>
              <p className="text-sm font-medium text-gray-600 group-hover:text-gray-800 transition-colors truncate">{business.email}</p>
            </div>
          </a>
        )}

        {showAddress && business.address && (
          <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-gray-200 bg-white/[0.02] min-h-[44px]">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${primaryColor}12` }}>
              <MapPin className="w-4 h-4" style={{ color: primaryColor }} />
            </div>
            <div>
              <p className="text-xs text-gray-400">Location</p>
              <p className="text-sm font-medium text-gray-600">{business.address}</p>
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
              <p className="text-xs text-gray-400">WhatsApp</p>
              <p className="text-sm font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">Chat with us</p>
            </div>
          </a>
        )}
      </div>
    </section>
  );
}
