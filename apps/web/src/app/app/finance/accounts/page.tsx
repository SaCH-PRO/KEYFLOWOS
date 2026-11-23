import { redirect } from "next/navigation";

// V1-66 (SWP-FIN-LEDGER): the Accounts tab by query. The fragment ("#accounts") did not survive the redirect,
// so Finance settings opened on General; the settings shell reads ?tab= on mount.
export default function AccountsRedirectPage() {
  redirect("/app/finance/settings?tab=accounts");
}
