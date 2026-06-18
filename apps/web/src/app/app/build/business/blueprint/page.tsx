import { redirect } from "next/navigation";

export default function BusinessBlueprintRedirectPage() {
  redirect("/app/profile?tab=business-genome&section=advanced-editor");
}
