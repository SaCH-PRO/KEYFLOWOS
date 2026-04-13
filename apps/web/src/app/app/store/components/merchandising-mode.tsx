"use client";

import { useState } from "react";
import { ShoppingBag, Star, HelpCircle, Search, Globe } from "lucide-react";
import { AccordionGroup, AccordionSection } from "./accordion-section";
import { MerchandisingPanel } from "./merchandising-panel";
import { SocialProofPanel } from "./social-proof-panel";
import { FaqManager } from "./faq-manager";
import { PolicyEditor } from "./policy-editor";
import type { Service, Product, StorefrontConfig } from "@/lib/client";

type SeoProps = {
  storefrontConfig: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  publicUrl: string;
  businessName?: string;
};

function SeoSettingsInline({ storefrontConfig, onConfigChange, onSaveConfig, configSaving, publicUrl, businessName }: SeoProps) {
  const seo = (storefrontConfig.seo ?? {}) as { metaTitle?: string; metaDescription?: string; ogImage?: string };
  const [previewMode, setPreviewMode] = useState<"google" | "social">("google");

  const previewTitle = seo.metaTitle || businessName || "Your Store";
  const previewDesc = seo.metaDescription || "Browse our products and services. Book online today.";
  const previewUrl = publicUrl || "https://yoursite.com/book/your-store";

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Meta Title</label>
          <input
            type="text"
            value={seo.metaTitle ?? ""}
            onChange={(e) => onConfigChange("seo", { metaTitle: e.target.value })}
            placeholder={businessName || "Your Store Name"}
            maxLength={60}
            className="w-full rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]"
            style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)", color: "hsl(var(--kf-foreground))" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{(seo.metaTitle ?? "").length}/60</p>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>OG Image URL</label>
          <input
            type="url"
            value={seo.ogImage ?? ""}
            onChange={(e) => onConfigChange("seo", { ogImage: e.target.value })}
            placeholder="https://example.com/og-image.jpg"
            className="w-full rounded-xl px-3.5 py-2.5 text-sm min-h-[44px]"
            style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)", color: "hsl(var(--kf-foreground))" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>1200×630px recommended</p>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "hsl(var(--kf-muted-foreground))" }}>Meta Description</label>
        <textarea
          value={seo.metaDescription ?? ""}
          onChange={(e) => onConfigChange("seo", { metaDescription: e.target.value })}
          placeholder="Browse our products and services. Book online today."
          maxLength={160}
          rows={2}
          className="w-full rounded-xl px-3.5 py-2.5 text-sm resize-none"
          style={{ background: "hsl(var(--kf-muted)/0.15)", border: "1px solid hsl(var(--kf-border)/0.3)", color: "hsl(var(--kf-foreground))" }}
        />
        <p className="text-[10px] mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{(seo.metaDescription ?? "").length}/160</p>
      </div>
      <div>
        <div className="flex items-center gap-1 mb-2 p-0.5 rounded-lg w-fit" style={{ background: "hsl(var(--kf-muted)/0.1)" }}>
          {(["google", "social"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setPreviewMode(mode)}
              aria-pressed={previewMode === mode}
              className="text-[10px] font-medium px-3 py-1.5 rounded-md transition-all min-h-[32px]"
              style={{
                background: previewMode === mode ? "hsl(var(--kf-card))" : "transparent",
                color: previewMode === mode ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))",
                boxShadow: previewMode === mode ? "0 1px 4px hsl(var(--kf-background)/0.3)" : "none",
              }}
            >
              {mode === "google" ? "Google" : "Social"}
            </button>
          ))}
        </div>
        {previewMode === "google" ? (
          <div className="rounded-xl p-3 space-y-0.5" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
            <p className="text-sm font-medium truncate" style={{ color: "hsl(var(--kf-accent2))" }}>{previewTitle}</p>
            <p className="text-[10px] truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewUrl}</p>
            <p className="text-xs line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewDesc}</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--kf-border)/0.3)" }}>
            <div className="w-full h-[80px] flex items-center justify-center" style={{ background: "hsl(var(--kf-muted)/0.1)" }}>
              {seo.ogImage ? (
                <img src={seo.ogImage} alt="Social preview" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px]" style={{ color: "hsl(var(--kf-muted-foreground))" }}>No OG image</span>
              )}
            </div>
            <div className="p-2.5" style={{ background: "hsl(var(--kf-muted)/0.08)" }}>
              <p className="text-xs font-semibold line-clamp-1" style={{ color: "hsl(var(--kf-foreground))" }}>{previewTitle}</p>
              <p className="text-[10px] line-clamp-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{previewDesc}</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <button onClick={onSaveConfig} disabled={configSaving} className="kf-btn-primary min-h-[44px] px-4 text-sm">
          {configSaving ? "Saving..." : "Save SEO"}
        </button>
      </div>
    </div>
  );
}

type Props = {
  businessData: { name?: string; primaryColor?: string | null; secondaryColor?: string | null } | null;
  services: Service[];
  commerceProducts: Product[];
  storefrontConfig: StorefrontConfig;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => Promise<void>;
  configSaving: boolean;
  publicUrl: string;
  hasTestimonials: boolean;
};

export function MerchandisingMode({
  businessData,
  services,
  commerceProducts,
  storefrontConfig,
  onConfigChange,
  onSaveConfig,
  configSaving,
  publicUrl,
  hasTestimonials,
}: Props) {
  const appearance = storefrontConfig.appearance as { primaryColor?: string; secondaryColor?: string } | undefined;
  const pc = appearance?.primaryColor || businessData?.primaryColor || "#F97316";
  const ac = "#a78bfa";

  const merchandisingBadge = (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ background: "hsl(var(--kf-muted)/0.2)", color: "hsl(var(--kf-muted-foreground))" }}>
      {commerceProducts.length} items
    </span>
  );
  const socialBadge = hasTestimonials ? (
    <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: "hsl(var(--kf-success)/0.15)", color: "hsl(var(--kf-success))" }}>Added</span>
  ) : undefined;

  return (
    <div className="space-y-5">
      <AccordionGroup title="Merchandising" brandColor={pc}>
        <AccordionSection title="Featured Items" subtitle="Featured products & display" icon={ShoppingBag} accentColor={pc} badge={merchandisingBadge} defaultOpen>
          <MerchandisingPanel
            config={storefrontConfig}
            products={commerceProducts}
            services={services}
            onConfigChange={onConfigChange}
            onSave={onSaveConfig}
            saving={configSaving}
          />
        </AccordionSection>
        <AccordionSection title="Social Proof" subtitle="Testimonials & reviews" icon={Star} accentColor={pc} badge={socialBadge}>
          <SocialProofPanel
            storefrontConfig={storefrontConfig}
            configSaving={configSaving}
            onConfigChange={onConfigChange}
            onSaveConfig={onSaveConfig}
          />
        </AccordionSection>
        <AccordionSection title="FAQ & Policies" subtitle="Questions, refund policy & terms" icon={HelpCircle} accentColor={pc}>
          <div className="space-y-4">
            <FaqManager config={storefrontConfig} onConfigChange={onConfigChange} onSave={onSaveConfig} saving={configSaving} />
            <div className="pt-2" style={{ borderTop: "1px solid hsl(var(--kf-border)/0.2)" }}>
              <PolicyEditor config={storefrontConfig} onConfigChange={onConfigChange} onSave={onSaveConfig} saving={configSaving} />
            </div>
          </div>
        </AccordionSection>
        <AccordionSection title="SEO" subtitle="Search engine & social previews" icon={Search} accentColor={ac}>
          <SeoSettingsInline
            storefrontConfig={storefrontConfig}
            onConfigChange={onConfigChange}
            onSaveConfig={onSaveConfig}
            configSaving={configSaving}
            publicUrl={publicUrl}
            businessName={businessData?.name}
          />
        </AccordionSection>
      </AccordionGroup>
    </div>
  );
}
