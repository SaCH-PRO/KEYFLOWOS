"use client";

import type { Business, CatalogItem } from "./types";

function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/<\//g, "<\\/");
}

type OrganizationProps = {
  business: Business;
  url: string;
};

export function OrganizationSchema({ business, url }: OrganizationProps) {
  if (!url) return null;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: business.name,
    url,
    ...(business.logoUrl && { logo: business.logoUrl }),
    ...(business.description && { description: business.description }),
    ...(business.email && { email: business.email }),
    ...(business.phone && { telephone: business.phone }),
    ...(business.address && {
      address: {
        "@type": "PostalAddress",
        streetAddress: business.address,
      },
    }),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}

type ProductSchemaProps = {
  item: CatalogItem;
  businessName: string;
  url: string;
};

export function ProductSchema({ item, businessName, url }: ProductSchemaProps) {
  if (!url) return null;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.name,
    ...(item.description && { description: item.description }),
    ...(item.imageUrl && { image: item.imageUrl }),
    offers: {
      "@type": "Offer",
      price: item.price,
      priceCurrency: item.currency,
      availability: "https://schema.org/InStock",
      seller: {
        "@type": "Organization",
        name: businessName,
      },
    },
    url,
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}

type BreadcrumbSchemaProps = {
  items: { name: string; url: string }[];
};

export function BreadcrumbListSchema({ items }: BreadcrumbSchemaProps) {
  if (items.length === 0) return null;

  const validItems = items.filter((i) => i.url);
  if (validItems.length === 0) return null;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: validItems.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}
