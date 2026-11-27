"use client";

import { HAS_PLACEHOLDER, clip, offerWords } from "../storefront-counts";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  Wand2,
  Search,
  HelpCircle,
  ShieldCheck,
  Megaphone,
} from "lucide-react";

type GeneratedFaq = { question: string; answer: string; category: string };
type SeoResult = {
  metaTitleOptions: string[];
  metaDescOptions: string[];
  recommendation: { metaTitle: string; metaDescription: string };
  instruction?: string;
};
type FaqResult = {
  faqs: GeneratedFaq[];
  instruction?: string;
};

type ActionType = "faq" | "seo" | "trust" | "launch";

type Props = {
  storeName?: string;
  businessDescription?: string;
  businessTagline?: string;
  /** P231 r7 (D-303): what the storefront shows, by the kind /book names it (storefront-counts.ts). */
  productsCount?: number;
  /** Bookable services. */
  servicesCount?: number;
  packagesCount?: number;
  /** SERVICE-category products: services /book sells (bought, not booked). */
  orderableServicesCount?: number;
  /** P231 r11: whether what is on the store is known (false: the store graph or the storefront config was not read). */
  productsKnown?: boolean;
  servicesKnown?: boolean;
  hasDelivery?: boolean;
  testimonialCount?: number;
  onApplyFaq?: (faqs: GeneratedFaq[]) => void;
  onApplySeo?: (data: { metaTitle: string; metaDescription: string }) => void;
};

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 rounded-md hover:bg-[hsl(var(--kf-muted)/0.3)] transition-colors flex-shrink-0"
    >
      {copied ? <Check className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} /> : <Copy className="w-3 h-3 text-muted-foreground" />}
    </button>
  );
}

const ACTIONS: { id: ActionType; icon: React.ElementType; label: string; desc: string; color: string }[] = [
  { id: "faq", icon: HelpCircle, label: "Generate FAQ", desc: "Create FAQ entries for your store", color: "hsl(var(--kf-accent2))" },
  { id: "seo", icon: Search, label: "Generate SEO", desc: "Craft optimized meta title & description", color: "hsl(var(--kf-accent1))" },
  { id: "trust", icon: ShieldCheck, label: "Trust Copy", desc: "Badges and social proof from your testimonials", color: "hsl(var(--kf-success))" },
  { id: "launch", icon: Megaphone, label: "Launch Posts", desc: "Social media & WhatsApp launch copy", color: "hsl(var(--kf-warning))" },
];

/**
 * P231 (D-303) Trust Copy: only what the testimonials show. No guarantee or service claim the product does not check
 * (r1-r3: "100% Satisfaction Guarantee", "Secure, Encrypted Checkout", "Verified Business", "Secure Payments",
 * "Quality Guaranteed", "Fast, Reliable Service", "Real Human Support"); with none, nothing (r2-r3). r4: how many
 * reviews there are, true at any rating, never that the customers are happy or satisfied or keep coming back.
 */
function trustCopyFor(testimonialCount: number): { trustBadges: string[]; socialProofCopy: string[] } {
  // r5: a count that is not a positive number (NaN, undefined) suggests nothing.
  if (!(testimonialCount > 0)) return { trustBadges: [], socialProofCopy: [] };
  const reviews = testimonialCount === 1 ? "review" : "reviews";
  return {
    trustBadges: [`${testimonialCount} customer ${reviews}`],
    socialProofCopy: [`Read ${testimonialCount} ${reviews} from our customers.`],
  };
}

/** P231 r5-r7: the placeholder detector the FAQ Manager and the save paths share (any [bracketed] part). */
export { HAS_PLACEHOLDER };

export function AiContentPanel({
  storeName,
  businessDescription,
  businessTagline,
  productsCount = 0,
  servicesCount = 0,
  packagesCount = 0,
  orderableServicesCount = 0,
  productsKnown = true,
  servicesKnown = true,
  hasDelivery = false,
  testimonialCount = 0,
  onApplyFaq,
  onApplySeo,
}: Props) {
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [loading, setLoading] = useState(false);
  const [faqResult, setFaqResult] = useState<FaqResult | null>(null);
  const [seoResult, setSeoResult] = useState<SeoResult | null>(null);
  // P231 r4: Trust Copy is worked out from the testimonial count each render once it was asked for, so it follows the
  // count (testimonials removed or added after generating) and never shows a stale "N customer reviews".
  const [trustRequested, setTrustRequested] = useState(false);
  const [launchResult, setLaunchResult] = useState<{ socialPosts: string[]; whatsappMessages: string[]; emailSubjectLines: string[] } | null>(null);
  const [appliedFaq, setAppliedFaq] = useState(false);
  // r6: once added, the answers are in the FAQ Manager, and that is where the [bracketed] parts are filled in.
  const [faqAdded, setFaqAdded] = useState(false);
  const [appliedSeo, setAppliedSeo] = useState(false);
  const [selectedSeoTitle, setSelectedSeoTitle] = useState("");
  const [selectedSeoDesc, setSelectedSeoDesc] = useState("");

  const name = storeName || "Your Store";
  const offer = offerWords({ products: productsCount, packages: packagesCount, services: servicesCount, orderableServices: orderableServicesCount, productsKnown, servicesKnown });
  const totalItems = offer.total;
  const trustResult = trustRequested ? trustCopyFor(testimonialCount) : null;

  async function generate(action: ActionType) {
    setActiveAction(action);
    if (action === "faq") setFaqAdded(false);
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));

    if (action === "faq") {
      const faqs: GeneratedFaq[] = [];
      if (offer.books) {
        // r7: /book has no "Book Now" control: a service is added, and its time chosen at checkout.
        faqs.push({ question: "How do I book a service?", answer: "Add the service you want, then choose a date and time at checkout to complete your booking.", category: "Bookings" });
        // P231 r4 (D-303): the merchant's own policies are left as marked placeholders, never invented.
        // r6: the policy itself is the merchant's, so the whole answer is theirs to fill in.
        faqs.push({ question: "Can I reschedule or cancel?", answer: "[your reschedule and cancellation policy]", category: "Bookings" });
      }
      if (offer.buys) {
        // r7: not "All payments are processed at checkout": cash or manual payment is always offered.
        faqs.push({ question: "What payment methods do you accept?", answer: "We accept [your payment methods].", category: "Payments" });
      }
      if (hasDelivery) {
        // P231 r4b: no "Express options" or "local pickup" the product does not know the merchant offers.
        faqs.push({ question: "How long does delivery take?", answer: "Delivery takes [your delivery time]. Delivery options are shown at checkout.", category: "Delivery" });
      }
      faqs.push({ question: `What makes ${name} different?`, answer: "[what makes your business different]", category: "About" });
      // r6: no contact section or refund the product does not know the store has.
      faqs.push({ question: "How can I contact you?", answer: "Reach us at [your contact details]. We respond within [your response time].", category: "Support" });
      faqs.push({ question: "What is your refund policy?", answer: "[your refund policy]", category: "Refunds" });
      // r5: the [bracketed] parts can only be filled in once the answers are in the FAQ Manager.
      setFaqResult({ faqs, instruction: "Click 'Add All to FAQ', then fill in the [bracketed] parts with your own policies in the FAQ Manager, and save." });
    }

    if (action === "seo") {
      const tagline = businessTagline || "";
      // P231 r4b-r5: no "fast delivery", "instantly", "quality" or "curated" the product does not check, and only what
      // the store really offers (from its counts): no "buy" without products, no "book" without services.
      const metaTitleOptions = [
        // r9: cut at a word, with "...", never mid-word (clip).
        clip(`${name} — ${offer.shops ? "Shop Online Today" : offer.books ? "Book Online Today" : "Now Online"}`, 60),
        // r11: a total only when the whole offer is known.
        clip(tagline ? `${name} | ${tagline}` : `${name} | ${totalItems > 0 && !offer.partial ? offer.Items : "Online"}`, 60),
        clip(`${name} Online`, 60),
      ];
      const metaDescOptions = [
        // r6: the count goes with the noun it counts.
        clip(totalItems > 0 ? `Browse ${offer.counted} at ${name}. ${offer.action}` : `Visit ${name} online.`, 160),
        clip(`${name} — ${tagline || (offer.counted ? `${offer.counted} available online` : "now online")}.${offer.action ? ` ${offer.action}` : ""}`, 160),
        clip(`Discover ${name} online.${businessDescription ? ` ${clip(businessDescription, 80)}` : ""}`, 160),
      ];
      setSeoResult({
        metaTitleOptions,
        metaDescOptions,
        recommendation: { metaTitle: metaTitleOptions[0], metaDescription: metaDescOptions[0] },
        instruction: "Select the title and description that best represents your store, then click Apply.",
      });
      setSelectedSeoTitle(metaTitleOptions[0]);
      setSelectedSeoDesc(metaDescOptions[0]);
    }

    if (action === "trust") setTrustRequested(true);

    if (action === "launch") {
      setLaunchResult({
        socialPosts: [
          // P231 r4b-r5: the store's own item count (not "N+"), no "fast response", and only what it really offers.
          totalItems > 0
            ? `🚀 We're officially live! ${name} is now open online. Browse our ${offer.partial ? offer.counted : offer.items}. Link in bio! ✨`
            : `🚀 We're officially live! ${name} is now open online. Link in bio! ✨`,
          `Big news! 🎉 ${name} just launched online.${offer.action ? ` ${offer.action}` : ""} Drop a comment if you want the link! 👇`,
          `We've been working hard behind the scenes, and it's finally here. ${name} is now live online. Come take a look! 🛍️`,
        ],
        whatsappMessages: [
          `Hi! Just wanted to let you know that ${name} is now live online! 🎉 Would love to see you there! 😊`,
          `Big news — ${name} is now online! 🚀 Check it out and let me know what you think!`,
        ],
        emailSubjectLines: [
          `We're Live! ${name} Is Now Online`,
          `Big News from ${name} — Visit Us Online`,
          `${name} Just Launched — Come Check It Out`,
        ],
      });
    }

    setLoading(false);
  }

  const action = ACTIONS.find((a) => a.id === activeAction);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-accent1)/0.2)", boxShadow: "0 2px 12px hsl(var(--kf-accent1)/0.05)" }}
    >
      <div
        className="flex items-center gap-2.5 px-4 py-3.5"
        style={{ borderBottom: "1px solid hsl(var(--kf-accent1)/0.1)", background: "linear-gradient(135deg, hsl(var(--kf-accent1)/0.06), transparent)" }}
      >
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1)/0.12)" }}>
          <Wand2 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <div>
          <p className="text-sm font-semibold">AI Content Intelligence</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Generate FAQ, SEO, trust copy, and launch campaign</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            const isActive = activeAction === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => generate(a.id)}
                disabled={loading}
                className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-left transition-all min-h-[52px]"
                style={{
                  background: isActive ? `${a.color}12` : "hsl(var(--kf-muted)/0.08)",
                  border: isActive ? `1px solid ${a.color}30` : "1px solid hsl(var(--kf-border)/0.3)",
                  opacity: loading && !isActive ? 0.5 : 1,
                }}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: a.color }} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-tight truncate">{a.label}</p>
                  <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">{a.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          {loading && activeAction && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 px-3 py-3 rounded-xl"
              style={{ background: "hsl(var(--kf-muted)/0.1)" }}
            >
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: action?.color }} />
              <p className="text-xs text-muted-foreground">Generating {action?.label}...</p>
            </motion.div>
          )}

          {!loading && activeAction === "faq" && faqResult && (
            <motion.div key="faq" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2">
              <p className="text-[10px] text-muted-foreground">{faqResult.instruction}</p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {faqResult.faqs.map((faq, i) => (
                  <div key={i} className="px-3 py-2 rounded-xl" style={{ background: "hsl(var(--kf-accent2)/0.06)", border: "1px solid hsl(var(--kf-accent2)/0.12)" }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold">{faq.question}</p>
                      <CopyBtn text={`Q: ${faq.question}\nA: ${faq.answer}`} />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{faq.answer}</p>
                    {HAS_PLACEHOLDER.test(faq.answer) && (
                      <p role="note" className="text-[9px] font-semibold mt-0.5" style={{ color: "hsl(var(--kf-warning))" }}>
                        Fill in the [bracketed] part in the FAQ Manager.
                      </p>
                    )}
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ background: "hsl(var(--kf-accent2)/0.1)", color: "hsl(var(--kf-accent2))" }}>{faq.category}</span>
                  </div>
                ))}
              </div>
              {faqResult.faqs.some((f) => HAS_PLACEHOLDER.test(f.answer)) && (
                <p role="note" className="text-[10px] font-semibold" style={{ color: "hsl(var(--kf-warning))" }}>
                  {faqAdded
                    ? "Added. Check the FAQ Manager: fill in the [bracketed] parts there before you save."
                    : "Some answers have [bracketed] parts: fill them in before your customers see them."}
                </p>
              )}
              {onApplyFaq && (
                <button
                  type="button"
                  onClick={() => { onApplyFaq(faqResult.faqs); setAppliedFaq(true); setFaqAdded(true); setTimeout(() => setAppliedFaq(false), 3000); }}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 min-h-[40px] transition-all"
                  style={{ background: appliedFaq ? "hsl(var(--kf-success)/0.12)" : "hsl(var(--kf-accent2))", color: appliedFaq ? "hsl(var(--kf-success))" : "white" }}
                >
                  {appliedFaq ? <><Check className="w-4 h-4" /> Applied!</> : <><Sparkles className="w-4 h-4" /> Add All to FAQ</>}
                </button>
              )}
            </motion.div>
          )}

          {!loading && activeAction === "seo" && seoResult && (
            <motion.div key="seo" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              <p className="text-[10px] text-muted-foreground">{seoResult.instruction}</p>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Meta Title</label>
                <div className="space-y-1">
                  {seoResult.metaTitleOptions.map((t, i) => (
                    <button key={i} type="button" onClick={() => setSelectedSeoTitle(t)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs transition-all"
                      style={{ background: selectedSeoTitle === t ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.08)", border: `1px solid ${selectedSeoTitle === t ? "hsl(var(--kf-accent1)/0.3)" : "hsl(var(--kf-border)/0.3)"}`, color: selectedSeoTitle === t ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-foreground)/0.8)" }}
                    >
                      <span className="flex-1">{t}</span>
                      {selectedSeoTitle === t && <Check className="w-3 h-3 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Meta Description</label>
                <div className="space-y-1">
                  {seoResult.metaDescOptions.map((d, i) => (
                    <button key={i} type="button" onClick={() => setSelectedSeoDesc(d)}
                      className="w-full flex items-start gap-2 px-3 py-2 rounded-xl text-left text-xs transition-all"
                      style={{ background: selectedSeoDesc === d ? "hsl(var(--kf-accent1)/0.1)" : "hsl(var(--kf-muted)/0.08)", border: `1px solid ${selectedSeoDesc === d ? "hsl(var(--kf-accent1)/0.3)" : "hsl(var(--kf-border)/0.3)"}`, color: selectedSeoDesc === d ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-foreground)/0.8)" }}
                    >
                      <span className="flex-1 text-left">{d}</span>
                      {selectedSeoDesc === d && <Check className="w-3 h-3 flex-shrink-0 mt-0.5" />}
                    </button>
                  ))}
                </div>
              </div>
              {onApplySeo && (
                <button
                  type="button"
                  onClick={() => { onApplySeo({ metaTitle: selectedSeoTitle, metaDescription: selectedSeoDesc }); setAppliedSeo(true); setTimeout(() => setAppliedSeo(false), 3000); }}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 min-h-[40px] transition-all"
                  style={{ background: appliedSeo ? "hsl(var(--kf-success)/0.12)" : "hsl(var(--kf-accent1))", color: appliedSeo ? "hsl(var(--kf-success))" : "white" }}
                >
                  {appliedSeo ? <><Check className="w-4 h-4" /> Applied!</> : <><Search className="w-4 h-4" /> Apply SEO Settings</>}
                </button>
              )}
            </motion.div>
          )}

          {!loading && activeAction === "trust" && trustResult && (
            <motion.div key="trust" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              {/* P231 r3: guarantee statements are no longer suggested (D-303); with no testimonials nothing is. */}
              {trustResult.trustBadges.length === 0 && trustResult.socialProofCopy.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No trust copy yet. Add testimonials under Social Proof, and the copy suggested here will point to them.
                </p>
              )}
              {trustResult.trustBadges.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Trust Badges</p>
                <div className="flex flex-wrap gap-1.5">
                  {trustResult.trustBadges.map((b, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "hsl(var(--kf-success)/0.1)", color: "hsl(var(--kf-success))" }}>
                      {b}
                      <CopyBtn text={b} />
                    </span>
                  ))}
                </div>
              </div>
              )}
              {trustResult.socialProofCopy.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Social Proof Copy</p>
                {trustResult.socialProofCopy.map((c, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl mb-1" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
                    <p className="text-xs flex-1">{c}</p>
                    <CopyBtn text={c} />
                  </div>
                ))}
              </div>
              )}
            </motion.div>
          )}

          {!loading && activeAction === "launch" && launchResult && (
            <motion.div key="launch" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Social Media Posts</p>
                {launchResult.socialPosts.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-xl mb-1.5" style={{ background: "hsl(var(--kf-warning)/0.06)", border: "1px solid hsl(var(--kf-warning)/0.15)" }}>
                    <p className="text-xs flex-1 leading-relaxed">{p}</p>
                    <CopyBtn text={p} />
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">WhatsApp Messages</p>
                {launchResult.whatsappMessages.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-xl mb-1" style={{ background: "hsl(var(--kf-success)/0.06)", border: "1px solid hsl(var(--kf-success)/0.12)" }}>
                    <p className="text-xs flex-1 leading-relaxed">{m}</p>
                    <CopyBtn text={m} />
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Email Subject Lines</p>
                {launchResult.emailSubjectLines.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl mb-1" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
                    <p className="text-xs flex-1 font-medium">{s}</p>
                    <CopyBtn text={s} />
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
