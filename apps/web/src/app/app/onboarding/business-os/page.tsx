import { redirect } from "next/navigation";

export default function OnboardingBusinessOsRedirectPage() {
  redirect("/app/profile?tab=business-genome");
}
