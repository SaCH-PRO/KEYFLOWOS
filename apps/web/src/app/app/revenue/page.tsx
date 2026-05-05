import { redirect } from "next/navigation";

export default async function RevenueRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else if (value != null) {
      qs.set(key, value);
    }
  }
  const suffix = qs.toString();
  redirect(`/app/commerce${suffix ? `?${suffix}` : ""}`);
}
