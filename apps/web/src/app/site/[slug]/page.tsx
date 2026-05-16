import { getApiBase } from "@/lib/api-base";
import { redirect } from "next/navigation";
import PresenceRenderer from "../_components/presence-renderer";
import { PresenceJsonLd } from "../_components/presence-jsonld";
import { PresenceTracker } from "../../_lib/PresenceTracker";
import { PoweredByKeyFlow } from "../_components/powered-by-keyflow";
import { WhatsAppShare } from "../_components/whatsapp-share";
import CaseStudiesSection, { type PublicCaseStudy } from "../_components/case-studies-section";

const API_BASE = getApiBase();
const PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";

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

async function fetchPublicCaseStudies(slug: string): Promise<PublicCaseStudy[]> {
  try {
    const res = await fetch(`${API_BASE}/site/storefront/public/${encodeURIComponent(slug)}/case-studies`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as PublicCaseStudy[]) : [];
  } catch { return []; }
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const data = await fetchPublished(slug);
  if (!data) return { title: "Site not found" };
  const seo = data.payload?.seo ?? {};
  const robots = seo.robotsIndex === false ? { index: false, follow: false } : undefined;
  const title = seo.metaTitle || data.business.name;
  const description = seo.metaDescription || data.business.tagline || data.business.description;
  const images = seo.socialImageUrl
    ? [seo.socialImageUrl]
    : (data.business.logoUrl ? [data.business.logoUrl] : []);
  const canonicalUrl = seo.canonicalUrl || (PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/site/${slug}` : `/site/${slug}`);
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    robots,
    openGraph: {
      type: "website",
      url: canonicalUrl,
      title,
      description,
      images,
      siteName: data.business.name,
    },
    // Per-page Twitter card override hooks: storefront SEO settings
    // can supply twitterTitle / twitterDescription / twitterImage to
    // tailor the social preview without changing the OG values used
    // by Facebook and LinkedIn.
    twitter: {
      card: "summary_large_image",
      title: seo.twitterTitle || title,
      description: seo.twitterDescription || description,
      images: seo.twitterImage ? [seo.twitterImage] : images,
    },
  };
}

export default async function PublicSitePage({ params }: Props) {
  const { slug } = await params;
  const [data, caseStudies] = await Promise.all([
    fetchPublished(slug),
    fetchPublicCaseStudies(slug),
  ]);
  if (!data) {
    // Fall back to legacy /book/[slug] storefront if there's no published presence yet
    redirect(`/book/${encodeURIComponent(slug)}`);
  }
  // The published payload carries the active plan tier (FREE/FLOW/KEYFLOW)
  // so the renderer can hide the Powered-by badge for paying customers
  // without an extra round trip.
  const plan: string = data.plan ?? "FREE";
  const shareUrl = PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/site/${slug}` : `/site/${slug}`;
  return (
    <>
      <PresenceTracker businessId={data.business?.id ?? null} />
      <PresenceJsonLd business={data.business} payload={data.payload} slug={slug} catalog={data.catalog} />
      <PresenceRenderer business={data.business} payload={data.payload} />
      <CaseStudiesSection studies={caseStudies} primaryColor={data.business.primaryColor || undefined} />
      <div className="px-6 py-6 flex justify-center">
        <WhatsAppShare
          businessId={data.business?.id ?? undefined}
          businessName={data.business.name}
          shareUrl={shareUrl}
          primaryColor={data.business.primaryColor || "#25D366"}
        />
      </div>
      <PoweredByKeyFlow plan={plan} />
    </>
  );
}
