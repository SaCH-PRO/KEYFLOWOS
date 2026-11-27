"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Loader2,
  ChevronDown,
  Copy,
  Check,
  Wand2,
  RotateCcw,
  ArrowRight,
} from "lucide-react";

type HeroCopyResult = {
  headlines: string[];
  subheadlines: string[];
  offerRibbons: string[];
  ctas: string[];
  recommendation: {
    headline: string;
    subheadline: string;
    offerRibbon: string;
    cta: string;
  };
  tip?: string;
};

type Props = {
  storeName?: string;
  businessDescription?: string;
  businessTagline?: string;
  currentHeadline?: string;
  currentSubheadline?: string;
  currentCta?: string;
  productsCount?: number;
  servicesCount?: number;
  onApply?: (fields: { headline?: string; subheadline?: string; ctaText?: string; ribbonText?: string }) => void;
};

/**
 * P231 r6 (D-303): the words for what the store offers, from its real counts of products live on the storefront and
 * bookable services (the same rules as the AI Content panel and the store AI hub): no "buy" without products, no
 * "book" without services, each count with the noun it counts, in the singular for one.
 */
function offerWords(productCount: number, serviceCount: number) {
  const products = Math.max(0, Math.floor(productCount) || 0);
  const services = Math.max(0, Math.floor(serviceCount) || 0);
  const sells = products > 0;
  const books = services > 0;
  const total = products + services;
  const word = (n: number, w: string) => `${w}${n === 1 ? "" : "s"}`;
  return {
    sells,
    books,
    total,
    counted: [sells ? `${products} ${word(products, "product")}` : "", books ? `${services} ${word(services, "service")}` : ""].filter(Boolean).join(" and "),
    action: sells && books ? "Book or buy online." : sells ? "Buy online." : books ? "Book online." : "",
    items: `${total} ${word(total, "item")}`,
  };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 rounded-md transition-colors hover:bg-[hsl(var(--kf-muted)/0.3)] flex-shrink-0"
      title="Copy"
    >
      {copied ? (
        <Check className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />
      ) : (
        <Copy className="w-3 h-3 text-muted-foreground" />
      )}
    </button>
  );
}

function OptionList({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "hsl(var(--kf-muted-foreground))" }}>{label}</label>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-[10px] flex items-center gap-0.5 transition-colors"
          style={{ color: "hsl(var(--kf-accent1))" }}
        >
          {open ? "Hide options" : `${options.length} option${options.length === 1 ? "" : "s"}`}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown className="w-3 h-3" />
          </motion.span>
        </button>
      </div>
      <div
        className="flex items-start gap-2 px-3 py-2 rounded-xl"
        style={{ background: "hsl(var(--kf-accent1)/0.06)", border: "1px solid hsl(var(--kf-accent1)/0.12)" }}
      >
        <p className="text-xs font-medium flex-1 leading-snug">{selected}</p>
        <CopyButton text={selected} />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-1">
              {options.filter((o) => o !== selected).map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onSelect(opt); setOpen(false); }}
                  className="w-full flex items-start gap-2 px-3 py-2 rounded-xl text-left transition-colors hover:bg-[hsl(var(--kf-muted)/0.15)] group"
                  style={{ border: "1px solid hsl(var(--kf-border)/0.3)" }}
                >
                  <span className="text-xs flex-1 leading-snug" style={{ color: "hsl(var(--kf-foreground)/0.7)" }}>{opt}</span>
                  <span className="text-[9px] font-medium opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "hsl(var(--kf-accent1))" }}>Use</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AiHeroCopyPanel({
  storeName,
  businessDescription,
  businessTagline,
  currentHeadline: _currentHeadline,
  currentSubheadline: _currentSubheadline,
  currentCta: _currentCta,
  productsCount = 0,
  servicesCount = 0,
  onApply,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HeroCopyResult | null>(null);
  const [selectedHeadline, setSelectedHeadline] = useState("");
  const [selectedSubheadline, setSelectedSubheadline] = useState("");
  const [selectedRibbon, setSelectedRibbon] = useState("");
  const [selectedCta, setSelectedCta] = useState("");
  const [applied, setApplied] = useState(false);

  async function generate() {
    setLoading(true);
    setApplied(false);
    await new Promise((r) => setTimeout(r, 900));

    const name = storeName || "Your Store";
    const tagline = businessTagline || "";
    const description = businessDescription || "";
    const offer = offerWords(productsCount, servicesCount);

    // P231 r6 (D-303): no quality ("Quality You Can Trust", "Premium"), speed ("in seconds"), delivery ("delivered to
    // you"), "curated", "N+ Items", "all in one place", "New Arrivals Just Added" or "First-Time Customer Special" the
    // product does not know the merchant has; only what the store really offers (its counts), and the merchant's own
    // news and offers as [placeholders].
    const headlines = [
      `${name} — ${tagline || "Now Online"}`,
      ...(offer.total > 0 ? [`Discover ${offer.counted} from ${name}`] : []),
    ];
    const subheadlines = [
      ...(description ? [description.slice(0, 100)] : offer.total > 0 ? [`Browse ${offer.counted}. ${offer.action}`] : []),
      ...(offer.total > 0 ? [`${offer.items}, online.`] : []),
    ];
    if (subheadlines.length === 0) subheadlines.push(`${name}, now online.`);
    const offerRibbons = [
      offer.sells ? "🎉 Now Open Online — Shop Today" : offer.books ? "🎉 Now Open Online — Book Today" : "🎉 Now Open Online",
      "✨ [your latest news]",
      "🔥 [your offer]",
    ];
    const ctas = [
      ...(offer.sells ? ["Shop Now", "Explore Collection"] : []),
      ...(offer.books ? ["Book Today"] : []),
      "Get Started",
    ];

    const res: HeroCopyResult = {
      headlines,
      subheadlines,
      offerRibbons,
      ctas,
      recommendation: {
        headline: headlines[0],
        subheadline: subheadlines[0],
        offerRibbon: offerRibbons[0],
        cta: ctas[0],
      },
      tip: "These suggestions are built from your store details. Click any option to use it, or copy and paste into your hero fields. Replace any [bracketed] part with your own before you save.",
    };

    setResult(res);
    setSelectedHeadline(res.recommendation.headline);
    setSelectedSubheadline(res.recommendation.subheadline);
    setSelectedRibbon(res.recommendation.offerRibbon);
    setSelectedCta(res.recommendation.cta);
    setLoading(false);
  }

  function handleApply() {
    if (!onApply || !result) return;
    onApply({
      headline: selectedHeadline,
      subheadline: selectedSubheadline,
      ctaText: selectedCta,
      ribbonText: selectedRibbon,
    });
    setApplied(true);
    setTimeout(() => setApplied(false), 3000);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-accent1)/0.2)", boxShadow: "0 2px 12px hsl(var(--kf-accent1)/0.06)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-3.5"
        style={{ borderBottom: "1px solid hsl(var(--kf-accent1)/0.1)", background: "linear-gradient(135deg, hsl(var(--kf-accent1)/0.06), transparent)" }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1)/0.12)" }}>
            <Wand2 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <p className="text-sm font-semibold">AI Hero Copy</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Generate headline, subheadline, ribbon & CTA</p>
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all min-h-[36px]"
          style={{
            background: loading ? "hsl(var(--kf-muted)/0.2)" : "hsl(var(--kf-accent1))",
            color: loading ? "hsl(var(--kf-muted-foreground))" : "white",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating...
            </>
          ) : result ? (
            <>
              <RotateCcw className="w-3.5 h-3.5" />
              Regenerate
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              Generate
            </>
          )}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-4 space-y-3">
              {result.tip && (
                <p className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                  <Sparkles className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                  {result.tip}
                </p>
              )}

              <OptionList
                label="Headline"
                options={result.headlines}
                selected={selectedHeadline}
                onSelect={setSelectedHeadline}
              />
              <OptionList
                label="Subheadline"
                options={result.subheadlines}
                selected={selectedSubheadline}
                onSelect={setSelectedSubheadline}
              />
              <OptionList
                label="Offer Ribbon"
                options={result.offerRibbons}
                selected={selectedRibbon}
                onSelect={setSelectedRibbon}
              />
              <OptionList
                label="Call to Action"
                options={result.ctas}
                selected={selectedCta}
                onSelect={setSelectedCta}
              />

              {onApply && (
                <button
                  type="button"
                  onClick={handleApply}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all min-h-[44px]"
                  style={{
                    background: applied ? "hsl(var(--kf-success)/0.12)" : "hsl(var(--kf-accent1))",
                    color: applied ? "hsl(var(--kf-success))" : "white",
                    border: applied ? "1px solid hsl(var(--kf-success)/0.3)" : "none",
                  }}
                >
                  {applied ? (
                    <>
                      <Check className="w-4 h-4" />
                      Applied to Hero!
                    </>
                  ) : (
                    <>
                      Apply to Hero Section
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
              <p className="text-[9px] text-muted-foreground text-center">
                Changes apply to your hero fields above. Save to persist.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!result && !loading && (
        <div className="px-4 py-3 text-center">
          <p className="text-[10px] text-muted-foreground">
            Click Generate to create AI-powered hero copy tailored to your business.
          </p>
        </div>
      )}
    </motion.div>
  );
}
