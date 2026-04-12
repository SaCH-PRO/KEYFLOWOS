"use client";

import { ShieldCheck, Clock, CreditCard, Star, Award, Zap } from "lucide-react";

type Props = {
  primaryColor: string;
  secondaryColor: string;
  businessName?: string;
  showPaymentBadge?: boolean;
  completedOrdersCount?: number;
  businessHoursToday?: string | null;
};

function formatOrderCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k+`;
  if (count >= 100) return `${count}+`;
  if (count >= 10) return `${count}+`;
  return `${count}`;
}

export function TrustBar({ primaryColor, secondaryColor, showPaymentBadge = true, completedOrdersCount, businessHoursToday }: Props) {
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
  const visibleItems = trustItems;

  return (
    <div
      className="rounded-2xl border border-gray-200 backdrop-blur-sm overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.01) 100%)",
      }}
    >
      <div className="flex items-center justify-around py-3.5 px-4 gap-2 flex-wrap sm:flex-nowrap">
        {visibleItems.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={item.key}
              className="flex items-center gap-2 px-2 py-1"
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${idx % 2 === 0 ? primaryColor : secondaryColor}12` }}
              >
                <Icon
                  className="w-3.5 h-3.5"
                  style={{ color: idx % 2 === 0 ? primaryColor : secondaryColor }}
                />
              </div>
              <span className="text-[11px] font-medium text-gray-500 whitespace-nowrap">
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
    <div className="border-t border-gray-200 pt-8 pb-6 space-y-4">
      <div className="flex items-center justify-center gap-6 flex-wrap">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-300">
          <ShieldCheck className="w-3 h-3" />
          <span>SSL Encrypted</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-300">
          <Zap className="w-3 h-3" />
          <span>Instant Booking</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-300">
          <Star className="w-3 h-3" />
          <span>Trusted Platform</span>
        </div>
      </div>
      <p className="text-center text-[10px] text-gray-900/15">
        &copy; {new Date().getFullYear()} {businessName}. All rights reserved.
      </p>
      <p className="text-center text-[10px] text-gray-900/10">
        Powered by KeyFlowOS
      </p>
    </div>
  );
}
