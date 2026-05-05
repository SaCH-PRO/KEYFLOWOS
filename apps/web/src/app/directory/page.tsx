import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";

export const dynamic = "force-dynamic";
export const revalidate = 60;

type DirectoryItem = {
  slug: string;
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  headline: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  publishedAt: string | null;
};

type DirectoryFilterFacet = { value: string; count: number };

type DirectoryResponse = {
  items: DirectoryItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  filters: { industries: DirectoryFilterFacet[]; cities: DirectoryFilterFacet[] };
};

type SearchParams = Record<string, string | string[] | undefined>;

function pickStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function fetchDirectory(params: SearchParams): Promise<DirectoryResponse | null> {
  const qs = new URLSearchParams();
  const industry = pickStr(params.industry);
  const city = pickStr(params.city);
  const q = pickStr(params.q);
  const page = pickStr(params.page);
  if (industry) qs.set("industry", industry);
  if (city) qs.set("city", city);
  if (q) qs.set("q", q);
  if (page) qs.set("page", page);
  try {
    const res = await fetch(`${API_BASE}/site/presence/directory?${qs.toString()}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as DirectoryResponse;
  } catch {
    return null;
  }
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const industry = pickStr(params.industry);
  const city = pickStr(params.city);
  const parts = ["Business Directory"];
  if (industry) parts.push(industry);
  if (city) parts.push(city);
  const title = `${parts.join(" · ")} | KeyFlow`;
  const description = `Discover ${industry ?? "businesses"} in ${city ?? "your area"} powered by KeyFlow. Browse storefronts, services and contacts.`;
  const canonical = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/directory` : "/directory";
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      siteName: "KeyFlow",
    },
    robots: { index: true, follow: true },
  };
}

function buildHref(base: SearchParams, overrides: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  const merged: Record<string, string | undefined> = {
    industry: pickStr(base.industry),
    city: pickStr(base.city),
    q: pickStr(base.q),
    page: pickStr(base.page),
    ...overrides,
  };
  for (const [k, v] of Object.entries(merged)) {
    if (v && v.length > 0) next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `/directory?${qs}` : "/directory";
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const data = await fetchDirectory(params);
  const industry = pickStr(params.industry);
  const city = pickStr(params.city);
  const q = pickStr(params.q);
  const page = Number(pickStr(params.page) ?? "1") || 1;

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;
  const industries = data?.filters.industries ?? [];
  const cities = data?.filters.cities ?? [];

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "KeyFlow Business Directory",
    numberOfItems: items.length,
    itemListElement: items.map((b, i) => {
      const url = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/site/${b.slug}` : `/site/${b.slug}`;
      return {
        "@type": "ListItem",
        position: i + 1,
        url,
        item: {
          "@type": "LocalBusiness",
          name: b.name,
          url,
          image: b.logoUrl || undefined,
          description: b.headline || b.tagline || undefined,
          address: b.city || b.country
            ? {
                "@type": "PostalAddress",
                addressLocality: b.city || undefined,
                addressCountry: b.country || undefined,
              }
            : undefined,
        },
      };
    }),
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-black text-zinc-100">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd).replace(/<\//g, "<\\/") }}
      />
      <header className="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            KeyFlow
          </Link>
          <nav className="text-sm text-zinc-400 flex items-center gap-4">
            <Link href="/pricing" className="hover:text-zinc-100">Pricing</Link>
            <Link href="/auth/sign-up" className="rounded-full bg-orange-500 px-4 py-1.5 text-zinc-950 font-medium hover:bg-orange-400">
              Get listed
            </Link>
          </nav>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-12 pb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-orange-400/80">Business directory</p>
        <h1 className="mt-3 text-3xl md:text-5xl font-bold tracking-tight">
          Discover {total > 0 ? `${total.toLocaleString()} ` : ""}businesses on KeyFlow
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-400">
          Browse every published storefront on the network. Filter by industry or city to find the right team
          for your next project — every entry links straight to the live business page.
        </p>

        <form action="/directory" method="get" className="mt-8 flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search businesses, services, taglines"
            className="flex-1 min-w-[240px] rounded-full border border-zinc-800 bg-zinc-900/60 px-5 py-3 text-sm placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none"
            maxLength={80}
          />
          {industry ? <input type="hidden" name="industry" value={industry} /> : null}
          {city ? <input type="hidden" name="city" value={city} /> : null}
          <button
            type="submit"
            className="rounded-full bg-orange-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-orange-400"
          >
            Search
          </button>
          {(q || industry || city) && (
            <Link
              href="/directory"
              className="rounded-full border border-zinc-800 px-5 py-3 text-sm text-zinc-400 hover:text-zinc-100"
            >
              Clear filters
            </Link>
          )}
        </form>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8">
          <aside className="space-y-8 lg:sticky lg:top-28 self-start">
            <FacetGroup
              title="Industry"
              facets={industries}
              activeValue={industry}
              hrefFor={(value) => buildHref(params, { industry: value, page: undefined })}
              clearHref={buildHref(params, { industry: undefined, page: undefined })}
            />
            <FacetGroup
              title="City"
              facets={cities}
              activeValue={city}
              hrefFor={(value) => buildHref(params, { city: value, page: undefined })}
              clearHref={buildHref(params, { city: undefined, page: undefined })}
            />
          </aside>

          <div>
            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-12 text-center">
                <h2 className="text-lg font-semibold">No businesses match those filters yet.</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Try clearing a filter, or <Link className="text-orange-400 hover:text-orange-300" href="/auth/sign-up">publish your own storefront</Link> to be the first.
                </p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {items.map((b) => (
                  <li key={b.slug}>
                    <DirectoryCard item={b} />
                  </li>
                ))}
              </ul>
            )}

            {pageCount > 1 ? (
              <nav className="mt-10 flex items-center justify-between text-sm text-zinc-400">
                <div>
                  Page {page} of {pageCount}
                </div>
                <div className="flex items-center gap-2">
                  {page > 1 ? (
                    <Link
                      href={buildHref(params, { page: String(page - 1) })}
                      className="rounded-full border border-zinc-800 px-4 py-2 hover:text-zinc-100"
                    >
                      ← Previous
                    </Link>
                  ) : null}
                  {page < pageCount ? (
                    <Link
                      href={buildHref(params, { page: String(page + 1) })}
                      className="rounded-full border border-zinc-800 px-4 py-2 hover:text-zinc-100"
                    >
                      Next →
                    </Link>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-900 py-8 text-center text-xs text-zinc-500">
        Powered by KeyFlow · <Link href="/" className="hover:text-zinc-300">keyflow.app</Link>
      </footer>
    </main>
  );
}

function FacetGroup({
  title,
  facets,
  activeValue,
  hrefFor,
  clearHref,
}: {
  title: string;
  facets: DirectoryFilterFacet[];
  activeValue?: string;
  hrefFor: (value: string) => string;
  clearHref: string;
}) {
  if (!facets.length && !activeValue) return null;
  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        {activeValue ? (
          <Link href={clearHref} className="text-xs text-orange-400 hover:text-orange-300">
            Clear
          </Link>
        ) : null}
      </div>
      <ul className="mt-3 space-y-1">
        {facets.slice(0, 12).map((f) => {
          const active = activeValue && activeValue.toLowerCase() === f.value.toLowerCase();
          return (
            <li key={f.value}>
              <Link
                href={active ? clearHref : hrefFor(f.value)}
                className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-orange-500/15 text-orange-200"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                }`}
              >
                <span className="truncate">{f.value}</span>
                <span className="ml-2 shrink-0 text-xs text-zinc-500">{f.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DirectoryCard({ item }: { item: DirectoryItem }) {
  const subtitle = item.headline || item.tagline || item.industry || "";
  const location = [item.city, item.country].filter(Boolean).join(", ");
  return (
    <Link
      href={`/site/${item.slug}`}
      className="group flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 transition hover:-translate-y-0.5 hover:border-orange-500/60 hover:bg-zinc-900/70"
    >
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-800 ring-1 ring-zinc-700/60 flex items-center justify-center text-sm font-semibold text-zinc-300">
          {item.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.logoUrl} alt={`${item.name} logo`} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span>{item.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-zinc-100 group-hover:text-orange-200">
            {item.name}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-zinc-400">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {item.industry ? (
          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1">{item.industry}</span>
        ) : null}
        {location ? (
          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1">{location}</span>
        ) : null}
      </div>
    </Link>
  );
}
