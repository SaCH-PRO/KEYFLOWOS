"use client";

import { useState, useEffect, useRef } from "react";
import {
  Briefcase,
  Sparkles,
  FileText,
  Tag,
  MapPin,
  Heart,
  Shield,
  Wand2,
  RefreshCw,
  AlertCircle,
  ChevronRight,
  X,
  Scale,
  DollarSign,
  Palette,
  Building2,
  CheckCircle,
  Clock,
  Store,
} from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { apiPatch, apiPost } from "@/lib/api";
import {
  generateAiProfile,
  fetchDocumentGuidance,
  type DocumentRecommendation,
} from "@/lib/client";
import { AccordionSection, AccordionGroup } from "../../store/components/accordion-section";
import { AiFieldBadge, DataUsageHint } from "./ai-field-badge";
import { useProfileSection } from "@/hooks/use-profile-section";

const INDUSTRY_OPTIONS = [
  "Technology", "Healthcare", "Finance", "Education", "Retail",
  "Food & Beverage", "Creative & Design", "Consulting", "Real Estate",
  "Fitness & Wellness", "Tourism & Hospitality", "Agriculture",
  "Construction", "Manufacturing", "Media & Entertainment",
  "Non-Profit", "Professional Services", "E-commerce", "Other",
];

const BUSINESS_STAGES = [
  { value: "IDEA", label: "Idea Stage" },
  { value: "STARTUP", label: "Startup" },
  { value: "GROWTH", label: "Growth" },
  { value: "ESTABLISHED", label: "Established" },
  { value: "SCALING", label: "Scaling" },
];

const CATEGORY_CONFIG: Record<string, { icon: typeof Scale; color: string; bg: string }> = {
  Legal: { icon: Scale, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.1)" },
  Financial: { icon: DollarSign, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.1)" },
  Creative: { icon: Palette, color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.1)" },
  Constitutional: { icon: Building2, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
};

const CAPACITY_OPTIONS = [
  { value: "OPEN", label: "Open for Work" },
  { value: "LIMITED", label: "Limited Availability" },
  { value: "FULL", label: "At Capacity" },
];

const BUDGET_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "Budget-Friendly", label: "Budget-Friendly" },
  { value: "Mid-Range", label: "Mid-Range" },
  { value: "Premium", label: "Premium" },
  { value: "Enterprise", label: "Enterprise" },
];

interface BizForm {
  headline: string;
  bio: string;
  industry: string;
  skills: string[];
  businessStage: string;
  interests: string[];
  city: string;
  country: string;
  acceptingWork: boolean;
  currentCapacity: string;
  leadTime: string;
  preferredProjectTypes: string[];
  budgetFit: string;
  positioningStatement: string;
}

interface BusinessProfile {
  id: string;
  name: string;
  headline?: string | null;
  bio?: string | null;
  industry?: string | null;
  skills: string[];
  businessStage?: string | null;
  interests: string[];
  profileCompleteness: number;
  city?: string | null;
  country?: string | null;
}

const EMPTY_BIZ_FORM: BizForm = {
  headline: "", bio: "", industry: "", skills: [], businessStage: "",
  interests: [], city: "", country: "",
  acceptingWork: true, currentCapacity: "OPEN", leadTime: "",
  preferredProjectTypes: [], budgetFit: "", positioningStatement: "",
};

function isBizFormDirty(current: BizForm, initial: BizForm): boolean {
  return (
    current.headline !== initial.headline ||
    current.bio !== initial.bio ||
    current.industry !== initial.industry ||
    current.businessStage !== initial.businessStage ||
    current.city !== initial.city ||
    current.country !== initial.country ||
    current.skills.length !== initial.skills.length ||
    current.skills.some((s, i) => s !== initial.skills[i]) ||
    current.interests.length !== initial.interests.length ||
    current.interests.some((s, i) => s !== initial.interests[i]) ||
    current.acceptingWork !== initial.acceptingWork ||
    current.currentCapacity !== initial.currentCapacity ||
    current.leadTime !== initial.leadTime ||
    current.budgetFit !== initial.budgetFit ||
    current.positioningStatement !== initial.positioningStatement ||
    current.preferredProjectTypes.length !== initial.preferredProjectTypes.length ||
    current.preferredProjectTypes.some((s, i) => s !== initial.preferredProjectTypes[i])
  );
}

interface ProfessionalProfileSectionProps {
  businessId: string | null;
  businessData?: {
    headline?: string | null;
    bio?: string | null;
    industry?: string | null;
    skills?: string[];
    businessStage?: string | null;
    interests?: string[];
    city?: string | null;
    country?: string | null;
    profileCompleteness?: number;
    acceptingWork?: boolean;
    currentCapacity?: string | null;
    leadTime?: string | null;
    preferredProjectTypes?: string[];
    budgetFit?: string | null;
    positioningStatement?: string | null;
  } | null;
  businessLoading?: boolean;
  userName: string;
  onCompletenessChange: (pct: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
  onSaved?: (saved: Partial<BizForm & { profileCompleteness: number }>) => void;
}

export default function ProfessionalProfileSection({
  businessId,
  businessData,
  businessLoading,
  userName,
  onCompletenessChange,
  onDirtyChange,
  onStatus,
  onSaved,
}: ProfessionalProfileSectionProps) {
  const { form: bizForm, setForm: setBizForm, setInitialForm: setInitialBizForm, isDirty: isBizDirty, saving: savingBusiness, setSaving: setSavingBusiness } = useProfileSection<BizForm>({
    initialState: EMPTY_BIZ_FORM,
    isDirtyFn: isBizFormDirty,
    onDirtyChange,
  });

  const [skillInput, setSkillInput] = useState("");
  const [interestInput, setInterestInput] = useState("");
  const [projectTypeInput, setProjectTypeInput] = useState("");
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [generatingSkills, setGeneratingSkills] = useState(false);
  const [recommendations, setRecommendations] = useState<DocumentRecommendation[]>([]);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!businessId || businessLoading || !businessData) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    const bf: BizForm = {
      headline: businessData.headline || "",
      bio: businessData.bio || "",
      industry: businessData.industry || "",
      skills: businessData.skills || [],
      businessStage: businessData.businessStage || "",
      interests: businessData.interests || [],
      city: businessData.city || "",
      country: businessData.country || "",
      acceptingWork: businessData.acceptingWork ?? true,
      currentCapacity: businessData.currentCapacity || "OPEN",
      leadTime: businessData.leadTime || "",
      preferredProjectTypes: businessData.preferredProjectTypes || [],
      budgetFit: businessData.budgetFit || "",
      positioningStatement: businessData.positioningStatement || "",
    };
    setBizForm(bf);
    setInitialBizForm(bf);
    onCompletenessChange(businessData.profileCompleteness || 0);
  }, [businessId, businessLoading, businessData]);

  useEffect(() => {
    if (!businessId) return;
    fetchDocumentGuidance(businessId)
      .then((res) => {
        if (res.data?.recommendations) setRecommendations(res.data.recommendations);
      })
      .catch((err) => {
        console.error("Failed to load document guidance:", err);
      });
  }, [businessId]);

  const handleSave = async () => {
    if (!businessId) return;
    setSavingBusiness(true);
    onStatus(null);
    try {
      const { data, error } = await apiPatch<BusinessProfile>(`/identity/businesses/${businessId}`, bizForm);
      if (error) {
        onStatus({ type: "error", message: error });
      } else if (data) {
        onStatus({ type: "success", message: "Professional profile updated" });
        setInitialBizForm({ ...bizForm });
        const pct = data.profileCompleteness || 0;
        onCompletenessChange(pct);
        onSaved?.({ ...bizForm, profileCompleteness: pct });
        fetchDocumentGuidance(businessId)
          .then((res) => {
            if (res.data?.recommendations) setRecommendations(res.data.recommendations);
          })
          .catch((err) => {
            console.error("Failed to refresh document guidance:", err);
          });
      }
    } catch (err) {
      onStatus({ type: "error", message: err instanceof Error ? err.message : "Network error" });
    }
    setSavingBusiness(false);
  };

  const handleGenerateProfile = async () => {
    if (!businessId) return;
    setGeneratingProfile(true);
    onStatus(null);
    try {
      const res = await generateAiProfile(businessId, {
        name: userName,
        industry: bizForm.industry,
        skills: bizForm.skills,
        businessStage: bizForm.businessStage,
        description: bizForm.bio,
      });
      if (res.data) {
        setBizForm((f) => ({
          ...f,
          headline: res.data!.headline || f.headline,
          bio: res.data!.bio || f.bio,
        }));
        onStatus({ type: "success", message: "AI profile generated! Review and save your changes." });
      } else {
        onStatus({ type: "error", message: res.error || "Failed to generate profile" });
      }
    } catch (err) {
      onStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to generate profile" });
    }
    setGeneratingProfile(false);
  };

  const handleGenerateSkills = async () => {
    if (!businessId) return;
    setGeneratingSkills(true);
    onStatus(null);
    try {
      const res = await apiPost<{ skills?: string[] }>({
        path: `/identity/businesses/${businessId}/ai-generate-field`,
        body: {
          field: "skills",
          context: { industry: bizForm.industry, businessStage: bizForm.businessStage },
        },
      });
      if (res.data?.skills && Array.isArray(res.data.skills)) {
        const newSkills = res.data.skills.filter((s: string) => !bizForm.skills.includes(s));
        if (newSkills.length > 0) {
          setBizForm((f) => ({ ...f, skills: [...f.skills, ...newSkills] }));
          onStatus({ type: "success", message: `Added ${newSkills.length} AI-suggested skills! Review and save.` });
        } else {
          onStatus({ type: "success", message: "No new skills to suggest — you've got great coverage!" });
        }
      } else {
        onStatus({ type: "error", message: "Failed to generate skills" });
      }
    } catch (err) {
      onStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to generate skills" });
    }
    setGeneratingSkills(false);
  };

  const addSkill = () => {
    const skill = skillInput.trim();
    if (skill && !bizForm.skills.includes(skill)) {
      setBizForm((f) => ({ ...f, skills: [...f.skills, skill] }));
    }
    setSkillInput("");
  };

  const addInterest = () => {
    const interest = interestInput.trim();
    if (interest && !bizForm.interests.includes(interest)) {
      setBizForm((f) => ({ ...f, interests: [...f.interests, interest] }));
    }
    setInterestInput("");
  };

  const addProjectType = () => {
    const pt = projectTypeInput.trim();
    if (pt && !bizForm.preferredProjectTypes.includes(pt)) {
      setBizForm((f) => ({ ...f, preferredProjectTypes: [...f.preferredProjectTypes, pt] }));
    }
    setProjectTypeInput("");
  };

  if (businessLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" aria-busy="true" aria-label="Loading professional profile">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" aria-hidden="true" />
        Loading professional profile...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Briefcase className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} aria-hidden="true" />
          Professional Profile
        </div>
        <button
          onClick={handleGenerateProfile}
          disabled={generatingProfile}
          aria-label="Generate professional profile with AI"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border min-h-[44px]"
          style={{
            background: "hsl(var(--kf-accent1) / 0.1)",
            borderColor: "hsl(var(--kf-accent1) / 0.2)",
            color: "hsl(var(--kf-accent1))",
          }}
        >
          {generatingProfile ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {generatingProfile ? "Generating..." : "Generate with AI"}
        </button>
      </div>

      <AccordionGroup title="Profile Details">
        <AccordionSection
          title="Identity & Bio"
          subtitle="Your professional headline and story"
          icon={Sparkles}
          accentColor="hsl(var(--kf-accent1))"
          defaultOpen
        >
          <div className="space-y-4 p-1">
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Professional Headline
                <AiFieldBadge />
                {!bizForm.headline && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                )}
              </div>
              <Input
                value={bizForm.headline}
                onChange={(e) => setBizForm((f) => ({ ...f, headline: e.target.value }))}
                placeholder="e.g., Caribbean Tech Entrepreneur | Building SaaS for SMBs"
                maxLength={120}
                style={!bizForm.headline ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <div className="flex justify-between mt-1">
                <DataUsageHint text="Shown on your community profile and public storefront" />
                <p className="text-[10px]" aria-label={`${bizForm.headline.length} of 120 characters`}>{bizForm.headline.length}/120</p>
              </div>
            </label>
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <FileText className="h-3 w-3" aria-hidden="true" />
                Bio
                <AiFieldBadge />
                {!bizForm.bio && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                )}
              </div>
              <textarea
                value={bizForm.bio}
                onChange={(e) => setBizForm((f) => ({ ...f, bio: e.target.value }))}
                placeholder="Tell the community about yourself and your business..."
                maxLength={500}
                rows={3}
                aria-label="Professional bio"
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 resize-none"
                style={!bizForm.bio ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <div className="flex justify-between mt-1">
                <DataUsageHint text="Displayed on your community profile and public pages" />
                <p className="text-[10px]" aria-label={`${bizForm.bio.length} of 500 characters`}>{bizForm.bio.length}/500</p>
              </div>
            </label>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Industry & Stage"
          subtitle="Your business sector and maturity level"
          icon={Briefcase}
          accentColor="hsl(var(--kf-accent2))"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-1">
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Briefcase className="h-3 w-3" aria-hidden="true" />
                Industry
                {!bizForm.industry && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                )}
              </div>
              <select
                value={bizForm.industry}
                onChange={(e) => setBizForm((f) => ({ ...f, industry: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 min-h-[44px]"
                style={!bizForm.industry ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              >
                <option value="">Select industry</option>
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <DataUsageHint text="Powers AI recommendations, document guidance, and templates" />
            </label>
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Shield className="h-3 w-3" aria-hidden="true" />
                Business Stage
                {!bizForm.businessStage && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                )}
              </div>
              <select
                value={bizForm.businessStage}
                onChange={(e) => setBizForm((f) => ({ ...f, businessStage: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 min-h-[44px]"
                style={!bizForm.businessStage ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              >
                <option value="">Select stage</option>
                {BUSINESS_STAGES.map((stage) => (
                  <option key={stage.value} value={stage.value}>{stage.label}</option>
                ))}
              </select>
              <DataUsageHint text="Tailors document recommendations and growth strategies" />
            </label>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Skills & Interests"
          subtitle="Your expertise and personal interests"
          icon={Tag}
          accentColor="hsl(var(--kf-accent1))"
          badge={bizForm.skills.length + bizForm.interests.length > 0 ? <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }}>{bizForm.skills.length + bizForm.interests.length}</span> : undefined}
        >
          <div className="space-y-4 p-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                  <Tag className="h-3 w-3" aria-hidden="true" />
                  Skills & Expertise
                  <AiFieldBadge />
                </div>
                <button
                  type="button"
                  onClick={handleGenerateSkills}
                  disabled={generatingSkills}
                  aria-label="Suggest skills with AI"
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all"
                  style={{
                    background: "hsl(var(--kf-accent1) / 0.1)",
                    color: "hsl(var(--kf-accent1))",
                  }}
                >
                  {generatingSkills ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Wand2 className="h-3 w-3" aria-hidden="true" />}
                  {generatingSkills ? "..." : "Suggest Skills"}
                </button>
              </div>
              <div className="flex gap-2">
                <Input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                  placeholder="Add a skill and press Enter"
                  aria-label="New skill"
                  className="flex-1"
                />
                <Button onClick={addSkill} disabled={!skillInput.trim()} className="px-3 min-h-[44px]">
                  Add
                </Button>
              </div>
              {bizForm.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2" role="list" aria-label="Skills">
                  {bizForm.skills.map((skill) => (
                    <span
                      key={skill}
                      role="listitem"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.1)",
                        color: "hsl(var(--kf-accent1))",
                      }}
                    >
                      {skill}
                      <button
                        type="button"
                        onClick={() => setBizForm((f) => ({ ...f, skills: f.skills.filter((s) => s !== skill) }))}
                        aria-label={`Remove skill: ${skill}`}
                        className="hover:opacity-60 transition-opacity"
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <Heart className="h-3 w-3" aria-hidden="true" />
                Interests
              </div>
              <div className="flex gap-2">
                <Input
                  value={interestInput}
                  onChange={(e) => setInterestInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInterest(); } }}
                  placeholder="Add an interest and press Enter"
                  aria-label="New interest"
                  className="flex-1"
                />
                <Button onClick={addInterest} disabled={!interestInput.trim()} className="px-3 min-h-[44px]">
                  Add
                </Button>
              </div>
              {bizForm.interests.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2" role="list" aria-label="Interests">
                  {bizForm.interests.map((interest) => (
                    <span
                      key={interest}
                      role="listitem"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                      style={{
                        background: "hsl(var(--kf-accent2) / 0.1)",
                        color: "hsl(var(--kf-accent2))",
                      }}
                    >
                      {interest}
                      <button
                        type="button"
                        onClick={() => setBizForm((f) => ({ ...f, interests: f.interests.filter((i) => i !== interest) }))}
                        aria-label={`Remove interest: ${interest}`}
                        className="hover:opacity-60 transition-opacity"
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Location"
          subtitle="Where your business operates"
          icon={MapPin}
          accentColor="hsl(var(--kf-accent2))"
        >
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  City
                  {!bizForm.city && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                  )}
                </div>
                <Input
                  value={bizForm.city}
                  onChange={(e) => setBizForm((f) => ({ ...f, city: e.target.value }))}
                  placeholder="Port of Spain"
                  style={!bizForm.city ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  Country
                  {!bizForm.country && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                  )}
                </div>
                <Input
                  value={bizForm.country}
                  onChange={(e) => setBizForm((f) => ({ ...f, country: e.target.value }))}
                  placeholder="Trinidad & Tobago"
                  style={!bizForm.country ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
                />
              </label>
            </div>
            <DataUsageHint text="Used on invoices, tax compliance guidance, and local business permits" />
          </div>
        </AccordionSection>

        <AccordionSection
          title="Store Settings"
          subtitle="Your availability, capacity, and what you offer"
          icon={Store}
          accentColor="hsl(var(--kf-success))"
        >
          <div className="space-y-4 p-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <CheckCircle className="h-3 w-3" aria-hidden="true" />
                Accepting Work
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={bizForm.acceptingWork}
                aria-label="Toggle accepting work"
                onClick={() => setBizForm((f) => ({ ...f, acceptingWork: !f.acceptingWork }))}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors min-h-[44px] min-w-[44px]"
                style={{
                  background: bizForm.acceptingWork ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted))",
                }}
              >
                <span
                  className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  style={{ transform: bizForm.acceptingWork ? "translateX(1.375rem)" : "translateX(0.25rem)" }}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                  <Store className="h-3 w-3" aria-hidden="true" />
                  Current Capacity
                </div>
                <select
                  value={bizForm.currentCapacity}
                  onChange={(e) => setBizForm((f) => ({ ...f, currentCapacity: e.target.value }))}
                  aria-label="Current capacity"
                  className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30"
                >
                  {CAPACITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  Lead Time
                </div>
                <Input
                  value={bizForm.leadTime}
                  onChange={(e) => setBizForm((f) => ({ ...f, leadTime: e.target.value }))}
                  placeholder="e.g., 2-3 weeks, Immediate"
                />
              </label>
            </div>

            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <DollarSign className="h-3 w-3" aria-hidden="true" />
                Budget Fit
              </div>
              <select
                value={bizForm.budgetFit}
                onChange={(e) => setBizForm((f) => ({ ...f, budgetFit: e.target.value }))}
                aria-label="Budget fit"
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30"
              >
                {BUDGET_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Positioning Statement
                {!bizForm.positioningStatement && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}>Empty</span>
                )}
              </div>
              <textarea
                value={bizForm.positioningStatement}
                onChange={(e) => setBizForm((f) => ({ ...f, positioningStatement: e.target.value }))}
                placeholder="What makes your business unique? e.g., We help Caribbean SMBs go digital with affordable, culturally-aware solutions."
                maxLength={300}
                rows={2}
                aria-label="Positioning statement"
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 resize-none"
                style={!bizForm.positioningStatement ? { borderColor: "hsl(var(--kf-warning) / 0.3)" } : undefined}
              />
              <div className="flex justify-between mt-1">
                <DataUsageHint text="Displayed prominently on your community profile and directory listing" />
                <p className="text-[10px]" aria-label={`${bizForm.positioningStatement.length} of 300 characters`}>{bizForm.positioningStatement.length}/300</p>
              </div>
            </label>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <Tag className="h-3 w-3" aria-hidden="true" />
                Preferred Project Types
              </div>
              <div className="flex gap-2">
                <Input
                  value={projectTypeInput}
                  onChange={(e) => setProjectTypeInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addProjectType(); } }}
                  placeholder="e.g., Branding, Web Development"
                  aria-label="New project type"
                  className="flex-1"
                />
                <Button onClick={addProjectType} disabled={!projectTypeInput.trim()} className="px-3 min-h-[44px]">
                  Add
                </Button>
              </div>
              {bizForm.preferredProjectTypes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2" role="list" aria-label="Preferred project types">
                  {bizForm.preferredProjectTypes.map((pt) => (
                    <span
                      key={pt}
                      role="listitem"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                      style={{
                        background: "hsl(var(--kf-success) / 0.1)",
                        color: "hsl(var(--kf-success))",
                      }}
                    >
                      {pt}
                      <button
                        type="button"
                        onClick={() => setBizForm((f) => ({ ...f, preferredProjectTypes: f.preferredProjectTypes.filter((p) => p !== pt) }))}
                        aria-label={`Remove project type: ${pt}`}
                        className="hover:opacity-60 transition-opacity"
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </AccordionSection>
      </AccordionGroup>

      {recommendations.length > 0 && (
        <AccordionSection
          title="Recommended Documents"
          subtitle="Based on your industry and business stage"
          icon={FileText}
          accentColor="hsl(var(--kf-accent1))"
          badge={<span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }}>{recommendations.length}</span>}
        >
          <div className="space-y-3 p-1">
            {(["Legal", "Financial", "Creative", "Constitutional"] as const).map((category) => {
              const catRecs = recommendations.filter((r) => r.category === category);
              if (catRecs.length === 0) return null;
              const config = CATEGORY_CONFIG[category];
              const CatIcon = config.icon;
              return (
                <div key={category} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: config.color }}>
                    <CatIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    {category}
                  </div>
                  {catRecs.map((rec) => (
                    <div
                      key={rec.title}
                      className="flex items-start gap-3 p-3 rounded-xl border border-border/20"
                      style={{ background: config.bg }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium">{rec.title}</p>
                          {rec.priority === "high" && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                              style={{ background: "hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))" }}
                            >
                              Priority
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{rec.description}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" aria-hidden="true" />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </AccordionSection>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border/30">
        {isBizDirty && (
          <p className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }} role="status">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            You have unsaved changes
          </p>
        )}
        <div className="ml-auto">
          <Button onClick={handleSave} disabled={savingBusiness || !isBizDirty} className="min-h-[44px]">
            {savingBusiness ? "Saving..." : "Save Professional Profile"}
          </Button>
        </div>
      </div>
    </div>
  );
}
