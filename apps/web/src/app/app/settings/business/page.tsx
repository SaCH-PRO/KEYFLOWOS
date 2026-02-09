"use client";

import { useState } from "react";
import { Building2, Globe, Palette, CreditCard, Crown, CheckCircle2, AlertCircle } from "lucide-react";
import { Button, Card } from "@keyflow/ui";
import { useBusinessSettings } from "./use-business-settings";
import { LogoUploader } from "./logo-uploader";
import { BasicInfoTab } from "./basic-info-tab";
import { SocialTab } from "./social-tab";
import { BrandingTab } from "./branding-tab";
import { PaymentsTab } from "./payments-tab";
import { BillingTab } from "./billing-tab";

export default function BusinessSettingsPage() {
  const {
    form,
    setField,
    loading,
    saving,
    uploading,
    status,
    business,
    handleSave,
    handleLogoUpload,
    fileInputRef,
    logoUrl,
  } = useBusinessSettings();
  const [activeTab, setActiveTab] = useState<"basic" | "social" | "branding" | "payments" | "billing">("basic");

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  if (!business) {
    return <div className="text-muted-foreground">No business found. Please set up your workspace first.</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
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

      <Card className="p-6">
        <LogoUploader
          logoUrl={logoUrl}
          name={form.name}
          uploading={uploading}
          fileInputRef={fileInputRef}
          onUpload={handleLogoUpload}
        />

        <div className="flex gap-2 mb-6 border-b border-border/40" role="tablist">
          {[
            { key: "basic", label: "Basic Info", icon: Building2 },
            { key: "social", label: "Social Media", icon: Globe },
            { key: "branding", label: "Branding", icon: Palette },
            { key: "payments", label: "Payments", icon: CreditCard },
            { key: "billing", label: "Billing", icon: Crown },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              role="tab"
              aria-selected={activeTab === key}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {activeTab === "basic" && <div role="tabpanel"><BasicInfoTab form={form} setField={setField} /></div>}
        {activeTab === "social" && <div role="tabpanel"><SocialTab form={form} setField={setField} /></div>}
        {activeTab === "branding" && <div role="tabpanel"><BrandingTab form={form} setField={setField} /></div>}
        {activeTab === "payments" && <div role="tabpanel"><PaymentsTab /></div>}
        {activeTab === "billing" && <div role="tabpanel"><BillingTab /></div>}

        <div className="flex justify-end pt-6 mt-6 border-t border-border/40">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
