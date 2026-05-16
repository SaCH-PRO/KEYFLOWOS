"use client";

import { useEffect, useRef, useState } from "react";
import type { StorefrontSectionKey } from "@/lib/client";

type Props = {
  sectionKey: StorefrontSectionKey;
  index: number;
  primaryColor: string;
  secondaryColor: string;
  pageBg: string;
  children: React.ReactNode;
};

export function StoreSectionWrapper({
  sectionKey,
  index,
  primaryColor,
  secondaryColor,
  pageBg,
  children,
}: Props) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Determine if this section should have an alternate background
  const alternatingSections: StorefrontSectionKey[] = [
    "featured",
    "catalog",
    "testimonials",
    "faq",
    "contact",
  ];
  const shouldAlternate = alternatingSections.includes(sectionKey);
  const isEven = index % 2 === 0;

  if (!shouldAlternate) {
    return (
      <div
        ref={ref}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="relative -mx-4 sm:-mx-8 px-4 sm:px-8 py-6 sm:py-10"
      style={{
        background: isEven
          ? `linear-gradient(180deg, ${primaryColor}04 0%, ${secondaryColor}02 50%, ${primaryColor}04 100%)`
          : pageBg,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
        transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
      }}
    >
      {/* Subtle top border for alternating sections */}
      {isEven && (
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: `linear-gradient(to right, transparent, ${primaryColor}10, transparent)`,
          }}
        />
      )}
      {children}
      {/* Subtle bottom border for alternating sections */}
      {isEven && (
        <div
          className="absolute bottom-0 left-0 right-0 h-px"
          style={{
            background: `linear-gradient(to right, transparent, ${primaryColor}10, transparent)`,
          }}
        />
      )}
    </div>
  );
}
