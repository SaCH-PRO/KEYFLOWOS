"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Landmark, Wallet, ArrowRight, Loader2 } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { Surface, Badge, Button, EmptyState } from "@/components/ui-v2";
import { getStoredBusinessId } from "@/lib/workspace";
import { listOpenPayables, type OpenPayable } from "@/lib/api/payments-gateway";
import { apiGet } from "@/lib/api";

type GatewayStatus = {
  id: string;
  name: string;
  connected: boolean;
  supports: { transactions: boolean; paymentLinks: boolean; refunds: boolean };
};

const GATEWAY_ICONS: Record<string, React.ElementType> = {
  stripe: CreditCard,
  paypal: Wallet,
  wipay: Landmark,
};

function formatMoney(amount: number, currency: string) {
  return `${amount.toFixed(2)} ${currency}`;
}

export default function CommerceGatewayPage() {
  const router = useRouter();
  const businessId = getStoredBusinessId() ?? "";
  const [payables, setPayables] = useState<OpenPayable[]>([]);
  const [counts, setCounts] = useState({ invoices: 0, massComms: 0, storefrontOrders: 0, eventTickets: 0 });
  const [gateways, setGateways] = useState<GatewayStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      setLoading(true);
      const [payablesRes, gatewaysRes] = await Promise.all([
        listOpenPayables(businessId),
        apiGet<GatewayStatus[]>(`/payments/businesses/${businessId}/gateways`),
      ]);
      if (payablesRes.data) {
        setPayables(payablesRes.data.payables);
        setCounts(payablesRes.data.counts);
      }
      if (gatewaysRes.data) {
        setGateways(gatewaysRes.data);
      }
      setLoading(false);
    };
    void load();
  }, [businessId]);

  return (
    <WorkspaceShell
      icon={CreditCard}
      title="Payment Gateway"
      subtitle="Collect payments across invoices, storefront orders, and event tickets."
    >
      <div className="space-y-5">
        {/* Gateway status cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {gateways.map((gw) => {
            const Icon = GATEWAY_ICONS[gw.id] ?? CreditCard;
            return (
              <Surface key={gw.id} variant="default" className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{gw.name}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {gw.supports.transactions ? "Checkout" : ""}
                        {gw.supports.paymentLinks ? " · Links" : ""}
                        {gw.supports.refunds ? " · Refunds" : ""}
                      </p>
                    </div>
                  </div>
                  <Badge color={gw.connected ? "mint" : "muted"}>
                    {gw.connected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
              </Surface>
            );
          })}
        </div>

        {/* Payables summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Surface variant="accent" className="p-4 text-center">
            <p className="text-caption text-muted-foreground uppercase tracking-wide">Open invoices</p>
            <p className="font-display text-title font-semibold text-foreground mt-1">{counts.invoices}</p>
          </Surface>
          <Surface variant="accent" className="p-4 text-center">
            <p className="text-caption text-muted-foreground uppercase tracking-wide">Mass comms</p>
            <p className="font-display text-title font-semibold text-foreground mt-1">{counts.massComms}</p>
          </Surface>
          <Surface variant="accent" className="p-4 text-center">
            <p className="text-caption text-muted-foreground uppercase tracking-wide">Storefront orders</p>
            <p className="font-display text-title font-semibold text-foreground mt-1">{counts.storefrontOrders}</p>
          </Surface>
          <Surface variant="accent" className="p-4 text-center">
            <p className="text-caption text-muted-foreground uppercase tracking-wide">Event tickets owed</p>
            <p className="font-display text-title font-semibold text-foreground mt-1">{counts.eventTickets}</p>
          </Surface>
        </div>

        {/* Payables list */}
        <Surface variant="default" className="p-0 overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-display text-heading font-semibold text-foreground">Open payables</h3>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {loading && payables.length === 0 ? (
            <div className="p-8 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : payables.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={CreditCard}
                title="Nothing to collect"
                description="All invoices, orders, and tickets are paid up."
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {payables.map((p) => (
                <div
                  key={`${p.type}-${p.id}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        color={
                          p.type === "invoice"
                            ? "sky"
                            : p.type === "mass_comm"
                              ? "violet"
                              : p.type === "storefront_order"
                                ? "orange"
                                : "violet"
                        }
                      >
                        {p.type.replace("_", " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                      {p.dueAt && (
                        <span className="text-xs text-muted-foreground">
                          Due {new Date(p.dueAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-sm text-foreground mt-1 truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.customer}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="font-display text-title font-semibold text-foreground">
                      {formatMoney(p.amount, p.currency)}
                    </span>
                    <Button
                      variant="soft"
                      className="h-8 text-xs"
                      onClick={() => router.push(p.href)}
                      rightIcon={<ArrowRight className="h-3 w-3" />}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>
    </WorkspaceShell>
  );
}
