"use client";

import { useEffect, useState, useRef } from "react";
import { MapPin, Phone, Mail, CheckCircle, Shield, Award, ExternalLink, Facebook, Instagram, Twitter, MessageCircle, CalendarCheck, ShoppingBag, ArrowRight, Sparkles } from "lucide-react";
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

function AnimatedCounter({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let start = 0;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      start = Math.round(eased * value);
      setDisplay(start);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration]);

  return <span ref={ref}>{display}</span>;
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

  const builtInProofChips: Array<{ icon?: string; label: string; iconComponent?: React.ElementType; iconColor?: string; value?: number }> = [
    ...(catalogCount && catalogCount > 0 ? [{ iconComponent: ShoppingBag, label: `${catalogCount} ${catalogCount === 1 ? "Item" : "Items"}`, iconColor: primaryColor, value: catalogCount }] : []),
    ...(completedOrdersCount && completedOrdersCount > 0 ? [{ iconComponent: CalendarCheck, label: `${completedOrdersCount}+ orders`, iconColor: secondaryColor, value: completedOrdersCount }] : []),
    { iconComponent: Shield, label: "Verified Business", iconColor: "#22c55e" },
    { iconComponent: Award, label: "Instant Booking", iconColor: primaryColor },
  ];

  const displayProofChips = proofChips.length > 0 ? proofChips : null;

  const isLeftAligned = heroLayout === "left_aligned";
  const textAlign = isLeftAligned ? "text-left" : "text-center";
  const justify = isLeftAligned ? "justify-start" : "justify-center";

  const ctaPadding = ctaSize === "lg" ? "px-8 py-4 text-base" : ctaSize === "sm" ? "px-4 py-2.5 text-sm" : "px-6 py-3.5 text-sm";

  return (
    <div ref={heroRef} className={`relative overflow-hidden ${ts.fontClass}`}>
      {promotionalRibbon && (
        <div
          className="w-full px-4 py-2.5 text-center text-xs font-medium flex items-center justify-center gap-2 backdrop-blur-sm"
          style={{
            backgroundColor: `${ribbonColor}12`,
            color: ribbonColor,
            borderBottom: `1px solid ${ribbonColor}20`,
          }}
        >
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
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
              <img src={coverUrl} alt="" className="w-full h-full object-cover" loading="eager" />
            )}
          </div>
          <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${ts.pageBg}88, ${ts.pageBg}bb 40%, ${ts.pageBg}ee 70%, ${ts.pageBg})` }} />
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${primaryColor}12, transparent 50%, ${secondaryColor}08)` }} />
        </div>
      )}

      {!coverUrl && !coverVideoUrl && (
        <div className="absolute inset-0">
          <div className="absolute inset-0" style={{ background: ts.heroBg, opacity: ts.heroGlowIntensity + 0.15 }} />
          <div
            className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full"
            style={{ background: `radial-gradient(circle, ${primaryColor}0D, ${primaryColor}04 40%, transparent 70%)` }}
          />
          <div
            className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full"
            style={{ background: `radial-gradient(circle, ${secondaryColor}0A, transparent 60%)` }}
          />
          <div
            className="absolute top-[20%] left-[-5%] w-[300px] h-[300px] rounded-full"
            style={{ background: `radial-gradient(circle, ${accentColor}06, transparent 60%)` }}
          />
        </div>
      )}

      <div
        className={`relative max-w-5xl mx-auto px-4 sm:px-8 ${ts.spacing === "relaxed" ? "pt-16 sm:pt-20 pb-14 sm:pb-16" : "pt-14 sm:pt-16 pb-10 sm:pb-12"}`}
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? "translateY(0)" : "translateY(24px)",
          transition: "opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div className={`${isLeftAligned ? "flex flex-col items-start" : "flex flex-col items-center text-center"} space-y-6`}>
          <div
            className="relative inline-block"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "scale(1)" : "scale(0.85)",
              transition: "opacity 0.6s 0.15s, transform 0.6s 0.15s cubic-bezier(0.34,1.56,0.64,1)",
            }}
          >
            {business.logoUrl ? (
              <div className="relative">
                <div className="absolute -inset-3 rounded-[32px] blur-2xl" style={{ background: `${primaryColor}18` }} />
                <img
                  src={business.logoUrl}
                  alt={business.name}
                  className={`relative h-20 w-20 sm:h-24 sm:w-24 object-cover border-2 shadow-2xl ${theme === "elegant" || theme === "luxury_editorial" ? "rounded-full" : "rounded-2xl"}`}
                  style={{ borderColor: `${primaryColor}25` }}
                />
                <div
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-lg"
                  style={{ borderColor: ts.pageBg, backgroundColor: openStatus.isOpen ? "#22c55e" : "#ef4444" }}
                >
                  <CheckCircle className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute -inset-3 rounded-[32px] blur-2xl" style={{ background: `${primaryColor}12` }} />
                <div
                  className={`relative h-20 w-20 sm:h-24 sm:w-24 flex items-center justify-center border-2 shadow-xl text-2xl sm:text-3xl ${ts.headerWeight} ${theme === "elegant" || theme === "luxury_editorial" ? "rounded-full" : "rounded-2xl"}`}
                  style={{
                    background: `linear-gradient(135deg, ${primaryColor}25, ${secondaryColor}15)`,
                    color: primaryColor,
                    borderColor: `${primaryColor}20`,
                  }}
                >
                  {business.name.charAt(0)}
                </div>
              </div>
            )}
          </div>

          <div
            className="space-y-4 max-w-2xl"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? "translateY(0)" : "translateY(16px)",
              transition: "opacity 0.7s 0.25s, transform 0.7s 0.25s cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            {showHours && (
              <div
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-medium backdrop-blur-sm ${textAlign}`}
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
              className={`text-3xl sm:text-4xl md:text-5xl lg:text-[3.25rem] tracking-tight leading-[1.1] ${ts.headerWeight} ${ts.textStyle}`}
              style={{
                background: coverUrl || coverVideoUrl
                  ? undefined
                  : `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                WebkitBackgroundClip: coverUrl || coverVideoUrl ? undefined : "text",
                WebkitTextFillColor: coverUrl || coverVideoUrl ? undefined : "transparent",
                color: coverUrl || coverVideoUrl ? "inherit" : undefined,
              }}
            >
              {headline}
            </h1>

            {subheadline && (
              <p className={`text-base sm:text-lg text-gray-500 leading-relaxed max-w-xl ${isLeftAligned ? "" : "mx-auto"} ${ts.bodyWeight}`}>
                {subheadline}
              </p>
            )}
          </div>

          {displayProofChips && displayProofChips.length > 0 && (
            <div
              className={`flex flex-wrap items-center gap-2 ${justify}`}
              style={{
                opacity: entered ? 1 : 0,
                transition: "opacity 0.6s 0.4s",
              }}
            >
              {displayProofChips.map((chip: ProofChip, i: number) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-medium backdrop-blur-sm transition-all duration-300 hover:scale-105"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.04)",
                    border: "1px solid rgba(0,0,0,0.08)",
                    color: "rgba(0,0,0,0.55)",
                    animationDelay: `${i * 80}ms`,
                  }}
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
                transition: "opacity 0.6s 0.4s",
              }}
            >
              {builtInProofChips.slice(0, 4).map((badge, i) => (
                <div
                  key={i}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-medium backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:shadow-sm"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.03)",
                    border: "1px solid rgba(0,0,0,0.07)",
                    color: "rgba(0,0,0,0.55)",
                    opacity: entered ? 1 : 0,
                    transform: entered ? "translateY(0)" : "translateY(8px)",
                    transition: `opacity 0.4s ${0.45 + i * 0.08}s, transform 0.4s ${0.45 + i * 0.08}s`,
                  }}
                >
                  {badge.iconComponent && <badge.iconComponent className="w-3.5 h-3.5" style={{ color: badge.iconColor ?? primaryColor }} />}
                  {badge.value ? (
                    <span><AnimatedCounter value={badge.value} /> {badge.label.replace(/^\d+\s*/, "").replace(/^\+?\s*/, "")}</span>
                  ) : (
                    badge.label
                  )}
                </div>
              ))}
            </div>
          )}

          {showScrollCta && (
            <div
              className={`flex flex-col sm:flex-row items-center gap-3 ${justify} pt-2 w-full sm:w-auto`}
              style={{
                opacity: entered ? 1 : 0,
                transform: entered ? "translateY(0)" : "translateY(10px)",
                transition: "opacity 0.6s 0.5s, transform 0.6s 0.5s",
              }}
            >
              <button
                onClick={onScrollToCatalog}
                className={`w-full sm:w-auto inline-flex items-center justify-center gap-2.5 ${ctaPadding} rounded-full font-semibold text-white shadow-lg transition-all duration-300 hover:scale-[1.03] hover:shadow-xl active:scale-[0.97] min-h-[48px]`}
                style={{
                  backgroundColor: primaryColor,
                  boxShadow: `0 8px 32px ${primaryColor}35, 0 2px 8px ${primaryColor}20`,
                }}
              >
                {primaryCtaLabel}
                <ArrowRight className="w-4 h-4" />
              </button>

              {secondaryCtaLabel && (
                <button
                  onClick={onScrollToCatalog}
                  className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 ${ctaPadding} rounded-full font-medium transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] min-h-[48px]`}
                  style={{
                    color: primaryColor,
                    border: `1.5px solid ${primaryColor}30`,
                    backgroundColor: `${primaryColor}06`,
                  }}
                >
                  {secondaryCtaLabel}
                </button>
              )}
            </div>
          )}

          {(business.address || business.phone || business.email) && (
            <div
              className={`flex items-center flex-wrap gap-3 sm:gap-5 text-xs text-gray-400 ${justify}`}
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
                <a href={`tel:${business.phone}`} className="flex items-center gap-1.5 hover:text-gray-500 transition-colors min-h-[44px] items-center">
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" style={{ color: primaryColor }} /> {business.phone}
                </a>
              )}
              {business.email && (
                <a href={`mailto:${business.email}`} className="flex items-center gap-1.5 hover:text-gray-500 transition-colors min-h-[44px] items-center">
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: primaryColor }} /> {business.email}
                </a>
              )}
              {business.website && /^https?:\/\//i.test(business.website) && (
                <a href={business.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-gray-500 transition-colors min-h-[44px] items-center">
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" style={{ color: primaryColor }} /> Website
                </a>
              )}
            </div>
          )}

          {(business.facebook || business.instagram || business.twitter || business.whatsapp) && (
            <div
              className={`flex items-center gap-2.5 flex-wrap ${justify}`}
              style={{
                opacity: entered ? 1 : 0,
                transition: "opacity 0.5s 0.65s",
              }}
            >
              {business.facebook && (
                <a
                  href={business.facebook.startsWith("http") ? business.facebook : `https://facebook.com/${business.facebook}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-all hover:scale-105 min-h-[44px]"
                  aria-label="Facebook"
                >
                  <Facebook className="w-4 h-4 text-gray-500" />
                </a>
              )}
              {business.instagram && (
                <a
                  href={business.instagram.startsWith("http") ? business.instagram : `https://instagram.com/${business.instagram}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-all hover:scale-105 min-h-[44px]"
                  aria-label="Instagram"
                >
                  <Instagram className="w-4 h-4 text-gray-500" />
                </a>
              )}
              {business.twitter && (
                <a
                  href={business.twitter.startsWith("http") ? business.twitter : `https://twitter.com/${business.twitter}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-all hover:scale-105 min-h-[44px]"
                  aria-label="Twitter"
                >
                  <Twitter className="w-4 h-4 text-gray-500" />
                </a>
              )}
              {business.whatsapp && showWhatsApp && (
                <a
                  href={`https://wa.me/${business.whatsapp.replace(/\D/g, "")}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-all hover:scale-105 min-h-[44px]"
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
