import type { Metadata, ResolvingMetadata } from "next";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

type Props = {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
};

async function fetchBusiness(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/identity/businesses/slug/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (res.ok) return await res.json();
    const fallback = await fetch(`${API_BASE}/identity/businesses/public/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (fallback.ok) return await fallback.json();
    return null;
  } catch {
    return null;
  }
}

async function fetchStorefrontConfig(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/site/storefront/public/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300 },
    });
    if (res.ok) {
      const data = await res.json();
      return data?.storefront ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug } = await params;
  const biz = await fetchBusiness(slug);

  if (!biz) {
    return {
      title: "Store Not Found | KeyFlowOS",
      description: "This store could not be found.",
    };
  }

  const sfConfig = await fetchStorefrontConfig(slug);
  const seo = sfConfig?.seo as { metaTitle?: string; metaDescription?: string; ogImage?: string } | undefined;

  const title = seo?.metaTitle || `${biz.name} | Book Online`;
  const description = seo?.metaDescription || biz.tagline || `Book an appointment with ${biz.name} online.`;
  const ogImage = seo?.ogImage || biz.logoUrl;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "KeyFlowOS",
      ...(ogImage ? { images: [{ url: ogImage, width: ogImage === biz.logoUrl ? 200 : 1200, height: ogImage === biz.logoUrl ? 200 : 630, alt: biz.name }] } : {}),
    },
    twitter: {
      card: seo?.ogImage ? "summary_large_image" : "summary",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default function BookingLayout({ children }: Props) {
  return <>{children}</>;
}
