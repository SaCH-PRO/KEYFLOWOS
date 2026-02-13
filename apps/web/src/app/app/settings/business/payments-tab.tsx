"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CreditCard, Wallet, Shield, Eye, EyeOff, ExternalLink, CheckCircle2, AlertCircle, Zap } from "lucide-react";
import { Button } from "@keyflow/ui";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type PaymentSettings = {
  wipayApiKey: string;
  wipayAccountNumber: string;
  paypalClientId: string;
  paypalClientSecret: string;
};

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  showToggle = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  showToggle?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1.5 font-medium">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-border/60 bg-muted/10 px-3 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/60 transition-all"
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setShow((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function PaymentsTab() {
  const [settings, setSettings] = useState<PaymentSettings>({
    wipayApiKey: "", wipayAccountNumber: "", paypalClientId: "", paypalClientSecret: "",
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

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

  const setField = (field: keyof PaymentSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const hasWipay = Boolean(settings.wipayApiKey || settings.wipayAccountNumber);
  const hasPaypal = Boolean(settings.paypalClientId && settings.paypalClientSecret);

  return (
    <motion.div variants={{ show: { transition: { staggerChildren: 0.06 } } }} initial="hidden" animate="show" className="space-y-6">
      {status && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/20 text-emerald-200"
              : "border border-red-400/40 bg-red-900/20 text-red-200"
          }`}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {status.message}
        </motion.div>
      )}

      <motion.div variants={fadeUp} className={`rounded-xl border p-5 space-y-4 transition-all ${hasWipay ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-500/20 to-teal-500/20 flex items-center justify-center border border-green-500/20">
              <CreditCard className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">WiPay</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 font-medium">Caribbean</span>
              </div>
              <p className="text-xs text-muted-foreground">Accept TTD, JMD, BBD, GYD, XCD</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasWipay && (
              <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            )}
            <a
              href="https://wipaycaribbean.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Sign up <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="grid gap-3">
          <SecretField
            label="API Key (Developer ID)"
            value={settings.wipayApiKey}
            onChange={(v) => setField("wipayApiKey", v)}
            placeholder="Your WiPay API key"
          />
          <SecretField
            label="Account Number"
            value={settings.wipayAccountNumber}
            onChange={(v) => setField("wipayAccountNumber", v)}
            placeholder="Your WiPay account number"
            showToggle={false}
          />
        </div>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Zap className="h-3 w-3" />
          Leave blank for sandbox mode. Test card: 4111 1111 1111 1111, CVV: 123, Exp: 01/25
        </p>
      </motion.div>

      <motion.div variants={fadeUp} className={`rounded-xl border p-5 space-y-4 transition-all ${hasPaypal ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center border border-blue-500/20">
              <Wallet className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">PayPal</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium">International</span>
              </div>
              <p className="text-xs text-muted-foreground">Accept PayPal and cards in USD</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasPaypal && (
              <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connected
              </span>
            )}
            <a
              href="https://developer.paypal.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Developer portal <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="grid gap-3">
          <SecretField
            label="Client ID"
            value={settings.paypalClientId}
            onChange={(v) => setField("paypalClientId", v)}
            placeholder="PayPal client ID"
          />
          <SecretField
            label="Client Secret"
            value={settings.paypalClientSecret}
            onChange={(v) => setField("paypalClientSecret", v)}
            placeholder="PayPal client secret"
          />
        </div>
      </motion.div>

      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="w-4 h-4" />
          <span>Credentials stored securely, never shared with third parties</span>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Payment Settings"}
        </Button>
      </motion.div>
    </motion.div>
  );
}
