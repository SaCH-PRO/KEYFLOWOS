import { redirect } from "next/navigation";

export default function CashflowRedirectPage() {
  redirect("/app/finance?tab=cashflow");
}
