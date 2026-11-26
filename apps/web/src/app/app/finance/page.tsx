import { redirect } from "next/navigation";

/**
 * SWP-FIN-WEB-CRASHES: /app/finance is a server redirect to the money overview. It was a client component that
 * called redirect() while rendering in the browser; next.config also redirects /app/finance, and this page is the
 * fallback when that redirect does not apply.
 */
export default function FinanceRedirectPage() {
  redirect("/app/financial-flow");
}
