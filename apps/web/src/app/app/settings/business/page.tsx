"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Building2, Globe, Palette, CreditCard, Crown, CheckCircle2, AlertCircle, Bot } from "lucide-react";
import { Button } from "@keyflow/ui";
import { useBusinessSettings } from "./use-business-settings";
import { LogoUploader } from "./logo-uploader";
import { BasicInfoTab } from "./basic-info-tab";
import { SocialTab } from "./social-tab";
import { BrandingTab } from "./branding-tab";
import { PaymentsTab } from "./payments-tab";
import { BillingTab } from "./billing-tab";

const tabs = [
  { key: "basic", label: "Basic Info", icon: Building2 },
  { key: "social", label: "Social Media", icon: Globe },
  { key: "branding", label: "Branding", icon: Palette },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "billing", label: "Billing", icon: Crown },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function SkeletonBusiness() {
  return (
    <div className="space-y-6 max-w-3xl animate-pulse">
      <div className="flex items-center gap-6">
        <div className="w-24 h-24 rounded-2xl bg-muted/40" />
        <div className="space-y-2">
          <div className="h-5 w-40 bg-muted/40 rounded-lg" />
          <div className="h-3 w-56 bg-muted/30 rounded-lg" />
        </div>
      </div>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 w-24 bg-muted/30 rounded-xl" />
        ))}
      </div>
      <div className="kf-card p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-muted/20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function BusinessSettingsPage() {
  const router = useRouter();
  const {
    form, setField, loading, saving, uploading, status,
    business, handleSave, handleLogoUpload, fileInputRef, logoUrl,
    isDirty,
  } = useBusinessSettings();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === "undefined") return "basic";
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get("tab");
    const validKeys = tabs.map((t) => t.key) as readonly string[];
    if (urlTab && validKeys.includes(urlTab)) return urlTab as TabKey;
    return "basic";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("tab")) {
      params.delete("tab");
      const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", clean);
    }
  }, []);

  if (loading) return <SkeletonBusiness />;

  if (!business) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="kf-card p-8 text-center max-w-md mx-auto">
        <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <h3 className="text-lg font-semibold mb-1">No Business Found</h3>
        <p className="text-sm text-muted-foreground">Please set up your workspace first through the onboarding wizard.</p>
      </motion.div>
    );
  }

  const isFormTab = activeTab === "basic" || activeTab === "social" || activeTab === "branding";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-3xl"
    >
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

      <LogoUploader
        logoUrl={logoUrl}
        name={form.name}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onUpload={handleLogoUpload}
      />

      <div className="flex gap-1 p-1 rounded-2xl bg-muted/30 backdrop-blur-sm border border-border/40 overflow-x-auto scrollbar-none" role="tablist">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl transition-all shrink-0 ${
              activeTab === key
                ? "text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
            role="tab"
            aria-selected={activeTab === key}
          >
            {activeTab === key && (
              <motion.div
                layoutId="business-tab-bg"
                className="absolute inset-0 rounded-xl bg-background border border-border/60 shadow-sm"
                transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
              />
            )}
            <span className="relative flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </span>
          </button>
        ))}
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="kf-card p-6"
      >
        {activeTab === "basic" && <BasicInfoTab form={form} setField={setField} logoUrl={logoUrl ?? undefined} />}
        {activeTab === "social" && <SocialTab form={form} setField={setField} />}
        {activeTab === "branding" && <BrandingTab form={form} setField={setField} />}
        {activeTab === "payments" && <PaymentsTab />}
        {activeTab === "billing" && <BillingTab />}
      </motion.div>

      {isFormTab && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-between"
        >
          {isDirty ? (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              You have unsaved changes
            </p>
          ) : (
            <div />
          )}
          <Button onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mt-4"
      >
        <button
          onClick={() => router.push("/app/onboarding")}
          className="w-full flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-muted/10 hover:bg-muted/20 transition-all group"
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div className="text-left flex-1">
            <p className="text-sm font-medium group-hover:text-foreground transition-colors">Setup Assistant</p>
            <p className="text-xs text-muted-foreground">Re-run the onboarding concierge to set up or reconfigure your business</p>
          </div>
        </button>
      </motion.div>
    </motion.div>
  );
}
