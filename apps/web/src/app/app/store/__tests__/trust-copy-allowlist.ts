/**
 * P231 TRUST-BADGES-TRUE-ONLY (D-303), rounds 5-7: the only fixed strings the store's copy generators (the AI Content
 * panel, the store AI hub's copy tools and the AI Hero Copy panel) may produce, once the business name is taken out
 * as {name}, every number as {n} and every [bracketed] placeholder as […]. They are UI labels, instructions to the
 * merchant, and copy that states only the store's name, its real counts and what it offers (r7: by the kinds /book
 * names: products, packages and services), and the merchant's own description and tagline (the test store's). A generated claim not in
 * this list ("24-hour turnaround", "the best in town", "Trusted by thousands", "Free shipping") fails the specs that
 * use it, whatever its wording.
 */
export const norm = (t: string) =>
  t.replace(/pepper co/gi, "{name}").replace(/\[[^\]]*\]/g, "[…]").replace(/\d+/g, "{n}").replace(/\s+/g, " ").trim();

/** Every string an output holds, line by line, normalised. */
export function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") v.split("\n").forEach((l) => l.trim() && out.push(norm(l)));
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** Every text node of the rendered document, normalised. */
export function textNodes(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = norm(n.textContent ?? "");
    if (t) out.push(t);
  }
  return out;
}

export const ALLOWED = new Set<string>([
  "AI Content Intelligence",
  "AI Hero Copy",
  "About",
  "Add All to FAQ",
  "Add at least {n} sentences per product for better indexing.",
  "Add testimonials under Social Proof first; trust copy is then suggested from them.",
  "Add the review count to your description and the social proof copy near your testimonials section; update them when your reviews change.",
  "Add the service you want, then choose a date and time at checkout to complete your booking.",
  "Apply SEO Settings",
  "Apply the recommended meta title and description in Merchandising → SEO section. Choose options that best describe your business.",
  "Apply to Hero Section",
  "Badges and social proof from your testimonials",
  "Big News from {name} — Visit Us Online",
  "Big news — {name} is now online! 🚀 Check it out and let me know what you think!",
  "Big news! 🎉 {name} just launched online. Book online. Drop a comment if you want the link! 👇",
  "Big news! 🎉 {name} just launched online. Book or buy online. Drop a comment if you want the link! 👇",
  "Big news! 🎉 {name} just launched online. Buy online. Drop a comment if you want the link! 👇",
  "Big news! 🎉 {name} just launched online. Drop a comment if you want the link! 👇",
  "Book Today",
  "Bookings",
  "Browse {n} package at {name}. Buy online.",
  "Browse {n} package. Buy online.",
  "Browse {n} packages at {name}. Buy online.",
  "Browse {n} packages. Buy online.",
  "Browse {n} product and {n} service at {name}. Book or buy online.",
  "Browse {n} product and {n} service. Book or buy online.",
  "Browse {n} product at {name}. Buy online.",
  "Browse {n} product, {n} packages and {n} services at {name}. Book or buy online.",
  "Browse {n} product, {n} packages and {n} services. Book or buy online.",
  "Browse {n} product. Buy online.",
  "Browse {n} products and {n} service at {name}. Book or buy online.",
  "Browse {n} products and {n} service. Book or buy online.",
  "Browse {n} products and {n} services at {name}. Book or buy online.",
  "Browse {n} products and {n} services. Book or buy online.",
  "Browse {n} products at {name}. Buy online.",
  "Browse {n} products. Buy online.",
  "Browse {n} service at {name}. Book online.",
  "Browse {n} service at {name}. Buy online.",
  "Browse {n} service. Book online.",
  "Browse {n} service. Buy online.",
  "Browse {n} services at {name}. Book online.",
  "Browse {n} services at {name}. Book or buy online.",
  "Browse {n} services at {name}. Buy online.",
  "Browse {n} services. Book online.",
  "Browse {n} services. Book or buy online.",
  "Browse {n} services. Buy online.",
  "Call to Action",
  "Can I reschedule or cancel my booking?",
  "Can I reschedule or cancel?",
  "Changes apply to your hero fields above. Save to persist.",
  "Click 'Add All to FAQ', then fill in the […] parts with your own policies in the FAQ Manager, and save.",
  "Click Generate to create AI-powered hero copy tailored to your business.",
  "Copy these FAQs into your FAQ Manager in the Merchandising tab, then fill in the […] parts with your own policies there before you save.",
  "Craft optimized meta title & description",
  "Create FAQ entries for your store",
  "Delivery",
  "Delivery takes […]. Delivery options are shown at checkout.",
  "Discover {name} online.",
  "Discover {name} online. Small-batch hot sauces.",
  "Discover {n} package from {name}",
  "Discover {n} packages from {name}",
  "Discover {n} product and {n} service from {name}",
  "Discover {n} product from {name}",
  "Discover {n} product, {n} packages and {n} services from {name}",
  "Discover {n} products and {n} service from {name}",
  "Discover {n} products and {n} services from {name}",
  "Discover {n} products from {name}",
  "Discover {n} service from {name}",
  "Discover {n} services from {name}",
  "Email Subject Lines",
  "Explore Collection",
  "Fill in the […] part in the FAQ Manager.",
  "Generate",
  "Generate FAQ",
  "Generate FAQ, SEO, trust copy, and launch campaign",
  "Generate SEO",
  "Generate headline, subheadline, ribbon & CTA",
  "Generated SEO metadata for \"{name}\" targeting its package.",
  "Generated SEO metadata for \"{name}\" targeting its packages.",
  "Generated SEO metadata for \"{name}\" targeting its product and service.",
  "Generated SEO metadata for \"{name}\" targeting its product, packages and services.",
  "Generated SEO metadata for \"{name}\" targeting its product.",
  "Generated SEO metadata for \"{name}\" targeting its products and service.",
  "Generated SEO metadata for \"{name}\" targeting its products and services.",
  "Generated SEO metadata for \"{name}\" targeting its products.",
  "Generated SEO metadata for \"{name}\" targeting its service.",
  "Generated SEO metadata for \"{name}\" targeting its services.",
  "Generated SEO metadata for \"{name}\".",
  "Generated launch campaign materials for \"{name}\": {n} social posts, {n} WhatsApp messages, and a launch email.",
  "Generated trust badges and social proof language for \"{name}\" from its {n} testimonial.",
  "Generated trust badges and social proof language for \"{name}\" from its {n} testimonials.",
  "Generated {n} FAQ entries for \"{name}\" covering about, support, refunds.",
  "Generated {n} FAQ entries for \"{name}\" covering bookings, about, support, refunds.",
  "Generated {n} FAQ entries for \"{name}\" covering bookings, delivery, about, support, refunds.",
  "Generated {n} FAQ entries for \"{name}\" covering bookings, payments, about, support, refunds.",
  "Generated {n} FAQ entries for \"{name}\" covering bookings, payments, delivery, about, support, refunds.",
  "Generated {n} FAQ entries for \"{name}\" covering payments, about, support, refunds.",
  "Generated {n} headline option, {n} subheadline, {n} ribbon options, and {n} CTA for {name}.",
  "Generated {n} headline options, {n} subheadlines, {n} ribbon options, and {n} CTA for {name}.",
  "Generated {n} headline options, {n} subheadlines, {n} ribbon options, and {n} CTAs for {name}.",
  "Get Started",
  "Headline",
  "Hero Image",
  "Hi […],",
  "Hi! Just wanted to let you know that {name} is now live online! 🎉 Would love to see you there! 😊",
  "Hi! Just wanted to let you know that {name} is now live online! 🎉 You can find us at […]. Would love to see you there! 😊",
  "Hide options",
  "How can I contact you?",
  "How do I book a service?",
  "How long does delivery take?",
  "Launch Posts",
  "Meta Description",
  "Meta Title",
  "No OG image set for social sharing",
  "No trust copy for \"{name}\" yet: add testimonials, and the copy suggested will point to them.",
  "No trust copy yet. Add testimonials under Social Proof, and the copy suggested here will point to them.",
  "Offer Ribbon",
  "Payments",
  "Product Descriptions",
  "Reach us at […]. We respond within […].",
  "Read {n} review from our customers.",
  "Read {n} reviews from our customers.",
  "Refunds",
  "Regenerate",
  "Select the title and description that best represents your store, then click Apply.",
  "Shop Now",
  "Small-batch hot sauces.",
  "Social Media Posts",
  "Social Proof Copy",
  "Social media & WhatsApp launch copy",
  "Some answers have […] parts: fill them in before your customers see them.",
  "Some products lack descriptions",
  "Subheadline",
  "Support",
  "Take a look at our store.",
  "Thank you for reading.",
  "These suggestions are built from your store details. Click any option to use it, or copy and paste into your hero fields. Replace any […] part with your own before you save.",
  "Trust Badges",
  "Trust Copy",
  "Upload a {n}×{n}px image to improve social share previews.",
  "Use",
  "Use the recommended combination for maximum impact, or mix and match from the options above. Update these in Design → Appearance → Hero section.",
  "Use these across your channels in the {n}-{n} hours around your launch for maximum impact. Personalize with your actual store link before sending.",
  "Visit {name} online.",
  "Warmly,",
  "We accept […].",
  "We have {n} item available.",
  "We have {n} items available.",
  "We're Live! {name} Is Now Online",
  "We're just getting started.",
  "We're thrilled to announce that {name} is now live online!",
  "We've been working hard behind the scenes, and it's finally here. {name} is now live online. Come take a look! 🛍️",
  "What is your refund policy?",
  "What makes {name} different?",
  "What payment methods do you accept?",
  "WhatsApp Messages",
  "You can now book directly from our store.",
  "You can now buy and book directly from our store.",
  "You can now order directly from our store.",
  "[…]",
  "book online",
  "buy online",
  "{name}",
  "{name} Just Launched — Come Check It Out",
  "{name} Online",
  "{name} is now online.",
  "{name} offers {n} package online. Buy online.",
  "{name} offers {n} packages online. Buy online.",
  "{name} offers {n} product and {n} service online. Book or buy online.",
  "{name} offers {n} product online. Buy online.",
  "{name} offers {n} product, {n} packages and {n} services online. Book or buy online.",
  "{name} offers {n} products and {n} service online. Book or buy online.",
  "{name} offers {n} products and {n} services online. Book or buy online.",
  "{name} offers {n} products online. Buy online.",
  "{name} offers {n} service online. Book online.",
  "{name} offers {n} service online. Buy online.",
  "{name} offers {n} services online. Book online.",
  "{name} offers {n} services online. Book or buy online.",
  "{name} offers {n} services online. Buy online.",
  "{name} | Book Online",
  "{name} | Heat with care",
  "{name} | Online",
  "{name} | Shop & Book Online",
  "{name} | Shop Online",
  "{name} | {n} Item",
  "{name} | {n} Items",
  "{name} — Book Online Today",
  "{name} — Heat with care",
  "{name} — Heat with care. Book or buy online.",
  "{name} — Now Online",
  "{name} — Package Online",
  "{name} — Packages Online",
  "{name} — Product Online",
  "{name} — Product and Service Online",
  "{name} — Product, Packages and Services Online",
  "{name} — Products Online",
  "{name} — Products and Service Online",
  "{name} — Products and Services Online",
  "{name} — Service Online",
  "{name} — Services Online",
  "{name} — Shop Online Today",
  "{name} — now online.",
  "{name} — {n} package available online. Buy online.",
  "{name} — {n} package. Now online.",
  "{name} — {n} packages available online. Buy online.",
  "{name} — {n} packages. Now online.",
  "{name} — {n} product and {n} service available online. Book or buy online.",
  "{name} — {n} product and {n} service. Now online.",
  "{name} — {n} product available online. Buy online.",
  "{name} — {n} product, {n} packages and {n} services available online. Book or buy online.",
  "{name} — {n} product, {n} packages and {n} services. Now online.",
  "{name} — {n} product. Now online.",
  "{name} — {n} products and {n} service available online. Book or buy online.",
  "{name} — {n} products and {n} service. Heat with care",
  "{name} — {n} products and {n} service. Now online.",
  "{name} — {n} products and {n} services available online. Book or buy online.",
  "{name} — {n} products and {n} services. Now online.",
  "{name} — {n} products available online. Buy online.",
  "{name} — {n} products. Now online.",
  "{name} — {n} service available online. Book online.",
  "{name} — {n} service available online. Buy online.",
  "{name} — {n} service. Now online.",
  "{name} — {n} services available online. Book online.",
  "{name} — {n} services available online. Book or buy online.",
  "{name} — {n} services available online. Buy online.",
  "{name} — {n} services. Now online.",
  "{name}, now online.",
  "{name}. Now online.",
  "{n} customer review",
  "{n} customer reviews",
  "{n} item, online.",
  "{n} items, online.",
  "✨ […]",
  "🎉 Now Open Online",
  "🎉 Now Open Online — Book Today",
  "🎉 Now Open Online — Shop Today",
  "🔥 […]",
  "🚀 We're officially live! {name} is now open online. Browse our {n} item. Link in bio! ✨",
  "🚀 We're officially live! {name} is now open online. Browse our {n} items. Link in bio! ✨",
  "🚀 We're officially live! {name} is now open online. Link in bio! ✨",
]);

/**
 * P231 r12: the hub's copy tools write only from the store's view (storeProducts, storeServices, from the store page);
 * absent is "not known", as null is, never the whole catalog. A spec's store with all of its catalog on the store:
 * the view is the lists given (a view the spec gives itself, null included, is kept).
 */
export function onStore<D extends object>(d: D): D & { storeProducts: unknown; storeServices: unknown } {
  const v = d as D & { products?: unknown[]; services?: unknown[]; storeProducts?: unknown; storeServices?: unknown };
  return {
    ...d,
    storeProducts: "storeProducts" in v ? v.storeProducts : (v.products ?? []),
    storeServices: "storeServices" in v ? v.storeServices : (v.services ?? []),
  };
}

/**
 * P231 r15 (R15-5): what a clip()'s kept part must not end in, checked independently of clip()'s own rules, from
 * explicit lists of the characters the fuzz alphabets use (never clip()'s Unicode classes, so a mistake shared by
 * clip() and its check cannot pass). Returns why, or null.
 */
const ALWAYS_DROPPED = [".", ",", ";", ":", "!", "?", "…", "—", "–", "-", "(", "[", "{", "“", "‘", "«", "„", "。", "、", "，", "！", "？", "；", "：", "．", "｡", "､"];
/** Symbols and marks that go when they stand alone (after a space): none of them closes or means anything there. */
const LONE_DROPPED = ["&", "•", "/", "*", "#", "@", "¿", "¡", "<", "$", "€", "°", "★", "|", "©", "®", "™", "↔", "→", "‼"];
const CURRENCY = ["$", "€"];
/** What makes text more than punctuation and symbols: a letter, a digit, or one of the alphabets' emoji. */
export const CLIP_EMOJI = ["🎉", "🌶️", "👍🏽", "#️⃣", "1️⃣", "🇹🇹", "🇺🇸", "👨‍👩‍👧", "🏳️‍🌈", "❤️"];
export const hasWordOrEmoji = (t: string) => /[\p{L}\p{N}]/u.test(t) || CLIP_EMOJI.some((e) => t.includes(e));

export function clipEndViolation(text: string, kept: string): string | null {
  if (/\s$/u.test(kept)) return "whitespace before the '...'";
  if (!hasWordOrEmoji(text)) return null;
  if (!hasWordOrEmoji(kept)) return "only punctuation and symbols kept from text that has words";
  if (ALWAYS_DROPPED.some((c) => kept.endsWith(c))) return `ends in ${JSON.stringify(kept.slice(-1))}`;
  // The last token after a space, made only of characters that go when alone: a lone symbol left at the end.
  const m = /(\S*)\s+(\S+)$/u.exec(kept);
  if (m) {
    const token = Array.from(m[2]);
    if (token.every((c) => LONE_DROPPED.includes(c))) {
      const afterNumber = token.every((c) => CURRENCY.includes(c)) && /[0-9]$/.test(m[1]);
      if (!afterNumber) return `ends in a lone ${JSON.stringify(m[2])}`;
    }
  }
  return null;
}

/**
 * P231 r16 (R16-2): what a clip() must keep, independent of clip()'s rules too: when the kept part is the text's
 * start (the cut at a word, not the hard-cut fallback), every token of the text that fits in the room left for the
 * "..." (the first max - 3 graphemes), is followed by whitespace, and ends in a mark that closes or means something
 * ("%", "+", a closing bracket or quote, a straight quote), is kept whole. Returns why not, or null.
 */
const KEPT_AT_END = ["%", "+", ")", "]", "}", "”", "’", "»", '"', "'"];
export function clipKeepViolation(text: string, max: number, kept: string): string | null {
  if (!text.startsWith(kept) || max <= 3) return null;
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const room = Array.from(seg.segment(text), (s) => s.segment).slice(0, max - 3).join("");
  for (const m of text.matchAll(/\S+(?=\s)/gu)) {
    const end = (m.index ?? 0) + m[0].length;
    if (end > room.length) break;
    if (KEPT_AT_END.some((c) => m[0].endsWith(c)) && kept.length < end) return `dropped ${JSON.stringify(m[0])}`;
  }
  return null;
}
