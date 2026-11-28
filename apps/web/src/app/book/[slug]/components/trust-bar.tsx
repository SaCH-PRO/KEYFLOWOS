"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ShieldCheck, Clock, CreditCard, Star } from "lucide-react";
import type { TrustRailItem } from "@/lib/client";
import { useStorefrontGateways } from "./checkout-flow";

type Props = {
  primaryColor: string;
  secondaryColor: string;
  businessName?: string;
  showPaymentBadge?: boolean;
  completedOrdersCount?: number;
  businessHoursToday?: string | null;
  /**
   * TRUST-BADGES-TRUE-ONLY (D-303): the owner's picked rails are no longer rendered. None of them ("Verified
   * Business", "Instant Booking", "Secure Checkout", ...) is something the product checks. Kept in the type so the
   * stored setting still reads; the value is ignored.
   */
  configuredRails?: TrustRailItem[];
  /** The storefront slug and the currency the checkout would ask for: "Payments by <gateway>" names what is connected. */
  slug?: string;
  currency?: string;
  variant?: "inline" | "banner";
};

function formatOrderCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k+`;
  if (count >= 100) return `${count}+`;
  if (count >= 10) return `${count}+`;
  return `${count}`;
}

/** "WiPay", "PayPal" or "WiPay and PayPal": the gateways the server's storefront list carries; null for none or no answer. */
function connectedGatewaysLabel(gateways: { wipay: boolean; paypal: boolean } | null): string | null {
  if (!gateways) return null;
  const names = [gateways.wipay ? "WiPay" : null, gateways.paypal ? "PayPal" : null].filter(Boolean);
  return names.length ? names.join(" and ") : null;
}

export function TrustBar({ primaryColor, secondaryColor, showPaymentBadge = true, completedOrdersCount, businessHoursToday, slug, currency, variant = "inline" }: Props) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The checkout's own read of the storefront's gateway list; no slug, no read.
  const gateways = useStorefrontGateways(slug ?? "", currency ?? "");
  const paymentsBy = slug ? connectedGatewaysLabel(gateways) : null;

  // TRUST-BADGES-TRUE-ONLY (D-303): only statements the product can stand behind. No 'Secure Checkout', no 'Instant
  // Confirmation' (a booking can wait for the owner), no 'Secure Payments' whatever is connected.
  const visibleItems: { icon: React.ElementType; label: string; key: string }[] = [
    ...(completedOrdersCount && completedOrdersCount > 0
      ? [{ icon: Star, label: `${formatOrderCount(completedOrdersCount)} Orders Completed`, key: "orders" }]
      : []),
    ...(showPaymentBadge && paymentsBy ? [{ icon: CreditCard, label: `Payments by ${paymentsBy}`, key: "payments" }] : []),
    // CUSTOMER-PAGE-HONESTY: no 'Guaranteed by KeyFlowOS' fallback; KeyFlowOS guarantees nothing.
    ...(businessHoursToday ? [{ icon: Clock, label: `Today: ${businessHoursToday}`, key: "hours" }] : []),
  ];
  const hasItems = visibleItems.length > 0;

  // P231 r1 (MAJOR-2): the bar renders nothing until it has a line, and a line can arrive late (the gateway list, the
  // order count), so the fade-in observer attaches when the bar first has a line, not only on mount.
  useEffect(() => {
    const el = ref.current;
    if (!hasItems || !el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasItems]);

  if (!hasItems) return null;

  if (variant === "banner") {
    return (
      <div
        ref={ref}
        className="w-full overflow-hidden transition-all duration-700"
        style={{
          background: `linear-gradient(135deg, ${primaryColor}08 0%, ${secondaryColor}06 50%, ${primaryColor}04 100%)`,
          borderTop: `1px solid ${primaryColor}12`,
          borderBottom: `1px solid ${primaryColor}12`,
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(8px)",
        }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-8 py-3.5 sm:py-4">
          <div className="flex items-center justify-center sm:justify-between gap-3 sm:gap-4 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {visibleItems.map((item, idx) => {
              const Icon = item.icon;
              const color = idx % 2 === 0 ? primaryColor : secondaryColor;
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-2 sm:gap-2.5 px-2 sm:px-3 py-1.5 rounded-xl flex-shrink-0"
                  style={{
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(6px)",
                    transition: `opacity 0.4s ${0.1 + idx * 0.08}s, transform 0.4s ${0.1 + idx * 0.08}s`,
                  }}
                >
                  <div
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${color}10`, boxShadow: `0 2px 8px ${color}08` }}
                  >
                    <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color }} />
                  </div>
                  <span className="text-[10px] sm:text-xs font-semibold text-gray-700 whitespace-nowrap">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="rounded-2xl border backdrop-blur-sm overflow-hidden transition-all duration-500"
      style={{
        background: `linear-gradient(135deg, ${primaryColor}06 0%, ${secondaryColor}04 100%)`,
        borderColor: `${primaryColor}12`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
      }}
    >
      <div className="flex items-center justify-around py-3.5 sm:py-4 px-3 sm:px-4 gap-1.5 sm:gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap" style={{ scrollbarWidth: "none" }}>
        {visibleItems.map((item, idx) => {
          const Icon = item.icon;
          const color = idx % 2 === 0 ? primaryColor : secondaryColor;
          return (
            <div
              key={item.key}
              className="flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl transition-all duration-200 flex-shrink-0"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(6px)",
                transition: `opacity 0.4s ${0.1 + idx * 0.08}s, transform 0.4s ${0.1 + idx * 0.08}s`,
              }}
            >
              <div
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${color}10`, boxShadow: `0 2px 8px ${color}08` }}
              >
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color }} />
              </div>
              <span className="text-[10px] sm:text-[11px] font-semibold text-gray-600 whitespace-nowrap">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type FooterBadgeProps = {
  primaryColor: string;
  businessName: string;
  /** Overrides the browser's own answer; for tests and server renders that know the scheme. */
  servedOverHttps?: boolean;
};

const noSubscribe = () => () => {};

/** True only in a browser that loaded this page over https; false on the server render. */
export function useServedOverHttps(): boolean {
  return useSyncExternalStore(noSubscribe, () => window.location.protocol === "https:", () => false);
}

export function SecurityFooter({ primaryColor, businessName, servedOverHttps }: FooterBadgeProps) {
  const browserHttps = useServedOverHttps();
  const https = servedOverHttps ?? browserHttps;
  // TRUST-BADGES-TRUE-ONLY (D-303): no 'Trusted Platform'; 'SSL Encrypted' only when the page is served over https.
  // CUSTOMER-PAGE-HONESTY: no 'Instant Booking' (a booking may wait for the owner's confirmation).
  const badges = https ? [{ icon: ShieldCheck, label: "SSL Encrypted" }] : [];
  return (
    <div className="pt-10 pb-8 space-y-6">
      <div className="h-px w-full" style={{ background: `linear-gradient(to right, transparent, ${primaryColor}12, transparent)` }} />
      {badges.length > 0 && (
        <div className="flex items-center justify-center gap-8 flex-wrap">
          {badges.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-gray-500 transition-colors">
              <item.icon className="w-3 h-3" />
              <span className="font-medium">{item.label}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-center text-[10px] text-gray-500 font-medium">
          &copy; {new Date().getFullYear()} {businessName}. All rights reserved.
        </p>
        <p className="text-center text-[10px] text-gray-500">
          Powered by KeyFlowOS
        </p>
      </div>
    </div>
  );
}
