import { redirect } from "next/navigation";

export default function OnboardingRedirectPage() {
  redirect("/app/profile?tab=business-genome&intro=1");
}
