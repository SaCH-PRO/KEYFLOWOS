import { redirect } from "next/navigation";
import PresenceRenderer from "../_components/presence-renderer";
import { PresenceJsonLd } from "../_components/presence-jsonld";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

type Props = { params: Promise<{ slug: string }> };

async function fetchPublished(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/site/presence/public/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const data = await fetchPublished(slug);
  if (!data) return { title: "Site not found" };
  const seo = data.payload?.seo ?? {};
  const robots = seo.robotsIndex === false ? { index: false, follow: false } : undefined;
  return {
    title: seo.metaTitle || data.business.name,
    description: seo.metaDescription || data.business.tagline || data.business.description,
    alternates: seo.canonicalUrl ? { canonical: seo.canonicalUrl } : undefined,
    robots,
    openGraph: {
      title: seo.metaTitle || data.business.name,
      description: seo.metaDescription || data.business.tagline,
      images: seo.socialImageUrl ? [seo.socialImageUrl] : (data.business.logoUrl ? [data.business.logoUrl] : []),
    },
  };
}

export default async function PublicSitePage({ params }: Props) {
  const { slug } = await params;
  const data = await fetchPublished(slug);
  if (!data) {
    // Fall back to legacy /book/[slug] storefront if there's no published presence yet
    redirect(`/book/${encodeURIComponent(slug)}`);
  }
  return (
    <>
      <PresenceJsonLd business={data.business} payload={data.payload} slug={slug} catalog={data.catalog} />
      <PresenceRenderer business={data.business} payload={data.payload} />
    </>
  );
}
