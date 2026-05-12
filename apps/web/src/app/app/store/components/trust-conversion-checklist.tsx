"use client";

import { useMemo } from "react";
import { CheckCircle2, Circle, AlertTriangle, ShieldCheck } from "lucide-react";

interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  critical: boolean;
}

interface Props {
  hasLogo: boolean;
  hasPrimaryColor: boolean;
  hasContactInfo: boolean;
  productCount: number;
  hasTestimonials: boolean;
  hasFaq: boolean;
  hasPolicies: boolean;
  hasPaymentMethods: boolean;
  hasBookingCta: boolean;
  mobileVerified: boolean;
}

export function TrustConversionChecklist({
  hasLogo,
  hasPrimaryColor,
  hasContactInfo,
  productCount,
  hasTestimonials,
  hasFaq,
  hasPolicies,
  hasPaymentMethods,
  hasBookingCta,
  mobileVerified,
}: Props) {
  const items: ChecklistItem[] = useMemo(
    () => [
      { id: "logo", label: "Logo uploaded", checked: hasLogo, critical: true },
      { id: "color", label: "Primary color set", checked: hasPrimaryColor, critical: false },
      { id: "contact", label: "Contact info visible", checked: hasContactInfo, critical: true },
      { id: "products", label: "At least 3 products/services", checked: productCount >= 3, critical: true },
      { id: "testimonials", label: "Testimonials or reviews", checked: hasTestimonials, critical: false },
      { id: "faq", label: "FAQ section", checked: hasFaq, critical: false },
      { id: "policies", label: "Refund/cancellation policy", checked: hasPolicies, critical: true },
      { id: "payments", label: "Payment methods visible", checked: hasPaymentMethods, critical: true },
      { id: "booking", label: "Booking CTA clear", checked: hasBookingCta, critical: false },
      { id: "mobile", label: "Mobile preview verified", checked: mobileVerified, critical: false },
    ],
    [hasLogo, hasPrimaryColor, hasContactInfo, productCount, hasTestimonials, hasFaq, hasPolicies, hasPaymentMethods, hasBookingCta, mobileVerified]
  );

  const passed = items.filter((i) => i.checked).length;
  const criticalPassed = items.filter((i) => i.critical && i.checked).length;
  const criticalTotal = items.filter((i) => i.critical).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-semibold">Trust & Conversion Checklist</h4>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {passed}/{items.length}
          </span>
          {criticalPassed < criticalTotal && (
            <span className="flex items-center gap-1 text-[10px] text-amber-500">
              <AlertTriangle className="w-3 h-3" />
              {criticalTotal - criticalPassed} critical pending
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-2 p-2 rounded-lg border text-xs transition-all ${
              item.checked
                ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
                : item.critical
                ? "border-amber-500/20 bg-amber-500/5 text-amber-700"
                : "border-border/30 bg-muted/20 text-muted-foreground"
            }`}
          >
            {item.checked ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            ) : (
              <Circle className={`w-3.5 h-3.5 shrink-0 ${item.critical ? "text-amber-500" : "text-muted-foreground/50"}`} />
            )}
            <span className={item.checked ? "line-through opacity-70" : ""}>{item.label}</span>
            {item.critical && !item.checked && (
              <span className="ml-auto text-[9px] font-medium text-amber-500 uppercase">Required</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
