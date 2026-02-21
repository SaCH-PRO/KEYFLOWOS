"use client";

import { MapPin, Phone, Mail } from "lucide-react";
import type { Business } from "./types";
import { getThemeStyles, type ThemeKey } from "@/lib/storefront-themes";
import type { StorefrontConfig } from "@/lib/client";

type Props = {
  business: Business;
  primaryColor: string;
  secondaryColor: string;
  config?: StorefrontConfig | null;
};

export function BusinessHero({ business, primaryColor, secondaryColor, config }: Props) {
  const theme = (config?.appearance?.theme ?? "default") as ThemeKey;
  const ts = getThemeStyles(theme, primaryColor, secondaryColor);
  const hero = config?.hero ?? {};
  const headline = hero.headline || business.name;
  const subheadline = hero.subheadline || business.tagline || "Book your appointment online";

  return (
    <div className={`relative overflow-hidden ${ts.fontClass}`}>
      <div
        className="absolute inset-0"
        style={{
          background: ts.heroOverlay !== "none"
            ? ts.heroOverlay
            : `radial-gradient(ellipse at 50% 0%, ${primaryColor}, transparent 70%), radial-gradient(ellipse at 80% 100%, ${secondaryColor}, transparent 60%)`,
          opacity: ts.heroGlowIntensity,
        }}
      />
      {theme === "bold" && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${primaryColor}08, ${secondaryColor}05)`,
          }}
        />
      )}
      <div className={`relative max-w-4xl mx-auto px-4 ${ts.spacing === "relaxed" ? "pt-14 pb-10" : "pt-12 pb-8"}`}>
        <div className="text-center space-y-4">
          {business.logoUrl ? (
            <div className="relative inline-block">
              <img
                src={business.logoUrl}
                alt={business.name}
                className={`h-20 w-20 object-cover border-2 border-white/10 shadow-2xl ${theme === "elegant" ? "rounded-full" : "rounded-2xl"}`}
              />
              <div
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-[#0a0a0f]"
                style={{ backgroundColor: "#22c55e" }}
              />
            </div>
          ) : (
            <div
              className={`h-20 w-20 mx-auto flex items-center justify-center border-2 border-white/10 shadow-2xl text-3xl ${ts.headerWeight} ${theme === "elegant" ? "rounded-full" : "rounded-2xl"}`}
              style={{ background: `linear-gradient(135deg, ${primaryColor}30, ${secondaryColor}20)`, color: primaryColor }}
            >
              {business.name.charAt(0)}
            </div>
          )}
          <div>
            <h1 className={`text-3xl md:text-4xl tracking-tight ${ts.headerWeight} ${ts.textStyle}`}>
              {headline}
            </h1>
            <p className={`text-base text-white/50 mt-2 max-w-md mx-auto ${ts.bodyWeight} ${ts.fontClass}`}>
              {subheadline}
            </p>
          </div>
          {(business.address || business.phone || business.email) && (
            <div className="flex items-center justify-center gap-5 text-xs text-white/40 flex-wrap">
              {business.address && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> {business.address}
                </span>
              )}
              {business.phone && (
                <a href={`tel:${business.phone}`} className="flex items-center gap-1.5 hover:text-white/60 transition-colors">
                  <Phone className="w-3.5 h-3.5" /> {business.phone}
                </a>
              )}
              {business.email && (
                <a href={`mailto:${business.email}`} className="flex items-center gap-1.5 hover:text-white/60 transition-colors">
                  <Mail className="w-3.5 h-3.5" /> {business.email}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
