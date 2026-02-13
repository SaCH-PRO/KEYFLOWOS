"use client";

import { MapPin, Phone, Mail } from "lucide-react";
import type { Business } from "./types";

type Props = {
  business: Business;
  primaryColor: string;
  secondaryColor: string;
};

export function BusinessHero({ business, primaryColor, secondaryColor }: Props) {
  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${primaryColor}, transparent 70%), radial-gradient(ellipse at 80% 100%, ${secondaryColor}, transparent 60%)`,
        }}
      />
      <div className="relative max-w-4xl mx-auto px-4 pt-12 pb-8">
        <div className="text-center space-y-4">
          {business.logoUrl ? (
            <div className="relative inline-block">
              <img
                src={business.logoUrl}
                alt={business.name}
                className="h-20 w-20 rounded-2xl object-cover border-2 border-white/10 shadow-2xl"
              />
              <div
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-[#0a0a0f]"
                style={{ backgroundColor: "#22c55e" }}
              />
            </div>
          ) : (
            <div
              className="h-20 w-20 rounded-2xl mx-auto flex items-center justify-center border-2 border-white/10 shadow-2xl text-3xl font-bold"
              style={{ background: `linear-gradient(135deg, ${primaryColor}30, ${secondaryColor}20)`, color: primaryColor }}
            >
              {business.name.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{business.name}</h1>
            {business.tagline ? (
              <p className="text-base text-white/50 mt-2 max-w-md mx-auto">{business.tagline}</p>
            ) : (
              <p className="text-base text-white/50 mt-2">Book your appointment online</p>
            )}
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
