"use client";

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
  keywords: string[];
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
  productsCount?: number;
  servicesCount?: number;
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
  { id: "trust", icon: ShieldCheck, label: "Trust Copy", desc: "Guarantees, badges, social proof text", color: "hsl(var(--kf-success))" },
  { id: "launch", icon: Megaphone, label: "Launch Posts", desc: "Social media & WhatsApp launch copy", color: "hsl(var(--kf-warning))" },
];

export function AiContentPanel({
  storeName,
  businessDescription,
  businessTagline,
  productsCount = 0,
  servicesCount = 0,
  hasDelivery = false,
  testimonialCount = 0,
  onApplyFaq,
  onApplySeo,
}: Props) {
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [loading, setLoading] = useState(false);
  const [faqResult, setFaqResult] = useState<FaqResult | null>(null);
  const [seoResult, setSeoResult] = useState<SeoResult | null>(null);
  const [trustResult, setTrustResult] = useState<{ guarantees: string[]; trustBadges: string[]; socialProofCopy: string[] } | null>(null);
  const [launchResult, setLaunchResult] = useState<{ socialPosts: string[]; whatsappMessages: string[]; emailSubjectLines: string[] } | null>(null);
  const [appliedFaq, setAppliedFaq] = useState(false);
  const [appliedSeo, setAppliedSeo] = useState(false);
  const [selectedSeoTitle, setSelectedSeoTitle] = useState("");
  const [selectedSeoDesc, setSelectedSeoDesc] = useState("");

  const name = storeName || "Your Store";
  const totalItems = productsCount + servicesCount;

  async function generate(action: ActionType) {
    setActiveAction(action);
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));

    if (action === "faq") {
      const faqs: GeneratedFaq[] = [];
      if (servicesCount > 0) {
        faqs.push({ question: "How do I book a service?", answer: `Simply browse our services and click "Book Now" on the one you want. You'll choose your preferred time and complete your booking in just a few steps.`, category: "Bookings" });
        faqs.push({ question: "Can I reschedule or cancel?", answer: "Yes — you can reschedule or cancel up to 24 hours before your appointment. Contact us directly for any last-minute changes.", category: "Bookings" });
      }
      if (productsCount > 0) {
        faqs.push({ question: "What payment methods do you accept?", answer: "We accept all major credit and debit cards. All payments are processed securely at checkout.", category: "Payments" });
      }
      if (hasDelivery) {
        faqs.push({ question: "How long does delivery take?", answer: "Standard delivery is 3–5 business days. Express options may be available at checkout depending on your location.", category: "Delivery" });
        faqs.push({ question: "Do you offer local pickup?", answer: "Yes! Select local pickup at checkout and we'll notify you when your order is ready to collect.", category: "Delivery" });
      }
      faqs.push({ question: `What makes ${name} different?`, answer: `We're committed to quality and customer satisfaction in everything we offer. Every item is carefully selected and every service is delivered with care.`, category: "About" });
      faqs.push({ question: "How can I contact you?", answer: "Reach us through the contact section on our storefront. We typically respond within 1 business day.", category: "Support" });
      faqs.push({ question: "What is your refund policy?", answer: "We offer refunds within 7 days of purchase for items in original condition. Services can be cancelled up to 24 hours in advance.", category: "Refunds" });
      setFaqResult({ faqs, instruction: "These FAQs are ready to use. Click 'Add All to FAQ' to apply them to your FAQ Manager, then save." });
    }

    if (action === "seo") {
      const tagline = businessTagline || "";
      const metaTitleOptions = [
        `${name} — Shop Online Today`.slice(0, 60),
        tagline ? `${name} | ${tagline}`.slice(0, 60) : `${name} | ${totalItems > 0 ? `${totalItems} Items` : "Products & Services"}`.slice(0, 60),
        `Buy ${name} Products Online`.slice(0, 60),
      ];
      const metaDescOptions = [
        `Browse ${totalItems > 0 ? totalItems : ""} products and services at ${name}. Order online and get fast delivery.`.slice(0, 160),
        `${name} — ${tagline || "quality products and services available online"}. Book or buy instantly.`.slice(0, 160),
        `Discover everything ${name} has to offer. ${businessDescription ? businessDescription.slice(0, 80) + "..." : "Shop our curated catalog online today."}`.slice(0, 160),
      ];
      setSeoResult({
        metaTitleOptions,
        metaDescOptions,
        recommendation: { metaTitle: metaTitleOptions[0], metaDescription: metaDescOptions[0] },
        keywords: [name.toLowerCase(), "buy online", "book online", "local business"],
        instruction: "Select the title and description that best represents your store, then click Apply.",
      });
      setSelectedSeoTitle(metaTitleOptions[0]);
      setSelectedSeoDesc(metaDescOptions[0]);
    }

    if (action === "trust") {
      setTrustResult({
        guarantees: [
          "✅ 100% Satisfaction Guarantee",
          "🔒 Secure, Encrypted Checkout",
          "⚡ Fast, Reliable Service",
          "💬 Real Human Support",
        ],
        trustBadges: [
          "Verified Business",
          testimonialCount > 0 ? `${testimonialCount}+ Happy Customers` : "Trusted by Customers",
          "Secure Payments",
          "Quality Guaranteed",
        ],
        socialProofCopy: [
          testimonialCount > 0
            ? `Join ${testimonialCount}+ satisfied customers who trust ${name}.`
            : "Join our growing community of satisfied customers.",
          "Real results, real reviews — see why customers keep coming back.",
          `Trusted by customers across the region. See what they're saying below.`,
        ],
      });
    }

    if (action === "launch") {
      setLaunchResult({
        socialPosts: [
          `🚀 We're officially live! ${name} is now open online. Browse our ${totalItems > 0 ? `${totalItems}+ items` : "products and services"} and place your first order today. Link in bio! ✨`,
          `Big news! 🎉 ${name} just launched online. Shop, book, and explore — all in one place. Drop a comment if you want the link! 👇`,
          `We've been working hard behind the scenes, and it's finally here. ${name} is now live online. Come shop with us! 🛍️`,
        ],
        whatsappMessages: [
          `Hi! Just wanted to let you know that ${name} is now live online! 🎉 You can browse and shop directly at our store. Would love to see you there! 😊`,
          `Big news — ${name} is now online! 🚀 Easy ordering, fast response. Check it out and let me know what you think!`,
        ],
        emailSubjectLines: [
          `We're Live! ${name} Is Now Online`,
          `Big News from ${name} — Shop Us Online`,
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
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{faq.answer}</p>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ background: "hsl(var(--kf-accent2)/0.1)", color: "hsl(var(--kf-accent2))" }}>{faq.category}</span>
                  </div>
                ))}
              </div>
              {onApplyFaq && (
                <button
                  type="button"
                  onClick={() => { onApplyFaq(faqResult.faqs); setAppliedFaq(true); setTimeout(() => setAppliedFaq(false), 3000); }}
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
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Guarantee Statements</p>
                <div className="space-y-1">
                  {trustResult.guarantees.map((g, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: "hsl(var(--kf-success)/0.06)", border: "1px solid hsl(var(--kf-success)/0.12)" }}>
                      <p className="text-xs">{g}</p>
                      <CopyBtn text={g} />
                    </div>
                  ))}
                </div>
              </div>
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
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Social Proof Copy</p>
                {trustResult.socialProofCopy.map((c, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-xl mb-1" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.3)" }}>
                    <p className="text-xs flex-1">{c}</p>
                    <CopyBtn text={c} />
                  </div>
                ))}
              </div>
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
