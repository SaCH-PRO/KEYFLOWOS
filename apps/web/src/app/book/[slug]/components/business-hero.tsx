"use client";

import { useEffect, useState, useRef } from "react";
import { MapPin, Phone, Mail, CheckCircle, Shield, Award, ExternalLink, Facebook, Instagram, Twitter, MessageCircle, CalendarCheck, ShoppingBag, ArrowRight } from "lucide-react";
import type { Business, BusinessHours } from "./types";
import { getThemeStyles, type ThemeKey } from "@/lib/storefront-themes";
import type { StorefrontConfig, StorefrontHeroProofChip } from "@/lib/client";

type Props = {
  business: Business;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  config?: StorefrontConfig | null;
  catalogCount?: number;
  onScrollToCatalog?: () => void;
  completedOrdersCount?: number;
};

type ProofChip = StorefrontHeroProofChip;

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

export function BusinessHero({ business, primaryColor, secondaryColor, accentColor, config, catalogCount, onScrollToCatalog, completedOrdersCount }: Props) {
  const theme = (config?.appearance?.theme ?? "default") as ThemeKey;
  const ts = getThemeStyles(theme, primaryColor, secondaryColor, accentColor);
  const hero = config?.hero ?? {};
  const headline = hero.headline || business.name;
  const subheadline = hero.subheadline || business.tagline || "Book your appointment online";
  const coverUrl = hero.coverImageUrl;
  const coverVideoUrl = hero.coverVideoUrl;
  const openStatus = getOpenStatus(business.businessHours);
  const promotionalRibbon = hero.promotionalRibbon;
  const ribbonColor = hero.promotionalRibbonColor || "#f59e0b";
  const proofChips: ProofChip[] = hero.proofChips ?? [];
  const primaryCtaLabel = hero.ctaLabel || "Browse Services";
  const secondaryCtaLabel = hero.secondaryCtaLabel;
  const heroLayout = ts.heroLayout ?? "centered";
  const ctaSize = ts.heroCtaSize ?? "md";
  const showHours = hero.showHours !== false;
  const showWhatsApp = hero.showWhatsApp !== false;
  const showScrollCta = config?.sectionStyles?.hero?.showScrollCta !== false;

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

  const builtInProofChips: Array<{ icon?: string; label: string; iconComponent?: React.ElementType; iconColor?: string }> = [
    ...(catalogCount && catalogCount > 0 ? [{ iconComponent: ShoppingBag, label: `${catalogCount} ${catalogCount === 1 ? "Item" : "Items"}`, iconColor: primaryColor }] : []),
    ...(completedOrdersCount && completedOrdersCount > 0 ? [{ iconComponent: CalendarCheck, label: `${completedOrdersCount}+ orders`, iconColor: secondaryColor }] : []),
    { iconComponent: Shield, label: "Verified Business", iconColor: "#22c55e" },
    { iconComponent: Award, label: "Instant Booking", iconColor: primaryColor },
  ];

  const displayProofChips = proofChips.length > 0 ? proofChips : null;

  const isLeftAligned = heroLayout === "left_aligned";
  const textAlign = isLeftAligned ? "text-left" : "text-center";
  const justify = isLeftAligned ? "justify-start" : "justify-center";

  const ctaPadding = ctaSize === "lg" ? "px-8 py-4 text-base" : ctaSize === "sm" ? "px-4 py-2.5 text-sm" : "px-6 py-3 text-sm";

  return (
    <div ref={heroRef} className={`relative overflow-hidden ${ts.fontClass}`}>
      {promotionalRibbon && (
        <div
          className="w-full px-4 py-2.5 text-center text-xs font-medium flex items-center justify-center gap-2"
          style={{
            backgroundColor: `${ribbonColor}15`,
            color: ribbonColor,
            borderBottom: `1px solid ${ribbonColor}25`,
          }}
        >
          <span className="animate-pulse">🔥</span>
          <span>{promotionalRibbon}</span>
        </div>
      )}

      {(coverUrl || coverVideoUrl) && (
        <div className="absolute inset-0 w-full h-full">
          <div
            className="absolute inset-0 w-full h-[130%]"
            style={{ transform: `translateY(-${parallaxOffset}px)` }}
          >
            {coverVideoUrl ? (
              <video
                src={coverVideoUrl}
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <img src={coverUrl} alt="" className="w-full h-full object-cover" />
            )}
          </div>
          <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${ts.pageBg}99, ${ts.pageBg}cc 50%, ${ts.pageBg})` }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${primaryColor}15, transparent 50%, ${secondaryColor}10)` }} />
        </div>
      )}

      {!coverUrl && !coverVideoUrl && (
        <div className="absolute inset-0">
          <div className="absolute inset-0" style={{ background: ts.heroBg, opacity: ts.heroGlowIntensity + 0.15 }} />
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
        className={`relative max-w-5xl mx-auto px-4 sm:px-8 ${ts.spacing === "relaxed" ? "pt-16 pb-14" : "pt-14 pb-10"}`}
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? "translateY(0)" : "translateY(20px)",
          transition: "opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div className={`${isLeftAligned ? "flex flex-col items-start" : "flex flex-col items-center text-center"} space-y-6`}>
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
                <div className="absolute -inset-2 rounded-[28px] blur-xl" style={{ background: `${primaryColor}20` }} />
                <img
                  src={business.logoUrl}
                  alt={business.name}
                  className={`relative h-20 w-20 object-cover border-2 shadow-2xl ${theme === "elegant" || theme === "luxury_editorial" ? "rounded-full" : "rounded-2xl"}`}
                  style={{ borderColor: `${primaryColor}30` }}
                />
                <div
                  className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: ts.pageBg, backgroundColor: openStatus.isOpen ? "#22c55e" : "#ef4444" }}
                >
                  <CheckCircle className="w-3 h-3 text-white" />
                </div>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute -inset-2 rounded-[28px] blur-xl" style={{ background: `${primaryColor}15` }} />
                <div
                  className={`relative h-20 w-20 mx-auto flex items-center justify-center border-2 shadow-xl text-2xl ${ts.headerWeight} ${theme === "elegant" || theme === "luxury_editorial" ? "rounded-full" : "rounded-2xl"}`}
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
            className="space-y-3 max-w-2xl"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "translateY(0)" : "translateY(12px)",
              transition: "opacity 0.6s 0.25s, transform 0.6s 0.25s cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            {showHours && (
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] ${textAlign}`}
                style={{
                  backgroundColor: openStatus.isOpen ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                  border: `1px solid ${openStatus.isOpen ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: openStatus.isOpen ? "#22c55e" : "#ef4444" }} />
                <span style={{ color: openStatus.isOpen ? "#16a34a" : "#dc2626" }}>{openStatus.label}</span>
              </div>
            )}

            <h1
              className={`text-3xl md:text-5xl tracking-tight leading-tight ${ts.headerWeight} ${ts.textStyle}`}
              style={{ color: "inherit" }}
            >
              {headline}
            </h1>

            {subheadline && (
              <p className={`text-base md:text-lg text-gray-500 leading-relaxed ${ts.bodyWeight}`}>
                {subheadline}
              </p>
            )}
          </div>

          {displayProofChips && displayProofChips.length > 0 && (
            <div
              className={`flex flex-wrap items-center gap-2 ${justify}`}
              style={{
                opacity: entered ? 1 : 0,
                transition: "opacity 0.5s 0.4s",
              }}
            >
              {displayProofChips.map((chip: ProofChip, i: number) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium bg-gray-50 border border-gray-200 text-gray-600"
                >
                  {chip.icon && <span>{chip.icon}</span>}
                  {chip.label}
                </div>
              ))}
            </div>
          )}

          {!displayProofChips && (
            <div
              className={`flex flex-wrap items-center gap-2 ${justify}`}
              style={{
                opacity: entered ? 1 : 0,
                transition: "opacity 0.5s 0.4s",
              }}
            >
              {builtInProofChips.slice(0, 4).map((badge, i) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] text-gray-600 bg-gray-50 border border-gray-200"
                >
                  {badge.iconComponent && <badge.iconComponent className="w-3 h-3" style={{ color: badge.iconColor ?? primaryColor }} />}
                  {badge.label}
                </div>
              ))}
            </div>
          )}

          {showScrollCta && (
          <div
            className={`flex flex-wrap items-center gap-3 ${justify} pt-1`}
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 0.5s 0.5s, transform 0.5s 0.5s",
            }}
          >
            <button
              onClick={onScrollToCatalog}
              className={`inline-flex items-center gap-2 ${ctaPadding} rounded-full font-semibold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl active:scale-95`}
              style={{
                backgroundColor: primaryColor,
                boxShadow: `0 8px 24px ${primaryColor}40`,
              }}
            >
              {primaryCtaLabel}
              <ArrowRight className="w-4 h-4" />
            </button>

            {secondaryCtaLabel && (
              <button
                onClick={onScrollToCatalog}
                className={`inline-flex items-center gap-2 ${ctaPadding} rounded-full font-medium transition-all hover:scale-105 active:scale-95`}
                style={{
                  color: primaryColor,
                  border: `1.5px solid ${primaryColor}40`,
                  backgroundColor: `${primaryColor}08`,
                }}
              >
                {secondaryCtaLabel}
              </button>
            )}
          </div>
          )}

          {(business.address || business.phone || business.email) && (
            <div
              className={`flex items-center flex-wrap gap-4 md:gap-6 text-xs text-gray-400 ${justify}`}
              style={{
                opacity: entered ? 1 : 0,
                transition: "opacity 0.5s 0.6s",
              }}
            >
              {business.address && (
                <span className="flex items-center gap-1.5 hover:text-gray-500 transition-colors">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: primaryColor }} /> {business.address}
                </span>
              )}
              {business.phone && (
                <a href={`tel:${business.phone}`} className="flex items-center gap-1.5 hover:text-gray-500 transition-colors">
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" style={{ color: primaryColor }} /> {business.phone}
                </a>
              )}
              {business.email && (
                <a href={`mailto:${business.email}`} className="flex items-center gap-1.5 hover:text-gray-500 transition-colors">
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: primaryColor }} /> {business.email}
                </a>
              )}
              {business.website && /^https?:\/\//i.test(business.website) && (
                <a href={business.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-gray-500 transition-colors">
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" style={{ color: primaryColor }} /> Website
                </a>
              )}
            </div>
          )}

          {(business.facebook || business.instagram || business.twitter || business.whatsapp) && (
            <div
              className={`flex items-center gap-2 flex-wrap ${justify}`}
              style={{
                opacity: entered ? 1 : 0,
                transition: "opacity 0.5s 0.65s",
              }}
            >
              {business.facebook && (
                <a
                  href={business.facebook.startsWith("http") ? business.facebook : `https://facebook.com/${business.facebook}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors"
                  aria-label="Facebook"
                >
                  <Facebook className="w-4 h-4 text-gray-500" />
                </a>
              )}
              {business.instagram && (
                <a
                  href={business.instagram.startsWith("http") ? business.instagram : `https://instagram.com/${business.instagram}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors"
                  aria-label="Instagram"
                >
                  <Instagram className="w-4 h-4 text-gray-500" />
                </a>
              )}
              {business.twitter && (
                <a
                  href={business.twitter.startsWith("http") ? business.twitter : `https://twitter.com/${business.twitter}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors"
                  aria-label="Twitter"
                >
                  <Twitter className="w-4 h-4 text-gray-500" />
                </a>
              )}
              {business.whatsapp && showWhatsApp && (
                <a
                  href={`https://wa.me/${business.whatsapp.replace(/\D/g, "")}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                  aria-label="WhatsApp"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-600" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: ts.heroAccentBar }} />
    </div>
  );
}
