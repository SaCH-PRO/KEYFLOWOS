/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 5 (reviews of 5e7a6f0), under D-303: the panel's and the store AI hub's
 * generated copy says only what the product knows about the store.
 *
 *   R5-1  no "curated", "full catalog", "all in one place", "As always … amazing customers like you", or "Everything
 *         you need — available online, anytime"; and the book/buy/order wording comes from the store's real counts
 *         (a products-only store is not offered booking, a services-only store is not offered buying)
 *   R5-2  structural: for a store with 0 items, 0 services and 0 testimonials, every generator's output holds only the
 *         business name, real counts, [placeholders] and the fixed strings allowed below; a newly invented claim
 *         ("24-hour turnaround", "the best in town", "Trusted by thousands") is not one of them
 *   R5-3  placeholders: the FAQ instruction says to fill in the [bracketed] parts in the FAQ Manager after adding, and a
 *         visible note sits by each answer that holds one and by Add All
 *   R5-4  the hub's Trust Copy returns no guarantees key; its instruction matches the result and says to update the
 *         review count when reviews change
 *   R5-5  singular forms: "1 customer review", "Read 1 review", "Browse our 1 item", "We have 1 item available",
 *         "1 item, online", "1 Item"
 *   R5-6  a testimonial count that is not a positive number (NaN) suggests no trust copy
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/app/store",
  useParams: () => ({}),
}));

import { AiContentPanel } from "../components/ai-content-panel";
import { useStoreAiHub } from "../hooks/use-store-ai-hub";

afterEach(() => cleanup());

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const UNCHECKED = /curated|full catalog|all in one place|As always|amazing customers|Everything you need|available online, anytime/i;
const LONG = 30_000;

async function generate(label: string) {
  fireEvent.click(screen.getByText(label));
  await screen.findByText(/Generating/);
  await waitFor(() => expect(screen.queryByText(/Generating/)).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 50));
}

function hubTool(id: string) {
  const { result } = renderHook(() => useStoreAiHub());
  const tool = result.current.tools.find((t) => t.id === id);
  if (!tool) throw new Error(`no tool ${id}`);
  return tool;
}
const store = (products: number, services: number, testimonials = 0) => ({
  storeName: "Pepper Co",
  products: Array.from({ length: products }, (_, i) => ({ id: `p${i}`, category: "Sauces" })),
  services: Array.from({ length: services }, (_, i) => ({ id: `s${i}`, category: "Tasting" })),
  testimonials: Array.from({ length: testimonials }, (_, i) => ({ id: `t${i}` })),
});
const run = async (id: string, data: ReturnType<typeof store>) => hubTool(id).execute({ businessId: "biz_1", customData: data });
const COPY_TOOLS = ["faq-generator", "seo-generator", "launch-campaign-generator", "hero-copy-generator", "trust-copy-generator"];

/** Every string an output holds, line by line, with the name, numbers and [placeholders] taken out. */
const norm = (t: string) => t.replace(/pepper co/gi, "{name}").replace(/\[[^\]]*\]/g, "[…]").replace(/\d+/g, "{n}").replace(/\s+/g, " ").trim();
function strings(v: unknown, out: string[]) {
  if (typeof v === "string") v.split("\n").forEach((l) => l.trim() && out.push(norm(l)));
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
}

/** The fixed strings the generators may say to an empty store (UI labels, owner instructions, and neutral copy). */
const ALLOWED = new Set<string>([
  "AI Content Intelligence",
  "About",
  "Add All to FAQ",
  "Add testimonials under Social Proof first; trust copy is then suggested from them.",
  "Apply SEO Settings",
  "Apply the recommended meta title and description in Merchandising → SEO section. Choose options that best describe your business.",
  "Badges and social proof from your testimonials",
  "Big News from {name} — Visit Us Online",
  "Big news — {name} is now online! 🚀 Check it out and let me know what you think!",
  "Big news! 🎉 {name} just launched online. Drop a comment if you want the link! 👇",
  "Click 'Add All to FAQ', then fill in the […] parts with your own policies in the FAQ Manager, and save.",
  "Copy these FAQs into your FAQ Manager in the Merchandising tab, then fill in the […] parts with your own policies there before you save.",
  "Craft optimized meta title & description",
  "Create FAQ entries for your store",
  "Discover {name} online.",
  "Email Subject Lines",
  "Fill in the […] part in the FAQ Manager.",
  "Generate FAQ",
  "Generate FAQ, SEO, trust copy, and launch campaign",
  "Generate SEO",
  "Generated SEO metadata for \"{name}\".",
  "Generated launch campaign materials for \"{name}\": {n} social posts, {n} WhatsApp messages, and a launch email.",
  "Generated {n} FAQ entries for \"{name}\" covering about, support, refunds.",
  "Generated {n} headline options, {n} subheadlines, {n} ribbon options, and {n} CTAs for {name}.",
  "Get Started",
  "Hero Image",
  "Hi […],",
  "Hi! Just wanted to let you know that {name} is now live online! 🎉 Would love to see you there! 😊",
  "Hi! Just wanted to let you know that {name} is now live online! 🎉 You can find us at […]. Would love to see you there! 😊",
  "How can I contact you?",
  "Launch Posts",
  "Meta Description",
  "Meta Title",
  "No OG image set for social sharing",
  "No trust copy for \"{name}\" yet: add testimonials, and the copy suggested will point to them.",
  "No trust copy yet. Add testimonials under Social Proof, and the copy suggested here will point to them.",
  "Reach us through the contact section on our storefront. We respond within […].",
  "Refunds",
  "Select the title and description that best represents your store, then click Apply.",
  "Social Media Posts",
  "Social media & WhatsApp launch copy",
  "Some answers have […] parts: fill them in before your customers see them.",
  "Support",
  "Take a look at our store.",
  "Thank you for reading.",
  "Trust Copy",
  "Upload a {n}×{n}px image to improve social share previews.",
  "Use the recommended combination for maximum impact, or mix and match from the options above. Update these in Design → Appearance → Hero section.",
  "Use these across your channels in the {n}-{n} hours around your launch for maximum impact. Personalize with your actual store link before sending.",
  "Visit {name} online.",
  "Warmly,",
  "We offer refunds within […] of purchase.",
  "We offer refunds within […] of purchase. Please contact us to initiate a refund.",
  "We're Live! {name} Is Now Online",
  "We're just getting started.",
  "We're thrilled to announce that {name} is now live online!",
  "We've been working hard behind the scenes, and it's finally here. {name} is now live online. Come take a look! 🛍️",
  "What is your refund policy?",
  "What makes {name} different?",
  "WhatsApp Messages",
  "You can reach us through the contact section on our storefront, or message us directly via the contact details listed on our page. We respond within […].",
  "[…]",
  "{name}",
  "{name} Just Launched — Come Check It Out",
  "{name} Online",
  "{name} is now online.",
  "{name} | Online",
  "{name} — Now Online",
  "{name} — now online.",
  "{name}, now online.",
  "{name}. Now online.",
  "✨ […]",
  "🎉 Now Open Online",
  "🔥 […]",
  "🚀 We're officially live! {name} is now open online. Link in bio! ✨",
]);

describe("R5-1: nothing the product does not know", () => {
  it("the panel's SEO and launch copy, for a store with products and services, carries none of the unchecked phrases", async () => {
    for (const label of ["Generate SEO", "Launch Posts"]) {
      render(<AiContentPanel storeName="Pepper Co" productsCount={2} servicesCount={1} />);
      await generate(label);
      expect(text(), label).not.toMatch(UNCHECKED);
      cleanup();
    }
  }, LONG);

  it("the hub's generators, for a store with products and services, carry none of them", async () => {
    for (const id of COPY_TOOLS) expect(JSON.stringify(await run(id, store(2, 1, 2))), id).not.toMatch(UNCHECKED);
  });

  it("a products-only store is not offered booking; a services-only store is not offered buying or ordering", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} servicesCount={0} />);
    await generate("Generate SEO");
    expect(text()).not.toMatch(/\bbook/i);
    cleanup();
    render(<AiContentPanel storeName="Pepper Co" productsCount={2} servicesCount={0} />);
    await generate("Launch Posts");
    expect(text()).not.toMatch(/\bbook/i);
    cleanup();
    for (const label of ["Generate SEO", "Launch Posts"]) {
      render(<AiContentPanel storeName="Pepper Co" productsCount={0} servicesCount={2} />);
      await generate(label);
      expect(text(), label).not.toMatch(/\bbuy\b|\bshop\b|\border/i);
      cleanup();
    }
    for (const id of ["seo-generator", "launch-campaign-generator", "hero-copy-generator"]) {
      expect(JSON.stringify(await run(id, store(2, 0))), `${id} products only`).not.toMatch(/\bbook/i);
      expect(JSON.stringify(await run(id, store(0, 2))), `${id} services only`).not.toMatch(/\bbuy\b|\bshop\b|\border/i);
    }
  }, LONG);
});

describe("R5-2: an empty store is told only its name, real counts, placeholders and the allowed fixed strings", () => {
  it("the panel's FAQ, SEO, Trust Copy and Launch Posts", async () => {
    for (const label of ["Generate FAQ", "Generate SEO", "Trust Copy", "Launch Posts"]) {
      render(<AiContentPanel storeName="Pepper Co" productsCount={0} servicesCount={0} testimonialCount={0} onApplyFaq={() => {}} onApplySeo={() => {}} />);
      await generate(label);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const unknown: string[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = norm(n.textContent ?? "");
        if (t && !ALLOWED.has(t)) unknown.push(t);
      }
      expect(unknown, label).toEqual([]);
      cleanup();
    }
  }, LONG);

  it("the hub's FAQ, SEO, launch, hero and trust generators", async () => {
    for (const id of COPY_TOOLS) {
      const out: string[] = [];
      strings(await run(id, store(0, 0, 0)), out);
      expect(out.filter((s) => !ALLOWED.has(s)), id).toEqual([]);
    }
  });
});

describe("R5-3: the [bracketed] parts are marked to fill in", () => {
  it("the panel's FAQ says to fill them in the FAQ Manager after adding, and notes each answer and Add All", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={1} servicesCount={1} hasDelivery onApplyFaq={() => {}} />);
    await generate("Generate FAQ");
    expect(text()).toMatch(/Click 'Add All to FAQ', then fill in the \[bracketed\] parts with your own policies in the FAQ Manager/);
    const perAnswer = screen.getAllByText("Fill in the [bracketed] part in the FAQ Manager.");
    const withPlaceholder = screen.getAllByText(/\[your\s|\[what makes/);
    expect(perAnswer.length).toBe(withPlaceholder.filter((el) => el.tagName === "P" && !/Click 'Add All/.test(el.textContent ?? "")).length);
    const note = screen.getByText("Some answers have [bracketed] parts: fill them in before your customers see them.");
    expect(note.nextElementSibling?.textContent ?? "").toMatch(/Add All to FAQ/);
  });
});

describe("R5-4: the hub's Trust Copy", () => {
  it("returns no guarantees key, and its instruction matches the result", async () => {
    const none = (await run("trust-copy-generator", store(0, 0, 0))) as Record<string, unknown>;
    expect(none).not.toHaveProperty("guarantees");
    expect(String(none.instruction)).toMatch(/Add testimonials under Social Proof first/);
    expect(String(none.instruction)).not.toMatch(/Add (the )?(trust badges|review count)/i);
    const some = (await run("trust-copy-generator", store(0, 0, 2))) as Record<string, unknown>;
    expect(some).not.toHaveProperty("guarantees");
    expect(String(some.instruction)).toMatch(/update them when your reviews change/);
  });
});

describe("R5-5: singular forms", () => {
  it("the hub: '1 customer review', 'Read 1 review', 'Browse our 1 item', 'We have 1 item available', '1 item, online', '1 Item'", async () => {
    const trust = (await run("trust-copy-generator", store(0, 0, 1))) as { trustBadges: string[]; socialProofCopy: string[] };
    expect(trust.trustBadges).toEqual(["1 customer review"]);
    expect(trust.socialProofCopy).toEqual(["Read 1 review from our customers."]);
    const launch = JSON.stringify(await run("launch-campaign-generator", store(1, 0)));
    expect(launch).toMatch(/Browse our 1 item\./);
    expect(launch).toMatch(/We have 1 item available\./);
    expect(launch).not.toMatch(/1 items/);
    const hero = JSON.stringify(await run("hero-copy-generator", store(1, 0)));
    expect(hero).toMatch(/1 item, online\./);
    expect(hero).not.toMatch(/1 items/i);
    expect(JSON.stringify(await run("seo-generator", { ...store(1, 0), products: [{ id: "p0" }] }))).toMatch(/Pepper Co \| 1 Item"/);
  });

  it("the panel: 'Browse our 1 item' and '1 Item'", async () => {
    render(<AiContentPanel storeName="Pepper Co" productsCount={1} />);
    await generate("Launch Posts");
    expect(text()).toMatch(/Browse our 1 item\./);
    cleanup();
    render(<AiContentPanel storeName="Pepper Co" productsCount={1} />);
    await generate("Generate SEO");
    expect(text()).toMatch(/Pepper Co \| 1 Item(?!s)/);
  }, LONG);
});

describe("R5-6: a count that is not a positive number", () => {
  it("NaN testimonials suggest no trust copy", async () => {
    render(<AiContentPanel storeName="Pepper Co" testimonialCount={Number.NaN} />);
    await generate("Trust Copy");
    expect(text()).toMatch(/No trust copy yet/);
    expect(text()).not.toMatch(/NaN/);
  });
});
