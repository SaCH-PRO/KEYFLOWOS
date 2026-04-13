"use client";

import { motion } from "framer-motion";
import {
  Building2, Users, Clock, Briefcase, TrendingUp,
  MapPin, FileText, Palette, Globe, Zap,
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

const SECTION_POWERS: Record<string, PowersNote[]> = {
  identity: [
    { icon: FileText, label: "Invoices & Quotes", modules: "Revenue" },
    { icon: Globe, label: "Storefront & Public Pages", modules: "Store" },
    { icon: Zap, label: "AI Document Generation", modules: "Documents" },
  ],
  team: [
    { icon: Zap, label: "Automation Recommendations", modules: "Flows" },
    { icon: Users, label: "Staffing Guidance", modules: "Calendar" },
    { icon: TrendingUp, label: "Operations Intelligence", modules: "Projects" },
  ],
  hours: [
    { icon: Clock, label: "Booking Availability", modules: "Calendar" },
    { icon: Globe, label: "Storefront Display", modules: "Store" },
  ],
  brand: [
    { icon: Palette, label: "Visual Identity", modules: "Store, Emails" },
    { icon: Globe, label: "Social Presence", modules: "Content, Store" },
    { icon: FileText, label: "Document Branding", modules: "Documents" },
  ],
};

function PowersIndicator({ powers }: { powers: PowersNote[] }) {
  return (
    <div
      className="rounded-lg p-2.5 mt-1 mb-3"
      style={{
        background: "hsl(var(--kf-muted) / 0.06)",
        border: "1px solid hsl(var(--kf-border) / 0.1)",
      }}
    >
      <p className="text-[10px] font-semibold mb-1.5" style={{ color: "hsl(var(--kf-accent2))" }}>
        What this powers
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
            </span>
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
        <PowersIndicator powers={SECTION_POWERS.identity} />
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
        <PowersIndicator powers={SECTION_POWERS.brand} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <ProfileSectionErrorBoundary sectionName="Brand & Identity">
          <BrandIdentityTab onDirtyChange={onBrandDirtyChange} />
        </ProfileSectionErrorBoundary>
      </motion.div>
    </motion.div>
  );
}
