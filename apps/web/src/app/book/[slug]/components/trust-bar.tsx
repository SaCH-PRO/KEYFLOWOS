"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Clock, CreditCard, Star, Award, Zap, Truck, Headphones, Layers, BadgeCheck } from "lucide-react";
import type { TrustRailItem } from "@/lib/client";

type Props = {
  primaryColor: string;
  secondaryColor: string;
  businessName?: string;
  showPaymentBadge?: boolean;
  completedOrdersCount?: number;
  businessHoursToday?: string | null;
  configuredRails?: TrustRailItem[];
};

const TRUST_RAIL_ICONS: Record<TrustRailItem, React.ElementType> = {
  secure_checkout: ShieldCheck,
  fast_delivery: Truck,
  verified_business: BadgeCheck,
  instant_booking: Zap,
  custom_support: Headphones,
  digital_delivery: Layers,
};

const TRUST_RAIL_LABELS: Record<TrustRailItem, string> = {
  secure_checkout: "Secure Checkout",
  fast_delivery: "Fast Delivery",
  verified_business: "Verified Business",
  instant_booking: "Instant Booking",
  custom_support: "Custom Support",
  digital_delivery: "Digital Delivery",
};

function formatOrderCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k+`;
  if (count >= 100) return `${count}+`;
  if (count >= 10) return `${count}+`;
  return `${count}`;
}

export function TrustBar({ primaryColor, secondaryColor, showPaymentBadge = true, completedOrdersCount, businessHoursToday, configuredRails }: Props) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  let visibleItems: { icon: React.ElementType; label: string; key: string }[];

  if (configuredRails && configuredRails.length > 0) {
    visibleItems = configuredRails.map((rail) => ({
      icon: TRUST_RAIL_ICONS[rail],
      label: TRUST_RAIL_LABELS[rail],
      key: rail,
    }));
  } else {
    const trustItems = [
      { icon: ShieldCheck, label: "Secure Checkout", key: "secure" },
      ...(completedOrdersCount && completedOrdersCount > 0
        ? [{ icon: Star, label: `${formatOrderCount(completedOrdersCount)} Orders Completed`, key: "orders" }]
        : [{ icon: Clock, label: "Instant Confirmation", key: "instant" }]),
      ...(showPaymentBadge ? [{ icon: CreditCard, label: "Secure Payments", key: "payments" }] : []),
      ...(businessHoursToday
        ? [{ icon: Clock, label: `Today: ${businessHoursToday}`, key: "hours" }]
        : [{ icon: Award, label: "Guaranteed by KeyFlowOS", key: "guarantee" }]),
    ];
    visibleItems = trustItems;
  }

  return (
    <div
      ref={ref}
      className="rounded-2xl border backdrop-blur-sm overflow-hidden transition-all duration-500"
      style={{
        background: `linear-gradient(135deg, ${primaryColor}04 0%, ${secondaryColor}03 100%)`,
        borderColor: `${primaryColor}12`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
      }}
    >
      <div className="flex items-center justify-around py-4 px-4 gap-2 flex-wrap sm:flex-nowrap">
        {visibleItems.map((item, idx) => {
          const Icon = item.icon;
          const color = idx % 2 === 0 ? primaryColor : secondaryColor;
          return (
            <div
              key={item.key}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all duration-200"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(6px)",
                transition: `opacity 0.4s ${0.1 + idx * 0.08}s, transform 0.4s ${0.1 + idx * 0.08}s`,
              }}
            >
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${color}12`, boxShadow: `0 2px 8px ${color}10` }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <span className="text-[11px] font-semibold text-gray-600 whitespace-nowrap">
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
};

export function SecurityFooter({ primaryColor, businessName }: FooterBadgeProps) {
  return (
    <div className="pt-10 pb-8 space-y-6">
      <div className="h-px w-full" style={{ background: `linear-gradient(to right, transparent, ${primaryColor}12, transparent)` }} />
      <div className="flex items-center justify-center gap-8 flex-wrap">
        {[
          { icon: ShieldCheck, label: "SSL Encrypted" },
          { icon: Zap, label: "Instant Booking" },
          { icon: Star, label: "Trusted Platform" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-gray-500 transition-colors">
            <item.icon className="w-3 h-3" />
            <span className="font-medium">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-center text-[10px] text-gray-400 font-medium">
          &copy; {new Date().getFullYear()} {businessName}. All rights reserved.
        </p>
        <p className="text-center text-[10px] text-gray-300">
          Powered by KeyFlowOS
        </p>
      </div>
    </div>
  );
}
