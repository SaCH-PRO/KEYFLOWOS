import { redirect } from "next/navigation";

/**
 * CUSTOMER-PAGE-HONESTY (journey G11): the old page builder's public page is retired (the builder is hidden by
 * NAV-B-HIDE); every visitor of /site/<slug> is sent to the one store page, /book/<slug>, also when the business
 * published a page in the builder. redirect() from a server component answers a temporary 307, so the address can
 * come back later; nothing of the builder's page is read or rendered here.
 */
type Props = { params: Promise<{ slug: string }> };

export default async function PublicSitePage({ params }: Props) {
  const { slug } = await params;
  redirect(`/book/${encodeURIComponent(slug)}`);
}
