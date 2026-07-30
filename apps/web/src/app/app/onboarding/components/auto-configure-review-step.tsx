"use client";

import { ArrowRight, CheckCircle2, Clock, CreditCard, Package, Store } from "lucide-react";

interface AutoConfigureReviewStepProps {
  onComplete: () => void;
}

export function AutoConfigureReviewStep({ onComplete }: AutoConfigureReviewStepProps) {
  return (
    <div className="space-y-6 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10">
        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Your workspace is configured</h2>
        <p className="text-sm text-muted-foreground">
          KEY has applied your template. Here&apos;s what&apos;s ready:
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
        <div className="flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-card/40">
          <Package className="w-5 h-5 text-[hsl(var(--kf-accent1))] mt-0.5" />
          <div>
            <p className="text-sm font-medium">Products & services</p>
            <p className="text-xs text-muted-foreground">Pre-filled with TTD pricing</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-card/40">
          <Clock className="w-5 h-5 text-[hsl(var(--kf-accent1))] mt-0.5" />
          <div>
            <p className="text-sm font-medium">Business hours</p>
            <p className="text-xs text-muted-foreground">Typical hours for your industry</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-card/40">
          <CreditCard className="w-5 h-5 text-[hsl(var(--kf-accent1))] mt-0.5" />
          <div>
            <p className="text-sm font-medium">Payment methods</p>
            <p className="text-xs text-muted-foreground">WiPay, PayPal, cash options noted</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-card/40">
          <Store className="w-5 h-5 text-[hsl(var(--kf-accent1))] mt-0.5" />
          <div>
            <p className="text-sm font-medium">Online storefront</p>
            <p className="text-xs text-muted-foreground">Ready for bookings & orders</p>
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={onComplete}
          className="px-6 py-3 rounded-xl font-semibold text-sm bg-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1-foreground))] hover:brightness-110 transition-all flex items-center gap-2"
        >
          Looks good — continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        You can customize all of this later from Settings.
      </p>
    </div>
  );
}
