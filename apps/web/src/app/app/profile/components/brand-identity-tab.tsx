"use client";

import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@keyflow/ui";
import { useBusinessSettings } from "../../settings/business/use-business-settings";
import { LogoUploader } from "../../settings/business/logo-uploader";
import { BasicInfoTab } from "../../settings/business/basic-info-tab";
import { SocialTab } from "../../settings/business/social-tab";
import { BrandingTab } from "../../settings/business/branding-tab";
import { AccordionSection, AccordionGroup } from "../../store/components/accordion-section";
import {
  Building2, Globe, Palette,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

interface BrandIdentityTabProps {
  onDirtyChange?: (dirty: boolean) => void;
}

export default function BrandIdentityTab({ onDirtyChange }: BrandIdentityTabProps) {
  const {
    form, setField, loading, saving, uploading, status,
    business, handleSave, handleLogoUpload, fileInputRef, logoUrl,
    isDirty, validationErrors,
  } = useBusinessSettings();

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-muted/40" />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-40 bg-muted/40 rounded-lg" />
            <div className="h-3 w-56 bg-muted/30 rounded-lg" />
          </div>
        </div>
        <div className="kf-card p-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted/20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="kf-card p-8 text-center">
        <Building2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="text-lg font-semibold mb-1">No Business Found</h3>
        <p className="text-sm text-muted-foreground">Complete your onboarding first.</p>
      </div>
    );
  }

  return (
    <motion.div
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      {status && (
        <motion.div
          variants={fadeUp}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
          style={{
            border: `1px solid ${status.type === "success" ? "hsl(var(--kf-success) / 0.4)" : "hsl(var(--kf-error) / 0.4)"}`,
            background: status.type === "success" ? "hsl(var(--kf-success) / 0.08)" : "hsl(var(--kf-error) / 0.08)",
            color: status.type === "success" ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))",
          }}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {status.message}
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <LogoUploader
          logoUrl={logoUrl}
          name={form.name}
          uploading={uploading}
          fileInputRef={fileInputRef}
          onUpload={handleLogoUpload}
        />
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-6">
        <AccordionGroup title="Brand & Identity">
          <AccordionSection
            title="Business Information"
            subtitle="Name, contact, location, and settings"
            icon={Building2}
            accentColor="hsl(var(--kf-accent2))"
            defaultOpen
          >
            <div className="p-1">
              <BasicInfoTab form={form} setField={setField} logoUrl={logoUrl ?? undefined} validationErrors={validationErrors} />
            </div>
          </AccordionSection>

          <AccordionSection
            title="Social Media"
            subtitle="Connect your social accounts"
            icon={Globe}
            accentColor="hsl(var(--kf-accent1))"
          >
            <div className="p-1">
              <SocialTab form={form} setField={setField} />
            </div>
          </AccordionSection>

          <AccordionSection
            title="Branding & Colors"
            subtitle="Logo, palette, and visual identity"
            icon={Palette}
            accentColor="hsl(var(--kf-accent2))"
          >
            <div className="p-1">
              <BrandingTab form={form} setField={setField} />
            </div>
          </AccordionSection>
        </AccordionGroup>
      </motion.div>

      <motion.div variants={fadeUp} className="flex items-center justify-between">
        {isDirty ? (
          <p className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }}>
            <AlertCircle className="h-3 w-3" />
            You have unsaved changes
          </p>
        ) : (
          <div />
        )}
        <Button onClick={handleSave} disabled={saving || !isDirty} className="min-h-[44px]">
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </motion.div>
    </motion.div>
  );
}
