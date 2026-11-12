'use client';

import { PublicPageState } from "@/components/ui/public-page-state";

/**
 * Retired: "enter an invoice ID to pay".
 *
 * V1-46b-TOKEN-PAY-COMPLETE (CR-01; D-07, ruled 2026-10-31 by the owner:
 * token links only, the bare-id pay page is retired). This form sent the
 * customer to /pay/<invoiceId>, the retired bare-id page, so it could only
 * ever end on "no longer used". Invoices are paid through the token link the
 * business sends (/public/invoice/<token> -> /pay/link/<token>); this page
 * says so and sends nobody anywhere.
 */
export default function PublicPayPage() {
  return (
    <>
      {/* R0-15d: no business is known here, so no page view is attributed (it was the demo tenant's). */}
      <PublicPageState
        variant="empty"
        title="This payment address is no longer used"
        message="For your security, invoices are now paid only through the secure payment link the business sent you. Please use that link, or contact the business for a new one."
      />
    </>
  );
}
