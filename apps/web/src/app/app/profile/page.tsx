"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, CheckCircle2, AlertCircle, FileText,
  ChevronRight, Shield, Building2, Briefcase, Palette, Globe,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import PersonalInfoSection from "./components/personal-info-section";
import MyBusinessSection from "./components/my-business-section";
import ProfessionalProfileSection from "./components/professional-profile-section";
import DocumentsTab from "./components/documents-tab";
import BusinessBuilderCard from "./components/business-builder-card";
import SecuritySection from "./components/security-section";
import BrandIdentityTab from "./components/brand-identity-tab";
import { JourneyIndicator, type CompletenessItem } from "./components/journey-indicator";
import { BusinessContextCard } from "./components/business-context-card";
import { ContextDepthCard } from "./components/context-depth-card";
import { ProgressivePrompts } from "./components/progressive-prompts";
import { SkeletonProfile } from "./components/skeleton-profile";
import { ProfileSectionErrorBoundary } from "./components/profile-section-error-boundary";

interface IdentityMe {
  id: string;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

interface BusinessData {
  id?: string;
  name?: string;
  logoUrl?: string | null;
  industry?: string;
  businessStage?: string;
  teamSize?: string;
  city?: string;
  country?: string;
  tagline?: string | null;
  description?: string | null;
  businessHours?: Record<string, { open: string; close: string; closed: boolean }> | null;
  headline?: string | null;
  bio?: string | null;
  skills?: string[];
  interests?: string[];
  profileCompleteness?: number;
}

interface ProfileCompletenessField {
  key: string;
  label: string;
  description: string;
}

function checkFieldCompletion(key: string, bd: BusinessData | null): boolean {
  if (!bd) return false;
  switch (key) {
    case "name": return !!bd.name;
    case "logoUrl": return !!bd.logoUrl;
    case "headline": return !!bd.headline;
    case "bio": return !!bd.bio;
    case "industry": return !!bd.industry;
    case "skills": return (bd.skills?.length ?? 0) > 0;
    case "businessStage": return !!bd.businessStage;
    case "location": return !!(bd.city || bd.country);
    case "interests": return (bd.interests?.length ?? 0) > 0;
    case "taglineOrDescription": return !!(bd.tagline || bd.description);
    default: return false;
  }
}

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

type TabId = "profile" | "brand" | "documents";

const TAB_CONFIG: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "brand", label: "Brand & Identity", icon: Palette },
  { id: "documents", label: "Documents", icon: FileText },
];

export default function ProfileSettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = (searchParams.get("tab") as TabId) || "profile";

  const [loading, setLoading] = useState(true);
  const [status, setStatusRaw] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [dismissTimer, setDismissTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [savedForm, setSavedForm] = useState({ email: "", name: "", firstName: "", lastName: "", phone: "" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessData, setBusinessData] = useState<BusinessData | null>(null);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [profileCompleteness, setProfileCompleteness] = useState(0);
  const [docCount, setDocCount] = useState(0);
  const [bizBrandData, setBizBrandData] = useState<{
    primaryColor?: string | null;
    facebook?: string | null;
    instagram?: string | null;
    twitter?: string | null;
    linkedin?: string | null;
  } | null>(null);
  const [completenessFields, setCompletenessFields] = useState<ProfileCompletenessField[]>([]);

  const [activeTab, setActiveTab] = useState<TabId>(TAB_CONFIG.some(t => t.id === initialTab) ? initialTab : "profile");

  const setStatus = useCallback((s: { type: "success" | "error"; message: string } | null) => {
    setStatusRaw(s);
    if (dismissTimer) clearTimeout(dismissTimer);
    if (s) {
      const timer = setTimeout(() => setStatusRaw(null), 4000);
      setDismissTimer(timer);
    }
  }, [dismissTimer]);

  useEffect(() => {
    return () => {
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, [dismissTimer]);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    const url = tab === "profile" ? "/app/profile" : `/app/profile?tab=${tab}`;
    router.replace(url, { scroll: false });
  }, [router]);

  const [isPersonalDirty, setIsPersonalDirty] = useState(false);
  const [isBizDirty, setIsBizDirty] = useState(false);
  const [isBizInfoDirty, setIsBizInfoDirty] = useState(false);

  const hasUnsavedChanges = useMemo(() => isPersonalDirty || isBizDirty || isBizInfoDirty, [isPersonalDirty, isBizDirty, isBizInfoDirty]);
  useUnsavedChanges(hasUnsavedChanges);

  const handlePersonalDirtyChange = useCallback((dirty: boolean) => setIsPersonalDirty(dirty), []);
  const handleBizDirtyChange = useCallback((dirty: boolean) => setIsBizDirty(dirty), []);
  const handleBizInfoDirtyChange = useCallback((dirty: boolean) => setIsBizInfoDirty(dirty), []);

  const completenessItems: CompletenessItem[] = useMemo(() => {
    const hasPersonalName = !!(savedForm.firstName || savedForm.name);
    const hasPhone = !!savedForm.phone;
    const hasBranding = !!bizBrandData?.primaryColor;
    const hasSocial = !!(bizBrandData?.facebook || bizBrandData?.instagram || bizBrandData?.twitter || bizBrandData?.linkedin);
    const bizItems: CompletenessItem[] = completenessFields.length > 0
      ? completenessFields.map((field) => ({
          label: field.label,
          done: checkFieldCompletion(field.key, businessData),
          tab: "profile" as TabId,
          icon: Building2,
        }))
      : [
          { label: "Set industry & business stage", done: !!(businessData?.industry && businessData?.businessStage), tab: "profile" as TabId, icon: Briefcase },
          { label: "Complete professional profile", done: profileCompleteness >= 60, tab: "profile" as TabId, icon: Building2 },
        ];
    return [
      { label: "Add your name", done: hasPersonalName, tab: "profile" as TabId, icon: User },
      { label: "Add phone number", done: hasPhone, tab: "profile" as TabId, icon: User },
      ...bizItems,
      { label: "Set up branding", done: hasBranding, tab: "brand" as TabId, icon: Palette },
      { label: "Connect social accounts", done: hasSocial, tab: "brand" as TabId, icon: Globe },
      { label: "Generate your first document", done: docCount > 0, tab: "documents" as TabId, icon: FileText },
    ];
  }, [savedForm, businessData, profileCompleteness, docCount, bizBrandData, completenessFields]);

  useEffect(() => {
    apiGet<{ fields: ProfileCompletenessField[] }>("/identity/profile-completeness-fields")
      .then(({ data, error }) => {
        if (error) console.error("Failed to load completeness field definitions:", error);
        else if (data?.fields) setCompletenessFields(data.fields);
      })
      .catch((err) => {
        console.error("Failed to load completeness field definitions:", err);
      });
  }, []);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (bid) {
      setBusinessId(bid);
      setBusinessLoading(true);
      apiGet<unknown[]>(`/documents/businesses/${bid}/instances`)
        .then(({ data }) => {
          if (data) setDocCount(data.length);
        })
        .catch((err) => {
          console.error("Failed to load document count:", err);
        });
      apiGet<BusinessData>(`/identity/businesses/${bid}`)
        .then(({ data, error }) => {
          if (error) {
            setStatus({ type: "error", message: `Failed to load business data: ${error}` });
            return;
          }
          if (data) {
            setBusinessData(data);
            setProfileCompleteness(data.profileCompleteness || 0);
          }
        })
        .catch(() => {
          setStatus({ type: "error", message: "Failed to load business data. Please refresh." });
        })
        .finally(() => {
          setBusinessLoading(false);
        });
      apiGet<Record<string, unknown>>(`/identity/businesses/${bid}`)
        .then(({ data }) => {
          if (data) setBizBrandData(data as typeof bizBrandData);
        })
        .catch((err) => {
          console.error("Failed to load brand data:", err);
        });
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await apiGet<IdentityMe>("/identity/me");
        if (error) {
          setStatus({ type: "error", message: `Failed to load profile: ${error}` });
        } else if (data) {
          const f = {
            email: data.email || "",
            name: data.name || "",
            firstName: data.firstName || "",
            lastName: data.lastName || "",
            phone: data.phone || "",
          };
          setSavedForm(f);
          setAvatarUrl(data.avatarUrl || null);
        }
      } catch (e) {
        console.error("Failed to load profile:", e);
        setStatus({ type: "error", message: "Failed to load your profile. Please refresh the page." });
      }
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return (
    <div className="max-w-2xl mx-auto">
      <SkeletonProfile />
    </div>
  );

  const maxWidth = activeTab === "documents" ? "max-w-4xl" : activeTab === "brand" ? "max-w-3xl" : "max-w-2xl";

  const tabBadge = (tabId: TabId) => {
    if (tabId === "documents" && docCount > 0) {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }}>
          {docCount}
        </span>
      );
    }
    if (tabId === "profile" && profileCompleteness > 0 && profileCompleteness < 100) {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{
          background: profileCompleteness >= 80 ? "hsl(var(--kf-success) / 0.15)" : "hsl(var(--kf-warning) / 0.15)",
          color: profileCompleteness >= 80 ? "hsl(var(--kf-success))" : "hsl(var(--kf-warning))",
        }}>
          {profileCompleteness}%
        </span>
      );
    }
    return null;
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className={`space-y-4 ${maxWidth} mx-auto transition-all`}>
      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg">
          <User className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your profile, brand, and documents</p>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <JourneyIndicator items={completenessItems} onGoTo={handleTabChange} />
      </motion.div>

      <motion.div variants={fadeUp} className="flex gap-1 p-1 rounded-xl" style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.2)" }} role="tablist" aria-label="Profile sections">
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge = tabBadge(tab.id);
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => handleTabChange(tab.id)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all min-h-[44px]"
              style={{
                background: isActive ? "hsl(var(--kf-card))" : "transparent",
                color: isActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))",
                boxShadow: isActive ? "0 1px 3px hsl(0 0% 0% / 0.1)" : "none",
                border: isActive ? "1px solid hsl(var(--kf-border) / 0.3)" : "1px solid transparent",
              }}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{tab.label}</span>
              {badge}
            </button>
          );
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        {activeTab === "documents" && (
          <motion.div key="documents" id="tabpanel-documents" role="tabpanel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <ProfileSectionErrorBoundary sectionName="Documents">
              <DocumentsTab businessId={businessId} />
            </ProfileSectionErrorBoundary>
          </motion.div>
        )}

        {activeTab === "brand" && (
          <motion.div key="brand" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <BrandIdentityTab />
          </motion.div>
        )}

        {activeTab === "profile" && (
          <motion.div key="profile" id="tabpanel-profile" role="tabpanel" variants={stagger} initial="hidden" animate="show" exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <AnimatePresence>
              {status && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
                  role="status"
                  aria-live="polite"
                  style={{
                    border: `1px solid ${status.type === "success" ? "hsl(var(--kf-success) / 0.4)" : "hsl(var(--kf-error) / 0.4)"}`,
                    background: status.type === "success" ? "hsl(var(--kf-success) / 0.08)" : "hsl(var(--kf-error) / 0.08)",
                    color: status.type === "success" ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))",
                  }}
                >
                  {status.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  {status.message}
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div variants={fadeUp}>
              <BusinessContextCard businessData={businessData} />
            </motion.div>

            <motion.div variants={fadeUp}>
              <ProfileSectionErrorBoundary sectionName="Business Intelligence">
                <ContextDepthCard />
              </ProfileSectionErrorBoundary>
            </motion.div>

            <motion.div variants={fadeUp}>
              <ProfileSectionErrorBoundary sectionName="Smart Suggestions">
                <ProgressivePrompts />
              </ProfileSectionErrorBoundary>
            </motion.div>

            <motion.div variants={fadeUp}>
              <ProfileSectionErrorBoundary sectionName="Business Builder">
                <BusinessBuilderCard />
              </ProfileSectionErrorBoundary>
            </motion.div>

            <motion.div variants={fadeUp} className="kf-card p-6">
              <ProfileSectionErrorBoundary sectionName="Personal Info">
                <PersonalInfoSection
                  initialData={savedForm}
                  avatarUrl={avatarUrl}
                  onDirtyChange={handlePersonalDirtyChange}
                  onSaved={(newForm, newAvatar) => {
                    setSavedForm({ ...newForm });
                    if (newAvatar !== undefined) setAvatarUrl(newAvatar);
                  }}
                  onStatus={setStatus}
                />
              </ProfileSectionErrorBoundary>
            </motion.div>

            <motion.div variants={fadeUp} className="kf-card p-6">
              <ProfileSectionErrorBoundary sectionName="My Business">
                <MyBusinessSection
                  businessId={businessId}
                  businessData={businessData}
                  businessLoading={businessLoading}
                  onDirtyChange={handleBizInfoDirtyChange}
                  onStatus={setStatus}
                  onSaved={(saved) => setBusinessData((prev) => prev ? { ...prev, ...saved } : prev)}
                />
              </ProfileSectionErrorBoundary>
            </motion.div>

            <motion.div variants={fadeUp} className="kf-card p-6">
              <ProfileSectionErrorBoundary sectionName="Professional Profile">
                <ProfessionalProfileSection
                  businessId={businessId}
                  businessData={businessData}
                  businessLoading={businessLoading}
                  userName={savedForm.name || `${savedForm.firstName} ${savedForm.lastName}`.trim()}
                  onCompletenessChange={(pct) => {
                    setProfileCompleteness(pct);
                  }}
                  onDirtyChange={handleBizDirtyChange}
                  onStatus={setStatus}
                  onSaved={(saved) => {
                    setBusinessData((prev) => prev ? { ...prev, ...saved } : prev);
                    if (saved.profileCompleteness !== undefined) setProfileCompleteness(saved.profileCompleteness);
                  }}
                />
              </ProfileSectionErrorBoundary>
            </motion.div>

            <motion.div variants={fadeUp} className="kf-card p-6">
              <ProfileSectionErrorBoundary sectionName="Security">
                <SecuritySection onStatus={setStatus} />
              </ProfileSectionErrorBoundary>
            </motion.div>

            <motion.div variants={fadeUp}>
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors min-h-[44px]"
                style={{ border: "1px solid hsl(var(--kf-border) / 0.2)" }}
                onClick={() => router.push("/app/settings/security")}
                role="button"
                tabIndex={0}
                aria-label="Go to Security & Preferences"
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push("/app/settings/security"); }}
              >
                <Shield className="w-4 h-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[hsl(var(--foreground))]">Security & Preferences</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">Password, theme, and account security</div>
                </div>
                <ChevronRight className="w-4 h-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
