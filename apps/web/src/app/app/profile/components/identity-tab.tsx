"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Building2, User, Briefcase, Palette, Clock, Users,
  TrendingUp, Sparkles, MapPin, Globe, CheckCircle2,
  FileText, Zap, BarChart3, Target, ArrowRight,
} from "lucide-react";
import MyBusinessSection from "./my-business-section";
import BrandIdentityTab from "./brand-identity-tab";
import PersonalInfoSection from "./personal-info-section";
import ProfessionalProfileSection from "./professional-profile-section";
import { ProfileSectionErrorBoundary } from "./profile-section-error-boundary";
import type { ProfileBusinessData, StatusMessage } from "./profile-types";

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

type IdentityMode = "personal" | "business" | "brand";

const IDENTITY_MODES: { id: IdentityMode; label: string; icon: React.ElementType; description: string }[] = [
  { id: "personal", label: "Personal & Professional", icon: User, description: "Your identity, skills, and expertise" },
  { id: "business", label: "Business Profile", icon: Building2, description: "Company details, team, and operations" },
  { id: "brand", label: "Brand & Visual", icon: Palette, description: "Logo, colors, and social presence" },
];

const FIELD_POWERS: Record<string, { powers: string; modules: string[] }> = {
  name: { powers: "Your business name appears on invoices, contracts, storefront, and all AI-generated content", modules: ["Revenue", "Store", "Documents"] },
  industry: { powers: "Your industry selection drives template recommendations, market intelligence, and competitive analysis", modules: ["Intelligence", "Content", "Projects"] },
  businessStage: { powers: "Business stage powers growth recommendations, automation suggestions, and intelligence depth", modules: ["Autopilot", "Intelligence", "Revenue"] },
  description: { powers: "Your description improves AI document quality and feeds into public profile and storefront", modules: ["Documents", "Store", "Content"] },
  teamSize: { powers: "Team size shapes staffing recommendations, operations guidance, and automation fit", modules: ["Autopilot", "Projects", "Revenue"] },
  headline: { powers: "Your headline defines how you appear in marketplace listings and public profiles", modules: ["Store", "Clients"] },
  bio: { powers: "Your bio enriches AI-generated proposals, company profiles, and client communications", modules: ["Documents", "Clients", "Content"] },
  skills: { powers: "Skills enable smarter project templates, service matching, and expertise-based recommendations", modules: ["Projects", "Revenue", "Intelligence"] },
  location: { powers: "Location data drives tax compliance, local business relevance, and regional intelligence", modules: ["Compliance", "Intelligence", "Store"] },
  tagline: { powers: "Your tagline appears on storefront, marketing materials, and brand-aware documents", modules: ["Store", "Content", "Documents"] },
  logoUrl: { powers: "Your logo appears on invoices, proposals, storefront, and all branded exports", modules: ["Revenue", "Store", "Documents"] },
  primaryColor: { powers: "Brand color is applied to storefront theme, email templates, and document headers", modules: ["Store", "Content", "Documents"] },
};

function FieldPowersBanner({ fieldKey }: { fieldKey: string }) {
  const power = FIELD_POWERS[fieldKey];
  if (!power) return null;

  return (
    <div
      className="flex items-start gap-2 px-2.5 py-2 rounded-lg"
      style={{
        background: "hsl(var(--kf-accent2) / 0.04)",
        border: "1px solid hsl(var(--kf-accent2) / 0.08)",
      }}
    >
      <Zap className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent2))" }} />
      <div className="min-w-0">
        <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{power.powers}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {power.modules.map((mod) => (
            <span key={mod} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--kf-accent2) / 0.08)", color: "hsl(var(--kf-accent2))" }}>
              {mod}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompletionStrip({ businessData, hasName, hasPhone }: { businessData: ProfileBusinessData | null; hasName: boolean; hasPhone: boolean }) {
  const sections = useMemo(() => [
    {
      label: "Personal",
      icon: User,
      completed: [hasName, hasPhone].filter(Boolean).length,
      total: 2,
      powers: "Account identity and communications",
    },
    {
      label: "Identity",
      icon: Briefcase,
      completed: [businessData?.headline, businessData?.bio].filter(Boolean).length,
      total: 2,
      powers: "Public profile and AI proposals",
    },
    {
      label: "Business",
      icon: Building2,
      completed: [businessData?.name, businessData?.tagline, businessData?.description].filter(Boolean).length,
      total: 3,
      powers: "Invoices, store, and documents",
    },
    {
      label: "Industry",
      icon: TrendingUp,
      completed: [businessData?.industry, businessData?.businessStage].filter(Boolean).length,
      total: 2,
      powers: "Growth and intelligence logic",
    },
    {
      label: "Team",
      icon: Users,
      completed: businessData?.teamSize ? 1 : 0,
      total: 1,
      powers: "Operations and automation fit",
    },
    {
      label: "Brand",
      icon: Palette,
      completed: [businessData?.logoUrl, businessData?.primaryColor].filter(Boolean).length,
      total: 2,
      powers: "Visual identity across platforms",
    },
  ], [businessData, hasName, hasPhone]);

  const totalCompleted = sections.reduce((a, s) => a + s.completed, 0);
  const totalFields = sections.reduce((a, s) => a + s.total, 0);

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold">Identity Completion</span>
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
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {sections.map((s) => {
          const Icon = s.icon;
          const isComplete = s.completed === s.total;
          return (
            <div key={s.label} className="flex flex-col items-center gap-1" title={s.powers}>
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: isComplete ? "hsl(var(--kf-success) / 0.1)" : "hsl(var(--kf-muted) / 0.1)" }}
              >
                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
                ) : (
                  <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                )}
              </div>
              <span className="text-[10px] font-medium text-center" style={{ color: isComplete ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground))" }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface IdentityTabProps {
  businessId: string | null;
  businessData: ProfileBusinessData | null;
  businessLoading: boolean;
  savedForm: { email: string; name: string; firstName: string; lastName: string; phone: string };
  avatarUrl: string | null;
  onPersonalDirtyChange: (dirty: boolean) => void;
  onBizDirtyChange: (dirty: boolean) => void;
  onBrandDirtyChange: (dirty: boolean) => void;
  onStatus: (status: StatusMessage | null) => void;
  onPersonalSaved: (form: { email: string; name: string; firstName: string; lastName: string; phone: string }, avatar: string | null) => void;
  onBusinessSaved: (saved: Partial<ProfileBusinessData>) => void;
  onCompletenessChange: (pct: number) => void;
}

export function IdentityTab({
  businessId,
  businessData,
  businessLoading,
  savedForm,
  avatarUrl,
  onPersonalDirtyChange,
  onBizDirtyChange,
  onBrandDirtyChange,
  onStatus,
  onPersonalSaved,
  onBusinessSaved,
  onCompletenessChange,
}: IdentityTabProps) {
  const [mode, setMode] = useState<IdentityMode>("personal");
  const hasName = !!(savedForm.firstName || savedForm.name);
  const hasPhone = !!savedForm.phone;

  return (
    <motion.div
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <motion.div variants={fadeUp}>
        <CompletionStrip businessData={businessData} hasName={hasName} hasPhone={hasPhone} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <div
          className="flex gap-1 p-1 rounded-lg"
          style={{ background: "hsl(var(--kf-muted) / 0.08)", border: "1px solid hsl(var(--kf-border) / 0.15)" }}
        >
          {IDENTITY_MODES.map((m) => {
            const Icon = m.icon;
            const isActive = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-all"
                style={{
                  background: isActive ? "hsl(var(--kf-card))" : "transparent",
                  color: isActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))",
                  boxShadow: isActive ? "0 1px 3px hsl(0 0% 0% / 0.1)" : "none",
                  border: isActive ? "1px solid hsl(var(--kf-border) / 0.3)" : "1px solid transparent",
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{m.label}</span>
                <span className="sm:hidden">{m.id === "personal" ? "Personal" : m.id === "business" ? "Business" : "Brand"}</span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {mode === "personal" && (
        <motion.div key="personal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div
            className="rounded-xl p-3"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.04), hsl(var(--kf-accent1) / 0.02))",
              border: "1px solid hsl(var(--kf-accent2) / 0.1)",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
                This section powers
              </span>
            </div>
            <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Your personal and professional identity shapes AI recommendations, growth guidance, client matching, market intelligence, and automation suggestions across every module.
            </p>
          </div>

          <div className="space-y-2">
            <FieldPowersBanner fieldKey="headline" />
            <FieldPowersBanner fieldKey="skills" />
          </div>

          <div className="kf-card p-6">
            <ProfileSectionErrorBoundary sectionName="Personal Info">
              <PersonalInfoSection
                initialData={savedForm}
                avatarUrl={avatarUrl}
                onDirtyChange={onPersonalDirtyChange}
                onSaved={(newForm, newAvatar) => onPersonalSaved(newForm, newAvatar)}
                onStatus={onStatus}
              />
            </ProfileSectionErrorBoundary>
          </div>

          <div className="kf-card p-6">
            <ProfileSectionErrorBoundary sectionName="Professional Profile">
              <ProfessionalProfileSection
                businessId={businessId}
                businessData={businessData}
                businessLoading={businessLoading}
                userName={savedForm.name || `${savedForm.firstName} ${savedForm.lastName}`.trim()}
                onCompletenessChange={onCompletenessChange}
                onDirtyChange={onBizDirtyChange}
                onStatus={onStatus}
                onSaved={(saved) => onBusinessSaved(saved)}
              />
            </ProfileSectionErrorBoundary>
          </div>
        </motion.div>
      )}

      {mode === "business" && (
        <motion.div key="business" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div
            className="rounded-xl p-3"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.04), hsl(var(--kf-accent1) / 0.02))",
              border: "1px solid hsl(var(--kf-accent2) / 0.1)",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
                This section powers
              </span>
            </div>
            <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Your business details feed into invoices, storefront, AI document generation, and the intelligence package — every customer-facing and AI-powered surface in KeyFlow.
            </p>
          </div>

          <div className="space-y-2">
            <FieldPowersBanner fieldKey="name" />
            <FieldPowersBanner fieldKey="description" />
            <FieldPowersBanner fieldKey="teamSize" />
          </div>

          <div className="kf-card p-6">
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
          </div>
        </motion.div>
      )}

      {mode === "brand" && (
        <motion.div key="brand" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div
            className="rounded-xl p-3"
            style={{
              background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.04), hsl(var(--kf-accent1) / 0.02))",
              border: "1px solid hsl(var(--kf-accent2) / 0.1)",
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
              <span className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
                This section powers
              </span>
            </div>
            <p className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Your brand identity shapes your storefront appearance, email templates, marketing materials, and all branded document exports.
            </p>
          </div>

          <div className="space-y-2">
            <FieldPowersBanner fieldKey="logoUrl" />
            <FieldPowersBanner fieldKey="primaryColor" />
          </div>

          <ProfileSectionErrorBoundary sectionName="Brand & Identity">
            <BrandIdentityTab onDirtyChange={onBrandDirtyChange} />
          </ProfileSectionErrorBoundary>
        </motion.div>
      )}
    </motion.div>
  );
}
