"use client";

import { useState, useEffect, useCallback } from "react";
import { Truck, MapPin, Download, Calendar, Save, Loader2 } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api";

type DeliveryConfig = {
  shipping: { enabled: boolean };
  localPickup: { enabled: boolean; address: string; hours: string };
  digital: { enabled: boolean };
  service: { enabled: boolean };
};

const DEFAULT_CONFIG: DeliveryConfig = {
  shipping: { enabled: false },
  localPickup: { enabled: false, address: "", hours: "" },
  digital: { enabled: false },
  service: { enabled: false },
};

export function DeliveryConfigPanel({ businessId }: { businessId: string }) {
  const [config, setConfig] = useState<DeliveryConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    apiGet<DeliveryConfig>(`/marketplace/businesses/${businessId}/delivery-config`).then(({ data }) => {
      if (data) setConfig({ ...DEFAULT_CONFIG, ...data });
      setLoaded(true);
    });
  }, [businessId]);

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const { error } = await apiPut(`/marketplace/businesses/${businessId}/delivery-config`, config);
    if (error) setSaveError(error);
    setSaving(false);
  }, [businessId, config]);

  const toggle = (method: keyof DeliveryConfig) => {
    setConfig((prev) => ({
      ...prev,
      [method]: { ...prev[method], enabled: !prev[method].enabled },
    }));
  };

  if (!loaded) return null;

  const methods = [
    {
      key: "shipping" as const,
      icon: Truck,
      title: "Shipping",
      desc: "Ship products to customers with configurable zones and rates",
    },
    {
      key: "localPickup" as const,
      icon: MapPin,
      title: "Local Pickup",
      desc: "Customers collect orders from your location",
    },
    {
      key: "digital" as const,
      icon: Download,
      title: "Digital Delivery",
      desc: "Instant download or email delivery for digital products",
    },
    {
      key: "service" as const,
      icon: Calendar,
      title: "Service Booking",
      desc: "Use the existing booking scheduler for service-based items",
    },
  ];

  return (
    <div
      className="rounded-2xl p-5 space-y-5"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border))" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
            Delivery & Fulfillment
          </h3>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="kf-btn-primary min-h-[44px] px-4 text-sm flex items-center gap-1.5"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {saveError && (
        <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {methods.map(({ key, icon: Icon, title, desc }) => (
          <button
            key={key}
            onClick={() => toggle(key)}
            className="text-left rounded-xl p-4 transition-all"
            style={{
              background: config[key].enabled
                ? "hsl(var(--kf-accent1) / 0.1)"
                : "hsl(var(--kf-muted) / 0.15)",
              border: `1px solid ${config[key].enabled ? "hsl(var(--kf-accent1) / 0.3)" : "hsl(var(--kf-border))"}`,
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background: config[key].enabled
                    ? "hsl(var(--kf-accent1) / 0.2)"
                    : "hsl(var(--kf-muted) / 0.3)",
                }}
              >
                <Icon
                  className="w-4 h-4"
                  style={{
                    color: config[key].enabled
                      ? "hsl(var(--kf-accent1))"
                      : "hsl(var(--kf-muted-foreground))",
                  }}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p
                    className="text-sm font-medium"
                    style={{ color: "hsl(var(--kf-foreground))" }}
                  >
                    {title}
                  </p>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{
                      background: config[key].enabled
                        ? "hsl(var(--kf-success) / 0.15)"
                        : "hsl(var(--kf-muted) / 0.3)",
                      color: config[key].enabled
                        ? "hsl(var(--kf-success))"
                        : "hsl(var(--kf-muted-foreground))",
                    }}
                  >
                    {config[key].enabled ? "ON" : "OFF"}
                  </span>
                </div>
                <p
                  className="text-xs mt-0.5"
                  style={{ color: "hsl(var(--kf-muted-foreground))" }}
                >
                  {desc}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {config.localPickup.enabled && (
        <div className="space-y-3 pt-2">
          <p className="text-xs font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Pickup Details
          </p>
          <input
            type="text"
            value={config.localPickup.address}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                localPickup: { ...prev.localPickup, address: e.target.value },
              }))
            }
            placeholder="Pickup address"
            className="w-full rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.3)",
              border: "1px solid hsl(var(--kf-border))",
              color: "hsl(var(--kf-foreground))",
            }}
          />
          <input
            type="text"
            value={config.localPickup.hours}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                localPickup: { ...prev.localPickup, hours: e.target.value },
              }))
            }
            placeholder="Pickup hours (e.g., Mon-Fri 9am-5pm)"
            className="w-full rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
            style={{
              background: "hsl(var(--kf-muted) / 0.3)",
              border: "1px solid hsl(var(--kf-border))",
              color: "hsl(var(--kf-foreground))",
            }}
          />
        </div>
      )}
    </div>
  );
}
