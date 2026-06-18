import { redirect } from "next/navigation";

export default function BlueprintRedirectPage() {
  redirect("/app/profile?tab=business-genome&section=advanced-editor");
}
