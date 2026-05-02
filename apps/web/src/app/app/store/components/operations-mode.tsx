"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Power,
  Pause,
  Play,
  Truck,
  Clock,
  Phone,
  Target,
  Package,
  RefreshCw,
  Shield,
  Loader2,
  MessageCircle,
  Mail,
  Save,
  Monitor,
  MapPin,
  Eye,
  Loader,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { WorkspaceMetricStrip, type MetricStripItem } from "@/components/ui/workspace-metric-strip";
import { AiRecommendationCard } from "@/components/ui/ai-recommendation-card";
import { SectionCard } from "@/components/ui/section-card";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { DeliveryConfigPanel } from "./delivery-config-panel";
import { ShippingZonesPanel } from "./shipping-zones-panel";
import { HoursEditor, type BusinessHoursMap } from "./hours-editor";
import { FulfillmentPanel, type Order } from "./fulfillment-panel";
import { QualificationConfig } from "./qualification-config";
import type { StorefrontConfig, StoreStatus, DeliveryMethod, Product } from "@/lib/client";

type OrderApiResponse = {
  data: Order[];
  total: number;
};

type Props = {
  businessId: string;
  storeEnabled: boolean;
  businessHours: BusinessHoursMap;
  storefrontConfig: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, unknown>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  onHoursChange: (hours: BusinessHoursMap) => void;
  onSaveHours: () => Promise<void>;
  hoursSaving: boolean;
  onToggleStoreEnabled: () => void;
  commerceProducts?: Product[];
};

const STATUS_OPTIONS: { key: StoreStatus; label: string; description: string; icon: React.ElementType; color: string }[] = [
  { key: "active", label: "Active", description: "Store is live and accepting orders from customers", icon: Play, color: "hsl(var(--kf-success))" },
  { key: "paused", label: "Paused", description: "Temporarily not accepting orders from customers", icon: Pause, color: "hsl(var(--kf-warning))" },
  { key: "coming_soon", label: "Coming Soon", description: "Store page visible but checkout is disabled", icon: Eye, color: "hsl(217 91% 60%)" },
];

function StoreStatusControl({
  storeStatus,
  onStatusChange,
}: {
  storeStatus: StoreStatus;
  onStatusChange: (s: StoreStatus) => void;
}) {
  return (
    <div className="space-y-2 pt-2">
      {STATUS_OPTIONS.map((s) => {
        const Icon = s.icon;
        const isSelected = storeStatus === s.key;
        return (
          <button
            key={s.key}
            onClick={() => onStatusChange(s.key)}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all min-h-[44px]"
            style={{
              background: isSelected ? `${s.color}14` : "hsl(var(--kf-muted)/0.04)",
              border: `1px solid ${isSelected ? `${s.color}36` : "hsl(var(--kf-border)/0.25)"}`,
            }}
          >
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: isSelected ? `${s.color}22` : "hsl(var(--kf-muted)/0.1)" }}>
              <Icon className="w-3.5 h-3.5" style={{ color: isSelected ? s.color : "hsl(var(--kf-muted-foreground))" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: isSelected ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))" }}>{s.label}</p>
              <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{s.description}</p>
            </div>
            {isSelected && (
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={enabled} onClick={onToggle} className="flex items-center justify-between w-full py-2.5 group">
      <span className="text-sm" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{label}</span>
      <div className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0" style={{ background: enabled ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground)/0.3)" }}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
      </div>
    </button>
  );
}

function ContactOptionsPanel({
  storefrontConfig,
  onConfigChange,
  onSave,
  saving,
}: {
  storefrontConfig: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, unknown>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}) {
  const contactOptions = storefrontConfig.contactOptions ?? {};

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            <MessageCircle className="w-3 h-3" /> WhatsApp Number
          </label>
          <input
            type="tel"
            value={contactOptions.whatsappNumber ?? ""}
            onChange={(e) => onConfigChange("contactOptions", { whatsappNumber: e.target.value })}
            placeholder="+1 (868) 555-0123"
            className="kf-input w-full text-sm"
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground)/0.6)" }}>Customers can click to message you on WhatsApp from your storefront.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              <Mail className="w-3 h-3" /> Email
            </label>
            <input
              type="email"
              value={contactOptions.email ?? ""}
              onChange={(e) => onConfigChange("contactOptions", { email: e.target.value })}
              placeholder="hello@store.com"
              className="kf-input w-full text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              <Phone className="w-3 h-3" /> Phone
            </label>
            <input
              type="tel"
              value={contactOptions.phone ?? ""}
              onChange={(e) => onConfigChange("contactOptions", { phone: e.target.value })}
              placeholder="+1 (868) 555-0123"
              className="kf-input w-full text-sm"
            />
          </div>
        </div>
        <Toggle
          enabled={contactOptions.showContactForm ?? false}
          onToggle={() => onConfigChange("contactOptions", { showContactForm: !(contactOptions.showContactForm ?? false) })}
          label="Show Contact Form on store page"
        />
      </div>
      <button
        onClick={onSave}
        disabled={saving}
        className="kf-btn-primary w-full text-xs inline-flex items-center justify-center gap-1.5 min-h-[40px]"
        style={{ opacity: saving ? 0.7 : 1 }}
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {saving ? "Saving..." : "Save Contact Options"}
      </button>
    </div>
  );
}

const DELIVERY_LEGACY_OPTIONS: { key: DeliveryMethod; label: string; icon: React.ElementType; description: string }[] = [
  { key: "shipping", label: "Shipping", icon: Truck, description: "Ship products to customers" },
  { key: "pickup", label: "Pickup", icon: MapPin, description: "Customers pick up in-store" },
  { key: "digital", label: "Digital", icon: Monitor, description: "Digital delivery via email" },
];

function DeliveryOptionsLegacy({
  storefrontConfig,
  onConfigChange,
  onSave,
  saving,
}: {
  storefrontConfig: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, unknown>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}) {
  const storeSettings = storefrontConfig.storeSettings ?? {};
  const deliveryOptions: DeliveryMethod[] = storeSettings.deliveryOptions ?? [];

  function toggleDelivery(method: DeliveryMethod) {
    const updated = deliveryOptions.includes(method)
      ? deliveryOptions.filter((d) => d !== method)
      : [...deliveryOptions, method];
    onConfigChange("storeSettings", { deliveryOptions: updated });
  }

  return (
    <div className="space-y-3 pt-2">
      {DELIVERY_LEGACY_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const isActive = deliveryOptions.includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => toggleDelivery(opt.key)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
            style={{
              background: isActive ? "hsl(var(--kf-info)/0.08)" : "hsl(var(--kf-muted)/0.06)",
              border: isActive ? "1px solid hsl(var(--kf-info)/0.2)" : "1px solid hsl(var(--kf-border)/0.25)",
            }}
          >
            <Icon className="w-4 h-4" style={{ color: isActive ? "hsl(var(--kf-info))" : "hsl(var(--kf-muted-foreground))" }} />
            <div className="flex-1 text-left">
              <p className="text-xs font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>{opt.label}</p>
              <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{opt.description}</p>
            </div>
            <div className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0" style={{ background: isActive ? "hsl(var(--kf-info))" : "hsl(var(--kf-muted-foreground)/0.3)" }}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isActive ? "left-[22px]" : "left-0.5"}`} />
            </div>
          </button>
        );
      })}
      <button
        onClick={onSave}
        disabled={saving}
        className="kf-btn-primary w-full text-xs inline-flex items-center justify-center gap-1.5 min-h-[40px]"
        style={{ opacity: saving ? 0.7 : 1 }}
      >
        {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {saving ? "Saving..." : "Save Delivery Options"}
      </button>
    </div>
  );
}

const ORDER_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"] as const;

const PIPELINE_STAGE: Record<string, { label: string; color: string }> = {
  PENDING: { label: "Pending", color: "hsl(40 90% 50%)" },
  CONFIRMED: { label: "Confirmed", color: "hsl(200 80% 50%)" },
  PROCESSING: { label: "Processing", color: "hsl(270 70% 60%)" },
  SHIPPED: { label: "Shipped", color: "hsl(var(--kf-accent1))" },
  DELIVERED: { label: "Delivered", color: "hsl(var(--kf-success))" },
  CANCELLED: { label: "Cancelled", color: "hsl(var(--kf-error))" },
  REFUNDED: { label: "Refunded", color: "hsl(var(--kf-warning))" },
};

function FulfillmentPipeline({ orders }: { orders: Order[] }) {
  const stageCounts: Record<string, number> = {};
  for (const status of ORDER_STATUSES) stageCounts[status] = 0;
  for (const o of orders) {
    if (stageCounts[o.status] !== undefined) stageCounts[o.status]++;
    else stageCounts[o.status] = 1;
  }
  const activeStages = ORDER_STATUSES.filter((s) => stageCounts[s] > 0);
  if (activeStages.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {activeStages.map((status) => {
        const stage = PIPELINE_STAGE[status];
        const count = stageCounts[status];
        return (
          <div
            key={status}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
            style={{ background: `${stage.color}12`, border: `1px solid ${stage.color}25` }}
          >
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: stage.color }} />
            <span className="text-[10px] font-medium" style={{ color: stage.color }}>{count}</span>
            <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function OrdersSnapshot({ businessId }: { businessId: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await apiGet<OrderApiResponse>(
      `/marketplace/businesses/${businessId}/orders?pageSize=20`,
    );
    const raw = data?.data ?? (Array.isArray(data) ? (data as Order[]) : []);
    setOrders(raw);
    setLoading(false);
    setLoaded(true);
  }, [businessId]);

  const handleOrderUpdate = useCallback((updated: Order) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }, []);

  if (!loaded) {
    return (
      <div className="pt-2">
        <button
          onClick={load}
          className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-medium transition-colors hover:bg-[hsl(var(--kf-muted)/0.1)] min-h-[44px]"
          style={{ background: "hsl(var(--kf-muted)/0.06)", border: "1px solid hsl(var(--kf-border)/0.25)", color: "hsl(var(--kf-muted-foreground))" }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Load Orders
        </button>
      </div>
    );
  }

  const pending = orders.filter((o) => ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED"].includes(o.status));
  const completed = orders.filter((o) => ["DELIVERED", "CANCELLED", "REFUNDED"].includes(o.status));

  return (
    <div className="space-y-3 pt-2">
      {orders.length > 0 && (
        <FulfillmentPipeline orders={orders} />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-foreground))" }}>
            {pending.length} active {pending.length === 1 ? "order" : "orders"}
          </span>
          {pending.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning)/0.15)", color: "hsl(var(--kf-warning))" }}>
              Needs attention
            </span>
          )}
        </div>
        <button onClick={load} disabled={loading} className="p-1.5 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.1)]">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} style={{ color: "hsl(var(--kf-muted-foreground))" }} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-6">
          <Package className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(var(--kf-muted-foreground)/0.3)" }} />
          <p className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>No orders yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Active</p>
              {pending.slice(0, 3).map((order) => (
                <FulfillmentPanel
                  key={order.id}
                  businessId={businessId}
                  order={order}
                  onUpdate={handleOrderUpdate}
                />
              ))}
              {pending.length > 3 && (
                <p className="text-[10px] text-center" style={{ color: "hsl(var(--kf-muted-foreground))" }}>+{pending.length - 3} more active orders</p>
              )}
            </>
          )}
          {completed.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider mt-3" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Completed</p>
              {completed.slice(0, 2).map((order) => (
                <FulfillmentPanel
                  key={order.id}
                  businessId={businessId}
                  order={order}
                  onUpdate={handleOrderUpdate}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SupplierHealthCard({
  deliveryOptions,
  hasContact,
  hoursActive,
  storeStatus,
}: {
  deliveryOptions: DeliveryMethod[];
  hasContact: boolean;
  hoursActive: number;
  storeStatus: StoreStatus;
}) {
  const checks = [
    { label: "Fulfillment channel", ok: deliveryOptions.length > 0, detail: deliveryOptions.length > 0 ? `${deliveryOptions.length} method${deliveryOptions.length > 1 ? "s" : ""} active` : "No delivery method configured" },
    { label: "Customer reachability", ok: hasContact, detail: hasContact ? "Contact info set" : "No contact method" },
    { label: "Business hours", ok: hoursActive > 0, detail: hoursActive > 0 ? `${hoursActive}/7 days scheduled` : "No hours set" },
    { label: "Store accepting orders", ok: storeStatus === "active", detail: storeStatus === "active" ? "Live & accepting" : "Not accepting orders" },
  ];

  const score = checks.filter((c) => c.ok).length;
  const totalChecks = checks.length;
  const pct = Math.round((score / totalChecks) * 100);
  const statusColor = pct >= 75 ? "hsl(var(--kf-success))" : pct >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${statusColor}15` }}>
          <Shield className="w-5 h-5" style={{ color: statusColor }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>Supply Chain Readiness</span>
            <span className="text-xs font-bold" style={{ color: statusColor }}>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.2)" }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: statusColor }} />
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-2 text-[11px]">
            {check.ok ? (
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-success))" }} />
            ) : (
              <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: "hsl(var(--kf-warning))" }} />
            )}
            <span className="flex-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{check.label}</span>
            <span className="font-medium" style={{ color: check.ok ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))" }}>{check.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OperationsMode({
  businessId,
  storeEnabled,
  businessHours,
  storefrontConfig,
  onConfigChange,
  onSaveConfig,
  configSaving,
  onHoursChange,
  onSaveHours,
  hoursSaving,
  onToggleStoreEnabled,
  commerceProducts,
}: Props) {
  const primaryColor = "hsl(var(--kf-accent1))";
  const successColor = "hsl(var(--kf-success))";
  const warningColor = "hsl(var(--kf-warning))";
  const infoColor = "hsl(var(--kf-info))";

  const storeSettings = storefrontConfig.storeSettings ?? {};
  const storeStatus: StoreStatus = storeSettings.storeStatus ?? (storeEnabled ? "active" : "paused");
  const deliveryOptions: DeliveryMethod[] = storeSettings.deliveryOptions ?? [];
  const contactOptions = storefrontConfig.contactOptions ?? {};
  const hoursActive = Object.values(businessHours).filter((h) => (h as Record<string, unknown>)?.enabled).length;
  const hasContact = !!(contactOptions.whatsappNumber || contactOptions.email || contactOptions.phone);

  function handleStatusChange(newStatus: StoreStatus) {
    onConfigChange("storeSettings", { storeStatus: newStatus });
    if (newStatus === "active" && !storeEnabled) {
      onToggleStoreEnabled();
    } else if (newStatus !== "active" && storeEnabled) {
      onToggleStoreEnabled();
    }
    void onSaveConfig();
  }

  const liveStatusLabel = STATUS_OPTIONS.find((s) => s.key === storeStatus)?.label ?? "Active";

  const metrics: MetricStripItem[] = [
    {
      label: "Store Status",
      value: liveStatusLabel,
      icon: Power,
      iconColor: storeStatus === "active" ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
      threshold: { status: storeStatus === "active" ? "good" : "warn" },
    },
    {
      label: "Delivery Methods",
      value: deliveryOptions.length,
      icon: Truck,
      iconColor: infoColor,
      threshold: { status: deliveryOptions.length > 0 ? "good" : "critical" },
    },
    {
      label: "Business Hours",
      value: `${hoursActive}/7 days`,
      icon: Clock,
      iconColor: warningColor,
      threshold: { status: hoursActive > 0 ? "good" : "warn" },
    },
    {
      label: "Contact Setup",
      value: hasContact ? "Configured" : "Missing",
      icon: Phone,
      iconColor: successColor,
      threshold: { status: hasContact ? "good" : "warn" },
    },
  ];

  const aiRecs: { type: "action" | "insight" | "risk" | "opportunity"; priority: "high" | "medium" | "low"; title: string; description: string; actionLabel?: string; onAction?: () => void }[] = [];
  if (!storeEnabled) aiRecs.push({ type: "risk", priority: "high", title: "Store is Offline", description: "Your storefront is not accepting orders. Toggle it to Active to start receiving customers.", actionLabel: "Go Live", onAction: () => handleStatusChange("active") });
  if (deliveryOptions.length === 0) aiRecs.push({ type: "action", priority: "high", title: "No Delivery Methods", description: "Customers can't complete purchases without a delivery method. Add shipping, pickup, or digital delivery." });
  if (!hasContact) aiRecs.push({ type: "insight", priority: "medium", title: "No Contact Info", description: "Add WhatsApp, email, or phone so customers can reach you. This builds trust and reduces abandoned carts." });
  if (hoursActive === 0) aiRecs.push({ type: "opportunity", priority: "medium", title: "Set Business Hours", description: "Let customers know when you're available. Stores with hours configured receive more bookings." });

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <WorkspaceMetricStrip items={metrics} columns={4} compact />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex items-center gap-3 rounded-2xl px-4 py-3"
        style={{
          background: storeStatus === "active" ? "hsl(var(--kf-success)/0.06)" : storeStatus === "coming_soon" ? "hsl(217 91% 60% / 0.06)" : "hsl(var(--kf-warning)/0.06)",
          border: `1px solid ${storeStatus === "active" ? "hsl(var(--kf-success)/0.2)" : storeStatus === "coming_soon" ? "hsl(217 91% 60% / 0.2)" : "hsl(var(--kf-warning)/0.2)"}`,
        }}
      >
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: storeStatus === "active" ? "hsl(var(--kf-success)/0.15)" : "hsl(var(--kf-warning)/0.15)" }}>
          <Power className="w-4 h-4" style={{ color: storeStatus === "active" ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
            Store Status: {liveStatusLabel}
          </p>
          <p className="text-[11px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {storeStatus === "active" ? "Accepting orders from customers" : storeStatus === "coming_soon" ? "Page visible but checkout is disabled" : "Customers cannot order from your store"}
          </p>
        </div>
        <button
          onClick={() => handleStatusChange(storeStatus === "active" ? "paused" : "active")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold min-h-[40px] transition-all hover:opacity-90"
          style={{
            background: storeStatus === "active" ? "hsl(var(--kf-warning)/0.15)" : "hsl(var(--kf-success)/0.15)",
            color: storeStatus === "active" ? "hsl(var(--kf-warning))" : "hsl(var(--kf-success))",
            border: `1px solid ${storeStatus === "active" ? "hsl(var(--kf-warning)/0.3)" : "hsl(var(--kf-success)/0.3)"}`,
          }}
        >
          {storeStatus === "active" ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Go Live</>}
        </button>
      </motion.div>

      {aiRecs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-2"
        >
          {aiRecs.slice(0, 2).map((rec) => (
            <AiRecommendationCard
              key={rec.title}
              type={rec.type}
              priority={rec.priority}
              title={rec.title}
              description={rec.description}
              actionLabel={rec.actionLabel}
              onAction={rec.onAction}
            />
          ))}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <SectionCard title="Supplier & Fulfillment Health" subtitle="Supply chain readiness assessment" icon={Shield}>
          <SupplierHealthCard
            deliveryOptions={deliveryOptions}
            hasContact={hasContact}
            hoursActive={hoursActive}
            storeStatus={storeStatus}
          />
        </SectionCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
        <AccordionGroup title="Store Operations" brandColor="hsl(var(--kf-accent1))">
          <AccordionSection title="Store Status" subtitle="How your storefront appears to customers" icon={Power} accentColor={successColor} defaultOpen>
            <StoreStatusControl storeStatus={storeStatus} onStatusChange={handleStatusChange} />
          </AccordionSection>

          <AccordionSection title="Order Fulfillment" subtitle="View and manage customer orders" icon={Package} accentColor={primaryColor} defaultOpen>
            <OrdersSnapshot businessId={businessId} />
          </AccordionSection>

          <AccordionSection title="Delivery Methods (Advanced)" subtitle="Shipping, pickup, digital — storefront-level config" icon={Truck} accentColor={infoColor}>
            <DeliveryOptionsLegacy
              storefrontConfig={storefrontConfig}
              onConfigChange={onConfigChange}
              onSave={onSaveConfig}
              saving={configSaving}
            />
          </AccordionSection>

          <AccordionSection title="Delivery Config (Detailed)" subtitle="Zone rates, pickup settings, and service bookings" icon={Truck} accentColor={primaryColor}>
            <DeliveryConfigPanel businessId={businessId} />
          </AccordionSection>

          <AccordionSection title="Shipping Zones" subtitle="Rates and regions for physical delivery" icon={Truck} accentColor={infoColor}>
            <ShippingZonesPanel businessId={businessId} />
          </AccordionSection>
        </AccordionGroup>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <AccordionGroup title="Schedule & Contact" brandColor="#14B8A6">
          <AccordionSection
            title="Business Hours"
            subtitle={`${hoursActive} day${hoursActive !== 1 ? "s" : ""} active`}
            icon={Clock}
            accentColor={warningColor}
          >
            <HoursEditor
              hours={businessHours}
              onChange={onHoursChange}
              onSave={onSaveHours}
              saving={hoursSaving}
            />
          </AccordionSection>

          <AccordionSection
            title="Contact Options"
            subtitle="WhatsApp, email, phone, and contact form"
            icon={Phone}
            accentColor={successColor}
            badge={hasContact ? (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success)/0.15)", color: "hsl(var(--kf-success))" }}>Set</span>
            ) : undefined}
          >
            <ContactOptionsPanel
              storefrontConfig={storefrontConfig}
              onConfigChange={onConfigChange}
              onSave={onSaveConfig}
              saving={configSaving}
            />
          </AccordionSection>

          <AccordionSection
            title="Qualification Engine"
            subtitle="Guided package selector, intake, and analytics"
            icon={Target}
            accentColor={primaryColor}
          >
            <QualificationConfig
              businessId={businessId}
              products={commerceProducts ?? []}
            />
          </AccordionSection>
        </AccordionGroup>
      </motion.div>
    </div>
  );
}
