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

  const description = biz.tagline || `Book an appointment with ${biz.name} online.`;

  return {
    title: `${biz.name} | Book Online`,
    description,
    openGraph: {
      title: `${biz.name} | Book Online`,
      description,
      type: "website",
      siteName: "KeyFlowOS",
      ...(biz.logoUrl ? { images: [{ url: biz.logoUrl, width: 200, height: 200, alt: biz.name }] } : {}),
    },
    twitter: {
      card: "summary",
      title: `${biz.name} | Book Online`,
      description,
      ...(biz.logoUrl ? { images: [biz.logoUrl] } : {}),
    },
  };
}

export default function BookingLayout({ children }: Props) {
  return <>{children}</>;
}
