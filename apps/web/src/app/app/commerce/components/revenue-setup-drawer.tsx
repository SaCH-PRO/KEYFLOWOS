"use client";

import { ContextualSetupDrawer } from "@/components/ui/contextual-setup-drawer";
import { Receipt, Shield, Palette, ExternalLink } from "lucide-react";
import Link from "next/link";

type SetupSection = "billing" | "payments" | "branding";

interface RevenueSetupDrawerProps {
  open: boolean;
  onClose: () => void;
  section?: SetupSection;
}

const SECTION_META: Record<SetupSection, { title: string; subtitle: string; icon: React.ElementType; href: string; hrefLabel: string }> = {
  billing: {
    title: "Billing & Tax",
    subtitle: "Tax rates, invoice terms, and billing preferences",
    icon: Receipt,
    href: "/app/settings/business?tab=billing",
    hrefLabel: "Open full Billing Settings",
  },
  payments: {
    title: "Payment Gateways",
    subtitle: "WiPay, PayPal, bank transfer, and payment methods",
    icon: Shield,
    href: "/app/settings/business?tab=payments",
    hrefLabel: "Open full Payment Settings",
  },
  branding: {
    title: "Invoice Branding",
    subtitle: "Customize your invoice look, colors, and layout",
    icon: Palette,
    href: "/app/settings/business?tab=branding",
    hrefLabel: "Open full Branding Settings",
  },
};

export function RevenueSetupDrawer({ open, onClose, section = "billing" }: RevenueSetupDrawerProps) {
  const meta = SECTION_META[section];
  const Icon = meta.icon;

  return (
    <ContextualSetupDrawer
      open={open}
      onClose={onClose}
      title={meta.title}
      subtitle={meta.subtitle}
      settingsHref={meta.href}
      settingsLabel={meta.hrefLabel}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-muted/5">
          <div className="p-2 rounded-xl shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
            <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <p className="text-sm font-medium">{meta.title}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{meta.subtitle}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Configure your {meta.title.toLowerCase()} in the Settings page. Changes made there will apply across your entire workspace.
        </p>

        <Link
          href={meta.href}
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium transition-all hover:opacity-90 min-h-[44px]"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))", border: "1px solid hsl(var(--kf-accent1) / 0.2)" }}
        >
          <ExternalLink className="w-4 h-4" />
          Open {meta.title} Settings
        </Link>

        <p className="text-[10px] text-center text-muted-foreground/50">
          You&apos;ll be taken to the Settings page. Use your browser&apos;s back button to return here.
        </p>
      </div>
    </ContextualSetupDrawer>
  );
}
