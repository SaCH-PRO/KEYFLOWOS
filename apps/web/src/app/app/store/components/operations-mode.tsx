"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Power, Pause, Play, Truck, Clock, Phone,
  Package, RefreshCw, ChevronDown, ChevronUp,
  Loader2, MessageCircle, Mail, Save, Monitor,
  MapPin, Eye, Loader,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { DeliveryConfigPanel } from "./delivery-config-panel";
import { ShippingZonesPanel } from "./shipping-zones-panel";
import { HoursEditor, type BusinessHoursMap } from "./hours-editor";
import { FulfillmentPanel, type Order } from "./fulfillment-panel";
import type { StorefrontConfig, StoreStatus, DeliveryMethod } from "@/lib/client";

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
};

function OpsSection({
  title,
  subtitle,
  icon: Icon,
  accentColor,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accentColor: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.4)" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[hsl(var(--kf-muted)/0.06)]"
      >
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${accentColor}18` }}>
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>{title}</p>
          <p className="text-[11px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{subtitle}</p>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
          : <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
        }
      </button>
      {open && (
        <div className="px-4 pb-5 pt-1" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.25)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

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
}: Props) {
  const primaryColor = "hsl(var(--kf-accent1))";
  const successColor = "hsl(var(--kf-success))";
  const warningColor = "hsl(var(--kf-warning))";
  const infoColor = "hsl(var(--kf-info))";

  const storeSettings = storefrontConfig.storeSettings ?? {};
  const storeStatus: StoreStatus = storeSettings.storeStatus ?? (storeEnabled ? "active" : "paused");

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

  return (
    <div className="space-y-3">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
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

      <OpsSection title="Store Status" subtitle="Choose how your storefront appears to customers" icon={Power} accentColor={successColor} defaultOpen>
        <StoreStatusControl storeStatus={storeStatus} onStatusChange={handleStatusChange} />
      </OpsSection>

      <OpsSection title="Order Fulfillment" subtitle="View and manage customer orders" icon={Package} accentColor={primaryColor} defaultOpen>
        <OrdersSnapshot businessId={businessId} />
      </OpsSection>

      <OpsSection title="Delivery Methods (Advanced)" subtitle="Shipping, pickup, digital — storefront-level config" icon={Truck} accentColor={infoColor}>
        <DeliveryOptionsLegacy
          storefrontConfig={storefrontConfig}
          onConfigChange={onConfigChange}
          onSave={onSaveConfig}
          saving={configSaving}
        />
      </OpsSection>

      <OpsSection title="Delivery Config (Detailed)" subtitle="Zone rates, pickup settings, and service bookings" icon={Truck} accentColor={primaryColor}>
        <div className="pt-2">
          <DeliveryConfigPanel businessId={businessId} />
        </div>
      </OpsSection>

      <OpsSection title="Shipping Zones" subtitle="Rates and regions for physical delivery" icon={Truck} accentColor={infoColor}>
        <div className="pt-2">
          <ShippingZonesPanel businessId={businessId} />
        </div>
      </OpsSection>

      <OpsSection title="Business Hours" subtitle="When you're available for orders and bookings" icon={Clock} accentColor={warningColor}>
        <div className="pt-2">
          <HoursEditor
            hours={businessHours}
            onChange={onHoursChange}
            onSave={onSaveHours}
            saving={hoursSaving}
          />
        </div>
      </OpsSection>

      <OpsSection title="Contact Options" subtitle="WhatsApp, email, phone, and contact form on your store" icon={Phone} accentColor={successColor}>
        <ContactOptionsPanel
          storefrontConfig={storefrontConfig}
          onConfigChange={onConfigChange}
          onSave={onSaveConfig}
          saving={configSaving}
        />
      </OpsSection>
    </div>
  );
}
