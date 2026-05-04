import { redirect } from "next/navigation";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const sub = tab || "payments";
  redirect(`/app/commerce?tab=${encodeURIComponent(sub)}&surface=collections`);
}
