import { redirect } from "next/navigation";

export default function JournalRedirectPage() {
  redirect("/app/finance/ledger");
}
