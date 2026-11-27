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
 * Counts products already on the store (liveProducts) and bookable services by kind, as /book draws them. A
 * SERVICE-category product with the name of a public service (`dedupeNames`, by default the services given) is not
 * drawn.
 */
export function offerOf(
  products: { category?: unknown; name?: unknown }[],
  services: { name?: unknown }[],
  dedupeNames: Iterable<unknown> = services.map((s) => s.name),
): StorefrontOffer {
  const names = new Set(dedupeNames);
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
  // r8: the de-dupe is against every public service, the hidden ones too (book/[slug]/page.tsx storeServiceNames).
  return offerOf(liveProducts(commerceProducts, liveProductIds, { ...opts, services }), bookable, publicServiceNames(services));
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
  const products = count(o.products);
  const packages = count(o.packages);
  const booked = count(o.services);
  const orderable = count(o.orderableServices);
  const services = booked + orderable;
  const shops = products + packages > 0;
  const books = booked > 0;
  const buys = products + packages + orderable > 0;
  const total = products + packages + services;
  const kinds: [number, string][] = [[products, "product"], [packages, "package"], [services, "service"]];
  const present = kinds.filter(([n]) => n > 0);
  const noun = list(present.map(([n, w]) => plural(n, w)));
  return {
    /** Products or packages to shop ("Shop Now", "Explore Collection", "Shop Online"). */
    shops,
    /** A bookable service. */
    books,
    /** Anything bought (products, packages, or services bought, not booked). */
    buys,
    total,
    noun,
    Noun: noun.replace(/\b(product|package|service)/g, (w) => w.charAt(0).toUpperCase() + w.slice(1)),
    counted: list(present.map(([n, w]) => `${n} ${plural(n, w)}`)),
    action: books && buys ? "Book or buy online." : buys ? "Buy online." : books ? "Book online." : "",
    items: `${total} ${plural(total, "item")}`,
    Items: `${total} ${plural(total, "Item")}`,
  };
}

/** `n thing(s)`, for any count-bearing string. */
export const counted = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

/** P231 r5-r7: text still holding a [bracketed] part (a suggestion's placeholder) for the merchant to fill in. */
export const HAS_PLACEHOLDER = /\[[^\]]+\]/;

/** The FAQ entries still holding a [bracketed] part, in the question or the answer. */
export function unfilledFaqEntries<E extends { question?: string; answer?: string }>(entries: E[] | null | undefined): E[] {
  return (entries ?? []).filter((e) => HAS_PLACEHOLDER.test(e.question ?? "") || HAS_PLACEHOLDER.test(e.answer ?? ""));
}
