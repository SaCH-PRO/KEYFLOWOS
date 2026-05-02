"use client";

import { motion } from "framer-motion";
import {
  Settings,
  Save,
  Loader2,
  Truck,
  MapPin,
  Monitor,
  DollarSign,
  Clock,
  Phone,
  Mail,
  MessageCircle,
} from "lucide-react";
import type { StorefrontConfig, DeliveryMethod, StoreStatus } from "@/lib/client";

type Props = {
  config: StorefrontConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSave: () => Promise<void>;
  saving: boolean;
};

const DELIVERY_OPTIONS: { key: DeliveryMethod; label: string; icon: React.ElementType; description: string }[] = [
  { key: "shipping", label: "Shipping", icon: Truck, description: "Ship products to customers" },
  { key: "pickup", label: "Pickup", icon: MapPin, description: "Customers pick up in-store" },
  { key: "digital", label: "Digital", icon: Monitor, description: "Digital delivery via email" },
];

const STATUS_OPTIONS: { key: StoreStatus; label: string; color: string; description: string }[] = [
  { key: "active", label: "Active", color: "hsl(160 84% 39%)", description: "Store is live and accepting orders" },
  { key: "paused", label: "Paused", color: "hsl(45 93% 55%)", description: "Temporarily not accepting orders" },
  { key: "coming_soon", label: "Coming Soon", color: "hsl(217 91% 60%)", description: "Store page visible, orders disabled" },
];

const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "TTD", "CAD", "AUD", "JMD", "BBD"];

function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={enabled} onClick={onToggle} className="flex items-center justify-between w-full py-2 group">
      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
      <div className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0" style={{ background: enabled ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground) / 0.3)" }}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? "left-[22px]" : "left-0.5"}`} />
      </div>
    </button>
  );
}

export function StoreSettingsPanel({ config, onConfigChange, onSave, saving }: Props) {
  const storeSettings = config.storeSettings ?? {};
  const contactOptions = config.contactOptions ?? {};
  const deliveryOptions: DeliveryMethod[] = storeSettings.deliveryOptions ?? [];
  const storeStatus: StoreStatus = storeSettings.storeStatus ?? "active";
  const minOrder = storeSettings.minimumOrderValue ?? 0;
  const currency = storeSettings.currencyDisplay ?? "TTD";
  const taxRate = storeSettings.taxRate ?? 0;

  function toggleDelivery(method: DeliveryMethod) {
    const updated = deliveryOptions.includes(method)
      ? deliveryOptions.filter((d) => d !== method)
      : [...deliveryOptions, method];
    onConfigChange("storeSettings", { deliveryOptions: updated });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent2) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent2) / 0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent2) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.06), transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--kf-accent2) / 0.15)" }}>
            <Settings className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Store Settings</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Delivery, currency, and contact options</p>
          </div>
        </div>
        <button onClick={onSave} disabled={saving} className="kf-btn-primary text-xs inline-flex items-center gap-1.5" style={{ opacity: saving ? 0.6 : 1 }}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground block">Store Status</label>
          <div className="grid grid-cols-3 gap-2">
            {STATUS_OPTIONS.map((opt) => {
              const isActive = storeStatus === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onConfigChange("storeSettings", { storeStatus: opt.key })}
                  className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: isActive ? `${opt.color}15` : "hsl(var(--kf-muted) / 0.2)",
                    border: isActive ? `2px solid ${opt.color}40` : "1px solid hsl(var(--kf-border) / 0.3)",
                    color: isActive ? opt.color : undefined,
                  }}
                >
                  <Clock className="w-4 h-4" style={{ color: isActive ? opt.color : "hsl(var(--kf-muted-foreground))" }} />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {STATUS_OPTIONS.find((o) => o.key === storeStatus)?.description}
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground block">Delivery Options</label>
          <div className="space-y-2">
            {DELIVERY_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = deliveryOptions.includes(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleDelivery(opt.key)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
                  style={{
                    background: isActive ? "hsl(var(--kf-accent2) / 0.06)" : "hsl(var(--kf-muted) / 0.15)",
                    border: isActive ? "1px solid hsl(var(--kf-accent2) / 0.2)" : "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
                  <Icon className="w-4 h-4" style={{ color: isActive ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground))" }} />
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.description}</p>
                  </div>
                  <div className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0" style={{ background: isActive ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground) / 0.3)" }}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? "left-[22px]" : "left-0.5"}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Minimum Order Value</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="number"
                min={0}
                step={1}
                value={minOrder}
                onChange={(e) => onConfigChange("storeSettings", { minimumOrderValue: Number(e.target.value) || 0 })}
                className="kf-input w-full text-sm pl-8"
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Currency Display</label>
            <select
              value={currency}
              onChange={(e) => onConfigChange("storeSettings", { currencyDisplay: e.target.value })}
              className="kf-input w-full text-sm"
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tax Rate (%)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={taxRate}
              onChange={(e) => onConfigChange("storeSettings", { taxRate: Number(e.target.value) || 0 })}
              className="kf-input w-24 text-sm"
              placeholder="0"
            />
            <span className="text-xs text-muted-foreground">Set to 0 to hide tax from checkout</span>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-medium text-muted-foreground block">Contact Options</label>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block flex items-center gap-1">
                <MessageCircle className="w-3 h-3" /> WhatsApp Number
              </label>
              <input
                type="tel"
                value={contactOptions.whatsappNumber ?? ""}
                onChange={(e) => onConfigChange("contactOptions", { whatsappNumber: e.target.value })}
                placeholder="+1 (868) 555-0123"
                className="kf-input w-full text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block flex items-center gap-1">
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
                <label className="text-[10px] text-muted-foreground mb-1 block flex items-center gap-1">
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
              label="Show Contact Form"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
