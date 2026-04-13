"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useNavigationContext } from "@/lib/navigation-context";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, CheckCircle2, AlertCircle, FileText,
  Building2, Briefcase, Globe, Brain,
  LayoutDashboard, Shield, Sparkles,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { JourneyIndicator, type CompletenessItem } from "./components/journey-indicator";
import { SkeletonProfile } from "./components/skeleton-profile";
import { OverviewTab } from "./components/overview-tab";
import { BusinessTab } from "./components/business-tab";
import { ProfessionalTab } from "./components/professional-tab";
import { IntelligenceTab } from "./components/intelligence-tab";
import SecuritySection from "./components/security-section";
import { ProfileSectionErrorBoundary } from "./components/profile-section-error-boundary";
import type { ProfileBusinessData, ProfileCompletenessField, StatusMessage, TabId } from "./components/profile-types";

type ActiveTab = "overview" | "business" | "professional" | "intelligence" | "security";

function checkFieldCompletion(key: string, bd: ProfileBusinessData | null): boolean {
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

const TAB_CONFIG: { id: ActiveTab; label: string; icon: React.ElementType; shortLabel: string }[] = [
  { id: "overview", label: "Overview", shortLabel: "Overview", icon: LayoutDashboard },
  { id: "business", label: "Business", shortLabel: "Business", icon: Building2 },
  { id: "professional", label: "Professional", shortLabel: "Professional", icon: User },
  { id: "intelligence", label: "Documents & Intelligence", shortLabel: "Intelligence", icon: Brain },
  { id: "security", label: "Security & Preferences", shortLabel: "Security", icon: Shield },
];

const VALID_TABS = new Set<string>(TAB_CONFIG.map((t) => t.id));
const PROFESSIONAL_FIELD_KEYS = new Set(["headline", "bio", "industry", "skills", "businessStage", "interests", "location"]);

function mapLegacyTab(tab: string): ActiveTab {
  if (tab === "profile") return "overview";
  if (tab === "brand") return "business";
  if (tab === "documents") return "intelligence";
  if (VALID_TABS.has(tab)) return tab as ActiveTab;
  return "overview";
}

interface IntelligenceTier {
  tierId: string;
  label: string;
  score: number;
  description: string;
}

export default function ProfileSettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setCurrentMeta } = useNavigationContext();
  const rawTab = searchParams.get("tab") || "overview";
  const initialTab = mapLegacyTab(rawTab);

  const [loading, setLoading] = useState(true);
  const [status, setStatusRaw] = useState<StatusMessage | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedForm, setSavedForm] = useState({ email: "", name: "", firstName: "", lastName: "", phone: "" });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessData, setBusinessData] = useState<ProfileBusinessData | null>(null);
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
  const [intelligenceTiers, setIntelligenceTiers] = useState<IntelligenceTier[]>([]);
  const [overallIntelligenceScore, setOverallIntelligenceScore] = useState(0);

  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);

  useEffect(() => {
    const current = searchParams.get("tab") || "overview";
    const mapped = mapLegacyTab(current);
    if (mapped !== activeTab) {
      setActiveTab(mapped);
    }
  }, [searchParams]);

  const setStatus = useCallback((s: StatusMessage | null) => {
    setStatusRaw(s);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (s) {
      dismissTimerRef.current = setTimeout(() => setStatusRaw(null), 4000);
    } else {
      dismissTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handleTabChange = useCallback((tab: ActiveTab | TabId | string) => {
    const mapped = mapLegacyTab(tab);
    setActiveTab(mapped);
    setCurrentMeta({ tab: mapped === "overview" ? null : mapped });
    const url = mapped === "overview" ? "/app/profile" : `/app/profile?tab=${mapped}`;
    router.replace(url, { scroll: false });
  }, [router, setCurrentMeta]);

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
          tab: (PROFESSIONAL_FIELD_KEYS.has(field.key) ? "professional" : "business") as TabId,
          icon: PROFESSIONAL_FIELD_KEYS.has(field.key) ? Briefcase : Building2,
        }))
      : [
          { label: "Set industry & business stage", done: !!(businessData?.industry && businessData?.businessStage), tab: "professional" as TabId, icon: Briefcase },
          { label: "Complete professional profile", done: profileCompleteness >= 60, tab: "professional" as TabId, icon: Building2 },
        ];
    return [
      { label: "Add your name", done: hasPersonalName, tab: "professional" as TabId, icon: User },
      { label: "Add phone number", done: hasPhone, tab: "professional" as TabId, icon: User },
      ...bizItems,
      { label: "Set up branding", done: hasBranding, tab: "business" as TabId, icon: Globe },
      { label: "Connect social accounts", done: hasSocial, tab: "business" as TabId, icon: Globe },
      { label: "Generate your first document", done: docCount > 0, tab: "intelligence" as TabId, icon: FileText },
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
      apiGet<ProfileBusinessData>(`/identity/businesses/${bid}`)
        .then(({ data, error }) => {
          if (error) {
            setStatus({ type: "error", message: `Failed to load business data: ${error}` });
            return;
          }
          if (data) {
            setBusinessData(data);
            setProfileCompleteness(data.profileCompleteness || 0);
            setBizBrandData({
              primaryColor: data.primaryColor ?? null,
              facebook: data.facebook ?? null,
              instagram: data.instagram ?? null,
              twitter: data.twitter ?? null,
              linkedin: data.linkedin ?? null,
            });
          }
        })
        .catch(() => {
          setStatus({ type: "error", message: "Failed to load business data. Please refresh." });
        })
        .finally(() => {
          setBusinessLoading(false);
        });

      apiGet<{ overallScore: number; tiers: IntelligenceTier[] }>(`/identity/businesses/${bid}/tiered-completeness`)
        .then(({ data }) => {
          if (data) {
            setIntelligenceTiers(data.tiers || []);
            setOverallIntelligenceScore(data.overallScore || 0);
          }
        })
        .catch((err) => {
          console.error("Failed to load intelligence tiers:", err);
        });
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await apiGet<{ id: string; email: string; name?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null; avatarUrl?: string | null }>("/identity/me");
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
    <div className="max-w-3xl mx-auto">
      <SkeletonProfile />
    </div>
  );

  const maxWidth = activeTab === "intelligence" ? "max-w-4xl" : activeTab === "business" ? "max-w-3xl" : "max-w-3xl";

  const tabBadge = (tabId: ActiveTab) => {
    if (tabId === "intelligence" && docCount > 0) {
      return (
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }}>
          {docCount}
        </span>
      );
    }
    if (tabId === "overview" && profileCompleteness > 0 && profileCompleteness < 100) {
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
          <Sparkles className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Profile & Intelligence</h1>
          <p className="text-sm text-muted-foreground">Manage your identity, business foundation, intelligence, and system-ready documents.</p>
        </div>
      </motion.div>

      <motion.div variants={fadeUp}>
        <JourneyIndicator items={completenessItems} onGoTo={handleTabChange} />
      </motion.div>

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

      <motion.div
        variants={fadeUp}
        className="flex gap-1 p-1 rounded-xl overflow-x-auto"
        style={{ background: "hsl(var(--kf-muted) / 0.15)", border: "1px solid hsl(var(--kf-border) / 0.2)" }}
        role="tablist"
        aria-label="Profile sections"
      >
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
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-lg text-xs font-medium transition-all min-h-[44px] whitespace-nowrap"
              style={{
                background: isActive ? "hsl(var(--kf-card))" : "transparent",
                color: isActive ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))",
                boxShadow: isActive ? "0 1px 3px hsl(0 0% 0% / 0.1)" : "none",
                border: isActive ? "1px solid hsl(var(--kf-border) / 0.3)" : "1px solid transparent",
              }}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">{tab.label}</span>
              <span className="lg:hidden">{tab.shortLabel}</span>
              {badge}
            </button>
          );
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        {activeTab === "overview" && (
          <motion.div key="overview" id="tabpanel-overview" role="tabpanel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <OverviewTab
              businessData={businessData}
              profileCompleteness={profileCompleteness}
              intelligenceTiers={intelligenceTiers}
              overallIntelligenceScore={overallIntelligenceScore}
              completenessItems={completenessItems}
              onNavigateTab={handleTabChange}
            />
          </motion.div>
        )}

        {activeTab === "business" && (
          <motion.div key="business" id="tabpanel-business" role="tabpanel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <BusinessTab
              businessId={businessId}
              businessData={businessData}
              businessLoading={businessLoading}
              onBizDirtyChange={handleBizInfoDirtyChange}
              onBrandDirtyChange={handleBizInfoDirtyChange}
              onStatus={setStatus}
              onBusinessSaved={(saved) => setBusinessData((prev) => prev ? { ...prev, ...saved } : prev)}
            />
          </motion.div>
        )}

        {activeTab === "professional" && (
          <motion.div key="professional" id="tabpanel-professional" role="tabpanel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <ProfessionalTab
              businessId={businessId}
              businessData={businessData}
              businessLoading={businessLoading}
              savedForm={savedForm}
              avatarUrl={avatarUrl}
              onPersonalDirtyChange={handlePersonalDirtyChange}
              onBizDirtyChange={handleBizDirtyChange}
              onStatus={setStatus}
              onPersonalSaved={(newForm, newAvatar) => {
                setSavedForm({ ...newForm });
                if (newAvatar !== undefined) setAvatarUrl(newAvatar);
              }}
              onBusinessSaved={(saved) => {
                setBusinessData((prev) => prev ? { ...prev, ...saved } : prev);
                if (typeof saved.profileCompleteness === "number") setProfileCompleteness(saved.profileCompleteness);
              }}
              onCompletenessChange={(pct) => setProfileCompleteness(pct)}
            />
          </motion.div>
        )}

        {activeTab === "intelligence" && (
          <motion.div key="intelligence" id="tabpanel-intelligence" role="tabpanel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <IntelligenceTab businessId={businessId} businessData={businessData} />
          </motion.div>
        )}

        {activeTab === "security" && (
          <motion.div key="security" id="tabpanel-security" role="tabpanel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <div className="space-y-4">
              <div
                className="rounded-xl p-3 flex items-center gap-2.5"
                style={{
                  background: "hsl(var(--kf-muted) / 0.06)",
                  border: "1px solid hsl(var(--kf-border) / 0.15)",
                }}
              >
                <Shield className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
                <p className="text-[11px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                  Security and appearance settings are isolated from your business data. Changes here do not affect your profile completeness or intelligence score.
                </p>
              </div>
              <div className="kf-card p-6">
                <ProfileSectionErrorBoundary sectionName="Security & Preferences">
                  <SecuritySection onStatus={setStatus} />
                </ProfileSectionErrorBoundary>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
