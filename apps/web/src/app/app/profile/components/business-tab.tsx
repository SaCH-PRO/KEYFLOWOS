"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Building2, Users, Clock,
  FileText, Palette, Globe, Zap,
  CheckCircle2, BarChart3, Target,
} from "lucide-react";
import MyBusinessSection from "./my-business-section";
import BrandIdentityTab from "./brand-identity-tab";
import { ProfileSectionErrorBoundary } from "./profile-section-error-boundary";
import type { ProfileBusinessData, StatusMessage } from "./profile-types";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

interface PowersNote {
  icon: React.ElementType;
  label: string;
  modules: string;
}

const IDENTITY_POWERS: PowersNote[] = [
  { icon: FileText, label: "Invoices & Quotes", modules: "Revenue" },
  { icon: Globe, label: "Storefront & Public Pages", modules: "Store" },
  { icon: Zap, label: "AI Document Generation", modules: "Documents" },
  { icon: Target, label: "Intelligence Package", modules: "Profile" },
];

const BRAND_POWERS: PowersNote[] = [
  { icon: Palette, label: "Visual Identity", modules: "Store, Emails" },
  { icon: Globe, label: "Social Presence", modules: "Content, Store" },
  { icon: FileText, label: "Document Branding", modules: "Documents" },
  { icon: BarChart3, label: "Marketing Materials", modules: "Content" },
];

function PowersIndicator({ powers, title, description }: { powers: PowersNote[]; title: string; description: string }) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.04), hsl(var(--kf-accent1) / 0.02))",
        border: "1px solid hsl(var(--kf-accent2) / 0.1)",
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Zap className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
        <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
          {title}
        </span>
      </div>
      <p className="text-[10px] mb-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
        {description}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {powers.map((p, i) => {
          const Icon = p.icon;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px]"
              style={{
                background: "hsl(var(--kf-accent2) / 0.08)",
                color: "hsl(var(--kf-accent2))",
              }}
            >
              <Icon className="w-3 h-3" />
              {p.label}
              <span className="opacity-60">({p.modules})</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BusinessCompletionStrip({ businessData }: { businessData: ProfileBusinessData | null }) {
  const sections = useMemo(() => [
    {
      label: "Identity",
      icon: Building2,
      completed: [businessData?.name, businessData?.tagline, businessData?.description].filter(Boolean).length,
      total: 3,
    },
    {
      label: "Team",
      icon: Users,
      completed: businessData?.teamSize ? 1 : 0,
      total: 1,
    },
    {
      label: "Hours",
      icon: Clock,
      completed: businessData?.businessHours && Object.values(businessData.businessHours).some(
        (d: { open: string; close: string; closed: boolean }) => d.open !== "09:00" || d.close !== "17:00" || d.closed
      ) ? 1 : 0,
      total: 1,
    },
    {
      label: "Brand",
      icon: Palette,
      completed: [businessData?.logoUrl, businessData?.primaryColor].filter(Boolean).length,
      total: 2,
    },
  ], [businessData]);

  const totalCompleted = sections.reduce((a, s) => a + s.completed, 0);
  const totalFields = sections.reduce((a, s) => a + s.total, 0);

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "hsl(var(--kf-card))",
        border: "1px solid hsl(var(--kf-border) / 0.3)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold">Business Profile Completion</span>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{
            background: totalCompleted === totalFields ? "hsl(var(--kf-success) / 0.12)" : "hsl(var(--kf-accent1) / 0.12)",
            color: totalCompleted === totalFields ? "hsl(var(--kf-success))" : "hsl(var(--kf-accent1))",
          }}
        >
          {totalCompleted}/{totalFields}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {sections.map((s) => {
          const Icon = s.icon;
          const isComplete = s.completed === s.total;
          return (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: isComplete ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-muted) / 0.1)",
                }}
              >
                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
                ) : (
                  <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                )}
              </div>
              <span className="text-[10px] font-medium" style={{ color: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground))" }}>
                {s.label}
              </span>
              <span className="text-[9px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                {s.completed}/{s.total}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface BusinessTabProps {
  businessId: string | null;
  businessData: ProfileBusinessData | null;
  businessLoading: boolean;
  onBizDirtyChange: (dirty: boolean) => void;
  onBrandDirtyChange: (dirty: boolean) => void;
  onStatus: (status: StatusMessage | null) => void;
  onBusinessSaved: (saved: Partial<ProfileBusinessData>) => void;
}

export function BusinessTab({
  businessId,
  businessData,
  businessLoading,
  onBizDirtyChange,
  onBrandDirtyChange,
  onStatus,
  onBusinessSaved,
}: BusinessTabProps) {
  return (
    <motion.div
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div variants={fadeUp}>
        <BusinessCompletionStrip businessData={businessData} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <PowersIndicator
          powers={IDENTITY_POWERS}
          title="Business identity powers these modules"
          description="Your business name, description, and core details feed into every customer-facing and AI-powered surface in KeyFlow."
        />
      </motion.div>

      <motion.div variants={fadeUp} className="kf-card p-6">
        <ProfileSectionErrorBoundary sectionName="My Business">
          <MyBusinessSection
            businessId={businessId}
            businessData={businessData}
            businessLoading={businessLoading}
            onDirtyChange={onBizDirtyChange}
            onStatus={onStatus}
            onSaved={onBusinessSaved}
          />
        </ProfileSectionErrorBoundary>
      </motion.div>

      <motion.div variants={fadeUp}>
        <PowersIndicator
          powers={BRAND_POWERS}
          title="Brand & identity powers these modules"
          description="Your visual identity, colors, logo, and social presence shape how your business appears across storefront, emails, and marketing."
        />
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Brand & Identity">
          <BrandIdentityTab onDirtyChange={onBrandDirtyChange} />
        </ProfileSectionErrorBoundary>
      </motion.div>
    </motion.div>
  );
}
