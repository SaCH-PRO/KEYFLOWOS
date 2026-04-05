"use client";

import { useState, useEffect } from "react";
import {
  Briefcase, Sparkles, FileText, Tag, MapPin, Heart, Shield,
  Wand2, RefreshCw, AlertCircle, ChevronRight, X,
  Scale, DollarSign, Palette, Building2,
} from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { apiGet, apiPatch } from "@/lib/api";
import {
  generateAiProfile,
  fetchDocumentGuidance,
  type DocumentRecommendation,
} from "@/lib/client";
import { AccordionSection, AccordionGroup } from "../../store/components/accordion-section";

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

interface BizForm {
  headline: string;
  bio: string;
  industry: string;
  skills: string[];
  businessStage: string;
  interests: string[];
  city: string;
  country: string;
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

interface ProfessionalProfileSectionProps {
  businessId: string | null;
  userName: string;
  onCompletenessChange: (pct: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
}

export default function ProfessionalProfileSection({
  businessId,
  userName,
  onCompletenessChange,
  onDirtyChange,
  onStatus,
}: ProfessionalProfileSectionProps) {
  const [bizForm, setBizForm] = useState<BizForm>({
    headline: "", bio: "", industry: "", skills: [], businessStage: "",
    interests: [], city: "", country: "",
  });
  const [initialBizForm, setInitialBizForm] = useState<BizForm>(bizForm);
  const [skillInput, setSkillInput] = useState("");
  const [interestInput, setInterestInput] = useState("");
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [recommendations, setRecommendations] = useState<DocumentRecommendation[]>([]);

  const isBizDirty =
    bizForm.headline !== initialBizForm.headline ||
    bizForm.bio !== initialBizForm.bio ||
    bizForm.industry !== initialBizForm.industry ||
    bizForm.businessStage !== initialBizForm.businessStage ||
    bizForm.city !== initialBizForm.city ||
    bizForm.country !== initialBizForm.country ||
    bizForm.skills.length !== initialBizForm.skills.length ||
    bizForm.skills.some((s, i) => s !== initialBizForm.skills[i]) ||
    bizForm.interests.length !== initialBizForm.interests.length ||
    bizForm.interests.some((s, i) => s !== initialBizForm.interests[i]);

  useEffect(() => {
    onDirtyChange?.(isBizDirty);
  }, [isBizDirty, onDirtyChange]);

  useEffect(() => {
    if (!businessId) return;
    const loadBusiness = async () => {
      try {
        const { data } = await apiGet<BusinessProfile>(`/identity/businesses/${businessId}`);
        if (data) {
          const bf: BizForm = {
            headline: data.headline || "",
            bio: data.bio || "",
            industry: data.industry || "",
            skills: data.skills || [],
            businessStage: data.businessStage || "",
            interests: data.interests || [],
            city: data.city || "",
            country: data.country || "",
          };
          setBizForm(bf);
          setInitialBizForm(bf);
          onCompletenessChange(data.profileCompleteness || 0);
        }
      } catch {}
    };
    loadBusiness();
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    fetchDocumentGuidance(businessId)
      .then((res) => {
        if (res.data?.recommendations) setRecommendations(res.data.recommendations);
      })
      .catch(() => {});
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
        onCompletenessChange(data.profileCompleteness || 0);
        fetchDocumentGuidance(businessId)
          .then((res) => {
            if (res.data?.recommendations) setRecommendations(res.data.recommendations);
          })
          .catch(() => {});
      }
    } catch {
      onStatus({ type: "error", message: "Network error" });
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
    } catch {
      onStatus({ type: "error", message: "Failed to generate profile" });
    }
    setGeneratingProfile(false);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Briefcase className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Professional Profile
        </div>
        <button
          onClick={handleGenerateProfile}
          disabled={generatingProfile}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border min-h-[44px]"
          style={{
            background: "hsl(var(--kf-accent1) / 0.1)",
            borderColor: "hsl(var(--kf-accent1) / 0.2)",
            color: "hsl(var(--kf-accent1))",
          }}
        >
          {generatingProfile ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
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
                <Sparkles className="h-3 w-3" />
                Professional Headline
              </div>
              <Input
                value={bizForm.headline}
                onChange={(e) => setBizForm((f) => ({ ...f, headline: e.target.value }))}
                placeholder="e.g., Caribbean Tech Entrepreneur | Building SaaS for SMBs"
                maxLength={120}
              />
              <p className="text-[10px] mt-1 text-right">{bizForm.headline.length}/120</p>
            </label>
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <FileText className="h-3 w-3" />
                Bio
              </div>
              <textarea
                value={bizForm.bio}
                onChange={(e) => setBizForm((f) => ({ ...f, bio: e.target.value }))}
                placeholder="Tell the community about yourself and your business..."
                maxLength={500}
                rows={3}
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 resize-none"
              />
              <p className="text-[10px] mt-1 text-right">{bizForm.bio.length}/500</p>
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
                <Briefcase className="h-3 w-3" />
                Industry
              </div>
              <select
                value={bizForm.industry}
                onChange={(e) => setBizForm((f) => ({ ...f, industry: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 min-h-[44px]"
              >
                <option value="">Select industry</option>
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <Shield className="h-3 w-3" />
                Business Stage
              </div>
              <select
                value={bizForm.businessStage}
                onChange={(e) => setBizForm((f) => ({ ...f, businessStage: e.target.value }))}
                className="w-full bg-transparent border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1))]/30 min-h-[44px]"
              >
                <option value="">Select stage</option>
                {BUSINESS_STAGES.map((stage) => (
                  <option key={stage.value} value={stage.value}>{stage.label}</option>
                ))}
              </select>
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
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <Tag className="h-3 w-3" />
                Skills & Expertise
              </div>
              <div className="flex gap-2">
                <Input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                  placeholder="Add a skill and press Enter"
                  className="flex-1"
                />
                <Button onClick={addSkill} disabled={!skillInput.trim()} className="px-3 min-h-[44px]">
                  Add
                </Button>
              </div>
              {bizForm.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {bizForm.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                      style={{
                        background: "hsl(var(--kf-accent1) / 0.1)",
                        color: "hsl(var(--kf-accent1))",
                      }}
                    >
                      {skill}
                      <button
                        onClick={() => setBizForm((f) => ({ ...f, skills: f.skills.filter((s) => s !== skill) }))}
                        className="hover:opacity-60 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <Heart className="h-3 w-3" />
                Interests
              </div>
              <div className="flex gap-2">
                <Input
                  value={interestInput}
                  onChange={(e) => setInterestInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInterest(); } }}
                  placeholder="Add an interest and press Enter"
                  className="flex-1"
                />
                <Button onClick={addInterest} disabled={!interestInput.trim()} className="px-3 min-h-[44px]">
                  Add
                </Button>
              </div>
              {bizForm.interests.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {bizForm.interests.map((interest) => (
                    <span
                      key={interest}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                      style={{
                        background: "hsl(var(--kf-accent2) / 0.1)",
                        color: "hsl(var(--kf-accent2))",
                      }}
                    >
                      {interest}
                      <button
                        onClick={() => setBizForm((f) => ({ ...f, interests: f.interests.filter((i) => i !== interest) }))}
                        className="hover:opacity-60 transition-opacity"
                      >
                        <X className="w-3 h-3" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-1">
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <MapPin className="h-3 w-3" />
                City
              </div>
              <Input
                value={bizForm.city}
                onChange={(e) => setBizForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="Port of Spain"
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">
                <MapPin className="h-3 w-3" />
                Country
              </div>
              <Input
                value={bizForm.country}
                onChange={(e) => setBizForm((f) => ({ ...f, country: e.target.value }))}
                placeholder="Trinidad & Tobago"
              />
            </label>
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
                    <CatIcon className="w-3.5 h-3.5" />
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
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
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
          <p className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }}>
            <AlertCircle className="h-3 w-3" />
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
