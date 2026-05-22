"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import { toast } from "sonner";
import { CreditCard, Loader2, ToggleLeft, ToggleRight } from "lucide-react";

interface Props {
  businessId: string;
  productId: string;
}

export function SubscriptionConfigPanel({ businessId, productId }: Props) {
  const [config, setConfig] = useState({
    enabled: false,
    billingInterval: "month" as "week" | "month" | "year",
    intervalCount: 1,
    trialDays: 0,
    setupFee: 0,
    cancellationPolicy: "anytime" as "anytime" | "end_of_period" | "minimum_term",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId || !productId) return;
    apiGet<any>(`/conversion/businesses/${businessId}/products/${productId}/subscription-config`)
      .then((res) => {
        if (res.data) setConfig(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, productId]);

  const save = async () => {
    setSaving(true);
    try {
      await apiPatch(`/conversion/businesses/${businessId}/products/${productId}/subscription-config`, config);
      toast.success("Subscription settings saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          <h3 className="text-sm font-semibold">Subscription Billing</h3>
        </div>
        <button onClick={() => setConfig((c) => ({ ...c, enabled: !c.enabled }))}>
          {config.enabled ? (
            <ToggleRight className="w-7 h-7 text-[hsl(var(--kf-accent2))]" />
          ) : (
            <ToggleLeft className="w-7 h-7 text-muted-foreground" />
          )}
        </button>
      </div>

      {config.enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Interval</label>
              <select
                value={config.billingInterval}
                onChange={(e) => setConfig({ ...config, billingInterval: e.target.value as any })}
                className="kf-input w-full mt-1 text-sm"
              >
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Every N</label>
              <input
                type="number"
                min={1}
                value={config.intervalCount}
                onChange={(e) => setConfig({ ...config, intervalCount: parseInt(e.target.value) || 1 })}
                className="kf-input w-full mt-1 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Trial Days</label>
              <input
                type="number"
                min={0}
                value={config.trialDays}
                onChange={(e) => setConfig({ ...config, trialDays: parseInt(e.target.value) || 0 })}
                className="kf-input w-full mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Setup Fee</label>
              <input
                type="number"
                min={0}
                value={config.setupFee}
                onChange={(e) => setConfig({ ...config, setupFee: parseFloat(e.target.value) || 0 })}
                className="kf-input w-full mt-1 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Cancellation</label>
            <select
              value={config.cancellationPolicy}
              onChange={(e) => setConfig({ ...config, cancellationPolicy: e.target.value as any })}
              className="kf-input w-full mt-1 text-sm"
            >
              <option value="anytime">Anytime</option>
              <option value="end_of_period">End of billing period</option>
              <option value="minimum_term">Minimum term</option>
            </select>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="kf-btn-primary w-full py-2 text-xs rounded-lg disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Save Subscription Settings"}
          </button>
        </div>
      )}
    </div>
  );
}
