/**
 * P231 TRUST-BADGES-TRUE-ONLY rounds 6-7 (D-303): what the storefront shows, counted and named the way /book shows
 * it, so every copy generator (the AI Content panel, the store AI hub's copy tools and the AI Hero Copy panel) says
 * the same true thing about the store.
 *
 * What /book shows (book/[slug]/page.tsx catalogItems, CatalogService.listPublicProducts):
 * - every bookable service: a service row with no sourceProductId (a row with one is a product's store listing),
 *   booked at checkout;
 * - a product live on the store (a store listing names it) and active, drawn by its `category`: PRODUCT is a product,
 *   PACKAGE a package, SERVICE (the default) a service, bought, not booked, and left out when a bookable service has
 *   its name; any other category is not drawn;
 * - minus what the store's stock hides (tracked, nothing available, out-of-stock behaviour "hide", the default) and
 *   what the storefront's catalog override hides (visibilityRule "hidden").
 */
import type { StorefrontConfig } from "@/lib/client";

/** The business's stock per product: its own inventory rows summed (quantity, reserved), as the server sums them. */
export type StockByProduct = Map<string, { quantity: number; reserved: number }>;

type ProductLike = {
  id: string;
  name?: string;
  category?: string | null;
  isActive?: boolean;
  inventoryMode?: string | null;
  outOfStockBehavior?: string | null;
};
type ServiceLike = { id?: string; name?: string; sourceProductId?: unknown };

const DRAWN = new Set(["PRODUCT", "PACKAGE", "SERVICE"]);
const categoryOf = (p: { category?: unknown }) => (typeof p.category === "string" && p.category ? p.category : "SERVICE");

function hiddenByStorefront(config: StorefrontConfig | null | undefined): Set<string> {
  const overrides = config?.catalog?.itemOverrides ?? {};
  return new Set(Object.entries(overrides).filter(([, o]) => o?.visibilityRule === "hidden").map(([id]) => id));
}

/** CatalogService.projectAvailability: tracked, nothing available, and not shown out of stock or on backorder. */
function hiddenForStock(p: ProductLike, stock: StockByProduct): boolean {
  const row = stock.get(p.id);
  const mode = p.inventoryMode || (row ? "tracked" : "untracked");
  if (mode !== "tracked") return false;
  if (Math.max(0, (row?.quantity ?? 0) - (row?.reserved ?? 0)) > 0) return false;
  const behavior = p.outOfStockBehavior ?? "hide";
  return behavior !== "show_oos" && behavior !== "allow_backorder";
}

/** The services /book lists as bookable: no product listings, none the storefront hides. */
export function bookableServices<S extends ServiceLike>(services: S[], storefrontConfig?: StorefrontConfig | null): S[] {
  const hidden = hiddenByStorefront(storefrontConfig);
  return services.filter((s) => !s.sourceProductId && !(s.id && hidden.has(s.id)));
}

/**
 * The products /book shows: live on the store, active, of a drawn category, not hidden by the store's stock (when it
 * was read) or by the storefront, and not a SERVICE-category product with a bookable service's name.
 */
export function liveProducts<P extends ProductLike>(
  products: P[],
  liveProductIds: ReadonlySet<string> | undefined,
  opts: { services?: ServiceLike[]; stock?: StockByProduct | null; storefrontConfig?: StorefrontConfig | null } = {},
): P[] {
  if (!liveProductIds) return [];
  const hidden = hiddenByStorefront(opts.storefrontConfig);
  // r8: /book de-dupes against every public service (no sourceProductId), even one the catalog override hides.
  const bookableNames = new Set(publicServiceNames(opts.services ?? []));
  return products.filter((p) => {
    if (!liveProductIds.has(p.id) || p.isActive === false || hidden.has(p.id)) return false;
    const category = categoryOf(p);
    if (!DRAWN.has(category)) return false;
    if (category === "SERVICE" && bookableNames.has(p.name)) return false;
    return !(opts.stock && hiddenForStock(p, opts.stock));
  });
}

/** What the store offers, by the kind /book names it. */
export type StorefrontOffer = {
  /**
   * P231 r11: whether the products on the store are known (the store graph and the storefront config were read), and
   * whether the bookable services are (the config was read: what it hides). When one is not, its counts are 0 and
   * the copy states no total and nothing that would need it (offerWords().partial). Absent means known.
   */
  productsKnown?: boolean;
  servicesKnown?: boolean;
  /** PRODUCT-category products, bought. */
  products: number;
  /** PACKAGE-category products, bought. */
  packages: number;
  /** Bookable services, booked at checkout. */
  services: number;
  /** SERVICE-category products: services, but bought, not booked. */
  orderableServices: number;
};

/** The names /book de-dupes a SERVICE-category product against: every public service's, hidden or not. */
function publicServiceNames(services: ServiceLike[]): unknown[] {
  return services.filter((s) => !s.sourceProductId).map((s) => s.name);
}

/**
 * Counts products and bookable services by kind, as /book draws them; a SERVICE-category product with a given
 * service's name is not drawn (for products straight from the catalog, the hub's copy tools without the store's view;
 * storefrontOffer's products come de-duped by liveProducts, against every public service).
 */
export function offerOf(products: { category?: unknown; name?: unknown }[], services: { name?: unknown }[]): StorefrontOffer {
  const names = new Set(services.map((s) => s.name));
  const offer: StorefrontOffer = { products: 0, packages: 0, services: services.length, orderableServices: 0 };
  for (const p of products) {
    const category = categoryOf(p);
    if (category === "PRODUCT") offer.products++;
    else if (category === "PACKAGE") offer.packages++;
    else if (category === "SERVICE" && !names.has(p.name)) offer.orderableServices++;
  }
  return offer;
}

/** The whole count, from the store's raw lists. */
export function storefrontOffer(
  services: ServiceLike[],
  commerceProducts: ProductLike[],
  liveProductIds: ReadonlySet<string> | undefined,
  opts: { stock?: StockByProduct | null; storefrontConfig?: StorefrontConfig | null } = {},
): StorefrontOffer {
  const bookable = bookableServices(services, opts.storefrontConfig);
  // r8: liveProducts de-dupes against every public service, the hidden ones too (book/[slug]/page.tsx storeServiceNames).
  return offerOf(liveProducts(commerceProducts, liveProductIds, { ...opts, services }), bookable);
}

const count = (n: unknown) => Math.max(0, Math.floor(Number(n)) || 0);
const plural = (n: number, w: string) => `${w}${n === 1 ? "" : "s"}`;
const list = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/**
 * The words for what the store offers, from its counts (rounds 5-7): no "shop" without products or packages, no
 * "buy" without something to buy, no "book" without a bookable service; each count with the noun it counts, in the
 * singular for one; the nouns /book uses (product, package, service).
 */
export function offerWords(o: Partial<StorefrontOffer>) {
  // r11: what is not known is not counted, and the copy says the offer is partial.
  const productsKnown = o.productsKnown !== false;
  const servicesKnown = o.servicesKnown !== false;
  const products = productsKnown ? count(o.products) : 0;
  const packages = productsKnown ? count(o.packages) : 0;
  const booked = servicesKnown ? count(o.services) : 0;
  const orderable = productsKnown ? count(o.orderableServices) : 0;
  const services = booked + orderable;
  const shops = products + packages > 0;
  const books = booked > 0;
  const buys = products + packages + orderable > 0;
  const total = products + packages + services;
  // r12: a partial count names only what it counts, by its own noun: with the products not known, the services it
  // counts are the booked ones ("to book"; a SERVICE-category product, bought, may be on the store too); with the
  // services not known, the bought ones ("to buy"; a bookable service may be on the store too).
  const servicesAre = !productsKnown && servicesKnown ? " to book" : productsKnown && !servicesKnown ? " to buy" : "";
  const kinds: [number, string, string][] = [[products, "product", ""], [packages, "package", ""], [services, "service", servicesAre]];
  const present = kinds.filter(([n]) => n > 0);
  const noun = list(present.map(([n, w, are]) => `${plural(n, w)}${are}`));
  return {
    /**
     * r11: not everything on the store is known (the store graph or the storefront config was not read): the copy
     * states only what is known (the counted services, with their nouns), and no total ("N items"), no title that
     * names the whole offer by its nouns, and no "just getting started".
     */
    partial: !productsKnown || !servicesKnown,
    /** Products or packages to shop ("Shop Now", "Explore Collection", "Shop Online"). */
    shops,
    /** A bookable service. */
    books,
    /** Anything bought (products, packages, or services bought, not booked). */
    buys,
    total,
    noun,
    Noun: noun.replace(/\b(product|package|service)/g, (w) => w.charAt(0).toUpperCase() + w.slice(1)),
    counted: list(present.map(([n, w, are]) => `${n} ${plural(n, w)}${are}`)),
    action: books && buys ? "Book or buy online." : buys ? "Buy online." : books ? "Book online." : "",
    items: `${total} ${plural(total, "item")}`,
    Items: `${total} ${plural(total, "Item")}`,
  };
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
/** The text's graphemes (what a reader counts as characters), or its code points where Intl.Segmenter is missing. */
const graphemes = (text: string): string[] => (segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text));
const isSpace = (g: string | undefined) => g !== undefined && /^\s+$/u.test(g);
/**
 * r15 (R15-3): an emoji, as a reader sees one: a grapheme holding a character shown as a picture
 * (\p{Emoji_Presentation}: 🎉, 👍, a flag's regional indicators). Text-style ©, ®, ™, ‼, ↔ are Extended_Pictographic
 * but read as symbols, and are not. A grapheme asked to show as a picture (U+FE0F: ❤️), a keycap (U+20E3) or a ZWJ
 * sequence needs no test here: U+FE0F, U+20E3 and U+200D are marks and a format character, never punctuation or a
 * symbol, so such a grapheme is never a mark to drop (isMark) and always counts as content (hasContent).
 */
const isEmoji = (g: string) => /\p{Emoji_Presentation}/u.test(g);
/** Holds a letter, a digit, a mark, or is an emoji: more than whitespace, punctuation and symbols. */
const hasContent = (t: string | undefined) => t !== undefined && (/[^\s\p{P}\p{S}]/u.test(t) || isEmoji(t));
/** Punctuation or symbols only, and no emoji: what may be dropped at the cut. */
const isMark = (g: string | undefined) => g !== undefined && /^[\p{P}\p{S}]+$/u.test(g) && !isEmoji(g);
/**
 * r15-r16 (R15-2, R16-5): sentence punctuation, ASCII, CJK and full-width (\p{Sentence_Terminal}: . ! ? 。 ！ ？ ．;
 * the commas, colons, semicolons; and "…", which is not \p{Sentence_Terminal}, so it is listed), dashes, opening
 * brackets and quotes: always dropped at the cut.
 */
const ALWAYS_DROPPED = /^(?:[,;:…、，､：；﹐﹑﹔﹕]|\p{Sentence_Terminal}|\p{Pd}|\p{Ps}|\p{Pi})$/u;

/**
 * P231 r12-r16: the graphemes dropped from the end of the kept part, before the "..." (one grapheme at a time, so an
 * emoji with a skin tone, a keycap, a flag, a family is never split):
 * - always: whitespace and ALWAYS_DROPPED;
 * - any other punctuation or symbol ("&", "•", "/", "*", "#", "@", "¿", "<", "$", "©", "↔") only when its run of
 *   punctuation and symbols stands alone, after whitespace or nothing ("Shop &", "Shop &&", "4.5 /"); a run attached
 *   to the letter, digit, mark or emoji before it is that word's and stays whole ("C##", "4★★", "Free**", "a/b/",
 *   "Pepper™", R15-1); a run after sentence punctuation is lone (R16-3: "Shop.★" gives "Shop"); a run of currency
 *   signs after a number and one space is the number's too ("5 €", "5 €€": R16-4, decided for the whole run);
 * - never: a "%", a "+", a closing bracket or quote, a straight quote (it may close one), an emoji, or a grapheme
 *   holding anything else (a letter, a digit, a mark), alone or not (R15-4: "50 %...", "1 +...", "( weekdays )...":
 *   a closing mark closes what the kept part opened, and dropping it would leave that open).
 */
function dropTrailing(g: string[]): string[] {
  let end = g.length;
  while (end > 0) {
    const c = g[end - 1];
    if (isSpace(c)) {
      end--;
      continue;
    }
    if (!isMark(c)) break;
    if (/^[%+"'\p{Pe}\p{Pf}]/u.test(c)) break;
    if (!ALWAYS_DROPPED.test(c)) {
      // The run this grapheme ends: the marks before it, back to content, whitespace, the start, or (r16, R16-3)
      // sentence punctuation, which is no word: a symbol after it is lone, and goes with it ("Hello!!&" gives
      // "Hello"). The run is decided whole, here, before any of it goes (R16-4): it stays whole or goes whole.
      let k = end - 1;
      while (k > 0 && isMark(g[k - 1]) && !ALWAYS_DROPPED.test(g[k - 1])) k--;
      if (hasContent(g[k - 1])) break;
      const currency = g.slice(k, end).every((r) => /^\p{Sc}$/u.test(r));
      if (currency && isSpace(g[k - 1]) && /^\p{Nd}$/u.test(g[k - 2] ?? "")) break;
    }
    end--;
  }
  return g.slice(0, end);
}

/**
 * P231 r9-r15: `text` cut to at most `max` characters (graphemes, so an emoji or an accented letter is never split
 * and no lone surrogate is left), with "..." whenever anything is dropped and never after a whole text, and never
 * "..." alone:
 * - the cut is at the last whitespace (any: a space, a tab, a no-break space, an ideographic space) inside the room
 *   left for the "..."; a word that ends exactly where the room ends is kept whole;
 * - leading whitespace is not a break (a break needs a word before it);
 * - a single word longer than the room is cut hard, then "...";
 * - trailing whitespace, sentence punctuation, dashes, opening brackets and quotes before the "..." are dropped, and
 *   a lone symbol or other punctuation mark ("Shop & Book" gives "Shop...", not "Shop &..."), by grapheme
 *   (dropTrailing); one attached to the word before it stays ("C#...", "Free*..."), as do a "%", a "+", a closing
 *   bracket or quote, a straight quote, an emoji and a flag ("Get 50%...", "(50% off)...", "500+...", "👍🏽...");
 * - when the kept part holds no letter, digit, mark, emoji or flag (all whitespace, punctuation and symbols), the text
 *   is cut hard instead, from its first non-whitespace or, when that too holds none, from its first letter, digit,
 *   mark, emoji or flag, dropping the same trailing graphemes; only a text of punctuation, symbols and whitespace
 *   alone keeps them before the "...", never whitespace;
 * - with `max` of 3 or less there is no room for "..." and a character: the text's first `max` characters;
 * - a text of whitespace only, longer than `max`, gives "".
 */
export function clip(text: string, max: number): string {
  const g = graphemes(text);
  if (g.length <= max) return text;
  if (max <= 3) return g.slice(0, Math.max(0, max)).join("");
  const room = g.slice(0, max - 3);
  let end = room.length;
  if (!isSpace(g[room.length])) {
    let i = room.length - 1;
    while (i >= 0 && !isSpace(room[i])) i--;
    // i < 0: no whitespace in the room (a single long word): cut hard. Not redundant: room.slice(0, -1) would drop
    // the room's last character. (At i = 0 the prefix is empty, so `i > 0` and `i >= 0` agree there.)
    if (i > 0 && room.slice(0, i).join("").trim() !== "") end = i;
  }
  const kept = dropTrailing(room.slice(0, end)).join("");
  if (hasContent(kept)) return `${kept}...`;
  // r11-r14: the kept part is whitespace, punctuation and symbols only: a hard cut from the text's first
  // non-whitespace, its trailing graphemes dropped as above; when that leaves no letter, digit, mark, emoji or flag, a
  // hard cut from the text's first one; a text with none keeps its punctuation and symbols, never whitespace, before
  // the "...".
  const cutAt = (i: number) => g.slice(i, i + max - 3);
  const start = g.findIndex((c) => !isSpace(c));
  if (start < 0) return "";
  let cut = dropTrailing(cutAt(start)).join("");
  if (!hasContent(cut)) {
    const content = g.findIndex((c) => hasContent(c));
    cut = content < 0 ? cutAt(start).join("").replace(/\s+$/u, "") : dropTrailing(cutAt(content)).join("");
  }
  return `${cut}...`;
}

/** `n thing(s)`, for any count-bearing string. */
export const counted = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

/** P231 r5-r7: text still holding a [bracketed] part (a suggestion's placeholder) for the merchant to fill in. */
export const HAS_PLACEHOLDER = /\[[^\]]+\]/;

/** The FAQ entries still holding a [bracketed] part, in the question or the answer. */
export function unfilledFaqEntries<E extends { question?: string; answer?: string }>(entries: E[] | null | undefined): E[] {
  return (entries ?? []).filter((e) => HAS_PLACEHOLDER.test(e.question ?? "") || HAS_PLACEHOLDER.test(e.answer ?? ""));
}
