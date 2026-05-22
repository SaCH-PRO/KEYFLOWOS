import type { MetadataRoute } from "next";

interface DirectoryItem {
  slug: string;
  publishedAt: string | null;
}

interface DirectoryResponse {
  items: DirectoryItem[];
  total: number;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://keyflowos.com";

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/directory`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/pricing`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/auth/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/auth/signup`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ];

  let businessRoutes: MetadataRoute.Sitemap = [];

  try {
    // Fetch all published businesses (max 5000 for sitemap)
    const res = await fetch(
      `${baseUrl}/site/presence/directory?page=1&pageSize=5000`,
      { next: { revalidate: 3600 } } // Revalidate every hour
    );

    if (res.ok) {
      const data: DirectoryResponse = await res.json();
      businessRoutes = data.items.map((item) => ({
        url: `${baseUrl}/site/${item.slug}`,
        lastModified: item.publishedAt ? new Date(item.publishedAt) : new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }));
    }
  } catch {
    // Silently fail — static routes are better than no sitemap
  }

  return [...staticRoutes, ...businessRoutes];
}
