import { redirect } from "next/navigation";

export default function AccountsRedirectPage() {
  redirect("/app/finance?tab=accounts");
}
