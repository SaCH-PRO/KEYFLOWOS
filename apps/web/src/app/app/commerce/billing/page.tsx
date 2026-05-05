import { redirect } from "next/navigation";

export default function LegacyCommerceBillingRedirect() {
  redirect(`/app/settings/billing`);
}
