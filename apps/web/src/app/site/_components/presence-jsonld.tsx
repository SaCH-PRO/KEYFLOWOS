type PresenceSection = { id: string; type: string; visible: boolean; data: Record<string, unknown> };
type Payload = {
  branding: { logoUrl?: string; primaryColor?: string };
  sections: PresenceSection[];
  seo: { metaTitle?: string; metaDescription?: string; socialImageUrl?: string; canonicalUrl?: string };
  slug?: string;
};
type PublicBusiness = {
  id: string; name: string; slug?: string | null; logoUrl?: string | null; tagline?: string | null;
  description?: string | null; address?: string | null; city?: string | null; country?: string | null;
  phone?: string | null; email?: string | null; whatsapp?: string | null;
};

type CatalogService = {
  id: string; name: string; description?: string | null; price?: number | null;
  duration?: number | null;
};
type CatalogProduct = {
  id: string; name: string; description?: string | null; price?: number | null;
  currency?: string | null; imageUrl?: string | null; sku?: string | null;
};
type Catalog = { services?: CatalogService[]; products?: CatalogProduct[] };

function safeJson(data: unknown): string {
  return JSON.stringify(data).replace(/<\//g, "<\\/");
}

/**
 * Renders schema.org JSON-LD for the published presence:
 *   - LocalBusiness (always)
 *   - Service entries derived from the catalog (visible only when the
 *     "services" section is enabled)
 *   - Product entries derived from the catalog (visible only when the
 *     "products" section is enabled)
 * Each is emitted as its own <script type="application/ld+json"> tag so
 * crawlers can parse them independently.
 */
export function PresenceJsonLd({
  business,
  payload,
  slug,
  catalog,
}: {
  business: PublicBusiness;
  payload: Payload;
  slug: string;
  catalog?: Catalog;
}) {
  const heroSection = payload.sections.find((s) => s.type === "hero");
  const aboutSection = payload.sections.find((s) => s.type === "about");
  const url = payload.seo.canonicalUrl || `/site/${slug}`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": url,
    name: payload.seo.metaTitle || business.name,
    description: payload.seo.metaDescription || (aboutSection?.data?.body as string) || business.description || (heroSection?.data?.subheadline as string) || undefined,
    url,
    image: payload.seo.socialImageUrl || business.logoUrl || payload.branding.logoUrl || undefined,
    telephone: business.phone || undefined,
    email: business.email || undefined,
    address: business.address ? {
      "@type": "PostalAddress",
      streetAddress: business.address,
      addressLocality: business.city || undefined,
      addressCountry: business.country || undefined,
    } : undefined,
  };
  const servicesVisible = payload.sections.some((s) => s.type === "services" && s.visible);
  const productsVisible = payload.sections.some((s) => s.type === "products" && s.visible);
  const services = (catalog?.services ?? []).filter(Boolean);
  const products = (catalog?.products ?? []).filter(Boolean);

  const serviceLd = servicesVisible
    ? services.map((svc) => ({
        "@context": "https://schema.org",
        "@type": "Service",
        "@id": `${url}#service-${svc.id}`,
        name: svc.name,
        description: svc.description || undefined,
        provider: { "@type": "LocalBusiness", "@id": url, name: business.name },
        areaServed: business.city || business.country || undefined,
        offers:
          svc.price != null
            ? {
                "@type": "Offer",
                price: Number(svc.price),
                priceCurrency: "USD",
                availability: "https://schema.org/InStock",
              }
            : undefined,
      }))
    : [];

  const productLd = productsVisible
    ? products.map((p) => ({
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": `${url}#product-${p.id}`,
        name: p.name,
        description: p.description || undefined,
        image: p.imageUrl || undefined,
        sku: p.sku || undefined,
        brand: { "@type": "Brand", name: business.name },
        offers:
          p.price != null
            ? {
                "@type": "Offer",
                price: Number(p.price),
                priceCurrency: p.currency || "USD",
                availability: "https://schema.org/InStock",
                url,
              }
            : undefined,
      }))
    : [];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJson(ld) }} />
      {serviceLd.map((s) => (
        <script
          key={s["@id"]}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJson(s) }}
        />
      ))}
      {productLd.map((p) => (
        <script
          key={p["@id"]}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJson(p) }}
        />
      ))}
    </>
  );
}
