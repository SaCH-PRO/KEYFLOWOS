"use client";

import { ShieldCheck, Clock, CreditCard, Star, Award, Zap } from "lucide-react";

type Props = {
  primaryColor: string;
  secondaryColor: string;
  businessName?: string;
  showPaymentBadge?: boolean;
};

const trustItems = [
  { icon: ShieldCheck, label: "Secure Checkout", key: "secure" },
  { icon: Clock, label: "Instant Confirmation", key: "instant" },
  { icon: CreditCard, label: "Secure Payments", key: "payments" },
  { icon: Award, label: "Guaranteed by KeyFlowOS", key: "guarantee" },
];

export function TrustBar({ primaryColor, secondaryColor, showPaymentBadge = true }: Props) {
  const visibleItems = showPaymentBadge ? trustItems : trustItems.filter((i) => i.key !== "payments");

  return (
    <div
      className="rounded-2xl border border-white/[0.06] backdrop-blur-sm overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
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
              <span className="text-[11px] font-medium text-white/50 whitespace-nowrap">
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
    <div className="border-t border-white/[0.04] pt-8 pb-6 space-y-4">
      <div className="flex items-center justify-center gap-6 flex-wrap">
        <div className="flex items-center gap-1.5 text-[10px] text-white/20">
          <ShieldCheck className="w-3 h-3" />
          <span>SSL Encrypted</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-white/20">
          <Zap className="w-3 h-3" />
          <span>Instant Booking</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-white/20">
          <Star className="w-3 h-3" />
          <span>Trusted Platform</span>
        </div>
      </div>
      <p className="text-center text-[10px] text-white/15">
        &copy; {new Date().getFullYear()} {businessName}. All rights reserved.
      </p>
    </div>
  );
}
