import { redirect } from "next/navigation";

export default function OnboardingRedirectPage() {
  redirect("/app/keyflow-command?openNotes=get-started");
}
