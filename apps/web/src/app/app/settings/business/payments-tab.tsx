"use client";

import { useState, useEffect } from "react";
import { CreditCard, Wallet, Shield, Eye, EyeOff, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@keyflow/ui";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type PaymentSettings = {
  wipayApiKey: string;
  wipayAccountNumber: string;
  paypalClientId: string;
  paypalClientSecret: string;
};

export function PaymentsTab() {
  const [settings, setSettings] = useState<PaymentSettings>({
    wipayApiKey: "",
    wipayAccountNumber: "",
    paypalClientId: "",
    paypalClientSecret: "",
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      const businessId = getStoredBusinessId();
      if (!businessId) return;
      const res = await apiGet<{ metaData: Record<string, any> }>(`/identity/businesses/${businessId}`);
      if (res.data?.metaData) {
        const meta = res.data.metaData;
        setSettings({
          wipayApiKey: meta.wipayApiKey || "",
          wipayAccountNumber: meta.wipayAccountNumber || "",
          paypalClientId: meta.paypalClientId || "",
          paypalClientSecret: meta.paypalClientSecret || "",
        });
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    setSaving(true);
    setStatus(null);

    const res = await apiPatch(`/identity/businesses/${businessId}`, {
      metaData: {
        wipayApiKey: settings.wipayApiKey || undefined,
        wipayAccountNumber: settings.wipayAccountNumber || undefined,
        paypalClientId: settings.paypalClientId || undefined,
        paypalClientSecret: settings.paypalClientSecret || undefined,
      },
    });

    setSaving(false);
    if (res.error) {
      setStatus({ type: "error", message: res.error });
    } else {
      setStatus({ type: "success", message: "Payment settings saved" });
    }
  };

  const toggleSecret = (field: string) => {
    setShowSecrets((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const setField = (field: keyof PaymentSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const hasWipay = Boolean(settings.wipayApiKey || settings.wipayAccountNumber);
  const hasPaypal = Boolean(settings.paypalClientId && settings.paypalClientSecret);

  return (
    <div className="space-y-6">
      {status && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/30 text-emerald-200"
              : "border border-red-400/40 bg-red-900/30 text-red-200"
          }`}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {status.message}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">WiPay (Caribbean)</h3>
          {hasWipay && (
            <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">Connected</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Accept credit/debit card payments in TTD, JMD, BBD, GYD, and XCD.
          <a
            href="https://wipaycaribbean.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 ml-1 text-primary hover:underline"
          >
            Sign up <ExternalLink className="w-3 h-3" />
          </a>
        </p>

        <div className="grid gap-3 mt-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">API Key (Developer ID)</label>
            <div className="relative">
              <input
                type={showSecrets.wipayApiKey ? "text" : "password"}
                value={settings.wipayApiKey}
                onChange={(e) => setField("wipayApiKey", e.target.value)}
                placeholder="Your WiPay API key"
                className="w-full rounded-lg border border-border/60 bg-card px-3 py-2 text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => toggleSecret("wipayApiKey")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecrets.wipayApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Account Number</label>
            <input
              type="text"
              value={settings.wipayAccountNumber}
              onChange={(e) => setField("wipayAccountNumber", e.target.value)}
              placeholder="Your WiPay account number"
              className="w-full rounded-lg border border-border/60 bg-card px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Leave blank to use sandbox mode for testing. Use test card: 4111 1111 1111 1111, CVV: 123, Exp: 01/25
        </p>
      </div>

      <div className="border-t border-border/40" />

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold">PayPal (International)</h3>
          {hasPaypal && (
            <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">Connected</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Accept PayPal and international card payments in USD.
          <a
            href="https://developer.paypal.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 ml-1 text-primary hover:underline"
          >
            Developer portal <ExternalLink className="w-3 h-3" />
          </a>
        </p>

        <div className="grid gap-3 mt-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Client ID</label>
            <div className="relative">
              <input
                type={showSecrets.paypalClientId ? "text" : "password"}
                value={settings.paypalClientId}
                onChange={(e) => setField("paypalClientId", e.target.value)}
                placeholder="PayPal client ID"
                className="w-full rounded-lg border border-border/60 bg-card px-3 py-2 text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => toggleSecret("paypalClientId")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecrets.paypalClientId ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Client Secret</label>
            <div className="relative">
              <input
                type={showSecrets.paypalClientSecret ? "text" : "password"}
                value={settings.paypalClientSecret}
                onChange={(e) => setField("paypalClientSecret", e.target.value)}
                placeholder="PayPal client secret"
                className="w-full rounded-lg border border-border/60 bg-card px-3 py-2 text-sm pr-10"
              />
              <button
                type="button"
                onClick={() => toggleSecret("paypalClientSecret")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecrets.paypalClientSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border/40" />

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Shield className="w-4 h-4" />
        <span>Your payment credentials are stored securely and never shared with third parties.</span>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Payment Settings"}
        </Button>
      </div>
    </div>
  );
}
