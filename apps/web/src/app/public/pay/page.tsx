'use client';

import { PublicPageState } from "@/components/ui/public-page-state";
import { DEFAULT_BUSINESS_ID } from "@/lib/client";
import { PresenceTracker } from "@/app/_lib/PresenceTracker";

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
      <PresenceTracker businessId={DEFAULT_BUSINESS_ID || null} />
      <PublicPageState
        variant="empty"
        title="This payment address is no longer used"
        message="For your security, invoices are now paid only through the secure payment link the business sent you. Please use that link, or contact the business for a new one."
      />
    </>
  );
}
