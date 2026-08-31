import { redirect } from "next/navigation";

export default function DocumentsPage() {
  redirect("/app/profile?tab=outputs");
}
