import { redirect } from "next/navigation";

export default async function LegacyBillingRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const sub = tab || "payments";
  redirect(`/app/commerce/collections?tab=${encodeURIComponent(sub)}`);
}
