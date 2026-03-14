"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  Wallet,
  Building2,
  Banknote,
  Shield,
  Eye,
  EyeOff,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  MapPin,
  Info,
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { apiGet, apiPatch } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

type PaymentSettings = {
  wipayApiKey: string;
  wipayAccountNumber: string;
  paypalClientId: string;
  paypalClientSecret: string;
  bankTransferEnabled: boolean;
  bankName: string;
  bankAccountNumber: string;
  bankRoutingNumber: string;
  bankBranch: string;
  bankInstructions: string;
  cashEnabled: boolean;
};

const defaultSettings: PaymentSettings = {
  wipayApiKey: "",
  wipayAccountNumber: "",
  paypalClientId: "",
  paypalClientSecret: "",
  bankTransferEnabled: false,
  bankName: "",
  bankAccountNumber: "",
  bankRoutingNumber: "",
  bankBranch: "",
  bankInstructions: "",
  cashEnabled: false,
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
      <label className="text-xs text-[hsl(var(--kf-text-muted))] block mb-1.5 font-medium">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-[hsl(var(--kf-border))]/60 bg-[hsl(var(--kf-surface))]/50 px-3 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/60 transition-all"
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setShow((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--kf-text-muted))] hover:text-[hsl(var(--kf-text))] transition-colors"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-[hsl(var(--kf-text-muted))] block mb-1.5 font-medium">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full rounded-xl border border-[hsl(var(--kf-border))]/60 bg-[hsl(var(--kf-surface))]/50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/60 transition-all resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-[hsl(var(--kf-border))]/60 bg-[hsl(var(--kf-surface))]/50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/40 focus:border-[hsl(var(--kf-accent1))]/60 transition-all"
        />
      )}
    </div>
  );
}

function ToggleSwitch({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        enabled ? "bg-emerald-500" : "bg-[hsl(var(--kf-border))]"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function StatusDot({ status }: { status: "connected" | "partial" | "disabled" }) {
  const colors = {
    connected: "bg-emerald-400",
    partial: "bg-orange-400",
    disabled: "bg-[hsl(var(--kf-border))]",
  };
  return <span className={`w-2.5 h-2.5 rounded-full ${colors[status]} shrink-0`} />;
}

function CurrencyBadge({ currency }: { currency: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] font-medium">
      {currency}
    </span>
  );
}

function PaymentCard({
  icon,
  iconGradient,
  iconColor,
  title,
  subtitle,
  tag,
  tagColor,
  status,
  statusLabel,
  currencies,
  externalLink,
  externalLinkLabel,
  expanded,
  onToggleExpand,
  headerRight,
  children,
}: {
  icon: React.ReactNode;
  iconGradient: string;
  iconColor: string;
  title: string;
  subtitle: string;
  tag?: string;
  tagColor?: string;
  status: "connected" | "partial" | "disabled";
  statusLabel: string;
  currencies?: string[];
  externalLink?: string;
  externalLinkLabel?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const borderColor =
    status === "connected"
      ? "border-emerald-500/30"
      : status === "partial"
        ? "border-orange-400/30"
        : "border-[hsl(var(--kf-border))]/40";

  const bgGlow =
    status === "connected"
      ? "bg-emerald-500/[0.03]"
      : status === "partial"
        ? "bg-orange-400/[0.03]"
        : "";

  return (
    <motion.div
      layout
      className={`rounded-2xl border ${borderColor} ${bgGlow} backdrop-blur-md bg-[hsl(var(--kf-surface))]/60 overflow-hidden transition-colors`}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full p-5 flex items-center justify-between cursor-pointer hover:bg-[hsl(var(--kf-surface))]/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-11 h-11 rounded-xl bg-gradient-to-br ${iconGradient} flex items-center justify-center border border-${iconColor}/20`}
          >
            {icon}
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{title}</h3>
              {tag && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full ${tagColor} font-medium`}
                >
                  {tag}
                </span>
              )}
            </div>
            <p className="text-xs text-[hsl(var(--kf-text-muted))]">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {currencies && currencies.length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              {currencies.map((c) => (
                <CurrencyBadge key={c} currency={c} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <StatusDot status={status} />
            <span className="text-xs text-[hsl(var(--kf-text-muted))]">{statusLabel}</span>
          </div>
          {headerRight}
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-4 h-4 text-[hsl(var(--kf-text-muted))]" />
          </motion.div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 space-y-4 border-t border-[hsl(var(--kf-border))]/20">
              <div className="pt-4">{children}</div>
              {externalLink && (
                <a
                  href={externalLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[hsl(var(--kf-accent1))] hover:underline transition-colors"
                >
                  {externalLinkLabel} <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function PaymentsTab() {
  const [settings, setSettings] = useState<PaymentSettings>({ ...defaultSettings });
  const [businessAddress, setBusinessAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    wipay: false,
    paypal: false,
    bank: false,
    cash: false,
  });

  useEffect(() => {
    const load = async () => {
      const businessId = getStoredBusinessId();
      if (!businessId) return;
      const res = await apiGet<{ metaData: Record<string, any>; address?: string }>(`/identity/businesses/${businessId}`);
      if (res.data) {
        const meta = res.data.metaData || {};
        setSettings({
          wipayApiKey: meta.wipayApiKey || "",
          wipayAccountNumber: meta.wipayAccountNumber || "",
          paypalClientId: meta.paypalClientId || "",
          paypalClientSecret: meta.paypalClientSecret || "",
          bankTransferEnabled: meta.bankTransferEnabled || false,
          bankName: meta.bankName || "",
          bankAccountNumber: meta.bankAccountNumber || "",
          bankRoutingNumber: meta.bankRoutingNumber || "",
          bankBranch: meta.bankBranch || "",
          bankInstructions: meta.bankInstructions || "",
          cashEnabled: meta.cashEnabled || false,
        });
        setBusinessAddress(res.data.address || meta.address || "");
      }
    };
    load();
  }, []);

  const handleSave = useCallback(async () => {
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
        bankTransferEnabled: settings.bankTransferEnabled,
        bankName: settings.bankName || undefined,
        bankAccountNumber: settings.bankAccountNumber || undefined,
        bankRoutingNumber: settings.bankRoutingNumber || undefined,
        bankBranch: settings.bankBranch || undefined,
        bankInstructions: settings.bankInstructions || undefined,
        cashEnabled: settings.cashEnabled,
      },
    });
    setSaving(false);
    if (res.error) {
      setStatus({ type: "error", message: res.error });
    } else {
      setStatus({ type: "success", message: "Payment settings saved successfully" });
    }
  }, [settings]);

  const setField = <K extends keyof PaymentSettings>(field: K, value: PaymentSettings[K]) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const wipayStatus: "connected" | "partial" | "disabled" =
    settings.wipayApiKey && settings.wipayAccountNumber
      ? "connected"
      : settings.wipayApiKey || settings.wipayAccountNumber
        ? "partial"
        : "disabled";

  const paypalStatus: "connected" | "partial" | "disabled" =
    settings.paypalClientId && settings.paypalClientSecret
      ? "connected"
      : settings.paypalClientId || settings.paypalClientSecret
        ? "partial"
        : "disabled";

  const bankStatus: "connected" | "partial" | "disabled" =
    settings.bankTransferEnabled && settings.bankName && settings.bankAccountNumber
      ? "connected"
      : settings.bankTransferEnabled
        ? "partial"
        : "disabled";

  const cashStatus: "connected" | "partial" | "disabled" = settings.cashEnabled
    ? "connected"
    : "disabled";

  const statusLabel = (s: "connected" | "partial" | "disabled") =>
    s === "connected" ? "Connected" : s === "partial" ? "Partial" : "Not configured";

  const activeMethods = [
    wipayStatus === "connected" ? "WiPay" : null,
    paypalStatus === "connected" ? "PayPal" : null,
    bankStatus === "connected" ? "Bank Transfer" : null,
    cashStatus === "connected" ? "Cash" : null,
  ].filter(Boolean);

  return (
    <motion.div
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {status && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
              : "border border-red-400/40 bg-red-500/10 text-red-300"
          }`}
        >
          {status.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          {status.message}
        </motion.div>
      )}

      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } }}
        className="rounded-2xl border border-[hsl(var(--kf-border))]/40 backdrop-blur-md bg-[hsl(var(--kf-surface))]/60 p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm">Payment Methods Overview</h3>
            <p className="text-xs text-[hsl(var(--kf-text-muted))] mt-0.5">
              {activeMethods.length > 0
                ? `${activeMethods.length} active: ${activeMethods.join(", ")}`
                : "No payment methods configured yet"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {[
              { label: "WiPay", status: wipayStatus },
              { label: "PayPal", status: paypalStatus },
              { label: "Bank", status: bankStatus },
              { label: "Cash", status: cashStatus },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-1.5">
                <StatusDot status={m.status} />
                <span className="text-[11px] text-[hsl(var(--kf-text-muted))] hidden sm:inline">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <PaymentCard
        icon={<CreditCard className="w-5 h-5 text-green-400" />}
        iconGradient="from-green-500/20 to-teal-500/20"
        iconColor="green-500"
        title="Card Payments (WiPay)"
        subtitle="Accept debit & credit cards across the Caribbean"
        tag="Caribbean"
        tagColor="bg-teal-500/20 text-teal-300"
        status={wipayStatus}
        statusLabel={statusLabel(wipayStatus)}
        currencies={["TTD", "JMD", "BBD", "GYD", "XCD"]}
        externalLink="https://wipaycaribbean.com"
        externalLinkLabel="Sign up for WiPay"
        expanded={expanded.wipay}
        onToggleExpand={() => toggleExpand("wipay")}
        headerRight={
          wipayStatus === "connected" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : null
        }
      >
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
      </PaymentCard>

      <PaymentCard
        icon={<Wallet className="w-5 h-5 text-blue-400" />}
        iconGradient="from-blue-500/20 to-indigo-500/20"
        iconColor="blue-500"
        title="PayPal"
        subtitle="Accept PayPal and cards internationally"
        tag="International"
        tagColor="bg-blue-500/20 text-blue-300"
        status={paypalStatus}
        statusLabel={statusLabel(paypalStatus)}
        currencies={["USD"]}
        externalLink="https://developer.paypal.com"
        externalLinkLabel="PayPal Developer Portal"
        expanded={expanded.paypal}
        onToggleExpand={() => toggleExpand("paypal")}
        headerRight={
          paypalStatus === "connected" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : null
        }
      >
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
      </PaymentCard>

      <PaymentCard
        icon={<Building2 className="w-5 h-5 text-amber-400" />}
        iconGradient="from-amber-500/20 to-yellow-500/20"
        iconColor="amber-500"
        title="Bank Transfer"
        subtitle="Allow customers to pay via direct bank transfer"
        tag="Manual"
        tagColor="bg-amber-500/20 text-amber-300"
        status={bankStatus}
        statusLabel={statusLabel(bankStatus)}
        expanded={expanded.bank}
        onToggleExpand={() => toggleExpand("bank")}
        headerRight={
          <ToggleSwitch
            enabled={settings.bankTransferEnabled}
            onToggle={() => setField("bankTransferEnabled", !settings.bankTransferEnabled)}
          />
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Bank Name"
            value={settings.bankName}
            onChange={(v) => setField("bankName", v)}
            placeholder="e.g. Republic Bank"
          />
          <SecretField
            label="Account Number"
            value={settings.bankAccountNumber}
            onChange={(v) => setField("bankAccountNumber", v)}
            placeholder="Bank account number"
          />
          <TextField
            label="Routing / Transit Number"
            value={settings.bankRoutingNumber}
            onChange={(v) => setField("bankRoutingNumber", v)}
            placeholder="Routing or transit number"
          />
          <TextField
            label="Branch Name"
            value={settings.bankBranch}
            onChange={(v) => setField("bankBranch", v)}
            placeholder="e.g. Port of Spain"
          />
        </div>
        <div className="mt-3">
          <TextField
            label="Customer Instructions"
            value={settings.bankInstructions}
            onChange={(v) => setField("bankInstructions", v)}
            placeholder="e.g. Please include your invoice number as reference"
            multiline
          />
        </div>
      </PaymentCard>

      <PaymentCard
        icon={<Banknote className="w-5 h-5 text-violet-400" />}
        iconGradient="from-violet-500/20 to-purple-500/20"
        iconColor="violet-500"
        title="Cash / In-Person"
        subtitle="Accept cash payments at your location"
        tag="In-Person"
        tagColor="bg-violet-500/20 text-violet-300"
        status={cashStatus}
        statusLabel={statusLabel(cashStatus)}
        expanded={expanded.cash}
        onToggleExpand={() => toggleExpand("cash")}
        headerRight={
          <ToggleSwitch
            enabled={settings.cashEnabled}
            onToggle={() => setField("cashEnabled", !settings.cashEnabled)}
          />
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10 p-3">
            <Info className="w-4 h-4 text-[hsl(var(--kf-accent1))] mt-0.5 shrink-0" />
            <p className="text-xs text-[hsl(var(--kf-text-muted))]">
              When enabled, customers will see an option to pay with cash in person. 
              They&apos;ll receive instructions to visit your business location to complete payment.
            </p>
          </div>
          {businessAddress && (
            <div className="flex items-center gap-2 text-xs text-[hsl(var(--kf-text-muted))]">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>Business address: <strong className="text-[hsl(var(--kf-text))]">{businessAddress}</strong></span>
            </div>
          )}
          {!businessAddress && (
            <div className="flex items-center gap-2 text-xs text-orange-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>No business address set. Add one in the Basic Info tab for customers to find you.</span>
            </div>
          )}
        </div>
      </PaymentCard>

      <motion.div
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } }}
        className="flex items-center justify-between pt-2"
      >
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--kf-text-muted))]">
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
