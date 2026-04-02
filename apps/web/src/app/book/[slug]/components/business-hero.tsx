"use client";

import { useEffect, useState, useRef } from "react";
import { MapPin, Phone, Mail, CheckCircle, Shield, Award, Star, ExternalLink, Facebook, Instagram, Twitter, MessageCircle } from "lucide-react";
import type { Business, BusinessHours } from "./types";
import { getThemeStyles, type ThemeKey } from "@/lib/storefront-themes";
import type { StorefrontConfig } from "@/lib/client";

type Props = {
  business: Business;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  config?: StorefrontConfig | null;
  catalogCount?: number;
};

function getOpenStatus(hours?: BusinessHours | null): { isOpen: boolean; label: string } {
  if (!hours) return { isOpen: true, label: "Open Now" };
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const now = new Date();
  const dayKey = days[now.getDay()];
  const entry = hours[dayKey];
  if (!entry || entry.closed) return { isOpen: false, label: "Closed Today" };
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = entry.open.split(":").map(Number);
  const [closeH, closeM] = entry.close.split(":").map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;
  if (nowMins >= openMins && nowMins < closeMins) return { isOpen: true, label: `Open · Closes ${entry.close}` };
  if (nowMins < openMins) return { isOpen: false, label: `Opens at ${entry.open}` };
  return { isOpen: false, label: "Closed Now" };
}

export function BusinessHero({ business, primaryColor, secondaryColor, accentColor, config, catalogCount }: Props) {
  const theme = (config?.appearance?.theme ?? "default") as ThemeKey;
  const ts = getThemeStyles(theme, primaryColor, secondaryColor, accentColor);
  const hero = config?.hero ?? {};
  const headline = hero.headline || business.name;
  const subheadline = hero.subheadline || business.tagline || "Book your appointment online";
  const coverUrl = (hero as any).coverImageUrl;
  const openStatus = getOpenStatus(business.businessHours);

  const [entered, setEntered] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const parallaxOffset = Math.min(scrollY * 0.35, 120);

  const trustBadges = [
    ...(catalogCount ? [{ icon: Star, label: `${catalogCount} ${catalogCount === 1 ? "Item" : "Items"}` }] : []),
    { icon: Shield, label: "Verified Business" },
    { icon: Award, label: "Instant Booking" },
  ];

  return (
    <div ref={heroRef} className={`relative overflow-hidden ${ts.fontClass}`}>
      {coverUrl && (
        <div className="absolute inset-0 w-full h-full">
          <div
            className="absolute inset-0 w-full h-[130%]"
            style={{ transform: `translateY(-${parallaxOffset}px)` }}
          >
            <img
              src={coverUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
          <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${ts.pageBg}99, ${ts.pageBg}cc 50%, ${ts.pageBg})` }} />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}15, transparent 50%, ${secondaryColor}10)`,
            }}
          />
        </div>
      )}

      {!coverUrl && (
        <div className="absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              background: ts.heroBg,
              opacity: ts.heroGlowIntensity + 0.15,
            }}
          />
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full blur-[120px]"
            style={{ background: `${primaryColor}0C` }}
          />
          <div
            className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full blur-[100px]"
            style={{ background: `${secondaryColor}08` }}
          />
        </div>
      )}

      <div
        className={`relative max-w-4xl mx-auto px-4 ${ts.spacing === "relaxed" ? "pt-16 pb-12" : "pt-14 pb-10"}`}
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? "translateY(0)" : "translateY(20px)",
          transition: "opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div className="text-center space-y-5">
          <div
            className="relative inline-block"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "scale(1)" : "scale(0.8)",
              transition: "opacity 0.5s 0.15s, transform 0.5s 0.15s cubic-bezier(0.34,1.56,0.64,1)",
            }}
          >
            {business.logoUrl ? (
              <div className="relative">
                <div
                  className="absolute -inset-2 rounded-[28px] blur-xl"
                  style={{ background: `${primaryColor}20` }}
                />
                <img
                  src={business.logoUrl}
                  alt={business.name}
                  className={`relative h-24 w-24 object-cover border-2 shadow-2xl ${theme === "elegant" ? "rounded-full" : "rounded-2xl"}`}
                  style={{ borderColor: `${primaryColor}30` }}
                />
                <div
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: ts.pageBg, backgroundColor: openStatus.isOpen ? "#22c55e" : "#ef4444" }}
                >
                  <CheckCircle className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
            ) : (
              <div className="relative">
                <div
                  className="absolute -inset-2 rounded-[28px] blur-xl"
                  style={{ background: `${primaryColor}15` }}
                />
                <div
                  className={`relative h-24 w-24 mx-auto flex items-center justify-center border-2 shadow-2xl text-3xl ${ts.headerWeight} ${theme === "elegant" ? "rounded-full" : "rounded-2xl"}`}
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor}30, ${secondaryColor}20)`,
                    color: primaryColor,
                    borderColor: `${primaryColor}25`,
                  }}
                >
                  {business.name.charAt(0)}
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "translateY(0)" : "translateY(12px)",
              transition: "opacity 0.6s 0.25s, transform 0.6s 0.25s cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            <h1 className={`text-3xl md:text-5xl tracking-tight ${ts.headerWeight} ${ts.textStyle}`}>
              {headline}
            </h1>
            <p className={`text-base md:text-lg text-white/50 mt-3 max-w-lg mx-auto leading-relaxed ${ts.bodyWeight} ${ts.fontClass}`}>
              {subheadline}
            </p>
          </div>

          <div
            className="flex items-center justify-center gap-2 text-xs"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "translateY(0)" : "translateY(10px)",
              transition: "opacity 0.5s 0.35s, transform 0.5s 0.35s",
            }}
          >
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: openStatus.isOpen ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                border: `1px solid ${openStatus.isOpen ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
              }}
            >
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: openStatus.isOpen ? "#22c55e" : "#ef4444" }}
              />
              <span style={{ color: openStatus.isOpen ? "#86efac" : "#fca5a5" }}>
                {openStatus.label}
              </span>
            </div>
          </div>

          {(business.address || business.phone || business.email) && (
            <div
              className="flex items-center justify-center gap-4 md:gap-6 text-xs text-white/40 flex-wrap"
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? "translateY(0)" : "translateY(10px)",
                transition: "opacity 0.5s 0.45s, transform 0.5s 0.45s",
              }}
            >
              {business.address && (
                <span className="flex items-center gap-1.5 hover:text-white/60 transition-colors">
                  <MapPin className="w-3.5 h-3.5" style={{ color: primaryColor }} /> {business.address}
                </span>
              )}
              {business.phone && (
                <a href={`tel:${business.phone}`} className="flex items-center gap-1.5 hover:text-white/60 transition-colors">
                  <Phone className="w-3.5 h-3.5" style={{ color: primaryColor }} /> {business.phone}
                </a>
              )}
              {business.email && (
                <a href={`mailto:${business.email}`} className="flex items-center gap-1.5 hover:text-white/60 transition-colors">
                  <Mail className="w-3.5 h-3.5" style={{ color: primaryColor }} /> {business.email}
                </a>
              )}
              {business.website && (
                <a href={business.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-white/60 transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" style={{ color: primaryColor }} /> Website
                </a>
              )}
            </div>
          )}

          {(business.facebook || business.instagram || business.twitter || business.whatsapp) && (
            <div
              className="flex items-center justify-center gap-2 flex-wrap"
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? "translateY(0)" : "translateY(10px)",
                transition: "opacity 0.5s 0.5s, transform 0.5s 0.5s",
              }}
            >
              {business.facebook && (
                <a
                  href={business.facebook.startsWith("http") ? business.facebook : `https://facebook.com/${business.facebook}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] transition-colors"
                  aria-label="Facebook"
                >
                  <Facebook className="w-4 h-4 text-white/50 hover:text-white/70" />
                </a>
              )}
              {business.instagram && (
                <a
                  href={business.instagram.startsWith("http") ? business.instagram : `https://instagram.com/${business.instagram}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] transition-colors"
                  aria-label="Instagram"
                >
                  <Instagram className="w-4 h-4 text-white/50 hover:text-white/70" />
                </a>
              )}
              {business.twitter && (
                <a
                  href={business.twitter.startsWith("http") ? business.twitter : `https://twitter.com/${business.twitter}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] transition-colors"
                  aria-label="Twitter"
                >
                  <Twitter className="w-4 h-4 text-white/50 hover:text-white/70" />
                </a>
              )}
              {business.whatsapp && (
                <a
                  href={`https://wa.me/${business.whatsapp.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.12] transition-colors"
                  aria-label="WhatsApp"
                >
                  <MessageCircle className="w-4 h-4 text-white/50 hover:text-white/70" />
                </a>
              )}
            </div>
          )}

          <div
            className="flex items-center justify-center gap-3 flex-wrap pt-1"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "translateY(0)" : "translateY(10px)",
              transition: "opacity 0.5s 0.55s, transform 0.5s 0.55s",
            }}
          >
            {trustBadges.map((badge, i) => (
              <div
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] text-white/45 bg-white/[0.04] border border-white/[0.06]"
              >
                <badge.icon className="w-3 h-3" style={{ color: `${primaryColor}90` }} />
                {badge.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{
          background: ts.heroAccentBar,
        }}
      />
    </div>
  );
}
