"use client";

import { PublicPageState } from "@/components/ui/public-page-state";

/**
 * Retired: the bare-id pay page.
 *
 * V1-46-PUB-PAY-LINK-TOKEN-GATE (M34; D-07, ruled 2026-10-31 by the owner:
 * token links only, the bare-id pay page is retired). This page read the
 * invoice and recorded payment intents by the bare invoice id, so anyone
 * holding the id could keep paying through it after the business deactivated
 * or let the link expire. Customers pay at /pay/link/[token], which the
 * business's link and the public invoice page (/public/invoice/[token]) lead
 * to; the token there is the credential and stops working when revoked.
 *
 * Nothing is read or written here: the page states that the address is no
 * longer used and sends the customer back to the business for their link.
 */
export default function RetiredBareIdPaymentPage() {
  return (
    <PublicPageState
      variant="empty"
      title="This payment address is no longer used"
      message="For your security, invoices are now paid only through the secure payment link the business sent you. Please use that link, or contact the business for a new one."
    />
  );
}
