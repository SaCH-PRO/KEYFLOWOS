"use client";

import React, { useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FileText,
  Loader2,
  X,
  CheckCircle2,
  Palette,
  Users,
  Target,
  MessageSquare,
  Building2,
  Globe,
  Shirt,
  Image,
  Sparkles,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { moduleEvents } from "@/lib/module-events";

interface BriefData {
  businessName: string;
  tagline: string;
  missionStatement: string;
  productsServices: string;
  targetAudience: string;
  audienceAge: string;
  audienceLocation: string;
  brandPersonality: string;
  brandValues: string;
  toneOfVoice: string;
  colorPreferences: string;
  existingColors: string;
  fontPreferences: string;
  logoDescription: string;
  logoStyles: string[];
  inspirationBrands: string;
  existingAssets: string;
  deliverables: string[];
  socialPlatforms: string[];
  contentThemes: string;
  competitorNames: string;
  uniqueSellingPoint: string;
  budgetRange: string;
  timeline: string;
  additionalNotes: string;
}

const INITIAL_BRIEF: BriefData = {
  businessName: "",
  tagline: "",
  missionStatement: "",
  productsServices: "",
  targetAudience: "",
  audienceAge: "",
  audienceLocation: "",
  brandPersonality: "",
  brandValues: "",
  toneOfVoice: "",
  colorPreferences: "",
  existingColors: "",
  fontPreferences: "",
  logoDescription: "",
  logoStyles: [],
  inspirationBrands: "",
  existingAssets: "",
  deliverables: [],
  socialPlatforms: [],
  contentThemes: "",
  competitorNames: "",
  uniqueSellingPoint: "",
  budgetRange: "",
  timeline: "",
  additionalNotes: "",
};

const LOGO_STYLES = [
  "Wordmark",
  "Lettermark",
  "Icon/Symbol",
  "Combination Mark",
  "Emblem",
  "Mascot",
  "Abstract",
  "Minimal",
];

const DELIVERABLES = [
  "Logo Design",
  "Brand Guidelines",
  "Business Cards",
  "Letterhead",
  "Social Media Templates",
  "Email Signature",
  "Flyer / Brochure",
  "Apparel Design",
  "Packaging",
  "Website Banner",
  "Vehicle Wrap",
  "Signage",
];

const SOCIAL_PLATFORMS = [
  "Instagram",
  "Facebook",
  "TikTok",
  "LinkedIn",
  "Twitter/X",
  "YouTube",
  "Pinterest",
  "WhatsApp Business",
];

const TONE_OPTIONS = [
  "Professional",
  "Friendly & Warm",
  "Bold & Confident",
  "Playful & Fun",
  "Luxurious & Premium",
  "Casual & Relatable",
  "Authoritative & Expert",
  "Inspirational",
];

function getBudgetRanges(currency: string) {
  return [
    `Under 2,000 ${currency}`,
    `2,000 - 5,000 ${currency}`,
    `5,000 - 10,000 ${currency}`,
    `10,000 - 25,000 ${currency}`,
    `25,000+ ${currency}`,
    "Not sure yet",
  ];
}

interface MarketingBriefPanelProps {
  businessId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface BusinessSnapshot {
  businessName: string;
  tagline: string;
  description: string;
  industry: string;
  archetype: string;
  location: string;
  website: string;
  socialPresence: string[];
  totalContacts: number;
  totalProducts: number;
  totalRevenue: number;
  currency: string;
  totalBookings: number;
  totalServices: number;
}

interface SectionProps {
  title: string;
  icon: React.ElementType;
  color: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, icon: Icon, color, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/30 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}15` }}>
            <Icon className="w-3.5 h-3.5" style={{ color }} />
          </div>
          <span className="text-sm font-medium">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const inputCls = "w-full bg-muted/30 border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]";
const labelCls = "text-xs font-medium text-muted-foreground block mb-1.5";

export function MarketingBriefPanel({ businessId, isOpen, onClose }: MarketingBriefPanelProps) {
  const [brief, setBrief] = useState<BriefData>(INITIAL_BRIEF);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  useEffect(() => {
    if (!isOpen || !businessId || snapshot) return;
    let cancelled = false;
    setLoadingSnapshot(true);
    (async () => {
      try {
        const { fetchBusinessSnapshot } = await import("@/lib/client");
        const res = await fetchBusinessSnapshot(businessId);
        if (!cancelled && res.data) {
          const s = res.data as unknown as BusinessSnapshot;
          setSnapshot(s);
          setBrief(prev => ({
            ...prev,
            businessName: prev.businessName || s.businessName || "",
            tagline: prev.tagline || s.tagline || "",
            audienceLocation: prev.audienceLocation || s.location || "",
          }));
        }
      } catch {
        // silent
      }
      if (!cancelled) setLoadingSnapshot(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, businessId, snapshot]);

  const toggleMulti = useCallback((field: keyof BriefData, value: string) => {
    setBrief(prev => {
      const arr = prev[field] as string[];
      return {
        ...prev,
        [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      };
    });
  }, []);

  const isValid = brief.businessName && brief.targetAudience && brief.deliverables.length > 0;

  const handleSubmit = useCallback(async () => {
    if (!businessId || !isValid) return;
    setSubmitting(true);
    try {
      const { submitMarketingBrief } = await import("@/lib/client");

      const res = await submitMarketingBrief(businessId, brief as unknown as Record<string, unknown>);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- domain DTO from backend — pending shared API schema generation
      const data = res.data as any;
      if (data?.success === false) {
        toast.error(data?.message || "Could not send marketing brief. Please connect Gmail in Settings.");
        return;
      }
      setSubmitted(true);
      moduleEvents.emit("marketing:brief_submitted", "marketing", { businessName: brief.businessName, deliverables: brief.deliverables });
      if (data?.method === "gmail") {
        toast.success("Marketing brief sent to keyflowos.tt@gmail.com");
      } else {
        toast.success(data?.message || "Marketing brief submitted");
      }
    } catch {
      toast.error("Failed to submit marketing brief");
    } finally {
      setSubmitting(false);
    }
  }, [businessId, brief, isValid]);

  const handleReset = useCallback(() => {
    setBrief(_prev => ({
      ...INITIAL_BRIEF,
      businessName: snapshot?.businessName || "",
      tagline: snapshot?.tagline || "",
      audienceLocation: snapshot?.location || "",
    }));
    setSubmitted(false);
  }, [snapshot]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
          onClick={e => e.stopPropagation()}
          className="relative w-full max-w-2xl kf-card border border-border rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-border/40 bg-background/80 backdrop-blur-md rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent2))]/20 to-[hsl(var(--kf-accent1))]/20">
                <FileText className="w-5 h-5 text-[hsl(var(--kf-accent2))]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Marketing Brief</h2>
                <p className="text-xs text-muted-foreground">Everything a specialist needs to craft your brand</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {submitted ? (
            <div className="p-8 text-center space-y-4">
              <div className="inline-flex p-4 rounded-full bg-emerald-500/10">
                <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold">Brief Submitted</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Your marketing brief has been sent to the KeyflowOS team. A marketing specialist will review it and reach out.
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={handleReset}
                  className="text-sm px-4 py-2 rounded-xl border border-border/40 hover:bg-muted/30 transition-colors"
                >
                  Submit Another
                </button>
                <button
                  onClick={onClose}
                  className="text-sm px-4 py-2 rounded-xl bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {snapshot && (
                <div className="bg-muted/20 border border-border/30 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
                    <span className="text-xs font-medium text-[hsl(var(--kf-accent1))]">Auto-collected from your account</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <div className="font-semibold text-sm">{snapshot.totalContacts}</div>
                      <div className="text-muted-foreground">Contacts</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <div className="font-semibold text-sm">{snapshot.totalProducts}</div>
                      <div className="text-muted-foreground">Products</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <div className="font-semibold text-sm">{snapshot.totalBookings}</div>
                      <div className="text-muted-foreground">Bookings</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2 text-center">
                      <div className="font-semibold text-sm">{snapshot.totalServices}</div>
                      <div className="text-muted-foreground">Services</div>
                    </div>
                  </div>
                  {loadingSnapshot && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading business data...
                    </div>
                  )}
                </div>
              )}

              <Section title="Business Identity" icon={Building2} color="#F97316">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Business Name *</label>
                    <input value={brief.businessName} onChange={e => setBrief(p => ({ ...p, businessName: e.target.value }))} placeholder="Your business name" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Tagline / Slogan</label>
                    <input value={brief.tagline} onChange={e => setBrief(p => ({ ...p, tagline: e.target.value }))} placeholder="e.g. 'Where quality meets convenience'" className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Mission Statement</label>
                  <textarea value={brief.missionStatement} onChange={e => setBrief(p => ({ ...p, missionStatement: e.target.value }))} placeholder="What does your business stand for? What problem do you solve?" rows={2} className={inputCls + " resize-none"} />
                </div>
                <div>
                  <label className={labelCls}>Products / Services Offered</label>
                  <textarea value={brief.productsServices} onChange={e => setBrief(p => ({ ...p, productsServices: e.target.value }))} placeholder="List your main products or services..." rows={2} className={inputCls + " resize-none"} />
                </div>
              </Section>

              <Section title="Target Audience" icon={Users} color="#3b82f6">
                <div>
                  <label className={labelCls}>Who is your ideal customer? *</label>
                  <textarea value={brief.targetAudience} onChange={e => setBrief(p => ({ ...p, targetAudience: e.target.value }))} placeholder="Describe your target customer: demographics, interests, lifestyle, pain points..." rows={2} className={inputCls + " resize-none"} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Age Range</label>
                    <input value={brief.audienceAge} onChange={e => setBrief(p => ({ ...p, audienceAge: e.target.value }))} placeholder="e.g. 25-45" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Location / Market</label>
                    <input value={brief.audienceLocation} onChange={e => setBrief(p => ({ ...p, audienceLocation: e.target.value }))} placeholder="e.g. Trinidad & Tobago, Caribbean" className={inputCls} />
                  </div>
                </div>
              </Section>

              <Section title="Brand Personality & Voice" icon={MessageSquare} color="#8b5cf6">
                <div>
                  <label className={labelCls}>Brand Personality</label>
                  <textarea value={brief.brandPersonality} onChange={e => setBrief(p => ({ ...p, brandPersonality: e.target.value }))} placeholder="If your brand were a person, how would you describe them? e.g. friendly, modern, trustworthy..." rows={2} className={inputCls + " resize-none"} />
                </div>
                <div>
                  <label className={labelCls}>Core Brand Values</label>
                  <input value={brief.brandValues} onChange={e => setBrief(p => ({ ...p, brandValues: e.target.value }))} placeholder="e.g. Quality, Innovation, Community, Integrity" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls + " mb-2"}>Tone of Voice</label>
                  <div className="flex flex-wrap gap-1.5">
                    {TONE_OPTIONS.map(tone => (
                      <button
                        key={tone}
                        type="button"
                        onClick={() => setBrief(p => ({ ...p, toneOfVoice: p.toneOfVoice === tone ? "" : tone }))}
                        className={
                          brief.toneOfVoice === tone
                            ? "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                            : "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all text-muted-foreground hover:text-foreground border border-border/40 hover:bg-muted/40"
                        }
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title="Visual Identity & Logo" icon={Palette} color="#ec4899">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Color Preferences</label>
                    <input value={brief.colorPreferences} onChange={e => setBrief(p => ({ ...p, colorPreferences: e.target.value }))} placeholder="Colors you'd like: e.g. orange, teal, dark tones" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Existing Brand Colors</label>
                    <input value={brief.existingColors} onChange={e => setBrief(p => ({ ...p, existingColors: e.target.value }))} placeholder="Hex codes or names if you have them" className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Font / Typography Preferences</label>
                  <input value={brief.fontPreferences} onChange={e => setBrief(p => ({ ...p, fontPreferences: e.target.value }))} placeholder="e.g. Modern sans-serif, elegant serif, handwritten" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Logo Vision</label>
                  <textarea value={brief.logoDescription} onChange={e => setBrief(p => ({ ...p, logoDescription: e.target.value }))} placeholder="Describe your ideal logo: symbols, imagery, feeling it should evoke..." rows={2} className={inputCls + " resize-none"} />
                </div>
                <div>
                  <label className={labelCls + " mb-2"}>Preferred Logo Styles</label>
                  <div className="flex flex-wrap gap-1.5">
                    {LOGO_STYLES.map(style => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => toggleMulti("logoStyles", style)}
                        className={
                          brief.logoStyles.includes(style)
                            ? "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                            : "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all text-muted-foreground hover:text-foreground border border-border/40 hover:bg-muted/40"
                        }
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title="Deliverables Needed" icon={Image} color="#14b8a6" defaultOpen={true}>
                <div>
                  <label className={labelCls + " mb-2"}>What do you need designed? *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {DELIVERABLES.map(item => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleMulti("deliverables", item)}
                        className={
                          brief.deliverables.includes(item)
                            ? "text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-all bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] border border-[hsl(var(--kf-accent2))]/30 text-left"
                            : "text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-all text-muted-foreground hover:text-foreground border border-border/40 hover:bg-muted/40 text-left"
                        }
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title="Social & Content" icon={Globe} color="#6366f1" defaultOpen={false}>
                <div>
                  <label className={labelCls + " mb-2"}>Active Social Platforms</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SOCIAL_PLATFORMS.map(platform => (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => toggleMulti("socialPlatforms", platform)}
                        className={
                          brief.socialPlatforms.includes(platform)
                            ? "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                            : "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all text-muted-foreground hover:text-foreground border border-border/40 hover:bg-muted/40"
                        }
                      >
                        {platform}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Content Themes / Topics</label>
                  <textarea value={brief.contentThemes} onChange={e => setBrief(p => ({ ...p, contentThemes: e.target.value }))} placeholder="What topics/themes should your content cover?" rows={2} className={inputCls + " resize-none"} />
                </div>
              </Section>

              <Section title="Competition & Positioning" icon={Target} color="#f59e0b" defaultOpen={false}>
                <div>
                  <label className={labelCls}>Key Competitors</label>
                  <input value={brief.competitorNames} onChange={e => setBrief(p => ({ ...p, competitorNames: e.target.value }))} placeholder="Name 2-3 competitors in your space" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Unique Selling Point</label>
                  <textarea value={brief.uniqueSellingPoint} onChange={e => setBrief(p => ({ ...p, uniqueSellingPoint: e.target.value }))} placeholder="What makes you different from the competition?" rows={2} className={inputCls + " resize-none"} />
                </div>
                <div>
                  <label className={labelCls}>Brands You Admire</label>
                  <input value={brief.inspirationBrands} onChange={e => setBrief(p => ({ ...p, inspirationBrands: e.target.value }))} placeholder="Brands whose look/feel inspires you" className={inputCls} />
                </div>
              </Section>

              <Section title="Budget & Timeline" icon={Shirt} color="#10b981" defaultOpen={false}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Budget Range</label>
                    <select value={brief.budgetRange} onChange={e => setBrief(p => ({ ...p, budgetRange: e.target.value }))} className={inputCls}>
                      <option value="">Select range...</option>
                      {getBudgetRanges(snapshot?.currency || "TTD").map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Desired Timeline</label>
                    <input value={brief.timeline} onChange={e => setBrief(p => ({ ...p, timeline: e.target.value }))} placeholder="e.g. 2 weeks, 1 month" className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Existing Assets</label>
                  <textarea value={brief.existingAssets} onChange={e => setBrief(p => ({ ...p, existingAssets: e.target.value }))} placeholder="Do you have an existing logo, photos, brand assets?" rows={2} className={inputCls + " resize-none"} />
                </div>
              </Section>

              <div>
                <label className={labelCls}>Additional Notes</label>
                <textarea value={brief.additionalNotes} onChange={e => setBrief(p => ({ ...p, additionalNotes: e.target.value }))} placeholder="Anything else the designer should know..." rows={2} className={inputCls + " resize-none"} />
              </div>

              {!isValid && (
                <div className="flex items-center gap-2 text-[11px] text-amber-400/80">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Fill in Business Name, Target Audience, and select at least one Deliverable
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !isValid}
                  className="flex-1 inline-flex items-center justify-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl bg-gradient-to-r from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting Brief...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      Submit Marketing Brief
                    </>
                  )}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground/60 text-center">
                This brief will be emailed to the KeyflowOS marketing team along with your business data
              </p>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default MarketingBriefPanel;
