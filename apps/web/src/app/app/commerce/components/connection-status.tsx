"use client";

import React from "react";
import { Mail, CreditCard, Wallet } from "lucide-react";
import { ConnectionBanner } from "@/components/ui/connection-banner";

interface ConnectionStatusProps {
  gmailStatus: { connected: boolean; email: string | null } | null;
  paymentGateways: { wipay: boolean; paypal: boolean };
  loadingGmail: boolean;
  onConnectGmail: () => void;
  onDisconnectGmail: () => void;
}

export const ConnectionStatus = React.memo(function ConnectionStatus({
  gmailStatus,
  paymentGateways,
  loadingGmail,
  onConnectGmail,
  onDisconnectGmail,
}: ConnectionStatusProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
      <ConnectionBanner
        icon={Mail}
        color="#EA4335"
        title="Gmail"
        description="Send invoices and quotes via email"
        connected={gmailStatus?.connected ?? false}
        connectedDetail={gmailStatus?.email ? `Sending as ${gmailStatus.email}` : undefined}
        onConnect={onConnectGmail}
        onDisconnect={onDisconnectGmail}
        loading={loadingGmail}
        compact
      />
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border/50 bg-card/60">
        <div className="flex -space-x-1.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: paymentGateways.wipay ? "#10b98118" : "hsl(var(--kf-muted))" }}
          >
            <CreditCard className="w-4 h-4" style={{ color: paymentGateways.wipay ? "#10b981" : "hsl(var(--kf-muted-foreground))" }} />
          </div>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 -ml-1"
            style={{ background: paymentGateways.paypal ? "#0070ba18" : "hsl(var(--kf-muted))" }}
          >
            <Wallet className="w-4 h-4" style={{ color: paymentGateways.paypal ? "#0070ba" : "hsl(var(--kf-muted-foreground))" }} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">Payment Gateways</span>
            <span className="text-[11px] text-muted-foreground/70">
              {paymentGateways.wipay && paymentGateways.paypal
                ? "WiPay + PayPal"
                : paymentGateways.wipay
                ? "WiPay"
                : paymentGateways.paypal
                ? "PayPal"
                : "None configured"}
            </span>
          </div>
        </div>
        <a
          href="/app/settings/business?tab=payments"
          className="text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors flex items-center gap-1"
        >
          {paymentGateways.wipay || paymentGateways.paypal ? "Manage" : "Set up"}
        </a>
      </div>
    </div>
  );
});
