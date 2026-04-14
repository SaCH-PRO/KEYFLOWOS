import type { Metadata, ResolvingMetadata } from "next";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

type Props = {
  params: Promise<{ slug: string; productId: string }>;
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

async function fetchProduct(slug: string, productId: string) {
  try {
    const res = await fetch(
      `${API_BASE}/site/storefront/public/${encodeURIComponent(slug)}/product/${encodeURIComponent(productId)}`,
      { next: { revalidate: 300 } }
    );
    if (res.ok) return await res.json();
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug, productId } = await params;
  const [biz, productData] = await Promise.all([
    fetchBusiness(slug),
    fetchProduct(slug, productId),
  ]);

  if (!biz) {
    return {
      title: "Product Not Found | KeyFlowOS",
      description: "This product could not be found.",
    };
  }

  const product = productData?.product ?? productData;
  const productName = product?.name ?? "Product";
  const productDesc = product?.description ?? `Check out ${productName} from ${biz.name}`;
  const productImage = product?.imageUrl ?? biz.logoUrl;
  const price = product?.price;
  const currency = product?.currency ?? biz.currency ?? "TTD";

  const title = `${productName} | ${biz.name}`;
  const description = typeof productDesc === "string" && productDesc.length > 160
    ? productDesc.slice(0, 157) + "..."
    : productDesc;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: biz.name,
      ...(productImage ? {
        images: [{
          url: productImage,
          width: 1200,
          height: 630,
          alt: productName,
        }],
      } : {}),
    },
    twitter: {
      card: productImage ? "summary_large_image" : "summary",
      title,
      description,
      ...(productImage ? { images: [productImage] } : {}),
    },
    ...(price != null ? {
      other: {
        "product:price:amount": String(price / 100),
        "product:price:currency": currency,
      },
    } : {}),
  };
}

export default function ProductLayout({ children }: Props) {
  return <>{children}</>;
}
